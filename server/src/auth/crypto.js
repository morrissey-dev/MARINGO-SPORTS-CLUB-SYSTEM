import { scrypt as scryptCallback, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const COST = 16384;
const PARAMS = { N: COST, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function validPassword(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 256;
}

export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error('Password must contain 12–256 characters.');
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password,Buffer.from(salt,'hex'),64,PARAMS);
  return `scrypt$${COST}$8$1$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const match = /^scrypt\$16384\$8\$1\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(stored);
  if (!match) return false;
  const expected = Buffer.from(match[2],'hex');
  const actual = await scrypt(password,Buffer.from(match[1],'hex'),expected.length,PARAMS);
  return timingSafeEqual(actual,expected);
}
export const digest = input => createHash('sha256').update(input).digest('hex');
export const makeToken = () => randomBytes(32).toString('hex');
export function deriveCsrf(token, secret) {
  return createHmac('sha256', secret).update(`mscms-csrf:${token}`).digest('hex');
}
export function safeMatchHex(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
