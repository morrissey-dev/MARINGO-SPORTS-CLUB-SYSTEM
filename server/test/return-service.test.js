import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoreReturn,reviewStoreReturn} from '../src/store/returns-service.js';
const q=rows=>({rows,rowCount:rows.length});
function fakePool(responder){const logs=[];const db={query:async(sql,params=[])=>{logs.push({sql,params});return responder(sql,params)??q([])},release(){}};return {logs,connect:async()=>db};}
test('non-completed sales cannot be returned; transaction rolls back',async()=>{
 const pool=fakePool(sql=>sql.includes('FROM store_sales WHERE id')?q([{id:'10',status:'draft'}]):q([]));
 await assert.rejects(createStoreReturn(pool,{actorId:'3',saleId:'10',key:'return_request_test_123',body:{reason:'Customer brought item back',lines:[{saleLineId:'20',quantity:1}]}}),{code:'SALE_NOT_COMPLETED'});
 assert.ok(pool.logs.some(x=>x.sql==='ROLLBACK'));
});
test('cannot request more units than completed sale still allows',async()=>{
 const pool=fakePool(sql=>{
   if(sql.includes('FROM store_sales WHERE id'))return q([{id:'10',status:'completed'}]);
   if(sql.includes('FROM store_sale_lines WHERE sale_id'))return q([{id:'20',qty:2}]);
   if(sql.includes('FROM store_return_lines l JOIN store_returns'))return q([{sale_line_id:'20',quantity:1}]);
   return q([]);
 });
 await assert.rejects(createStoreReturn(pool,{actorId:'3',saleId:'10',key:'return_request_test_123',body:{reason:'Item was not needed',lines:[{saleLineId:'20',quantity:2}]}}),{code:'RETURN_EXCEEDS_SOLD'});
});
test('return reviewer cannot approve their own submission',async()=>{
 const pool=fakePool(sql=>{
   if(sql.includes('SELECT sale_id FROM store_returns'))return q([{sale_id:'10'}]);
   if(sql.includes('FROM store_sales WHERE id'))return q([{id:'10',status:'completed',subtotal:'100.00',total:'100.00'}]);
   if(sql.includes('SELECT * FROM store_returns'))return q([{id:'4',status:'pending_review',received_by_user_id:'3'}]);
   return q([]);
 });
 await assert.rejects(reviewStoreReturn(pool,{actorId:'3',returnId:'4',body:{decision:'reject'}}),{code:'SEPARATION_OF_DUTIES'});
 assert.equal(pool.logs.some(x=>x.sql.includes('UPDATE store_inventory')),false);
});
test('rejected return never restocks goods or books a refund',async()=>{
 const pool=fakePool(sql=>{
   if(sql.includes('SELECT sale_id FROM store_returns'))return q([{sale_id:'10'}]);
   if(sql.includes('FROM store_sales WHERE id'))return q([{id:'10',status:'completed',subtotal:'100.00',total:'100.00'}]);
   if(sql.includes('SELECT * FROM store_returns'))return q([{id:'4',status:'pending_review',received_by_user_id:'3'}]);
   if(sql.includes('FROM store_return_lines l JOIN store_sale_lines'))return q([{sale_line_id:'20',quantity:1,item_id:'1',sold_qty:1,unit_price_snapshot:'100.00'}]);
   return q([]);
 });
 const result=await reviewStoreReturn(pool,{actorId:'5',returnId:'4',body:{decision:'reject'}});
 assert.equal(result.status,'rejected');
 assert.equal(pool.logs.some(x=>x.sql.includes('UPDATE store_inventory')),false);
 assert.equal(pool.logs.some(x=>x.sql==='COMMIT'),true);
});
test('accepting resellable return restores inventory but never writes money movements',async()=>{
 const pool=fakePool(sql=>{
   if(sql.includes('SELECT sale_id FROM store_returns'))return q([{sale_id:'10'}]);
   if(sql.includes('FROM store_sales WHERE id'))return q([{id:'10',status:'completed',subtotal:'100.00',total:'100.00'}]);
   if(sql.includes('SELECT * FROM store_returns'))return q([{id:'4',status:'pending_review',received_by_user_id:'3'}]);
   if(sql.includes('FROM store_return_lines l JOIN store_sale_lines'))return q([{sale_line_id:'20',quantity:1,item_id:'1',sold_qty:1,unit_price_snapshot:'100.00'}]);
   if(sql.includes('FROM store_sale_lines WHERE sale_id'))return q([{id:'20',qty:1,unit_price_snapshot:'100.00'}]);
   if(sql.includes('AS due FROM store_returns'))return q([{due:'0.00'}]);
   return q([]);
 });
 const result=await reviewStoreReturn(pool,{actorId:'5',returnId:'4',body:{decision:'accept',conditions:[{saleLineId:'20',condition:'resellable'}]}});
 assert.equal(result.refundDue,'100.00');
 assert.equal(result.refundStatus,'awaiting_separate_payment_processing');
 assert.ok(pool.logs.some(x=>x.sql.includes('UPDATE store_inventory')));
 assert.equal(pool.logs.some(x=>x.sql.includes('INSERT INTO payments')),false);
 assert.equal(pool.logs.some(x=>x.sql.includes('INSERT INTO store_sale_tenders')),false);
});
test('accepting damaged return does not restock',async()=>{
 const pool=fakePool(sql=>{
   if(sql.includes('SELECT sale_id FROM store_returns'))return q([{sale_id:'10'}]);
   if(sql.includes('FROM store_sales WHERE id'))return q([{id:'10',status:'completed',subtotal:'100.00',total:'100.00'}]);
   if(sql.includes('SELECT * FROM store_returns'))return q([{id:'4',status:'pending_review',received_by_user_id:'3'}]);
   if(sql.includes('FROM store_return_lines l JOIN store_sale_lines'))return q([{sale_line_id:'20',quantity:1,item_id:'1',sold_qty:1,unit_price_snapshot:'100.00'}]);
   if(sql.includes('FROM store_sale_lines WHERE sale_id'))return q([{id:'20',qty:1,unit_price_snapshot:'100.00'}]);
   if(sql.includes('AS due FROM store_returns'))return q([{due:'0.00'}]);
   return q([]);
 });
 const result=await reviewStoreReturn(pool,{actorId:'5',returnId:'4',body:{decision:'accept',conditions:[{saleLineId:'20',condition:'damaged'}]}});
 assert.equal(result.refundDue,'100.00');
 assert.equal(pool.logs.some(x=>x.sql.includes('UPDATE store_inventory')),false);
});
