import {InputError} from '../members/validation.js';
import {positiveId,quantity} from './policy.js';
const fail=(code,message)=>new InputError(code,message);
export function validateReturnRequest(body){
  if(!body||typeof body!=='object'||Array.isArray(body))throw fail('INVALID_RETURN','Provide a return request.');
  const reason=typeof body.reason==='string'?body.reason.trim():'';
  if(reason.length<10||reason.length>500)throw fail('INVALID_RETURN_REASON','Explain the return in 10–500 characters.');
  if(!Array.isArray(body.lines)||body.lines.length===0||body.lines.length>30)
    throw fail('INVALID_RETURN_LINES','Provide 1–30 sale lines being returned.');
  const ids=new Set();
  const lines=body.lines.map(x=>{
    const saleLineId=positiveId(x?.saleLineId,'sale line');
    const count=quantity(x?.quantity,10000);
    if(ids.has(saleLineId))throw fail('DUPLICATE_RETURN_LINE','Combine quantities for the same sale item.');
    ids.add(saleLineId);
    return {saleLineId,quantity:count};
  });
  return {reason,lines};
}
export function validateReturnDecision(body,requestedLineIds){
  if(body?.decision==='reject') {
    if(body.conditions!==undefined)throw fail('INVALID_RETURN_REVIEW','Do not specify conditions when rejecting.');
    return {decision:'reject',conditions:[]};
  }
  if(body?.decision!=='accept')throw fail('INVALID_RETURN_REVIEW','Choose accept or reject.');
  if(!Array.isArray(body.conditions)||body.conditions.length!==requestedLineIds.length)
    throw fail('INVALID_RETURN_REVIEW','Inspect every returned product line.');
  const seen=new Set();
  for(const item of body.conditions){
    const id=positiveId(item?.saleLineId,'sale line');
    if(!requestedLineIds.includes(id)||seen.has(id)||!['resellable','damaged'].includes(item.condition))
      throw fail('INVALID_RETURN_REVIEW','Provide one valid condition for each requested line.');
    seen.add(id);
  }
  return {decision:'accept',conditions:body.conditions.map(i=>({saleLineId:positiveId(i.saleLineId),condition:i.condition}))};
}
// Cumulative round-half-up proration ensures approved return entitlements never exceed the
// sale's discounted total, irrespective of the order in which returns are reviewed.
export function proratedRefundDue({saleSubtotal,saleTotal,grossReturnedBefore,grossReturnedAfter,priorRefundDue}){
  const toCents=s=>{if(typeof s!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(s))throw fail('INVALID_RETURN_TOTAL','Invalid monetary amount.');
    const [whole,fraction='']=s.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));};
  const subtotal=toCents(saleSubtotal),total=toCents(saleTotal),before=toCents(grossReturnedBefore),after=toCents(grossReturnedAfter),prior=toCents(priorRefundDue);
  if(subtotal<=0n||total<=0n||total>subtotal||after<before||after>subtotal)throw fail('INVALID_RETURN_TOTAL','Return exceeds the original sale.');
  const cumulative=(after*total+subtotal/2n)/subtotal;
  if(cumulative<prior||cumulative>total)throw fail('INVALID_RETURN_TOTAL','Return amount cannot be reconciled.');
  const due=cumulative-prior;
  return `${due/100n}.${String(due%100n).padStart(2,'0')}`;
}
