import { InputError,parseId,kenyaDate } from '../members/validation.js';
import { moneyToCents,centsToMoney } from '../payments/policy.js';
const invalid=(code,message)=>new InputError(code,message);
export function id(value,name='id') {const s=parseId(value);if(!s)throw invalid('INVALID_ID',`Select a valid ${name}.`);return s;}
export function count(value){if(!Number.isInteger(value)||value<1||value>10000)throw invalid('INVALID_QUANTITY','Quantity must be an integer from 1 to 10,000.');return value;}
export function nonnegative(value){if(!Number.isInteger(value)||value<0||value>10000)throw invalid('INVALID_QUANTITY','Condition quantities must be whole numbers from 0 to 10,000.');return value;}
export function text(value,min=2,max=150,label='Text'){
  if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\x00-\x1f\x7f]/.test(value))
    throw invalid('INVALID_TEXT',`${label} must be ${min}–${max} printable characters.`);
  return value.trim();
}
export function optionalId(value,name='id'){return value===null||value===undefined||value===''?null:id(value,name);}
export function newItem(body){
  const code=text(body?.code,3,40,'Equipment code').toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code))throw invalid('INVALID_CODE','Equipment code must contain letters, numbers, - or _.');
  const name=text(body?.name,2,120,'Equipment name');
  const marketValue=centsToMoney(moneyToCents(body?.marketValue));
  return {code,name,marketValue};
}
export function receipt(body){return {equipmentTypeId:id(body?.equipmentTypeId,'equipment type'),quantity:count(body?.quantity),sourceReference:text(body?.sourceReference,3,80,'Receipt reference').toUpperCase()};}
export function loanRequest(body,onDate=kenyaDate()){
  const teamId=id(body?.teamId,'team');const eventId=optionalId(body?.eventId,'event');
  const purpose=text(body?.purpose,3,200,'Purpose');
  const dueDate=body?.dueDate;
  const date=typeof dueDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(dueDate)?new Date(`${dueDate}T00:00:00Z`):null;
  if(!date||Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==dueDate||dueDate<onDate)
    throw invalid('INVALID_DUE_DATE','Provide a valid today-or-future due date.');
  if(!Array.isArray(body?.lines)||body.lines.length<1||body.lines.length>30)throw invalid('INVALID_LINES','Choose 1–30 equipment types.');
  const seen=new Set();const lines=body.lines.map(line=>{
    const equipmentTypeId=id(line?.equipmentTypeId,'equipment type');const quantity=count(line?.quantity);
    if(seen.has(equipmentTypeId))throw invalid('DUPLICATE_EQUIPMENT','Each equipment type can appear only once.');
    seen.add(equipmentTypeId);return {equipmentTypeId,quantity};
  }).sort((a,b)=>BigInt(a.equipmentTypeId)<BigInt(b.equipmentTypeId)?-1:1);
  return {teamId,eventId,purpose,dueDate,lines};
}
export function returnRequest(body){
  if(!Array.isArray(body?.lines)||!body.lines.length||body.lines.length>30)throw invalid('INVALID_LINES','Record 1–30 loan lines.');
  const seen=new Set();const lines=body.lines.map(line=>{
    const loanLineId=id(line?.loanLineId,'loan line');
    if(seen.has(loanLineId))throw invalid('DUPLICATE_EQUIPMENT','Do not repeat the same loan line.');
    seen.add(loanLineId);
    const usableQty=nonnegative(line.usableQty),damagedQty=nonnegative(line.damagedQty),missingQty=nonnegative(line.missingQty);
    if(usableQty+damagedQty+missingQty<1 || usableQty+damagedQty+missingQty>10000)
      throw invalid('INVALID_QUANTITY','At least one item must be returned or reported missing.');
    return {loanLineId,usableQty,damagedQty,missingQty};
  }).sort((a,b)=>BigInt(a.loanLineId)<BigInt(b.loanLineId)?-1:1);
  const notes=body?.notes?text(body.notes,1,500,'Inspection notes'):null;
  return {lines,notes};
}
export function surcharge(quantity,marketValue){
  const n=count(quantity);const cents=moneyToCents(marketValue);
  if(cents<=0)throw invalid('INVALID_VALUATION','Market value must be greater than zero.');
  if(cents*n>900000000000)throw invalid('INVALID_VALUATION','Market valuation is too large.');
  return centsToMoney(Math.floor((cents*n*110+50)/100));
}
export function canRequest(roles,actorId,patronId){return roles.some(x=>['ADM','MGT'].includes(x)) || (roles.includes('PAT')&&String(actorId)===String(patronId));}
export function canRead(roles,actorId,patronId){return roles.some(x=>['ADM','MGT','STO','FIN'].includes(x))||canRequest(roles,actorId,patronId);}
