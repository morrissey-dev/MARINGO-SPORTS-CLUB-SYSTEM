import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRefundRequest,validateRefundDecision,refundStatusLabel} from '../src/store/refunds-policy.js';
test('refund must have a valid method and meaningful reason',()=>{
 assert.deepEqual(validateRefundRequest({method:'cash',reason:'  Return accepted after inspection  '}),{method:'cash',reason:'Return accepted after inspection'});
 assert.throws(()=>validateRefundRequest({method:'card',reason:'Returned the right item'}),{code:'INVALID_REFUND_METHOD'});
 assert.throws(()=>validateRefundRequest({method:'mobile_money',reason:'short'}),{code:'INVALID_REFUND_REASON'});
});
test('confirmed payment needs unique-format payout reference and supporting evidence note',()=>{
 assert.equal(validateRefundDecision({decision:'pay',evidenceReference:'MPESA-A12345',evidenceNote:'Verified on finance settlement record'}).decision,'pay');
 assert.throws(()=>validateRefundDecision({decision:'pay',evidenceReference:'ABC',evidenceNote:'Verified repayment'}),{code:'INVALID_REFUND_EVIDENCE'});
 assert.throws(()=>validateRefundDecision({decision:'pay',evidenceReference:'ABCDEF',evidenceNote:'x'}),{code:'INVALID_REFUND_EVIDENCE'});
});
test('rejected refund must have reason not payout evidence',()=>{
 assert.deepEqual(validateRefundDecision({decision:'reject',reason:'Customer refund claim not supported'}),{decision:'reject',reason:'Customer refund claim not supported'});
 assert.throws(()=>validateRefundDecision({decision:'reject',reason:'Claim was not valid',evidenceReference:'ABCDEF'}),{code:'INVALID_REFUND_DECISION'});
});
test('refund status reports pending, paid and rejected distinctly',()=>{
 assert.equal(refundStatusLabel({status:'pending'}),'pending_verification');
 assert.equal(refundStatusLabel({status:'paid'}),'paid');
 assert.equal(refundStatusLabel({status:'rejected'}),'rejected');
 assert.equal(refundStatusLabel(null),'not_requested');
});
