import { InputError } from '../members/validation.js';

// Nairobi keeps a UTC+03:00 civil-day boundary. No locale-dependent Date.parse.
const DAY = 24 * 60 * 60 * 1000;
function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const time = Date.UTC(year, month - 1, day);
  const actual = new Date(time);
  if (actual.getUTCFullYear() !== year || actual.getUTCMonth() !== month - 1 || actual.getUTCDate() !== day) return null;
  return time;
}
export function todayInNairobi(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).filter(p => ['year', 'month', 'day'].includes(p.type))
    .reduce((o,p) => ({...o,[p.type]:p.value}),{});
}
export function parseReportRange(query = {}, now = new Date()) {
  if (Array.isArray(query.from) || Array.isArray(query.to)) throw new InputError('INVALID_DATE_RANGE','Use one date per field.');
  const {year, month, day} = todayInNairobi(now);
  const today = `${year}-${month}-${day}`;
  const to = query.to ?? today;
  const endDay = isoDate(to);
  if (endDay === null) throw new InputError('INVALID_DATE_RANGE','to must be a valid YYYY-MM-DD date.');
  const from = query.from ?? new Date(endDay - 29 * DAY).toISOString().slice(0,10);
  const firstDay = isoDate(from);
  if (firstDay === null || firstDay > endDay || (endDay - firstDay) / DAY >= 366) {
    throw new InputError('INVALID_DATE_RANGE','Select a valid inclusive date range of 1 to 366 days.');
  }
  // Start and exclusive end as UTC timestamps, using Kenya civil midnight.
  const start = new Date(firstDay - 3 * 60 * 60 * 1000).toISOString();
  const endExclusive = new Date(endDay + DAY - 3 * 60 * 60 * 1000).toISOString();
  return {from,to,start,endExclusive,params:[start,endExclusive,from,to]};
}
export function moneyCents(value) {
  const s = String(value);
  if (!/^-?\d+\.\d{2}$/.test(s)) throw new Error('Unexpected SQL monetary value');
  const neg = s.startsWith('-');
  const [whole,frac] = s.replace('-','').split('.');
  const n = BigInt(whole)*100n+BigInt(frac);
  return neg ? -n : n;
}
export function centsMoney(value) {
  const cents = BigInt(value);
  const neg = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${neg}${abs/100n}.${String(abs%100n).padStart(2,'0')}`;
}
export function sumMoney(values) { return centsMoney(values.reduce((sum,x)=>sum+moneyCents(x),0n)); }

export const REPORT_ROLES={
  overview:['ADM','FIN','MGT'],income:['ADM','FIN','MGT'],
  memberships:['ADM','REG','FIN','MGT'],sports:['ADM','MGT','FIN'],
  sales:['ADM','STO','FIN','MGT'],inventory:['ADM','STO','FIN','MGT'],
  events:['ADM','FIN','MGT'],equipment:['ADM','STO','FIN','MGT']
};
