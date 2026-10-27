export function normalizeEmail(input) {
  if (typeof input !== 'string') return null;
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
export function rolesMayAccess(actualRoles, allowedRoles) {
  return Array.isArray(actualRoles) && actualRoles.some(role => allowedRoles.includes(role));
}
export function getAge(birthDate, onDate) {
  // ISO date-only inputs; no local timezone or year subtraction approximation.
  const parse = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date must be YYYY-MM-DD');
    const [year,month,day]=value.split('-').map(Number);
    const date=new Date(Date.UTC(year,month-1,day));
    if (date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) throw new Error('Invalid date');
    return {year,month,day};
  };
  const dob=parse(birthDate);const at=parse(onDate);
  const age=at.year-dob.year-((at.month<dob.month || (at.month===dob.month && at.day<dob.day)) ? 1:0);
  if (age < 0) throw new Error('Date of birth is in the future');
  return age;
}
