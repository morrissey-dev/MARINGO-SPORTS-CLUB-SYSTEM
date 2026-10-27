import { InputError,parseId } from '../members/validation.js';
import { centsToMoney,moneyToCents } from '../payments/policy.js';
const bad=(code,message)=>new InputError(code,message);
export function positiveId(value, field='id') { const id=parseId(value); if(!id)throw bad('INVALID_ID',`Choose a valid ${field}.`);return id; }
export function quantity(value, max=10000){if(!Number.isInteger(value)||value<1||value>max)throw bad('INVALID_QUANTITY',`Quantity must be an integer between 1 and ${max}.`);return value;}
export function validateItem(body){
  if(!body || typeof body!=='object'||Array.isArray(body))throw bad('INVALID_ITEM','Item details required.');
  const sku=typeof body.sku==='string'?body.sku.trim().toUpperCase():'';
  const name=typeof body.name==='string'?body.name.trim():'';
  const variant=typeof body.variant==='string'&&body.variant.trim()?body.variant.trim():null;
  if(!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(sku) || name.length<2 || name.length>120 || (variant&&variant.length>100))throw bad('INVALID_ITEM','Use SKU (3–40 letters/digits/-/_), name (2–120), optional variant (≤100).');
  const unitPrice=centsToMoney(moneyToCents(body.unitPrice));
  const maxStockLevel=quantity(body.maxStockLevel,1000000);
  if(name.toLowerCase()==='sports shoes' && (moneyToCents(unitPrice)<100000 || moneyToCents(unitPrice)>400000 || !variant))
    throw bad('INVALID_SHOE_VARIANT','Sports shoes require a variant and a unit price between KSh 1,000.00 and 4,000.00.');
  return {sku,name,variant,unitPrice,maxStockLevel};
}
export function validateReceipt(body){
  const itemId=positiveId(body?.itemId,'item'); const count=quantity(body?.quantity);
  const sourceReference=typeof body.sourceReference==='string'?body.sourceReference.trim().toUpperCase():'';
  if(sourceReference.length<3||sourceReference.length>80)throw bad('INVALID_REFERENCE','Enter a stock receipt reference (3–80 characters).');
  return {itemId,quantity:count,sourceReference};
}
export function validateSale(body){
  if(!Array.isArray(body?.lines)||!body.lines.length||body.lines.length>30)throw bad('INVALID_SALE','Provide 1–30 distinct sale items.');
  const seen=new Set();return body.lines.map(line=>{
    const itemId=positiveId(line?.itemId,'item'); const qty=quantity(line?.quantity,10000);
    if(seen.has(itemId))throw bad('DUPLICATE_ITEM','Combine quantities for repeated products.');
    seen.add(itemId);return {itemId,qty};
  });
}
export function validateBuyer(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string'||!/^MSC-[0-9]{8}$/.test(value.trim().toUpperCase()))throw bad('INVALID_BUYER','Enter an MSC-00000001 membership number or leave blank.');
  return value.trim().toUpperCase();
}
export function calculateSale(lines){
  let subtotal=0;
  for(const line of lines){const price=moneyToCents(line.unitPrice);subtotal+=price*quantity(line.qty);}
  if(!Number.isSafeInteger(subtotal)||subtotal<=0||subtotal>99999999999)throw bad('INVALID_TOTAL','Sale amount is too large.');
  // Exactly 10,000 receives no discount. Half-up to the nearest cent.
  const discount=subtotal>1000000?Math.floor((subtotal*5+50)/100):0;
  return {subtotal:centsToMoney(subtotal),discount:centsToMoney(discount),total:centsToMoney(subtotal-discount)};
}
export function lowStock(qty,max){return qty*5<=max;}
export function validateTender(body){
  if(body?.method!=='cash'&&body?.method!=='mobile_money')throw bad('INVALID_METHOD','Choose cash or mobile money.');
  let reference=null;
  if(body.method==='mobile_money'){
    if(typeof body.reference!=='string'||!/^[A-Za-z0-9-]{6,40}$/.test(body.reference.trim()))throw bad('INVALID_REFERENCE','Enter a valid transfer reference.');
    reference=body.reference.trim().toUpperCase();
  }else if(body.reference && String(body.reference).trim()) throw bad('INVALID_REFERENCE','Cash does not use a mobile-money reference.');
  return {method:body.method,reference};
}
export function validateVerificationEvidence(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9/_-]{6,100}$/.test(value.trim()))throw bad('EVIDENCE_REQUIRED','Enter a non-sensitive verification evidence reference (6–100 characters).');
  return value.trim();
}
