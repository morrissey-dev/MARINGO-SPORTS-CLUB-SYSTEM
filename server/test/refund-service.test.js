import test from 'node:test';
import assert from 'node:assert/strict';
import {requestStoreRefund,reviewStoreRefund} from '../src/store/refunds-service.js';
const rows=r=>({rows:r,rowCount:r.length});
function fake(responder){const log=[];const db={query:async(sql,params=[])=>{log.push({sql,params});return responder(sql,params)||rows([])},release(){}};return {connect:async()=>db,log};}
const base={actorId:'4',returnId:'15',key:'refund-12345678901234',body:{method:'cash',reason:'Returned product after store inspection'}};
test('unaccepted return never creates a refund',async()=>{
 const pool=fake(sql=>sql.includes('FROM store_returns WHERE id')?rows([{id:'15',status:'pending_review',refund_due:'800.00',sale_id:'3'}]):null);
 await assert.rejects(requestStoreRefund(pool,base),{code:'RETURN_NOT_ACCEPTED'});
 assert.ok(pool.log.some(r=>r.sql==='ROLLBACK'));
 assert.ok(!pool.log.some(r=>r.sql.includes('INSERT INTO store_refunds')));
});
test('refund entitlement cannot be zero',async()=>{
 const pool=fake(sql=>sql.includes('FROM store_returns WHERE id')?rows([{id:'15',status:'accepted',refund_due:'0.00',sale_id:'3'}]):null);
 await assert.rejects(requestStoreRefund(pool,base),{code:'REFUND_NOT_DUE'});
});
test('request records pending repayment without posting cash outflow',async()=>{
 const pool=fake(sql=>{
   if(sql.includes('FROM store_returns WHERE id'))return rows([{id:'15',status:'accepted',refund_due:'800.00',sale_id:'3'}]);
   if(sql.includes('INSERT INTO store_refunds'))return rows([{id:'99'}]);
   return null;
 });
 const result=await requestStoreRefund(pool,base);
 assert.equal(result.status,'pending');assert.equal(result.amount,'800.00');
 assert.ok(pool.log.some(r=>r.sql==='COMMIT'));
 assert.equal(pool.log.some(r=>r.sql.includes('INSERT INTO payment_allocations')),false);
});
test('same key replays refund, new key cannot create second refund for return',async()=>{
 const h=(await import('node:crypto')).createHash;
 const {idempotencyKey}=await import('../src/members/registration.js');
 const keyHash=h('sha256').update('4:refund:'+idempotencyKey(base.key)).digest('hex');
 const {stableJson}=await import('../src/members/registration.js');
 const payloadHash=h('sha256').update(stableJson({returnId:'15',...base.body})).digest('hex');
 const pool=fake(sql=>{
  if(sql.includes('FROM store_returns WHERE id'))return rows([{id:'15',sale_id:'3',status:'accepted',refund_due:'800.00'}]);
  if(sql.includes('FROM store_refunds WHERE return_id'))return rows([{id:'9',status:'pending',request_key_hash:keyHash,request_payload_hash:payloadHash}]);
  return null;
 });
 assert.equal((await requestStoreRefund(pool,base)).replayed,true);
 await assert.rejects(requestStoreRefund(pool,{...base,key:'another-refund-key-12345'}),{code:'REFUND_ALREADY_REQUESTED'});
});
const recorded={id:'9',return_id:'15',status:'pending',requested_by_user_id:'4',amount:'800.00',method:'cash'};
function refundPool(){return fake(sql=>{
 if(sql.includes('SELECT return_id FROM store_refunds'))return rows([{return_id:'15'}]);
 if(sql.includes('FROM store_returns WHERE id'))return rows([{id:'15',status:'accepted',refund_due:'800.00'}]);
 if(sql.includes('SELECT * FROM store_refunds'))return rows([recorded]);
 return null;
});}
test('requester cannot verify their own refund payout',async()=>{
 const p=refundPool();await assert.rejects(reviewStoreRefund(p,{actorId:'4',refundId:'9',body:{decision:'pay',evidenceReference:'CASH-0011',evidenceNote:'Cash voucher verified by finance'}}),{code:'SEPARATION_OF_DUTIES'});
 assert.ok(!p.log.some(r=>r.sql.includes("SET status='paid'")));
});
test('second officer can record verified payout, with no stock changes',async()=>{
 const p=refundPool();const result=await reviewStoreRefund(p,{actorId:'7',refundId:'9',body:{decision:'pay',evidenceReference:'CASH-0011',evidenceNote:'Cash voucher signed and physically reconciled'}});
 assert.equal(result.status,'paid');
 assert.ok(p.log.some(r=>r.sql.includes("SET status='paid'")));
 assert.equal(p.log.some(r=>r.sql.includes('UPDATE store_inventory')),false);
});
test('rejected refund never gets counted as actual payout',async()=>{
 const p=refundPool();const result=await reviewStoreRefund(p,{actorId:'7',refundId:'9',body:{decision:'reject',reason:'Original receipt does not match claim'}});
 assert.equal(result.status,'rejected');assert.ok(p.log.some(r=>r.sql.includes("SET status='rejected'")));
 assert.ok(!p.log.some(r=>r.sql.includes("SET status='paid'")));
});
test('already paid refund cannot be paid again',async()=>{
 const p=fake(sql=>{
 if(sql.includes('SELECT return_id FROM store_refunds'))return rows([{return_id:'15'}]);
 if(sql.includes('FROM store_returns WHERE id'))return rows([{status:'accepted',refund_due:'800.00'}]);
 if(sql.includes('SELECT * FROM store_refunds'))return rows([{...recorded,status:'paid'}]);
 return null;
 });
 await assert.rejects(reviewStoreRefund(p,{actorId:'7',refundId:'9',body:{decision:'pay',evidenceReference:'CASH-0011',evidenceNote:'Cash voucher signed and reconciled'}}),{code:'REFUND_ALREADY_REVIEWED'});
});
