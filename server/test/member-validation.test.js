import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMember, kenyaDate, validateOrganization } from '../src/members/validation.js';
import {idempotencyKey} from '../src/members/registration.js';
const date='2026-10-27';
const payload=(dob='2010-10-27')=>({fullName:'Test Member',dateOfBirth:dob,subCounty:'Example Sub-County',registrationType:'individual',
  sportIds:['1','3'],nextOfKin:{fullName:'Contact Person',relationship:'Parent',phone:'0700000000'},
  guardian:{fullName:'Guardian Person',relationship:'Parent',phone:'0700000000'}});
const valid=p=>validateMember(p,date);
test('age boundaries 12, 17, 18, 25, 26, 35',()=>{
  for (const [dob,band,minor] of [['2014-10-27','minor',true],['2009-10-27','minor',true],['2008-10-27','middle',false],['2001-10-27','middle',false],['2000-10-27','senior',false],['1991-10-27','senior',false]]) {
    const p=payload(dob);if(!minor) delete p.guardian;
    assert.equal(valid(p).ageBand,band);
  }
});
test('age before birthday and invalid dates are rejected',()=>{
  assert.throws(()=>valid(payload('2014-10-28')),/ages 12–35/);
  assert.throws(()=>valid(payload('1990-10-27')),/ages 12–35/);
  assert.throws(()=>valid(payload('2010-02-30')),/valid past date/);
});
test('minors require guardian contact',()=>{const p=payload();delete p.guardian;assert.throws(()=>valid(p),/guardian contact/);});
test('adults do not include guardian information',()=>{assert.throws(()=>valid(payload('2001-10-27')),/not required/);});
test('individual is KSh 1,000 while group is KSh 500',()=>{
  const a=valid(payload());assert.equal(a.fee,'1000.00');
  const b=payload();b.registrationType='group';b.organizationId='8';assert.equal(valid(b).fee,'500.00');
});
test('group registration requires organization; individual cannot use one',()=>{
  const p=payload();p.registrationType='group';assert.throws(()=>valid(p),/organization/);
  p.registrationType='individual';p.organizationId='8';assert.throws(()=>valid(p),/cannot have/);
});
test('sports are ordered, unique and selected',()=>{
  const p=payload();assert.deepEqual(valid(p).sportIds,['1','3']);
  p.sportIds=['1','1'];assert.throws(()=>valid(p),/distinct/);
  p.sportIds=[];assert.throws(()=>valid(p),/Choose 1/);
});
test('next of kin required',()=>{
  const p=payload();delete p.nextOfKin;assert.throws(()=>valid(p),/required/);
});
test('organization must use known type and name',()=>{
  assert.deepEqual(validateOrganization({name:'  Maringo School ',type:'school'}),{name:'Maringo School',type:'school'});
  assert.throws(()=>validateOrganization({name:'M',type:'club'}),/valid name/);
});
test('idempotency key is hashed and validated',()=>{
  assert.equal(idempotencyKey('01234567-abcdef-xyz').length,64);
  assert.throws(()=>idempotencyKey('weak'),/Idempotency-Key/);
});
test('date formatter returns Kenyan ISO calendar date',()=>{
  assert.equal(kenyaDate(new Date('2026-10-26T22:30:00Z')),'2026-10-27');
});
