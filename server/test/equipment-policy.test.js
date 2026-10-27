import test from 'node:test';
import assert from 'node:assert/strict';
import {loanRequest,returnRequest,surcharge,newItem,canRequest,canRead} from '../src/equipment/policy.js';

test('loan sorts distinct equipment types, with a current due date and optional event',()=>{
  const input=loanRequest({teamId:'1',dueDate:'2026-12-01',purpose:'County hockey practice',eventId:'',lines:[
    {equipmentTypeId:'8',quantity:2},{equipmentTypeId:'2',quantity:1}]},'2026-10-27');
  assert.deepEqual(input.lines,[{equipmentTypeId:'2',quantity:1},{equipmentTypeId:'8',quantity:2}]);
  assert.equal(input.eventId,null);
});
test('loan rejects invalid dates, negative quantities and repeated items',()=>{
  for(const date of ['2026-02-31','2026-09-01','not-a-date','2026-13-01']){
    assert.throws(()=>loanRequest({teamId:'2',dueDate:date,purpose:'Match equipment',lines:[{equipmentTypeId:'1',quantity:2}]},'2026-10-27'),{code:'INVALID_DUE_DATE'});
  }
  assert.throws(()=>loanRequest({teamId:'2',dueDate:'2026-12-01',purpose:'Match equipment',lines:[{equipmentTypeId:'1',quantity:2},{equipmentTypeId:'1',quantity:1}]},'2026-10-27'),{code:'DUPLICATE_EQUIPMENT'});
  assert.throws(()=>loanRequest({teamId:'2',dueDate:'2026-12-01',purpose:'Match equipment',lines:[{equipmentTypeId:'1',quantity:0}]},'2026-10-27'),{code:'INVALID_QUANTITY'});
});
test('return accepts partial inspected quantities and rejects empty or negative submissions',()=>{
  assert.deepEqual(returnRequest({lines:[{loanLineId:'8',usableQty:1,damagedQty:1,missingQty:0}]}).lines[0],{loanLineId:'8',usableQty:1,damagedQty:1,missingQty:0});
  assert.throws(()=>returnRequest({lines:[{loanLineId:'8',usableQty:0,damagedQty:0,missingQty:0}]}),{code:'INVALID_QUANTITY'});
  assert.throws(()=>returnRequest({lines:[{loanLineId:'8',usableQty:-1,damagedQty:1,missingQty:0}]}),{code:'INVALID_QUANTITY'});
});
test('equipment code and market value cannot be blank or zero',()=>{
  assert.deepEqual(newItem({code:'hock-001',name:'Training hockey stick',marketValue:'2000.00'}),{code:'HOCK-001',name:'Training hockey stick',marketValue:'2000.00'});
  assert.throws(()=>newItem({code:'HOCK',name:'Hockey',marketValue:'0.00'}));
});
test('110 percent market-value surcharge uses exact currency arithmetic, without assigning a debtor',()=>{
  assert.equal(surcharge(1,'2000.00'),'2200.00');
  assert.equal(surcharge(2,'99.99'),'219.98');
  assert.equal(surcharge(3,'99.99'),'329.97');
  assert.throws(()=>surcharge(1,'0.00'),{code:'INVALID_AMOUNT'});
});
test('patron may manage only their current sport, while clerk can read loans',()=>{
  assert.equal(canRequest(['PAT'],'10','10'),true);
  assert.equal(canRequest(['PAT'],'10','11'),false);
  assert.equal(canRead(['STO'],'20',null),true);
  assert.equal(canRead(['REG'],'10','10'),false);
});
