import { InputError } from '../members/validation.js';
import { requiredId, canManageSport } from '../teams/policy.js';

const err=(code,message)=>new InputError(code,message);
export const EVENT_FEE_CENTS=50000;
export const COMMISSION_PERCENT=20;
export { requiredId };

export function validateEvent(body){
  if(!body || typeof body!=='object' || Array.isArray(body))throw err('INVALID_EVENT','Event details are required.');
  const teamId=requiredId(body.teamId,'teamId');
  const eventType=body.eventType;
  if(!['internal','external'].includes(eventType))throw err('INVALID_EVENT_TYPE','Choose internal or external event.');
  const eventDate=body.eventDate;
  if(typeof eventDate!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
    Number.isNaN(new Date(`${eventDate}T12:00:00Z`).getTime()) || new Date(`${eventDate}T12:00:00Z`).toISOString().slice(0,10)!==eventDate)
    throw err('INVALID_EVENT_DATE','Use a real date in YYYY-MM-DD format.');
  const clean=(x,max)=>typeof x==='string' && x.trim().length>=2 && x.trim().length<=max && !/[\u0000-\u001f\u007f]/.test(x) ? x.trim():null;
  const venue=clean(body.venue,150),opponent=clean(body.opponent,150);
  if(!venue)throw err('INVALID_VENUE','Enter a venue (2–150 printable characters).');
  if(eventType==='external'&&!opponent)throw err('OPPONENT_REQUIRED','Provide an external opponent.');
  if(eventType==='internal' && body.opponent && !opponent)throw err('INVALID_OPPONENT','Enter a valid opponent or leave blank.');
  return {teamId,eventType,eventDate,venue,opponent:eventType==='internal'?(opponent||null):opponent};
}
export function canManageEvent(roles,actorId,patronUserId){return canManageSport(roles,actorId,patronUserId);}
export function canViewEvent(roles,actorId,patronUserId){return roles.some(r=>['ADM','MGT','FIN'].includes(r))||canManageEvent(roles,actorId,patronUserId);}
export function commissionPreview(billedCents,verifiedCents){
  for(const n of [billedCents,verifiedCents])if(!Number.isSafeInteger(n)||n<0)throw new Error('Amounts must be nonnegative whole cents.');
  if(verifiedCents>billedCents)throw new Error('Verified amount cannot exceed assessed charges.');
  // Exact values for our 500 KES fee and 20% rate; explicit rounding convention for future rates.
  return {billed:(billedCents*COMMISSION_PERCENT/100),collected:(verifiedCents*COMMISSION_PERCENT/100),basisConfirmed:false};
}
