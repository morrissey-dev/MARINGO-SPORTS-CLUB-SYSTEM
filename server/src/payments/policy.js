import { InputError, parseId } from '../members/validation.js';

export function moneyToCents(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,9})\.\d{2}$/.test(value))
    throw new InputError('INVALID_AMOUNT','Amount must be a positive KSh decimal string such as "500.00".');
  const [whole, fraction] = value.split('.');
  const cents=Number(whole)*100+Number(fraction);
  if (!Number.isSafeInteger(cents) || cents<=0) throw new InputError('INVALID_AMOUNT','Amount must be positive.');
  return cents;
}
export function centsToMoney(cents) {
  if (!Number.isSafeInteger(cents) || cents<0) throw new Error('Invalid money value');
  return `${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
}
export function validatePayment(body) {
  if (!body || typeof body!=='object' || Array.isArray(body)) throw new InputError('INVALID_PAYMENT','Payment details are required.');
  const chargeId=parseId(body.chargeId);
  if(!chargeId) throw new InputError('INVALID_CHARGE','Choose a valid membership charge.');
  const amount=centsToMoney(moneyToCents(body.amount));
  if(!['cash','mobile_money'].includes(body.method)) throw new InputError('INVALID_METHOD','Choose cash or mobile money.');
  let reference=null;
  if(body.method==='mobile_money') {
    if(typeof body.reference!=='string' || !/^[A-Za-z0-9-]{6,40}$/.test(body.reference.trim()))
      throw new InputError('INVALID_REFERENCE','Enter the mobile-money transaction reference (6–40 letters, digits or hyphens).');
    reference=body.reference.trim().toUpperCase();
  }
  if(body.method==='cash' && body.reference && String(body.reference).trim())
    throw new InputError('INVALID_REFERENCE','Cash payments do not use a mobile-money reference.');
  return {chargeId,amount,method:body.method,reference};
}
export function validateEvidence(input) {
  if(typeof input!=='string' || !/^[A-Za-z0-9/_-]{6,100}$/.test(input.trim()))
    throw new InputError('EVIDENCE_REQUIRED','Provide a non-sensitive verification reference (6–100 characters).');
  return input.trim();
}
export function validateReason(input) {
  if(typeof input!=='string' || input.trim().length<10 || input.trim().length>300)
    throw new InputError('REASON_REQUIRED','Provide a clear reason (10–300 characters).');
  return input.trim();
}
export function paymentDecision(totalCents, alreadyPaidCents, attemptedCents) {
  if(attemptedCents>totalCents-alreadyPaidCents) throw new InputError('OVERPAYMENT','Verified payment would exceed the remaining charge balance.');
  const remaining=totalCents-alreadyPaidCents-attemptedCents;
  return {remainingCents:remaining,paid:remaining===0};
}
