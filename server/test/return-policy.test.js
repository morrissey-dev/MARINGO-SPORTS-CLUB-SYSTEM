import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReturnRequest,validateReturnDecision,proratedRefundDue} from '../src/store/returns-policy.js';

test('return request needs explanation, sale lines and unique quantities',()=>{
 const valid=validateReturnRequest({reason:'Wrong size received',lines:[{saleLineId:'7',quantity:2}]});
 assert.equal(valid.lines[0].quantity,2);
 assert.throws(()=>validateReturnRequest({reason:'short',lines:[{saleLineId:'7',quantity:2}]}),{code:'INVALID_RETURN_REASON'});
 assert.throws(()=>validateReturnRequest({reason:'Wrong size received',lines:[{saleLineId:'7',quantity:2},{saleLineId:'7',quantity:1}]}),{code:'DUPLICATE_RETURN_LINE'});
 assert.throws(()=>validateReturnRequest({reason:'Wrong size received',lines:[{saleLineId:'7',quantity:-1}]}),{code:'INVALID_QUANTITY'});
});
test('review must inspect every exact sale line with approved condition',()=>{
 assert.equal(validateReturnDecision({decision:'accept',conditions:[{saleLineId:'7',condition:'damaged'}]},['7']).decision,'accept');
 assert.throws(()=>validateReturnDecision({decision:'accept',conditions:[{saleLineId:'7',condition:'unknown'}]},['7']),{code:'INVALID_RETURN_REVIEW'});
 assert.throws(()=>validateReturnDecision({decision:'accept',conditions:[]},['7']),{code:'INVALID_RETURN_REVIEW'});
 assert.throws(()=>validateReturnDecision({decision:'accept',conditions:[{saleLineId:'8',condition:'resellable'}]},['7']),{code:'INVALID_RETURN_REVIEW'});
});
test('refund assessment prorates discounted sale across partial returns in cents',()=>{
 const first=proratedRefundDue({saleSubtotal:'11000.00',saleTotal:'10450.00',grossReturnedBefore:'0.00',grossReturnedAfter:'1000.00',priorRefundDue:'0.00'});
 assert.equal(first,'950.00');
 const second=proratedRefundDue({saleSubtotal:'11000.00',saleTotal:'10450.00',grossReturnedBefore:'1000.00',grossReturnedAfter:'11000.00',priorRefundDue:first});
 assert.equal(second,'9500.00');
 assert.throws(()=>proratedRefundDue({saleSubtotal:'100.00',saleTotal:'100.00',grossReturnedBefore:'0.00',grossReturnedAfter:'150.00',priorRefundDue:'0.00'}),{code:'INVALID_RETURN_TOTAL'});
});
test('round-half-up with successive partial returns never exceeds paid total',()=>{
 let prior='0.00';let due='0.00';
 for(let n=1;n<=3;n++){
   due=proratedRefundDue({saleSubtotal:'3.00',saleTotal:'2.00',grossReturnedBefore:`${n-1}.00`,grossReturnedAfter:`${n}.00`,priorRefundDue:prior});
   const cents=s=>Math.round(Number(s)*100);
   prior=((cents(prior)+cents(due))/100).toFixed(2);
 }
 assert.equal(prior,'2.00');
});
