import { createHash } from 'node:crypto';
import { InputError } from '../members/validation.js';
import { idempotencyKey, stableJson } from '../members/registration.js';
import { validatePayment, validateEvidence, validateReason, moneyToCents, centsToMoney, paymentDecision } from './policy.js';

const digest=s=>createHash('sha256').update(s).digest('hex');
const conflict=(code,message)=>new InputError(code,message);

async function begin(client){ await client.query('BEGIN'); }
async function rollback(client){ try { await client.query('ROLLBACK'); } catch {} }

async function findCharge(client,chargeId){
  // Preserve the proven membership query, then handle external-match fees separately.
  const membership=await client.query(`SELECT c.id,c.member_id,c.amount,c.status,mc.membership_id
    FROM charges c JOIN membership_charges mc ON mc.charge_id=c.id
    WHERE c.id=$1 AND c.charge_type='membership' FOR UPDATE OF c`,[chargeId]);
  let charge;
  if(membership.rowCount)charge={...membership.rows[0],charge_type:'membership'};
  else {
    const external=await client.query(`SELECT c.id,c.member_id,c.amount,c.status,c.charge_type
      FROM charges c JOIN facilitation_charges fc ON fc.charge_id=c.id
      WHERE c.id=$1 AND c.charge_type='facilitation' FOR UPDATE OF c`,[chargeId]);
    if(!external.rowCount)throw conflict('CHARGE_NOT_FOUND','Supported charge not found.');
    charge=external.rows[0];
  }
  if(charge.status==='void')throw conflict('CHARGE_VOID','This charge is void.');
  return charge;
}
async function collectedCents(client,chargeId){
  // Reversed allocations are intentionally not counted. The ledger rows themselves remain.
  const result=await client.query(`SELECT COALESCE(SUM(a.amount),0)::text AS collected
    FROM payment_allocations a JOIN payments p ON p.id=a.payment_id
    WHERE a.charge_id=$1 AND p.status='verified'`,[chargeId]);
  return moneyToCentsNonNegative(result.rows[0].collected);
}
function moneyToCentsNonNegative(amount){
  const text=String(amount);
  if(text==='0' || text==='0.00') return 0;
  return moneyToCents(text.includes('.')?text:`${text}.00`);
}

// Caller holds the related charge lock, so one paid/active transition is serialized.
export async function reconcileCharge(client,charge){
  const billed=moneyToCents(String(charge.amount));
  const collected=await collectedCents(client,charge.id);
  if(collected>billed) throw new Error('Financial integrity mismatch: verified receipts exceed charge');
  const paid=collected===billed;
  await client.query(`UPDATE charges SET status=$2 WHERE id=$1`,[charge.id,paid?'paid':'outstanding']);
  // A facilitation fee is independent of membership activation.
  // Patron commission projections are calculated from verified allocations when read.
  if(charge.charge_type==='facilitation')return {collected:centsToMoney(collected),
    balance:centsToMoney(billed-collected),chargeStatus:paid?'paid':'outstanding'};
  // Membership is active only once the charge is fully paid and consent is satisfied.
  const member=await client.query(`SELECT m.id,m.date_of_birth,m.status,
    EXISTS(SELECT 1 FROM guardian_consents g WHERE g.member_id=m.id AND g.status='verified') AS has_consent
    FROM members m WHERE m.id=$1 FOR UPDATE`,[charge.member_id]);
  if(!member.rowCount) throw new Error('Member record missing for membership charge');
  const m=member.rows[0];
  // Age is derived by PostgreSQL. Guardian requirement must not be bypassed.
  const young=await client.query(`SELECT date_part('year',age(CURRENT_DATE,$1::date))<18 AS minor`,[m.date_of_birth]);
  const consentOk=!young.rows[0].minor || m.has_consent;
  const active=paid && consentOk && m.status!=='inactive';
  await client.query(`UPDATE memberships SET status=$2 WHERE id=$1 AND status<>'cancelled'`,
    [charge.membership_id,active?'active':'pending']);
  if(m.status!=='inactive'){
    await client.query(`UPDATE members SET status=$2,updated_at=now() WHERE id=$1`,
      [m.id,active?'active':(consentOk?'draft':'pending_consent')]);
  }
  return {collected:centsToMoney(collected),balance:centsToMoney(billed-collected),membershipStatus:active?'active':'pending',memberStatus:m.status==='inactive'?'inactive':active?'active':consentOk?'draft':'pending_consent'};
}

export async function recordPayment(pool,{actorId,roles,body,key}){
  const keyHash=idempotencyKey(key);
  if(!body || typeof body!=='object'||Array.isArray(body)) throw conflict('INVALID_PAYMENT','Payment details are required.');
  const payloadHash=digest(stableJson(body));
  const client=await pool.connect();
  try{
    await begin(client);
    await client.query(`INSERT INTO idempotency_requests(actor_user_id,operation,key_hash,payload_hash)
      VALUES($1,'payment.record',$2,$3) ON CONFLICT DO NOTHING`,[actorId,keyHash,payloadHash]);
    const replay=await client.query(`SELECT payload_hash,response_status,response_json FROM idempotency_requests
      WHERE actor_user_id=$1 AND operation='payment.record' AND key_hash=$2 FOR UPDATE`,[actorId,keyHash]);
    const existing=replay.rows[0];
    if(existing.payload_hash!==payloadHash) throw conflict('IDEMPOTENCY_CONFLICT','This request key was used for different payment details.');
    if(existing.response_status){await client.query('COMMIT');return {status:existing.response_status,data:existing.response_json,replayed:true};}
    const validated=validatePayment(body);
    const charge=await findCharge(client,validated.chargeId);
    if(charge.charge_type==='facilitation' && !roles?.some(r=>['FIN','ADM'].includes(r)))
      throw conflict('FORBIDDEN','Only finance or administrators may record external-match fees.');
    if(charge.status==='paid') throw conflict('CHARGE_ALREADY_PAID','This charge is already fully paid.');
    const billed=moneyToCents(String(charge.amount));
    const paid=await collectedCents(client,charge.id);
    if(moneyToCents(validated.amount)>billed-paid) throw conflict('OVERPAYMENT','Payment amount exceeds the unpaid membership balance.');
    const added=await client.query(`INSERT INTO payments(charge_id,amount,method,transfer_reference,recorded_by_user_id)
      VALUES($1,$2,$3,$4,$5) RETURNING id,recorded_at`,
      [charge.id,validated.amount,validated.method,validated.reference,actorId]);
    const data={id:String(added.rows[0].id),chargeId:String(charge.id),amount:validated.amount,currency:'KES',
      method:validated.method,reference:validated.reference,status:'pending',paymentStatus:'pending',
      message:'Recorded only. Independent verification required; no membership activation yet.'};
    await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata_summary)
      VALUES($1,'payment.record','payment',$2,$3)`,[actorId,String(added.rows[0].id),JSON.stringify({chargeId:String(charge.id),method:validated.method})]);
    await client.query(`UPDATE idempotency_requests SET response_status=201,response_json=$1
      WHERE actor_user_id=$2 AND operation='payment.record' AND key_hash=$3`,
      [JSON.stringify(data),actorId,keyHash]);
    await client.query('COMMIT');
    return {status:201,data,replayed:false};
  }catch(error){ await rollback(client);throw error; }
  finally{ client.release(); }
}

export async function verifyPayment(pool,{actorId,paymentId,evidenceReference}){
  const ref=validateEvidence(evidenceReference);
  const client=await pool.connect();
  try{
    await begin(client);
    const lookup=await client.query(`SELECT id,charge_id,amount,status,recorded_by_user_id,method FROM payments WHERE id=$1 FOR UPDATE`,[paymentId]);
    if(!lookup.rowCount) throw conflict('PAYMENT_NOT_FOUND','Payment not found.');
    const p=lookup.rows[0];
    if(String(p.recorded_by_user_id)===String(actorId)) throw conflict('MAKER_CHECKER_REQUIRED','A different authorized officer must verify this payment.');
    if(p.status!=='pending') throw conflict('PAYMENT_NOT_PENDING','Only pending payments can be verified.');
    const charge=await findCharge(client,p.charge_id);
    const paid=await collectedCents(client,charge.id);
    paymentDecision(moneyToCents(String(charge.amount)),paid,moneyToCents(String(p.amount)));
    // Verification itself is a human attestation based on independent external evidence.
    await client.query(`UPDATE payments SET status='verified',verified_at=now(),verified_by_user_id=$2,
      verification_reference=$3 WHERE id=$1`,[paymentId,actorId,ref]);
    await client.query(`INSERT INTO payment_allocations(payment_id,charge_id,amount) VALUES($1,$2,$3)`,[paymentId,charge.id,p.amount]);
    const summary=await reconcileCharge(client,charge);
    await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata_summary)
      VALUES($1,'payment.verify','payment',$2,$3)`,[actorId,String(paymentId),JSON.stringify({chargeId:String(charge.id)})]);
    await client.query('COMMIT');
    return {paymentId:String(paymentId),status:'verified',chargeId:String(charge.id),...summary};
  }catch(error){await rollback(client);throw error;} finally{client.release();}
}

export async function reversePayment(pool,{actorId,paymentId,reason}){
  const message=validateReason(reason);
  const client=await pool.connect();
  try{
    await begin(client);
    const lookup=await client.query(`SELECT id,charge_id,status,amount FROM payments WHERE id=$1 FOR UPDATE`,[paymentId]);
    if(!lookup.rowCount) throw conflict('PAYMENT_NOT_FOUND','Payment not found.');
    const p=lookup.rows[0];
    if(p.status!=='verified') throw conflict('PAYMENT_NOT_VERIFIED','Only verified payments may be reversed.');
    const charge=await findCharge(client,p.charge_id);
    await client.query(`UPDATE payments SET status='reversed',reversed_at=now(),reversed_by_user_id=$2,reversal_reason=$3 WHERE id=$1`,
      [paymentId,actorId,message]);
    const summary=await reconcileCharge(client,charge);
    await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata_summary)
      VALUES($1,'payment.reverse','payment',$2,$3)`,[actorId,String(paymentId),JSON.stringify({chargeId:String(charge.id)})]);
    await client.query('COMMIT');
    return {paymentId:String(paymentId),status:'reversed',chargeId:String(charge.id),...summary};
  }catch(error){await rollback(client);throw error;} finally{client.release();}
}
