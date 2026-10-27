import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReportRange,moneyCents,centsMoney,sumMoney} from '../src/reports/policy.js';

const current=new Date('2026-10-28T02:00:00.000Z');
test('date period uses Kenyan local date not server UTC date',()=>{
  const period=parseReportRange({},new Date('2026-10-27T22:00:00Z'));
  assert.equal(period.to,'2026-10-28');
  assert.equal(period.from,'2026-09-29');
  assert.equal(period.endExclusive,'2026-10-28T21:00:00.000Z');
});
test('inclusive Nairobi boundaries map to correct UTC timestamps',()=>{
  const p=parseReportRange({from:'2026-10-01',to:'2026-10-02'},current);
  assert.deepEqual(p.params.slice(0,2),['2026-09-30T21:00:00.000Z','2026-10-02T21:00:00.000Z']);
  assert.deepEqual(p.params.slice(2),['2026-10-01','2026-10-02']);
});
test('date validation rejects impossible, reversed, oversized and duplicated ranges',()=>{
  for (const q of [
    {from:'2026-02-30',to:'2026-03-01'}, {from:'2026-11-01',to:'2026-10-01'},
    {from:'2024-01-01',to:'2026-10-28'}, {from:['2026-10-01'],to:'2026-10-02'},
    {from:'2026-10-01',to:'not-date'}, {from:1,to:'2026-10-02'}
  ]) assert.throws(()=>parseReportRange(q,current),{code:'INVALID_DATE_RANGE'});
  assert.equal(parseReportRange({from:'2024-02-29',to:'2024-02-29'},current).from,'2024-02-29');
});
test('monetary aggregation preserves cents and negative reversals exactly',()=>{
  assert.equal(moneyCents('0.01'),1n);
  assert.equal(moneyCents('-1000.00'),-100000n);
  assert.equal(centsMoney(-1n),'-0.01');
  assert.equal(sumMoney(['1000.00','500.20','-1000.00','0.01']),'500.21');
  assert.throws(()=>moneyCents('NaN'));
});
