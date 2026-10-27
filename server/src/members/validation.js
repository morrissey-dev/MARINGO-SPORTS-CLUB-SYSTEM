import { getAge } from '../auth/policy.js';

export class InputError extends Error {
  constructor(code, message, fieldErrors={}) {
    super(message);
    this.code=code;
    this.fieldErrors=fieldErrors;
  }
}
export function kenyaDate(now=new Date()) {
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
const string = (v,max=150) => typeof v==='string' && v.trim().length>0 && v.trim().length<=max ? v.trim() : null;
const optional = (v,max=150) => v===null || v===undefined || v==='' ? null : string(v,max);

export function validateMember(body,onDate=kenyaDate()) {
  if (!body || typeof body!=='object' || Array.isArray(body)) throw new InputError('INVALID_MEMBER','Provide a member record.');
  const fullName=string(body.fullName,150);
  const gender=optional(body.gender,50);
  const phone=optional(body.phone,30);
  const subCounty=string(body.subCounty,100);
  const schoolOrCollege=optional(body.schoolOrCollege,150);
  const registrationType=body.registrationType;
  if(!fullName) throw new InputError('INVALID_MEMBER','Enter the member’s full name.',{fullName:'Required (2–150 characters).'});
  if(fullName.length<2) throw new InputError('INVALID_MEMBER','Enter a valid full name.',{fullName:'Minimum 2 characters.'});
  if(!subCounty) throw new InputError('INVALID_MEMBER','Enter the member’s sub-county.',{subCounty:'Required.'});
  if(body.phone && !phone || body.gender && !gender || body.schoolOrCollege && !schoolOrCollege)
    throw new InputError('INVALID_MEMBER','One or more fields are too long or invalid.');
  let age;
  try {age=getAge(body.dateOfBirth,onDate);} catch {throw new InputError('INVALID_DOB','Use a valid past date of birth in YYYY-MM-DD format.',{dateOfBirth:'Invalid date.'});}
  if(age<12||age>35) throw new InputError('AGE_NOT_ELIGIBLE','Registration is available to ages 12–35.',{dateOfBirth:'Outside eligible age range.'});
  if(!['individual','group'].includes(registrationType)) throw new InputError('INVALID_MEMBERSHIP','Choose individual or group registration.');
  const organizationId=registrationType==='group' ? parseId(body.organizationId) : null;
  if(registrationType==='group'&&!organizationId) throw new InputError('ORGANIZATION_REQUIRED','Select a registered organization.');
  if(registrationType==='individual' && body.organizationId) throw new InputError('INVALID_MEMBERSHIP','Individual registration cannot have an organization.');
  if (!Array.isArray(body.sportIds)||body.sportIds.length===0||body.sportIds.length>50) throw new InputError('SPORTS_REQUIRED','Choose 1–50 sports in priority order.');
  const sportIds=body.sportIds.map(parseId);
  if(sportIds.some(v=>!v) || new Set(sportIds).size!==sportIds.length) throw new InputError('INVALID_SPORTS','Choose distinct valid sports.');
  const kin=body.nextOfKin;
  if(!kin || typeof kin!=='object') throw new InputError('NEXT_OF_KIN_REQUIRED','Next-of-kin details are required.');
  const nextOfKin={fullName:string(kin.fullName),relationship:string(kin.relationship,80),phone:string(kin.phone,30)};
  if(!nextOfKin.fullName||!nextOfKin.relationship||!nextOfKin.phone) throw new InputError('NEXT_OF_KIN_REQUIRED','Enter next-of-kin name, relationship and contact.');
  let guardian=null;
  if(age<18){
    if(!body.guardian||typeof body.guardian!=='object') throw new InputError('GUARDIAN_REQUIRED','Provide a guardian contact for a minor.');
    guardian={fullName:string(body.guardian.fullName),relationship:string(body.guardian.relationship,80),phone:string(body.guardian.phone,30)};
    if(!guardian.fullName||!guardian.relationship||!guardian.phone) throw new InputError('GUARDIAN_REQUIRED','Enter guardian name, relationship and contact.');
  }
  if(body.guardian && age>=18) throw new InputError('INVALID_GUARDIAN','Guardian information is not required for adult applications.');
  const ageBand=age<=17?'minor':age<=25?'middle':'senior';
  return {fullName,gender,phone,subCounty,schoolOrCollege,dateOfBirth:body.dateOfBirth,age,ageBand,registrationType,organizationId,sportIds,nextOfKin,guardian,fee:registrationType==='group'?'500.00':'1000.00'};
}
export function parseId(value) {
  const s=String(value??'');
  if(!/^[1-9]\d{0,14}$/.test(s)) return null;
  return s;
}
export function validateOrganization(body) {
  if(!body || typeof body!=='object') throw new InputError('INVALID_ORGANIZATION','Organization details are required.');
  const name=string(body.name,150);
  const type=body.type;
  if(!name || name.length<2 || !['school','college','religious'].includes(type)) throw new InputError('INVALID_ORGANIZATION','Enter a valid name and organization type.');
  return {name,type};
}
