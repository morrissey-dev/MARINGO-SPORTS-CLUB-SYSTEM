import test from 'node:test';
import assert from 'node:assert/strict';
import {issueLoan,returnLoan,approveIncident,requestLoan,receiveEquipment,loanDetails} from '../src/equipment/service.js';
import {stableJson,idempotencyKey} from '../src/members/registration.js';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const q=rows=>({rows:rows||[],rowCount:rows?.length||0});
function fakePool(handler){
  const statements=[];
  const db={release(){},async query(sql,params=[]){statements.push({sql,params});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return q([]);
    return handler(sql,params,statements);}};
  return {statements,connect:async()=>db,query:db.query};
}
const loan={id:'9',team_id:'3',event_id:null,status:'requested',team_status:'active',sport_active:true,current_captain_id:'6',captain_member_id:'6',captain_name:'Captain Test',team_name:'Hockey A',current_patron_user_id:'7'};
const line={id:'55',loan_id:'9',equipment_type_id:'2',issued_qty:4,market_value:'2000.00',market_value_snapshot:'2000.00',name:'Hockey stick',code:'HOCKEY',active:true,accounted_qty:0};

test('issuing a loan atomically transfers usable to issued and snapshots value',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM equipment_loans l JOIN teams t'))return q([loan]);
    if(sql.includes('FROM team_members tm JOIN members'))return q([{found:true}]);
    if(sql.includes('FROM equipment_loan_lines l JOIN equipment_types'))return q([line]);
    if(sql.includes('FROM equipment_balances'))return q([{available_qty:10}]);
    return q([]);
  });
  const result=await issueLoan(pool,{actorId:'4',loanId:'9'});
  assert.equal(result.status,'issued');
  assert.ok(pool.statements.some(x=>x.sql.includes('UPDATE equipment_balances SET available_qty=available_qty-$2')&&x.params[1]===4));
  assert.ok(pool.statements.some(x=>x.sql.includes('market_value_snapshot')));
  assert.ok(pool.statements.some(x=>x.sql==='COMMIT'));
});
test('equipment issue rolls back if stock is unavailable, without posting movement',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM equipment_loans l JOIN teams t'))return q([loan]);
    if(sql.includes('FROM team_members tm JOIN members'))return q([{found:true}]);
    if(sql.includes('FROM equipment_loan_lines l JOIN equipment_types'))return q([line]);
    if(sql.includes('FROM equipment_balances'))return q([{available_qty:3}]);
    return q([]);
  });
  await assert.rejects(issueLoan(pool,{actorId:'4',loanId:'9'}),{code:'INSUFFICIENT_EQUIPMENT'});
  assert.ok(pool.statements.some(x=>x.sql==='ROLLBACK'));
  assert.equal(pool.statements.some(x=>x.sql.includes('INSERT INTO equipment_movements')),false);
});
test('equipment request snapshots current captain, but does not remove any stock',async()=>{
  const body={teamId:'3',dueDate:'2026-12-15',purpose:'Training session',lines:[{equipmentTypeId:'2',quantity:2}]};
  const normalized={teamId:'3',eventId:null,dueDate:'2026-12-15',purpose:'Training session',lines:[{equipmentTypeId:'2',quantity:2}]};
  const pool=fakePool(sql=>{
    if(sql.includes('FROM idempotency_requests'))return q([{response_status:null,payload_hash:sha(stableJson(normalized))}]);
    if(sql.includes('FROM teams t JOIN sports s'))return q([{id:'3',status:'active',is_active:true,patron_user_id:'7',captain_member_id:'6'}]);
    if(sql.includes('FROM team_members tm JOIN members'))return q([{}]);
    if(sql.includes('FROM equipment_types WHERE id=ANY'))return q([{id:'2',active:true}]);
    if(sql.includes('INSERT INTO equipment_loans'))return q([{id:'9'}]);
    return q([]);
  });
  const r=await requestLoan(pool,{actorId:'7',roles:['PAT'],body,key:'req-test-key-00001'});
  assert.equal(r.captainMemberId,'6');
  assert.equal(pool.statements.some(x=>x.sql.includes('UPDATE equipment_balances')),false);
  assert.ok(pool.statements.some(x=>x.sql==='COMMIT'));
});
test('returning usable/damaged/missing units updates correct buckets and opens TWO incidents',async()=>{
  const body={lines:[{loanLineId:'55',usableQty:1,damagedQty:1,missingQty:1}],notes:'One broken, one unaccounted for'};
  const pool=fakePool(sql=>{
    if(sql.includes('FROM idempotency_requests'))return q([{response_status:null,payload_hash:sha(stableJson({lines:body.lines,notes:body.notes}))}]);
    if(sql.includes('FROM equipment_loans l JOIN teams t'))return q([{...loan,status:'issued'}]);
    if(sql.includes('FROM equipment_loan_lines l JOIN equipment_types'))return q([line]);
    if(sql.includes('FROM equipment_balances'))return q([{issued_qty:4}]);
    if(sql.includes('INSERT INTO equipment_returns'))return q([{id:'12'}]);
    if(sql.includes('INSERT INTO equipment_return_lines'))return q([{id:'14'}]);
    if(sql.includes('INSERT INTO equipment_incidents'))return q([{id:'19'}]);
    return q([]);
  });
  const result=await returnLoan(pool,{actorId:'4',loanId:'9',body,key:'return-test-key-00001'});
  assert.equal(result.status,'partially_returned');
  assert.equal(result.remainingQty,1);
  assert.equal(result.incidents.length,2);
  assert.equal(pool.statements.filter(x=>x.sql.includes('INSERT INTO equipment_incidents')).length,2);
  assert.deepEqual(pool.statements.find(x=>x.sql.includes('UPDATE equipment_balances SET available_qty=available_qty+$2')).params.slice(1),[1,1,1,3]);
});
test('return rejects more items than outstanding and rolls back',async()=>{
  const body={lines:[{loanLineId:'55',usableQty:2,damagedQty:0,missingQty:0}]};
  const pool=fakePool(sql=>{
    if(sql.includes('FROM idempotency_requests'))return q([{response_status:null,payload_hash:sha(stableJson({lines:body.lines,notes:null}))}]);
    if(sql.includes('FROM equipment_loans l JOIN teams t'))return q([{...loan,status:'partially_returned'}]);
    if(sql.includes('FROM equipment_loan_lines l JOIN equipment_types'))return q([{...line,accounted_qty:3}]);
    return q([]);
  });
  await assert.rejects(returnLoan(pool,{actorId:'4',loanId:'9',body,key:'return-test-key-00002'}),{code:'OVER_RETURN'});
  assert.ok(pool.statements.some(x=>x.sql==='ROLLBACK'));
});
test('incident confirmation creates a valuation but never assigns member liability or creates charges',async()=>{
  const pool=fakePool(sql=>sql.includes('FROM equipment_incidents ei JOIN equipment_return_lines')?q([{id:'15',status:'reported',quantity:2,incident_type:'missing',inspected_by_user_id:'4'}]):q([]));
  const value=await approveIncident(pool,{actorId:'2',incidentId:'15',body:{approvedMarketValue:'1250.00',evidenceReference:'VALUATION-2026-1'}});
  assert.equal(value.surchargeTotal,'2750.00');
  assert.equal(value.liabilityAssigned,false);
  assert.equal(pool.statements.some(x=>x.sql.includes('INSERT INTO charges')),false);
  assert.ok(pool.statements.some(x=>x.sql==='COMMIT'));
});
test('cannot approve a recorded incident twice',async()=>{
  const pool=fakePool(sql=>sql.includes('FROM equipment_incidents ei JOIN equipment_return_lines')?q([{id:'15',status:'confirmed',quantity:2,incident_type:'missing',inspected_by_user_id:'4'}]):q([]));
  await assert.rejects(approveIncident(pool,{actorId:'2',incidentId:'15',body:{approvedMarketValue:'1250.00',evidenceReference:'VALUATION-2026-1'}}),{code:'INCIDENT_LOCKED'});
});
test('patron cannot read a different team equipment loan',async()=>{
  const pool=fakePool(sql=>sql.includes('FROM equipment_loans l JOIN teams t')?q([loan]):q([]));
  await assert.rejects(loanDetails(pool,{actorId:'8',roles:['PAT'],loanId:'9'}),{code:'FORBIDDEN'});
});

test('incident reviewer must differ from inspecting clerk',async()=>{
  const pool=fakePool(sql=>sql.includes('FROM equipment_incidents ei JOIN equipment_return_lines')?q([{id:'15',status:'reported',quantity:1,incident_type:'damaged',inspected_by_user_id:'4'}]):q([]));
  await assert.rejects(approveIncident(pool,{actorId:'4',incidentId:'15',body:{approvedMarketValue:'2000.00',evidenceReference:'VALUATION-2026-2'}}),{code:'SEPARATION_OF_DUTIES'});
  assert.ok(pool.statements.some(x=>x.sql==='ROLLBACK'));
});
