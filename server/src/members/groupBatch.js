import { createHash,randomUUID } from 'node:crypto';
import { createMemberRecords,stableJson,idempotencyKey } from './registration.js';
import { InputError,validateMember,parseId,kenyaDate } from './validation.js';

const hash=s=>createHash('sha256').update(s).digest('hex');
export const GROUP_BATCH_LIMIT=20;

export function validateGroupBatch(body,onDate=kenyaDate()) {
  if(!body||typeof body!=='object'||Array.isArray(body)) throw new InputError('INVALID_BATCH','Provide a group registration request.');
  const organizationId=parseId(body.organizationId);
  if(!organizationId) throw new InputError('ORGANIZATION_REQUIRED','Choose a valid organization.');
  if(!Array.isArray(body.members)||!body.members.length||body.members.length>GROUP_BATCH_LIMIT)
    throw new InputError('INVALID_BATCH_SIZE',`Register 1–${GROUP_BATCH_LIMIT} members at a time.`);
  const seen=new Set();
  const members=body.members.map((member,index)=>{
    if(!member||typeof member!=='object'||Array.isArray(member))
      throw new InputError('INVALID_BATCH_MEMBER',`Row ${index+1}: enter member details.`);
    if(member.registrationType!==undefined||member.organizationId!==undefined)
      throw new InputError('INVALID_BATCH_MEMBER',`Row ${index+1}: group registration details are set once for the entire batch.`);
    let validated;
    try {validated=validateMember({...member,registrationType:'group',organizationId},onDate);}
    catch(error){if(error instanceof InputError) throw new InputError(error.code,`Row ${index+1}: ${error.message}`,{
      ...Object.fromEntries(Object.entries(error.fieldErrors||{}).map(([name,message])=>[`members[${index}].${name}`,message]))
    });throw error;}
    const fingerprint=`${validated.fullName.trim().toLocaleLowerCase('en')}|${validated.dateOfBirth}`;
    if(seen.has(fingerprint)) throw new InputError('DUPLICATE_BATCH_MEMBER',`Row ${index+1} repeats a member in this batch.`);
    seen.add(fingerprint);
    return validated;
  });
  return {organizationId,members};
}

export async function registerGroupBatch(pool,{actorId,body,key,onDate=kenyaDate()}) {
  const keyHash=idempotencyKey(key);
  const validated=validateGroupBatch(body,onDate); // All row-level inputs must pass before any write.
  const payloadHash=hash(stableJson(body));
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO idempotency_requests(actor_user_id,operation,key_hash,payload_hash)
      VALUES($1,'group.create',$2,$3) ON CONFLICT DO NOTHING`,[actorId,keyHash,payloadHash]);
    const replay=await client.query(`SELECT payload_hash,response_status,response_json FROM idempotency_requests
      WHERE actor_user_id=$1 AND operation='group.create' AND key_hash=$2 FOR UPDATE`,[actorId,keyHash]);
    const existing=replay.rows[0];
    if(existing.payload_hash!==payloadHash) throw new InputError('IDEMPOTENCY_CONFLICT','This request key was already used for another group intake.');
    if(existing.response_status){await client.query('COMMIT');return {status:existing.response_status,data:existing.response_json,replayed:true};}
    const org=await client.query('SELECT id FROM organizations WHERE id=$1',[validated.organizationId]);
    if(!org.rowCount) throw new InputError('ORGANIZATION_NOT_FOUND','The organization does not exist.');
    // One batch header + every member + every charge are in the same transaction.
    const group=await client.query(`INSERT INTO group_registrations(organization_id,submitted_by_user_id,reference_code,status)
      VALUES($1,$2,$3,'posted') RETURNING id,reference_code`,
    [validated.organizationId,actorId,`GRP-${randomUUID()}`]);
    const entries=[];
    for (const member of validated.members) {
      entries.push(await createMemberRecords(client,{actorId,validated:member,onDate,groupRegistrationId:group.rows[0].id}));
    }
    const data={groupId:String(group.rows[0].id),groupReference:group.rows[0].reference_code,
      organizationId:validated.organizationId,count:entries.length,totalBilled:(entries.length*500).toFixed(2),
      members:entries};
    await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata_summary)
      VALUES($1,'group.register','group_registration',$2,$3)`,[actorId,String(group.rows[0].id),
      JSON.stringify({count:entries.length,totalBilled:data.totalBilled})]);
    await client.query(`UPDATE idempotency_requests SET response_status=201,response_json=$1
      WHERE actor_user_id=$2 AND operation='group.create' AND key_hash=$3`,[JSON.stringify(data),actorId,keyHash]);
    await client.query('COMMIT');
    return {status:201,data,replayed:false};
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
