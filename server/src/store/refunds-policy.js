import {InputError} from '../members/validation.js';
const fail=(code,message)=>new InputError(code,message);
export function validateRefundRequest(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('INVALID_REFUND','Provide refund details.');
  if(!['cash','mobile_money'].includes(input.method))throw fail('INVALID_REFUND_METHOD','Use cash or mobile money.');
  const reason=typeof input.reason==='string'?input.reason.trim():'';
  if(reason.length<10||reason.length>500)throw fail('INVALID_REFUND_REASON','Explain the refund in 10–500 characters.');
  return {method:input.method,reason};
}
export function validateRefundDecision(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!['pay','reject'].includes(input.decision))
    throw fail('INVALID_REFUND_DECISION','Choose pay or reject.');
  if(input.decision==='reject'){
    if(input.evidenceReference||input.evidenceNote)throw fail('INVALID_REFUND_DECISION','Rejected requests cannot include disbursement evidence.');
    const reason=typeof input.reason==='string'?input.reason.trim():'';
    if(reason.length<10||reason.length>500)throw fail('INVALID_REFUND_REASON','Explain rejection in 10–500 characters.');
    return {decision:'reject',reason};
  }
  const evidenceReference=typeof input.evidenceReference==='string'?input.evidenceReference.trim():'';
  const evidenceNote=typeof input.evidenceNote==='string'?input.evidenceNote.trim():'';
  if(!/^[A-Za-z0-9][A-Za-z0-9_.:\/-]{5,99}$/.test(evidenceReference))
    throw fail('INVALID_REFUND_EVIDENCE','Provide a unique cash voucher or verified transfer reference (6–100 characters).');
  if(evidenceNote.length<10||evidenceNote.length>500)
    throw fail('INVALID_REFUND_EVIDENCE','Document independent evidence of actual repayment (10–500 characters).');
  return {decision:'pay',evidenceReference,evidenceNote};
}
export function refundStatusLabel(record){
  if(record?.status==='paid')return 'paid';
  if(record?.status==='pending')return 'pending_verification';
  if(record?.status==='rejected')return 'rejected';
  return 'not_requested';
}
