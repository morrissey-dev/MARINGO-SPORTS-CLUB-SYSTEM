import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent,canManageEvent,canViewEvent,commissionPreview,EVENT_FEE_CENTS } from '../src/events/policy.js';

test('event validates team, type, venue, opponent and calendar date',()=>{
  const e=validateEvent({teamId:'5',eventType:'external',eventDate:'2026-11-20',venue:'Maringo Stadium',opponent:'Ruiru United'});
  assert.equal(e.teamId,'5');assert.equal(e.opponent,'Ruiru United');
  assert.equal(validateEvent({teamId:'5',eventType:'internal',eventDate:'2026-11-20',venue:'Field A'}).opponent,null);
  for(const invalid of ['2026-02-30','2026-13-01','not-a-date','2026-2-5'])
    assert.throws(()=>validateEvent({teamId:'5',eventType:'internal',eventDate:invalid,venue:'Field A'}));
  assert.throws(()=>validateEvent({teamId:'5',eventType:'external',eventDate:'2026-11-20',venue:'Field A'}),{code:'OPPONENT_REQUIRED'});
  assert.throws(()=>validateEvent({teamId:'5',eventType:'friendly',eventDate:'2026-11-20',venue:'Field A'}),{code:'INVALID_EVENT_TYPE'});
  assert.throws(()=>validateEvent({teamId:'5',eventType:'internal',eventDate:'2026-11-20',venue:'X'}),{code:'INVALID_VENUE'});
});
test('patrons cannot change other sports events, but finance and management can view',()=>{
  assert.equal(canManageEvent(['PAT'],'7','7'),true);
  assert.equal(canManageEvent(['PAT'],'7','8'),false);
  assert.equal(canManageEvent(['FIN'],'7','7'),false);
  assert.equal(canManageEvent(['ADM'],'7',null),true);
  assert.equal(canViewEvent(['MGT'],'7',null),true);
  assert.equal(canViewEvent(['FIN'],'7',null),true);
  assert.equal(canViewEvent(['PAT'],'7','8'),false);
});
test('fee and commission projections are correct, conditional and not payable',()=>{
  assert.equal(EVENT_FEE_CENTS,50000);
  const projection=commissionPreview(4*EVENT_FEE_CENTS,3*EVENT_FEE_CENTS);
  assert.deepEqual(projection,{billed:40000,collected:30000,basisConfirmed:false});
  assert.throws(()=>commissionPreview(50000,60000));
});
