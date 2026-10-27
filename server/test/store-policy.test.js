import test from 'node:test';
import assert from 'node:assert/strict';
import {validateItem,validateReceipt,validateSale,calculateSale,lowStock,validateTender,validateVerificationEvidence} from '../src/store/policy.js';

test('store discount applies only strictly above KSh 10,000',()=>{
  assert.deepEqual(calculateSale([{unitPrice:'2000.00',qty:5}]),{subtotal:'10000.00',discount:'0.00',total:'10000.00'});
  assert.deepEqual(calculateSale([{unitPrice:'2000.00',qty:5},{unitPrice:'1.00',qty:1}]),{subtotal:'10001.00',discount:'500.05',total:'9500.95'});
  assert.deepEqual(calculateSale([{unitPrice:'250.00',qty:42}]),{subtotal:'10500.00',discount:'525.00',total:'9975.00'});
});
test('rounds percentage half up in integer cents',()=>{
  assert.deepEqual(calculateSale([{unitPrice:'10000.10',qty:1}]),{subtotal:'10000.10',discount:'500.01',total:'9500.09'});
});
test('stock exactly at 20% triggers alert',()=>{
  assert.equal(lowStock(20,100),true);assert.equal(lowStock(21,100),false);
  assert.equal(lowStock(1,6),true);assert.equal(lowStock(2,6),false);
});
test('enforces variant and given price range for sports shoes',()=>{
  assert.throws(()=>validateItem({sku:'SHOE',name:'Sports shoes',unitPrice:'999.00',variant:'Size 42',maxStockLevel:100}),{code:'INVALID_SHOE_VARIANT'});
  assert.throws(()=>validateItem({sku:'SHOE',name:'Sports shoes',unitPrice:'4500.00',variant:'Size 42',maxStockLevel:100}),{code:'INVALID_SHOE_VARIANT'});
  assert.throws(()=>validateItem({sku:'SHOE',name:'Sports shoes',unitPrice:'2000.00',maxStockLevel:100}),{code:'INVALID_SHOE_VARIANT'});
  assert.equal(validateItem({sku:'shoe-42',name:'Sports shoes',unitPrice:'2000.00',variant:'Size 42',maxStockLevel:100}).sku,'SHOE-42');
});
test('requires safe distinct sale lines and integer quantities',()=>{
  assert.throws(()=>validateSale({lines:[{itemId:'1',quantity:2},{itemId:'1',quantity:2}]}),{code:'DUPLICATE_ITEM'});
  assert.throws(()=>validateSale({lines:[{itemId:'1',quantity:-2}]}),{code:'INVALID_QUANTITY'});
  assert.throws(()=>validateSale({lines:[]}),{code:'INVALID_SALE'});
  assert.deepEqual(validateSale({lines:[{itemId:'9',quantity:2}]}),[{itemId:'9',qty:2}]);
});
test('validates receipts, rejects fractional stock',()=>{
  assert.equal(validateReceipt({itemId:'5',quantity:10,sourceReference:'REC-2026'}).quantity,10);
  assert.throws(()=>validateReceipt({itemId:'5',quantity:1.5,sourceReference:'REC-2026'}),{code:'INVALID_QUANTITY'});
});
test('requires evidence before mobile verification, rejects cash references',()=>{
  assert.equal(validateTender({method:'mobile_money',reference:'mmo123456'}).reference,'MMO123456');
  assert.throws(()=>validateTender({method:'cash',reference:'FRAUD11'}),{code:'INVALID_REFERENCE'});
  assert.throws(()=>validateVerificationEvidence(''),{code:'EVIDENCE_REQUIRED'});
});
