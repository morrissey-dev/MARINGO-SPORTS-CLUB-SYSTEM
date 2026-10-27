import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyToCents, centsToMoney, validatePayment, validateEvidence, paymentDecision } from '../src/payments/policy.js';

test('KSh is handled as integer cents without rounding',()=>{
  assert.equal(moneyToCents('1000.05'),100005);
  assert.equal(centsToMoney(100005),'1000.05');
  assert.equal(centsToMoney(0),'0.00');
});
test('invalid amounts are refused',()=>{
  for(const amount of ['-1.00','0.00','1','1.999','1e3','01.00',1000.00,'1000.000'])
    assert.throws(()=>moneyToCents(amount));
});
test('cash payment ignores transfer reference and requires membership charge',()=>{
  assert.deepEqual(validatePayment({chargeId:'3',amount:'500.00',method:'cash'}),{
    chargeId:'3',amount:'500.00',method:'cash',reference:null});
  assert.throws(()=>validatePayment({chargeId:'3',amount:'500.00',method:'cash',reference:'R123'}));
});
test('mobile money reference is required and normalized',()=>{
  assert.equal(validatePayment({chargeId:'2',amount:'100.00',method:'mobile_money',reference:'  smd12345  '}).reference,'SMD12345');
  assert.throws(()=>validatePayment({chargeId:'2',amount:'100.00',method:'mobile_money',reference:'bad'}));
});
test('overpayment is blocked and partial payments are allowed',()=>{
  assert.deepEqual(paymentDecision(100000,25000,30000),{remainingCents:45000,paid:false});
  assert.deepEqual(paymentDecision(100000,25000,75000),{remainingCents:0,paid:true});
  assert.throws(()=>paymentDecision(100000,25000,75001),e=>e.code==='OVERPAYMENT');
});
test('verification requires a non-sensitive evidence ID',()=>{
  assert.equal(validateEvidence(' BANK-REF-123 '),'BANK-REF-123');
  assert.throws(()=>validateEvidence('x'));
});
