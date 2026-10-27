import test from 'node:test';
import assert from 'node:assert/strict';
import { recordPayment, verifyPayment, reversePayment } from '../src/payments/service.js';

function mockStore({amount='1000.00',minor=false,hasConsent=true}={}){
  const data={payments:new Map(),allocations:new Map(),requests:new Map(),amount,minor,hasConsent,
    memberStatus:'draft',membershipStatus:'pending',chargeStatus:'outstanding',queries:[],releases:0};
  let nextId=0;
  const client={
    async query(sql,params=[]){
      data.queries.push(sql);
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rowCount:0,rows:[]};
      if(sql.includes('INSERT INTO idempotency_requests')){
        const k=params[0]+'|'+params[1];
        if(!data.requests.has(k))data.requests.set(k,{payload_hash:params[2],response_status:null,response_json:null});
        return {rowCount:1,rows:[]};
      }
      if(sql.includes('SELECT payload_hash,response_status,response_json FROM idempotency_requests')){
        const r=data.requests.get(params[0]+'|'+params[1]);return {rowCount:1,rows:[r]};
      }
      if(sql.includes('UPDATE idempotency_requests')){
        const r=data.requests.get(params[1]+'|'+params[2]);r.response_json=JSON.parse(params[0]);r.response_status=201;
        return {rowCount:1,rows:[]};
      }
      if(sql.includes('FROM charges c JOIN membership_charges')){
        if(String(params[0])!=='3')return {rowCount:0,rows:[]};
        return {rowCount:1,rows:[{id:'3',member_id:'7',amount:data.amount,status:data.chargeStatus,membership_id:'4'}]};
      }
      if(sql.includes('FROM payment_allocations a JOIN payments p')){
        let cents=0;
        for(const [id,item] of data.allocations) if(data.payments.get(id)?.status==='verified') cents+=Math.round(Number(item.amount)*100);
        return {rowCount:1,rows:[{collected:`${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`}]};
      }
      if(sql.includes('INSERT INTO payments(')){
        const id=String(++nextId);data.payments.set(id,{id,charge_id:String(params[0]),amount:params[1],
          method:params[2],transfer_reference:params[3],recorded_by_user_id:String(params[4]),status:'pending'});
        return {rowCount:1,rows:[{id,recorded_at:new Date()}]};
      }
      if(sql.includes('SELECT id,charge_id,amount,status,recorded_by_user_id,method FROM payments') ||
         sql.includes('SELECT id,charge_id,status,amount FROM payments')){
        const p=data.payments.get(String(params[0]));return {rowCount:p?1:0,rows:p?[{...p}]:[]};
      }
      if(sql.includes('UPDATE payments SET status=')){
        const p=data.payments.get(String(params[0]));
        p.status=sql.includes("'verified'")?'verified':'reversed';return {rowCount:1,rows:[]};
      }
      if(sql.includes('INSERT INTO payment_allocations')){
        data.allocations.set(String(params[0]),{charge_id:String(params[1]),amount:params[2]});
        return {rowCount:1,rows:[]};
      }
      if(sql.includes('UPDATE charges SET status=')){data.chargeStatus=params[1];return {rowCount:1,rows:[]};}
      if(sql.includes('FROM members m WHERE m.id=')){
        return {rowCount:1,rows:[{id:'7',date_of_birth:minor?'2012-10-10':'2002-10-10',status:data.memberStatus,has_consent:data.hasConsent}]};
      }
      if(sql.includes("SELECT date_part('year'"))return {rowCount:1,rows:[{minor:data.minor}]};
      if(sql.includes('UPDATE memberships SET status=')){data.membershipStatus=params[1];return {rowCount:1,rows:[]};}
      if(sql.includes('UPDATE members SET status=')){data.memberStatus=params[1];return {rowCount:1,rows:[]};}
      return {rowCount:1,rows:[]};
    },
    release(){data.releases++;}
  };
  return {pool:{connect:async()=>client},data};
}
const cash=(amount='1000.00')=>({chargeId:'3',amount,method:'cash'});

test('recording a cash payment creates pending receipt without collecting money',async()=>{
  const x=mockStore();
  const result=await recordPayment(x.pool,{actorId:'1',body:cash(),key:'distinct-payment-0001'});
  assert.equal(result.status,201);assert.equal(result.data.status,'pending');
  assert.equal(x.data.allocations.size,0);assert.equal(x.data.memberStatus,'draft');
  assert.equal(x.data.queries[0],'BEGIN');assert.equal(x.data.queries.at(-1),'COMMIT');
  assert.equal(x.data.releases,1);
});
test('payment retry with same key gives the same pending payment, not a second',async()=>{
  const x=mockStore();
  const request={actorId:'1',body:cash(),key:'distinct-payment-0002'};
  const a=await recordPayment(x.pool,request),b=await recordPayment(x.pool,request);
  assert.equal(a.data.id,b.data.id);assert.equal(b.replayed,true);
  assert.equal(x.data.payments.size,1);
});
test('new payment with reused key and modified amount is rejected',async()=>{
  const x=mockStore();
  await recordPayment(x.pool,{actorId:'1',body:cash(),key:'distinct-payment-0003'});
  await assert.rejects(recordPayment(x.pool,{actorId:'1',body:cash('100.00'),key:'distinct-payment-0003'}),
    e=>e.code==='IDEMPOTENCY_CONFLICT');
  assert.equal(x.data.payments.size,1);
});
test('payment maker cannot approve their own receipt',async()=>{
  const x=mockStore();
  await recordPayment(x.pool,{actorId:'1',body:cash(),key:'distinct-payment-0004'});
  await assert.rejects(verifyPayment(x.pool,{actorId:'1',paymentId:'1',evidenceReference:'RECEIPT-123'}),
    e=>e.code==='MAKER_CHECKER_REQUIRED');
  assert.equal(x.data.payments.get('1').status,'pending');
});
test('verified full payment activates adult membership, once',async()=>{
  const x=mockStore();
  await recordPayment(x.pool,{actorId:'1',body:cash(),key:'distinct-payment-0005'});
  const result=await verifyPayment(x.pool,{actorId:'2',paymentId:'1',evidenceReference:'RECEIPT-123'});
  assert.equal(result.status,'verified');assert.equal(result.balance,'0.00');
  assert.equal(x.data.chargeStatus,'paid');assert.equal(x.data.memberStatus,'active');
  assert.equal(x.data.membershipStatus,'active');assert.equal(x.data.allocations.size,1);
  await assert.rejects(verifyPayment(x.pool,{actorId:'2',paymentId:'1',evidenceReference:'RECEIPT-123'}),
    e=>e.code==='PAYMENT_NOT_PENDING');
});
test('verified partial payment stays outstanding and does not activate membership',async()=>{
  const x=mockStore();
  await recordPayment(x.pool,{actorId:'1',body:cash('300.00'),key:'distinct-payment-0006'});
  const result=await verifyPayment(x.pool,{actorId:'2',paymentId:'1',evidenceReference:'RECEIPT-123'});
  assert.equal(result.balance,'700.00');assert.equal(result.collected,'300.00');
  assert.equal(x.data.memberStatus,'draft');assert.equal(x.data.membershipStatus,'pending');
});
test('minor remains pending consent even if full membership fee is verified',async()=>{
  const x=mockStore({amount:'500.00',minor:true,hasConsent:false});
  await recordPayment(x.pool,{actorId:'1',body:cash('500.00'),key:'distinct-payment-0007'});
  const result=await verifyPayment(x.pool,{actorId:'2',paymentId:'1',evidenceReference:'RECEIPT-123'});
  assert.equal(result.balance,'0.00');assert.equal(x.data.memberStatus,'pending_consent');
  assert.equal(x.data.membershipStatus,'pending');
});
test('reversing a verified payment restores outstanding balance and draft status',async()=>{
  const x=mockStore();
  await recordPayment(x.pool,{actorId:'1',body:cash(),key:'distinct-payment-0008'});
  await verifyPayment(x.pool,{actorId:'2',paymentId:'1',evidenceReference:'RECEIPT-123'});
  const result=await reversePayment(x.pool,{actorId:'2',paymentId:'1',reason:'Receipt voided after investigation'});
  assert.equal(result.balance,'1000.00');assert.equal(result.status,'reversed');
  assert.equal(x.data.chargeStatus,'outstanding');assert.equal(x.data.memberStatus,'draft');
  assert.equal(x.data.allocations.size,1,'audit allocation must not be deleted');
});
test('verified overpayment cannot exceed remaining charge balance',async()=>{
  const x=mockStore();
  await recordPayment(x.pool,{actorId:'1',body:cash('800.00'),key:'distinct-payment-0009'});
  await recordPayment(x.pool,{actorId:'1',body:cash('500.00'),key:'distinct-payment-0010'});
  await verifyPayment(x.pool,{actorId:'2',paymentId:'1',evidenceReference:'RECEIPT-123'});
  await assert.rejects(verifyPayment(x.pool,{actorId:'2',paymentId:'2',evidenceReference:'RECEIPT-124'}),
    e=>e.code==='OVERPAYMENT');
  assert.equal(x.data.chargeStatus,'outstanding');
  assert.equal(x.data.payments.get('2').status,'pending');
});
