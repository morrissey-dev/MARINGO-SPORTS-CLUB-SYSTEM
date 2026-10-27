import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { reconcileCharge,recordPayment } from '../src/payments/service.js';

function fakeDb(){
  const queries=[];
  const client={release(){},async query(sql,params=[]){
    queries.push({sql,params});
    if(sql.startsWith('SELECT c.id,c.member_id,c.amount,c.status,mc.membership_id'))return {rowCount:0,rows:[]};
    if(sql.includes('JOIN facilitation_charges fc'))return {rowCount:1,rows:[{id:'100',member_id:'1',charge_type:'facilitation',amount:'500.00',status:'outstanding'}]};
    if(sql.includes('SELECT payload_hash,response_status,response_json FROM idempotency_requests'))return {rowCount:1,rows:[{payload_hash:createHash('sha256').update('{"amount":"500.00","chargeId":"100","method":"cash"}').digest('hex')}]};
    if(sql.includes('FROM payment_allocations a JOIN payments p'))return {rowCount:1,rows:[{collected:'200.00'}]};
    return {rowCount:1,rows:[]};
  }};
  return {pool:{connect:async()=>client},client,queries};
}
test('facilitation reconciliation updates charge but never updates membership or member status',async()=>{
  const {client,queries}=fakeDb();
  const result=await reconcileCharge(client,{id:'100',member_id:'1',amount:'500.00',charge_type:'facilitation'});
  assert.deepEqual(result,{collected:'200.00',balance:'300.00',chargeStatus:'outstanding'});
  assert.equal(queries.some(x=>x.sql.startsWith('UPDATE charges SET status=')),true);
  assert.equal(queries.some(x=>x.sql.includes('UPDATE memberships')),false);
  assert.equal(queries.some(x=>x.sql.includes('UPDATE members')),false);
});
test('registration staff cannot record an external-match payment even with a valid fee charge',async()=>{
  const {pool,queries}=fakeDb();
  await assert.rejects(recordPayment(pool,{actorId:'1',roles:['REG'],body:{chargeId:'100',amount:'500.00',method:'cash'},key:'facilitation-pay-00001'}),
    e=>e.code==='FORBIDDEN');
  assert.equal(queries.some(x=>x.sql.includes('INSERT INTO payments(')),false);
  assert.equal(queries.some(x=>x.sql==='ROLLBACK'),true);
});
