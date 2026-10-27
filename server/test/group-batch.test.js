import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGroupBatch,registerGroupBatch} from '../src/members/groupBatch.js';
import { InputError } from '../src/members/validation.js';
const member={fullName:'Fictional Club Adult',dateOfBirth:'2002-03-20',subCounty:'Example',sportIds:['1'],
 nextOfKin:{fullName:'Fictional Kin',relationship:'Sibling',phone:'0700000000'}};
const body={organizationId:'9',members:[member,{...member,fullName:'Second Fictional Adult'}]};
const runDate='2026-10-27';
function stub(failOn=null){
 const queries=[];let released=false;let payload;
 const client={async query(sql,params){
  queries.push(sql);
  if(failOn&&sql.includes(failOn))throw Error('simulated failure');
  if(sql.includes('INSERT INTO idempotency_requests')){payload=params[2];return {rowCount:1,rows:[]};}
  if(sql.includes('SELECT payload_hash,response_status,response_json FROM idempotency_requests'))
    return {rowCount:1,rows:[{payload_hash:payload,response_status:null,response_json:null}]};
  if(sql.includes('FROM organizations'))return {rowCount:1,rows:[{id:'9'}]};
  if(sql.includes('FROM sports'))return {rowCount:1,rows:[{id:'1'}]};
  if(sql.includes('SELECT membership_number FROM members'))return {rowCount:0,rows:[]};
  if(sql.includes('INSERT INTO group_registrations'))return {rowCount:1,rows:[{id:'66',reference_code:'GRP-DUMMY'}]};
  if(sql.includes('INSERT INTO members('))return {rowCount:1,rows:[{id:String(12+queries.length),membership_number:'MSC-FAKE',status:'draft'}]};
  if(sql.includes('INSERT INTO memberships('))return {rowCount:1,rows:[{id:String(20+queries.length)}]};
  if(sql.includes('INSERT INTO charges('))return {rowCount:1,rows:[{id:String(30+queries.length)}]};
  return {rowCount:1,rows:[]};
 },release(){released=true;}};
 return {pool:{connect:async()=>client},queries,released:()=>released};
}
test('group input validates 2 members with KSh 500 each',()=>{
 const result=validateGroupBatch(body,runDate);
 assert.equal(result.members.length,2);
 assert.ok(result.members.every(x=>x.fee==='500.00'&&x.registrationType==='group'));
});
test('rejects empty/oversized batches, ineligible members and duplicated entries',()=>{
 assert.throws(()=>validateGroupBatch({...body,members:[]},runDate),/Register 1/);
 assert.throws(()=>validateGroupBatch({...body,members:Array(21).fill(member)},runDate),/Register 1/);
 assert.throws(()=>validateGroupBatch({...body,members:[member,member]},runDate),/repeats/);
 assert.throws(()=>validateGroupBatch({...body,members:[{...member,dateOfBirth:'2020-01-01'}]},runDate),/Row 1/);
 assert.throws(()=>validateGroupBatch({...body,members:[{...member,registrationType:'individual'}]},runDate),/Row 1/);
});
test('group intake records 2 members with one group header, 2 charges, and commits once',async()=>{
 const db=stub();
 const r=await registerGroupBatch(db.pool,{actorId:'3',body,key:'group-request-12345',onDate:runDate});
 assert.equal(r.status,201);assert.equal(r.data.count,2);assert.equal(r.data.totalBilled,'1000.00');
 assert.equal(db.queries.filter(s=>s.includes('INSERT INTO group_registrations')).length,1);
 assert.equal(db.queries.filter(s=>s.includes('INSERT INTO members(')).length,2);
 assert.equal(db.queries.filter(s=>s.includes('INSERT INTO charges(')).length,2);
 assert.equal(db.queries.at(-1),'COMMIT');assert.equal(db.released(),true);
});
test('failure in row processing rolls back entire group registration',async()=>{
 const db=stub('INSERT INTO charges(');
 await assert.rejects(()=>registerGroupBatch(db.pool,{actorId:'3',body,key:'group-request-45678',onDate:runDate}),/simulated failure/);
 assert.equal(db.queries.at(-1),'ROLLBACK');
 assert.ok(!db.queries.includes('COMMIT'));
});
test('invalid member in group fails before any database writes',async()=>{
 const db=stub();
 await assert.rejects(()=>registerGroupBatch(db.pool,{actorId:'3',body:{...body,members:[{...member,fullName:''}]},key:'group-request-67890',onDate:runDate}), InputError);
 assert.equal(db.queries.length,0);
});
