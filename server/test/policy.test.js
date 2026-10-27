import test from 'node:test';
import assert from 'node:assert/strict';
import { getAge, normalizeEmail, rolesMayAccess } from '../src/auth/policy.js';

test('age boundaries use complete birth dates rather than year subtraction',()=>{
  assert.equal(getAge('2014-10-28','2026-10-27'),11);
  assert.equal(getAge('2014-10-27','2026-10-27'),12);
  assert.equal(getAge('2009-10-27','2026-10-27'),17);
  assert.equal(getAge('2008-10-27','2026-10-27'),18);
  assert.equal(getAge('2001-10-27','2026-10-27'),25);
  assert.equal(getAge('2000-10-27','2026-10-27'),26);
  assert.equal(getAge('1991-10-27','2026-10-27'),35);
  assert.equal(getAge('1990-10-27','2026-10-27'),36);
  assert.throws(()=>getAge('2026-02-30','2026-10-27'),/Invalid/);
});
test('email is normalized; invalid emails rejected',()=>{
  assert.equal(normalizeEmail(' USER@Example.Com '),'user@example.com');
  assert.equal(normalizeEmail('not-an-email'),null);
  assert.equal(normalizeEmail(null),null);
});
test('authorization requires an allowed role',()=>{
  assert.equal(rolesMayAccess(['STO'],['REG','ADM']),false);
  assert.equal(rolesMayAccess(['STO','ADM'],['REG','ADM']),true);
  assert.equal(rolesMayAccess(null,['ADM']),false);
});
