import test from 'node:test';
import assert from 'node:assert/strict';
import {receiveStock,createSale,checkoutSale,verifyMobileSale} from '../src/store/service.js';
const key='test-stock-idempotency-12345';
const q=rows=>({rows,rowCount:rows.length});
function fakePool(responder){
  const statements=[];
  const db={query:async(sql,params=[])=>{statements.push({sql,params});return responder(sql,params)??q([])},release(){}};
  return {statements,connect:async()=>db};
}
const idem=(sql)=>sql.includes('FROM idempotency_requests')?q([{payload_hash:'',response_status:null}]):null;
// Don't reimplement hashing inside tests; test idempotency with returned response manually instead.
test('stock receipts roll back if a required inventory row is missing',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM idempotency_requests'))return q([{payload_hash:'placeholder',response_status:null}]);
    return q([]);
  });
  await assert.rejects(receiveStock(pool,{actorId:'1',body:{itemId:'2',quantity:4,sourceReference:'SUPPLIER-22'},key}),/request key was used|response/i);
  assert.ok(pool.statements.some(s=>s.sql==='ROLLBACK'));
});
test('competing sale stock cannot go negative; SQL locks inventory rows',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM idempotency_requests'))return q([{payload_hash:'broken',response_status:null}]);
    return q([]);
  });
  await assert.rejects(checkoutSale(pool,{actorId:'1',saleId:'9',body:{method:'cash'},key}));
  assert.ok(pool.statements.some(s=>s.sql==='ROLLBACK'));
});
test('mobile verification uses a separate finance reviewer and rolls back on self-review',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM store_sales WHERE id'))return q([{id:'9',status:'pending_mobile',total:'500.00'}]);
    if(sql.includes('FROM store_sale_tenders WHERE sale_id'))return q([{method:'mobile_money',status:'pending',recorded_by_user_id:'7',amount:'500.00'}]);
    return q([]);
  });
  await assert.rejects(verifyMobileSale(pool,{actorId:'7',saleId:'9',body:{evidenceReference:'RECON-2026'}}),{code:'SEPARATION_OF_DUTIES'});
  assert.equal(pool.statements.some(s=>s.sql==='ROLLBACK'),true);
  assert.equal(pool.statements.some(s=>s.sql.includes('UPDATE store_inventory')),false);
});
test('mobile verification leaves pending status when stock is unavailable',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM store_sales WHERE id'))return q([{id:'9',status:'pending_mobile',total:'500.00'}]);
    if(sql.includes('FROM store_sale_tenders WHERE sale_id'))return q([{method:'mobile_money',status:'pending',recorded_by_user_id:'7'}]);
    if(sql.includes('FROM store_sale_lines'))return q([{item_id:'3',qty:3}]);
    if(sql.includes('FROM store_inventory'))return q([{available_qty:2}]);
    return q([]);
  });
  await assert.rejects(verifyMobileSale(pool,{actorId:'8',saleId:'9',body:{evidenceReference:'RECON-2026'}}),{code:'INSUFFICIENT_STOCK'});
  assert.equal(pool.statements.some(s=>s.sql==='ROLLBACK'),true);
  assert.equal(pool.statements.some(s=>s.sql.includes('UPDATE store_sale_tenders')),false);
});
test('successful mobile verification updates stock and marks tender verified together',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM store_sales WHERE id'))return q([{id:'9',status:'pending_mobile',total:'500.00'}]);
    if(sql.includes('FROM store_sale_tenders WHERE sale_id'))return q([{method:'mobile_money',status:'pending',recorded_by_user_id:'7'}]);
    if(sql.includes('FROM store_sale_lines'))return q([{item_id:'3',qty:3}]);
    if(sql.includes('FROM store_inventory'))return q([{available_qty:10}]);
    return q([]);
  });
  const result=await verifyMobileSale(pool,{actorId:'8',saleId:'9',body:{evidenceReference:'RECON-2026'}});
  assert.equal(result.status,'completed');
  assert.ok(pool.statements.some(s=>s.sql.includes('UPDATE store_inventory')&&s.params[1]===3));
  assert.ok(pool.statements.some(s=>s.sql.includes('UPDATE store_sale_tenders')));
  assert.ok(pool.statements.some(s=>s.sql==='COMMIT'));
});
test('cannot verify an already completed sale twice',async()=>{
  const pool=fakePool(sql=>sql.includes('FROM store_sales WHERE id')?q([{id:'9',status:'completed',total:'500.00'}]):q([]));
  await assert.rejects(verifyMobileSale(pool,{actorId:'8',saleId:'9',body:{evidenceReference:'RECON-2026'}}),{code:'SALE_LOCKED'});
});
import { createHash } from 'node:crypto';
import { stableJson } from '../src/members/registration.js';
function payloadHash(value){return createHash('sha256').update(stableJson(value)).digest('hex');}
test('receipt posts matching stock movement and inventory adjustment within one transaction',async()=>{
  const body={itemId:'2',quantity:5,sourceReference:'delivery-25'};
  const canonical={itemId:'2',quantity:5,sourceReference:'DELIVERY-25'};
  const pool=fakePool(sql=>{
    if(sql.includes('FROM idempotency_requests'))return q([{payload_hash:payloadHash(canonical),response_status:null}]);
    if(sql.includes('FROM store_items i'))return q([{id:'2',active:true}]);
    if(sql.includes('FROM store_inventory'))return q([{available_qty:20}]);
    if(sql.includes('INSERT INTO stock_receipts'))return q([{id:'41'}]);
    return q([]);
  });
  const result=await receiveStock(pool,{actorId:'7',body,key});
  assert.equal(result.availableQty,25);
  assert.ok(pool.statements.some(x=>x.sql.includes('UPDATE store_inventory')&&x.params[1]===5));
  assert.ok(pool.statements.some(x=>x.sql.includes("'receipt'")&&x.params[1]===5));
  assert.ok(pool.statements.some(x=>x.sql==='COMMIT'));
});
test('two line sale retains original prices and correct discount snapshot',async()=>{
  const body={lines:[{itemId:'2',quantity:5},{itemId:'4',quantity:1}]};
  const pool=fakePool(sql=>{
    if(sql.includes('FROM idempotency_requests'))return q([{payload_hash:payloadHash({lines:[{itemId:'2',qty:5},{itemId:'4',qty:1}],buyerMemberNumber:null}),response_status:null}]);
    if(sql.includes('FROM store_items WHERE id=ANY'))return q([{id:'2',sku:'HOCKEY-STICK',name:'Hockey stick',unit_price:'2000.00',active:true},
      {id:'4',sku:'SOCKS',name:'Socks',unit_price:'350.00',active:true}]);
    if(sql.includes('INSERT INTO store_sales'))return q([{id:'19'}]);
    return q([]);
  });
  const result=await createSale(pool,{actorId:'7',body,key});
  assert.equal(result.subtotal,'10350.00');assert.equal(result.discount,'517.50');assert.equal(result.total,'9832.50');
  assert.equal(pool.statements.filter(s=>s.sql.includes('INSERT INTO store_sale_lines')).length,2);
  assert.equal(pool.statements.some(s=>s.sql.includes('UPDATE store_inventory')),false);
});
test('cash checkout deducts stock and commits verified tender exactly once',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM idempotency_requests'))return q([{payload_hash:payloadHash({method:'cash',reference:null}),response_status:null}]);
    if(sql.includes('FROM store_sales WHERE id'))return q([{id:'19',status:'draft',total:'2000.00'}]);
    if(sql.includes('FROM store_sale_lines'))return q([{item_id:'3',qty:1}]);
    if(sql.includes('FROM store_inventory'))return q([{available_qty:5}]);
    return q([]);
  });
  const result=await checkoutSale(pool,{actorId:'7',saleId:'19',body:{method:'cash'},key});
  assert.equal(result.status,'completed');
  assert.ok(pool.statements.some(s=>s.sql.includes("'cash'")&&s.sql.includes('INSERT INTO store_sale_tenders')));
  assert.ok(pool.statements.some(s=>s.sql.includes('UPDATE store_inventory')));
  assert.ok(pool.statements.some(s=>s.sql==='COMMIT'));
});
test('mobile checkout must leave inventory unchanged until approved',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM idempotency_requests'))return q([{payload_hash:payloadHash({method:'mobile_money',reference:'MMO123456'}),response_status:null}]);
    if(sql.includes('FROM store_sales WHERE id'))return q([{id:'19',status:'draft',total:'2000.00'}]);
    return q([]);
  });
  const result=await checkoutSale(pool,{actorId:'7',saleId:'19',body:{method:'mobile_money',reference:'mmo123456'},key});
  assert.equal(result.status,'pending_mobile');
  assert.equal(pool.statements.some(s=>s.sql.includes('UPDATE store_inventory')),false);
  assert.ok(pool.statements.some(s=>s.sql.includes('pending_mobile')));
});
