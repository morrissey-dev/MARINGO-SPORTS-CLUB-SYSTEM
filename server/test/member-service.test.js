import test from 'node:test';
import assert from 'node:assert/strict';
import { registerMember } from '../src/members/registration.js';

const data={fullName:'Demo Member',dateOfBirth:'2002-05-10',subCounty:'Sample',registrationType:'individual',
  sportIds:['1','2'],nextOfKin:{fullName:'Kin Person',relationship:'Sibling',phone:'0700000000'}};

function stubDb({failOn=null, replay=null}={}) {
  const sql=[];
  let released=false;
  const client={
    async query(statement,params){
      sql.push(statement);
      if(failOn && statement.includes(failOn)) throw new Error('simulated PostgreSQL failure');
      if(statement.includes('SELECT payload_hash,response_status,response_json FROM idempotency_requests')){
        return {rows:[{payload_hash:replay?.payloadHash||this.recordedPayload,response_status:replay?.status||null,response_json:replay?.data||null}],rowCount:1};
      }
      if(statement.includes('INSERT INTO idempotency_requests')) {this.recordedPayload=params[2];return {rows:[],rowCount:1};}
      if(statement.includes('FROM sports')) return {rows:[{id:'1'},{id:'2'}],rowCount:2};
      if(statement.includes('SELECT membership_number FROM members')) return {rows:[],rowCount:0};
      if(statement.includes('INSERT INTO members(')) return {rows:[{id:'12',membership_number:'MSC-00000012',status:'draft'}],rowCount:1};
      if(statement.includes('INSERT INTO memberships(')) return {rows:[{id:'14'}],rowCount:1};
      if(statement.includes('INSERT INTO charges(')) return {rows:[{id:'19'}],rowCount:1};
      return {rows:[],rowCount:1};
    },
    release(){released=true;}
  };
  return {pool:{connect:async()=>client},sql,wasReleased:()=>released};
}

test('registration inserts member, preferences, charge and audit within BEGIN/COMMIT',async()=>{
  const stub=stubDb();
  const outcome=await registerMember(stub.pool,{actorId:'1',body:data,key:'new-unique-key-12345',onDate:'2026-10-27'});
  assert.equal(outcome.status,201);
  assert.equal(outcome.data.membershipFee,'1000.00');
  assert.equal(outcome.data.paymentStatus,'outstanding');
  assert.equal(outcome.data.memberStatus,'draft');
  assert.equal(stub.sql[0],'BEGIN');
  assert.equal(stub.sql.at(-1),'COMMIT');
  assert.equal(stub.sql.filter(s=>s.includes('INSERT INTO member_sport_preferences')).length,2);
  assert.ok(stub.sql.some(s=>s.includes('INSERT INTO membership_charges')));
  assert.ok(stub.sql.some(s=>s.includes('INSERT INTO audit_logs')));
  assert.equal(stub.wasReleased(),true);
});
test('failed membership charge rolls back the entire transaction',async()=>{
  const stub=stubDb({failOn:'INSERT INTO charges('});
  await assert.rejects(registerMember(stub.pool,{actorId:'1',body:data,key:'another-unique-key-1234',onDate:'2026-10-27'}),/simulated/);
  assert.equal(stub.sql.at(-1),'ROLLBACK');
  assert.ok(!stub.sql.includes('COMMIT'));
  assert.equal(stub.wasReleased(),true);
});
test('existing request with same key does not create a second member',async()=>{
  const first=stubDb();
  const firstResult=await registerMember(first.pool,{actorId:'1',body:data,key:'fixed-unique-key-12345',onDate:'2026-10-27'});
  const hash=first.pool === undefined ? '' : first.sql.length; // require original fingerprint captured in next stub below
  assert.ok(hash>0);
  // Returning an existing finalized idempotency record means registration stops before inserting member.
  let previousHash;
  const once=stubDb();
  const original=once.pool.connect;
  once.pool.connect=async()=>{
    const connection=await original();const query=connection.query.bind(connection);
    connection.query=async(s,p)=>{if(s.includes('INSERT INTO idempotency_requests')) previousHash=p[2];return query(s,p);};
    return connection;
  };
  await registerMember(once.pool,{actorId:'1',body:data,key:'fixed-unique-key-12345',onDate:'2026-10-27'});
  const replay=stubDb({replay:{payloadHash:previousHash,status:201,data:firstResult.data}});
  const result=await registerMember(replay.pool,{actorId:'1',body:data,key:'fixed-unique-key-12345',onDate:'2026-10-27'});
  assert.equal(result.replayed,true);
  assert.ok(!replay.sql.some(s=>s.includes('INSERT INTO members(')));
});
