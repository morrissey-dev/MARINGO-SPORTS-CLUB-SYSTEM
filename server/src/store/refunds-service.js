import {createHash} from 'node:crypto';
import {InputError} from '../members/validation.js';
import {idempotencyKey,stableJson} from '../members/registration.js';
import {positiveId} from './policy.js';
import {validateRefundRequest,validateRefundDecision,refundStatusLabel} from './refunds-policy.js';
const fail=(code,message)=>new InputError(code,message);
async function transaction(pool,fn){const db=await pool.connect();try{await db.query('BEGIN');const r=await fn(db);await db.query('COMMIT');return r;}catch(err){await db.query('ROLLBACK');throw err;}finally{db.release();}}
async function audit(db,actor,action,id,metadata={}){
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata_summary)
    VALUES($1,$2,'store_refund',$3,$4)`,[actor,action,String(id),JSON.stringify(metadata)]);
}
// The parent return is always locked first, matching inspection's locking discipline.
export async function requestStoreRefund(pool,{actorId,returnId,body,key}){
  const id=positiveId(returnId,'return');const input=validateRefundRequest(body);
  const keyHash=createHash('sha256').update(String(actorId)+':refund:'+idempotencyKey(key)).digest('hex');
  const payloadHash=createHash('sha256').update(stableJson({returnId:id,...input})).digest('hex');
  return transaction(pool,async db=>{
    const ret=await db.query(`SELECT id,sale_id,status,refund_due FROM store_returns WHERE id=$1 FOR UPDATE`,[id]);
    if(!ret.rowCount)throw fail('RETURN_NOT_FOUND','Return not found.');
    const existing=await db.query('SELECT id,status,request_key_hash,request_payload_hash FROM store_refunds WHERE return_id=$1',[id]);
    if(existing.rowCount){
      const prior=existing.rows[0];
      if(prior.request_key_hash===keyHash&&prior.request_payload_hash===payloadHash)
        return {id:String(prior.id),returnId:id,status:prior.status,replayed:true};
      throw fail('REFUND_ALREADY_REQUESTED','A refund has already been requested for this return.');
    }
    if(ret.rows[0].status!=='accepted')throw fail('RETURN_NOT_ACCEPTED','Only accepted and inspected returns are eligible for refunds.');
    const amount=String(ret.rows[0].refund_due);
    if(!/^\d+\.\d{2}$/.test(amount)||Number(amount)<=0)
      throw fail('REFUND_NOT_DUE','This return does not have a payable refund entitlement.');
    const created=await db.query(`INSERT INTO store_refunds(return_id,sale_id,amount,method,reason,requested_by_user_id,request_key_hash,request_payload_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[id,ret.rows[0].sale_id,amount,input.method,input.reason,actorId,keyHash,payloadHash]);
    const refundId=String(created.rows[0].id);
    await audit(db,actorId,'store.refund.request',refundId,{returnId:id,saleId:String(ret.rows[0].sale_id),amount});
    return {id:refundId,returnId:id,status:'pending',amount,method:input.method,refundStatus:'pending_verification'};
  });
}
export async function reviewStoreRefund(pool,{actorId,refundId,body}){
  const id=positiveId(refundId,'refund');const decision=validateRefundDecision(body);
  return transaction(pool,async db=>{
    // Lock the corresponding return first, then refund, to prevent two reviewers processing it simultaneously.
    const pointer=await db.query('SELECT return_id FROM store_refunds WHERE id=$1',[id]);
    if(!pointer.rowCount)throw fail('REFUND_NOT_FOUND','Refund not found.');
    const ret=await db.query('SELECT id,status,refund_due FROM store_returns WHERE id=$1 FOR UPDATE',[pointer.rows[0].return_id]);
    const refund=await db.query('SELECT * FROM store_refunds WHERE id=$1 FOR UPDATE',[id]);
    const row=refund.rows[0];
    if(row.status!=='pending')throw fail('REFUND_ALREADY_REVIEWED','Refund request has already been processed.');
    if(String(row.requested_by_user_id)===String(actorId))throw fail('SEPARATION_OF_DUTIES','Another authorized officer must verify repayment.');
    if(ret.rows[0].status!=='accepted'||String(ret.rows[0].refund_due)!==String(row.amount))
      throw fail('REFUND_ENTITLEMENT_CHANGED','Refund entitlement is no longer valid.');
    if(decision.decision==='reject'){
      await db.query(`UPDATE store_refunds SET status='rejected',reviewed_by_user_id=$2,reviewed_at=now(),evidence_note=$3 WHERE id=$1`,[id,actorId,decision.reason]);
      await audit(db,actorId,'store.refund.reject',id,{reason:decision.reason});
      return {id,returnId:String(row.return_id),status:'rejected',refundStatus:'rejected'};
    }
    await db.query(`UPDATE store_refunds SET status='paid',reviewed_by_user_id=$2,reviewed_at=now(),evidence_reference=$3,evidence_note=$4 WHERE id=$1`,
      [id,actorId,decision.evidenceReference,decision.evidenceNote]);
    await audit(db,actorId,'store.refund.paid',id,{method:row.method,amount:String(row.amount),evidenceReference:decision.evidenceReference});
    return {id,returnId:String(row.return_id),status:'paid',amount:String(row.amount),method:row.method,refundStatus:'paid'};
  });
}
export async function listStoreRefunds(pool){
  const result=await pool.query(`SELECT f.id,f.return_id,f.sale_id,f.amount,f.method,f.status,f.requested_at,f.reviewed_at,
    f.requested_by_user_id,f.reviewed_by_user_id,f.evidence_reference
    FROM store_refunds f ORDER BY f.id DESC LIMIT 80`);
  return result.rows.map(x=>({id:String(x.id),returnId:String(x.return_id),saleId:String(x.sale_id),amount:String(x.amount),
    method:x.method,status:x.status,refundStatus:refundStatusLabel(x),requestedAt:x.requested_at,reviewedAt:x.reviewed_at,
    requestedByUserId:String(x.requested_by_user_id),reviewedByUserId:x.reviewed_by_user_id?String(x.reviewed_by_user_id):null,
    evidenceReference:x.evidence_reference||null}));
}
