import { createHash } from 'node:crypto';
import { InputError,validateMember,kenyaDate } from './validation.js';

const hex = value => createHash('sha256').update(value).digest('hex');
const sqlError = (code,message) => new InputError(code,message);

export function stableJson(value){
  if(Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if(value && typeof value==='object') return `{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableJson(value[k])).join(',')}}`;
  return JSON.stringify(value);
}

export function idempotencyKey(raw) {
  if(typeof raw!=='string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(raw)) throw sqlError('IDEMPOTENCY_REQUIRED','Use a new Idempotency-Key (16–128 letters, digits, - or _).');
  return hex(raw);
}

export async function registerMember(pool,{actorId,body,key,onDate=kenyaDate()}) {
  const keyHash=idempotencyKey(key);
  if(!body || typeof body!=='object'||Array.isArray(body)) throw sqlError('INVALID_MEMBER','Provide a member record.');
  // Hash the submitted fields (not time-derived age): a retry after midnight
  // must still retrieve its original successful response.
  const payloadHash=hex(stableJson(body));
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    // Concurrent requests using the same key are serialized by PostgreSQL's unique constraint.
    await client.query(`INSERT INTO idempotency_requests(actor_user_id,operation,key_hash,payload_hash)
      VALUES($1,'member.create',$2,$3) ON CONFLICT DO NOTHING`,[actorId,keyHash,payloadHash]);
    const replay=await client.query(`SELECT payload_hash,response_status,response_json FROM idempotency_requests
      WHERE actor_user_id=$1 AND operation='member.create' AND key_hash=$2 FOR UPDATE`,[actorId,keyHash]);
    const existing=replay.rows[0];
    if (existing.payload_hash!==payloadHash) throw sqlError('IDEMPOTENCY_CONFLICT','This request key was already used with different details.');
    if (existing.response_status) {
      await client.query('COMMIT');
      return {status:existing.response_status,data:existing.response_json,replayed:true};
    }
    const validated=validateMember(body,onDate);
    const data=await createMemberRecords(client,{actorId,validated,onDate});
    await client.query(`UPDATE idempotency_requests SET response_status=201,response_json=$1 WHERE actor_user_id=$2 AND operation='member.create' AND key_hash=$3`,
      [JSON.stringify(data),actorId,keyHash]);
    await client.query('COMMIT');
    return {status:201,data,replayed:false};
  } catch(err){
    await client.query('ROLLBACK');
    throw err;
  } finally {client.release();}
}

// Shared atomic record creation for individual and batch intake.
// The caller owns BEGIN/COMMIT; never commit an incomplete group.
export async function createMemberRecords(client,{actorId,validated,onDate,groupRegistrationId=null}) {
    if(validated.organizationId){
      const org=await client.query('SELECT id FROM organizations WHERE id=$1',[validated.organizationId]);
      if(!org.rowCount) throw sqlError('ORGANIZATION_NOT_FOUND','The organization does not exist.');
    }
    const sports=await client.query('SELECT id FROM sports WHERE id=ANY($1::bigint[]) AND is_active=true',[validated.sportIds]);
    if(sports.rowCount!==validated.sportIds.length) throw sqlError('INVALID_SPORTS','At least one sport does not exist or is inactive.');
    // Serialize identical name+DOB attempts even when their idempotency keys differ.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext(lower(btrim($1)) || ':' || $2::text))`,[validated.fullName,validated.dateOfBirth]);
    // Human review needed: same name+DOB may be valid for different people; do not silently merge.
    const possible=await client.query('SELECT membership_number FROM members WHERE lower(full_name)=lower($1) AND date_of_birth=$2 LIMIT 3',
      [validated.fullName,validated.dateOfBirth]);
    if(possible.rowCount) throw sqlError('POSSIBLE_DUPLICATE','A member with the same full name and birth date already exists. Review before registering another.');
    const member=await client.query(`INSERT INTO members(full_name,gender,date_of_birth,phone,sub_county,school_or_college,status)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,membership_number,status`,[
      validated.fullName,validated.gender,validated.dateOfBirth,validated.phone,validated.subCounty,validated.schoolOrCollege,
      validated.age<18?'pending_consent':'draft']);
    const m=member.rows[0];
    await client.query(`INSERT INTO member_contacts(member_id,contact_type,full_name,relationship,phone,is_primary)
      VALUES($1,'next_of_kin',$2,$3,$4,true)`,[m.id,validated.nextOfKin.fullName,validated.nextOfKin.relationship,validated.nextOfKin.phone]);
    if(validated.guardian){
      const contact=await client.query(`INSERT INTO member_contacts(member_id,contact_type,full_name,relationship,phone,is_primary)
        VALUES($1,'guardian',$2,$3,$4,true) RETURNING id`,[m.id,validated.guardian.fullName,validated.guardian.relationship,validated.guardian.phone]);
      await client.query('INSERT INTO guardian_consents(member_id,guardian_contact_id) VALUES($1,$2)',[m.id,contact.rows[0].id]);
    }
    const membership=await client.query(`INSERT INTO memberships(member_id,registration_type,organization_id,group_registration_id,registered_on,status)
      VALUES($1,$2,$3,$4,$5,'pending') RETURNING id`,[m.id,validated.registrationType,validated.organizationId,groupRegistrationId,onDate]);
    for(const [index,sportId] of validated.sportIds.entries()){
      await client.query('INSERT INTO member_sport_preferences(member_id,sport_id,priority) VALUES($1,$2,$3)',[m.id,sportId,index+1]);
    }
    const charge=await client.query(`INSERT INTO charges(member_id,charge_type,amount,status)
      VALUES($1,'membership',$2,'outstanding') RETURNING id`,[m.id,validated.fee]);
    await client.query(`INSERT INTO membership_charges(membership_id,charge_id,fee_rate_snapshot)
      VALUES($1,$2,$3)`,[membership.rows[0].id,charge.rows[0].id,validated.fee]);
    await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata_summary)
      VALUES($1,'member.register','member',$2,$3)`,[
      actorId,String(m.id),JSON.stringify({membershipNumber:m.membership_number,registrationType:validated.registrationType,ageBand:validated.ageBand})]);
    const data={id:String(m.id),membershipNumber:m.membership_number,fullName:validated.fullName,ageBand:validated.ageBand,
      registrationType:validated.registrationType,guardianConsent:validated.age<18?'pending':'not_required',
      memberStatus:m.status,membershipStatus:'pending',membershipFee:validated.fee,paymentStatus:'outstanding',sportIds:validated.sportIds};
    return data;
}
