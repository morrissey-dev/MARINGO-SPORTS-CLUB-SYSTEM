import test from 'node:test';
import assert from 'node:assert/strict';
import {listSales} from '../src/store/service.js';
import {reportSql} from '../src/reports/service.js';
import {parseReportRange} from '../src/reports/policy.js';

// This test caught a genuine integration bug: the old sales query joined
// members but didn't SELECT the membership number used by its response mapper.
test('sales list includes joined buyer membership numbers',async()=>{
  const queries=[];
  const db={query:async(sql)=>{
    queries.push(sql);
    assert.match(sql,/m\.membership_number\s+AS\s+buyer_member_number/i);
    return {rows:[{id:'12',status:'completed',subtotal:'2000.00',discount:'0.00',total:'2000.00',
      buyer_member_number:'MSC-00000021',method:'cash',payment_status:'verified'}]};
  }};
  const sales=await listSales(db);
  assert.equal(sales.length,1);
  assert.equal(sales[0].buyerMemberNumber,'MSC-00000021');
});

test('report SQL keeps pending payments and incident estimates out of income',()=>{
  const income=reportSql.income;
  assert.match(income,/p\.status IN \('verified','reversed'\)/);
  assert.match(income,/s\.status='completed' AND t\.status='verified'/);
  assert.doesNotMatch(income,/equipment_incidents/);
});

test('Kenyan civil day boundaries stay correct across month and year end',()=>{
  const p=parseReportRange({from:'2026-12-31',to:'2027-01-01'});
  assert.equal(p.start,'2026-12-30T21:00:00.000Z');
  assert.equal(p.endExclusive,'2027-01-01T21:00:00.000Z');
});

const deps = await Promise.all([import('express').catch(()=>null),import('pg').catch(()=>null)]);
const canRunHttp = deps.every(Boolean);
test('actual HTTP app rejects malformed JSON, oversized input and sends no-store headers',
  {skip:canRunHttp?false:'Install npm dependencies to run this HTTP regression test'}, async()=>{
    process.env.APP_ORIGIN='http://localhost:5173';
    const {createApp}=await import('../src/app.js');
    const server=await new Promise(resolve=>{
      const s=createApp().listen(0,'127.0.0.1',()=>resolve(s));
    });
    try{
      const url=`http://127.0.0.1:${server.address().port}/api/v1/health`;
      const health=await fetch(url);
      assert.equal(health.status,200);
      assert.equal(health.headers.get('cache-control'),'no-store');
      assert.equal(health.headers.get('x-content-type-options'),'nosniff');
      const bad=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{' });
      assert.equal(bad.status,400);
      assert.equal((await bad.json()).error.code,'INVALID_JSON');
      const tooLarge=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({data:'x'.repeat(102401)})});
      assert.equal(tooLarge.status,413);
      assert.equal((await tooLarge.json()).error.code,'PAYLOAD_TOO_LARGE');
    }finally{await new Promise(resolve=>server.close(resolve));}
  });
