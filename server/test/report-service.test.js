import test from 'node:test';
import assert from 'node:assert/strict';
import {getReport,reportSql,reportParameters} from '../src/reports/service.js';

const period={from:'2026-10-01',to:'2026-10-27'};
const now=new Date('2026-10-28T12:00:00Z');
function fake(data){
  const calls=[];
  return {calls,query:async(sql,params)=>{
    calls.push({sql,params});
    const name=Object.keys(reportSql).find(k=>reportSql[k]===sql);
    assert.ok(name,`Unknown query ${sql.slice(0,30)}`);
    const required=(sql.match(/\$(\d+)/g)??[]).map(x=>Number(x.slice(1)));
    assert.equal(params.length,Math.max(0,...required),`Wrong SQL parameter count for ${name}`);
    return {rows:data[name]??[]};
  }};
}
test('income counts store sales once and keeps refunded receipts dated separately',async()=>{
  const db=fake({income:[
    {source:'membership',method:'mobile_money',net_amount:'500.00'},
    {source:'membership',method:'cash',net_amount:'-200.00'},
    {source:'facilitation',method:'cash',net_amount:'1200.00'},
    {source:'store_sale',method:'mobile_money',net_amount:'1000.25'}
  ]});
  const result=await getReport(db,'income',period,now);
  assert.equal(result.netCollected,'2500.25');
  assert.deepEqual(result.sources.map(s=>s.netCollected),['300.00','1200.00','1000.25','0.00','0.00']);
  assert.equal(result.byMethod.find(x=>x.method==='cash').netCollected,'1000.00');
  assert.equal(result.bookedCommissionExpense,null);
  assert.equal(result.netProfit,null);
  assert.match(db.calls[0].sql,/p\.reversed_at/);
  assert.match(db.calls[0].sql,/s\.status='completed'/);
  assert.match(db.calls[0].sql,/payment_allocations/);
  assert.match(db.calls[0].sql,/f\.status='paid'/);
  assert.doesNotMatch(db.calls[0].sql,/equipment_incidents/);
});
test('membership cohort collected totals are lifetime and distinct from period receipts',async()=>{
  const db=fake({membership:[{category:'group',registrations:2,active_now:1,billed:'1000.00',collected_lifetime:'500.00'}],ageBands:[{age_band:'12-17',registrations:1},{age_band:'18-25',registrations:1}]});
  const r=await getReport(db,'memberships',period,now);
  assert.equal(r.categories[0].balanceNow,'500.00');
  assert.equal(r.categories[0].activeNow,1);
  assert.equal(r.ageBands[0].age_band,'12-17');
  assert.match(r.note,/as of now/);
  assert.match(db.calls[0].sql,/p\.status='verified'/);
});
test('sale revenue query requires completed and verified tender and discounts tracked',async()=>{
  const db=fake({sales:[{completed_sales:2,subtotal:'12000.00',discount:'600.00',total:'11400.00'}],saleProducts:[{sku:'STICK',name:'Hockey stick',units:6,gross_sales:'12000.00'}]});
  const r=await getReport(db,'sales',period,now);
  assert.equal(r.summary.discount,'600.00');
  assert.equal(r.products[0].gross_sales,'12000.00');
  assert.match(reportSql.sales,/t\.status='verified'/);
  assert.match(reportSql.saleProducts,/s\.status='completed'/);
});
test('inventory shows exact 20 percent reorder threshold and cannot confuse loans with sale stock',async()=>{
  const db=fake({inventory:[{sku:'SOCKS',available_qty:20,max_stock_level:100,low_stock:true,received_in_period:50,sold_in_period:30}]});
  const r=await getReport(db,'inventory',period,now);
  assert.equal(r.items[0].low_stock,true);
  assert.match(reportSql.inventory,/available_qty \* 5 <= i\.max_stock_level/);
  assert.doesNotMatch(reportSql.inventory,/equipment_balances/);
});
test('event commission is labelled provisional, equipment assessments not received revenue',async()=>{
  const db=fake({events:[{id:'1',assessed_fees:'1000.00',collected_lifetime:'500.00',commission_on_assessed:'200.00',commission_on_collected:'100.00'}],equipmentBalances:[],equipmentLoans:[{issued_in_period:2,overdue_now:1,outstanding_now:1}],equipmentIncidents:[{reported_in_period:2,confirmed_in_period:1,assessed_surcharge_in_period:'1100.00'}]});
  const events=await getReport(db,'events',period,now);
  assert.match(events.note,/estimates only/);
  assert.equal(events.events[0].commission_on_collected,'100.00');
  const equipment=await getReport(db,'equipment',period,now);
  assert.match(equipment.note,/NOT collected revenue/);
  assert.equal(equipment.incidents.assessed_surcharge_in_period,'1100.00');
});
test('output size capped and truncation identified for large reports',async()=>{
  const db=fake({events:Array.from({length:101},(_,i)=>({id:String(i)})),inventory:Array.from({length:201},(_,i)=>({sku:String(i)}))});
  const e=await getReport(db,'events',period,now);
  const i=await getReport(db,'inventory',period,now);
  assert.equal(e.events.length,100);assert.equal(e.truncated,true);
  assert.equal(i.items.length,200);assert.equal(i.truncated,true);
});

test('sports summary is a current snapshot without member private profiles',async()=>{
  const db=fake({sports:[{sport:'Hockey',active:true,current_patron:'Demo Patron',interested_members:7,active_teams:1,active_captains:1}]});
  const r=await getReport(db,'sports',period,now);
  assert.equal(r.asOf,'current');
  assert.equal(r.sports[0].sport,'Hockey');
  assert.doesNotMatch(reportSql.sports,/member_contacts|special_needs_notes/);
});

// Regression: CI against PostgreSQL caught passing 4 values to a query using
// only $1 and $2. Mock-only tests had incorrectly accepted this for months.
test('report parameter binding matches PostgreSQL SQL placeholders',()=>{
  const full=['2026-09-30T21:00:00.000Z','2026-10-01T21:00:00.000Z','2026-10-01','2026-10-01'];
  for(const [name,sql] of Object.entries(reportSql)) {
    const actual=reportParameters(name,full);
    const max=Math.max(0,...Array.from(sql.matchAll(/\$(\d+)/g),m=>Number(m[1])));
    assert.equal(actual.length,max,`SQL bindings for ${name} do not match placeholders`);
    assert.deepEqual(actual, ['ageBands','membership','events'].includes(name)?full.slice(2):
      ['sports','equipmentBalances'].includes(name)?[]:full.slice(0,2));
  }
});

test('paid refunds reduce net recorded cashflow; pending refunds are not in cash CTE',async()=>{
 const db=fake({income:[{source:'store_sale',method:'cash',net_amount:'2500.00'},
   {source:'store_refund',method:'mobile_money',net_amount:'-800.00'}]});
 const result=await getReport(db,'income',period,now);
 assert.equal(result.netCollected,'1700.00');
 assert.equal(result.sources.find(s=>s.source==='store_refund').netCollected,'-800.00');
 assert.equal(result.byMethod.find(s=>s.method==='mobile_money').netCollected,'-800.00');
 assert.match(db.calls[0].sql,/f\.reviewed_at >= \$1::timestamptz/);
 assert.match(db.calls[0].sql,/f\.status='paid'/);
});
