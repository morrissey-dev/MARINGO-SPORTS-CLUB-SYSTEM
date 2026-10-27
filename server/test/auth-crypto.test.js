import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, makeToken, digest, deriveCsrf, safeMatchHex } from '../src/auth/crypto.js';

test('password uses salted scrypt and can be verified securely',async()=>{
  const pw='CorrectHorse!2026';
  const a=await hashPassword(pw);
  const b=await hashPassword(pw);
  assert.match(a,/^scrypt\$16384\$8\$1\$/);
  assert.notEqual(a,b);
  assert.equal(await verifyPassword(pw,a),true);
  assert.equal(await verifyPassword('WrongPassword2026',a),false);
  assert.equal(await verifyPassword(pw,'bogus'),false);
});
test('short passwords are rejected',async()=>{
  await assert.rejects(hashPassword('short'),/12–256/);
});
test('random sessions, stable digests and CSRF binding',()=>{
  const token=makeToken(), token2=makeToken();
  assert.equal(token.length,64);
  assert.notEqual(token,token2);
  assert.equal(digest(token),digest(token));
  assert.notEqual(digest(token),token);
  const a=deriveCsrf(token,'f'.repeat(64));
  assert.equal(safeMatchHex(a,a),true);
  assert.equal(safeMatchHex(a,deriveCsrf(token2,'f'.repeat(64))),false);
  assert.equal(safeMatchHex('not a token',a),false);
});
