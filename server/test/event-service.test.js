import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent,enrollParticipant,finalizeEvent,eventSummary } from '../src/events/service.js';

function fakePool(handler){
  const statements=[];
  const db={release(){},async query(sql,params=[]){
    statements.push({sql,params});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[],rowCount:0};
    return handler(sql,params,statements);
  }};
  return {statements,connect:async()=>db,query:db.query};
}
const q=(rows=[])=>({rows,rowCount:rows.length});
test('external finalization creates exactly one KSh 500 charge per participating player',async()=>{
  let finalized=false,charges=0,projections=0;
  const pool=fakePool((sql,params)=>{
    if(sql.includes('FROM sporting_events e JOIN sport_patron_assignments spa'))
      return q([{id:'2',team_id:'3',sport_id:'1',event_type:'external',status:finalized?'finalized':'draft',current_patron_user_id:'9',original_patron_user_id:'9'}]);
    if(sql.includes('FROM event_participants ep JOIN members m'))return q([
      {id:'40',member_id:'6',status:'active',active_membership:true,current_team_member:true},
      {id:'41',member_id:'7',status:'active',active_membership:true,current_team_member:true}
    ]);
    if(sql.includes('INSERT INTO charges')){charges++;return q([{id:String(100+charges)}]);}
    if(sql.includes('INSERT INTO patron_commission_projections'))projections++;
    if(sql.includes("UPDATE sporting_events SET status='finalized'"))finalized=true;
    return q();
  });
  const params={actorId:'9',roles:['PAT'],eventId:'2'};
  const first=await finalizeEvent(pool,params);
  assert.equal(first.chargesCreated,2);assert.equal(first.assessedAmount,'1000.00');
  assert.equal(charges,2);assert.equal(projections,1);
  const retried=await finalizeEvent(pool,params);
  assert.equal(retried.unchanged,true);assert.equal(charges,2);assert.equal(projections,1);
  assert.equal(pool.statements.filter(x=>x.sql.includes('COMMIT')).length,2);
});
test('internal event finalizes without facilitation charges or patron commission',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM sporting_events e JOIN sport_patron_assignments spa'))
      return q([{id:'2',team_id:'3',sport_id:'1',event_type:'internal',status:'draft',current_patron_user_id:'9'}]);
    if(sql.includes('FROM event_participants ep JOIN members m'))return q([
      {id:'40',member_id:'6',status:'active',active_membership:true,current_team_member:true}]);
    return q();
  });
  const value=await finalizeEvent(pool,{actorId:'9',roles:['PAT'],eventId:'2'});
  assert.equal(value.assessedAmount,'0.00');assert.equal(value.chargesCreated,0);
  assert.equal(pool.statements.some(x=>x.sql.includes('INSERT INTO charges')),false);
  assert.equal(pool.statements.some(x=>x.sql.includes('INSERT INTO patron_commission_projections')),false);
});
test('finalization rolls back if an enrolled player is no longer active',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM sporting_events e JOIN sport_patron_assignments spa'))
      return q([{id:'2',team_id:'3',sport_id:'1',event_type:'external',status:'draft',current_patron_user_id:'9'}]);
    if(sql.includes('FROM event_participants ep JOIN members m'))return q([{id:'40',member_id:'6',status:'inactive',active_membership:false,current_team_member:true}]);
    return q();
  });
  await assert.rejects(finalizeEvent(pool,{actorId:'9',roles:['PAT'],eventId:'2'}),{code:'ROSTER_CHANGED'});
  assert.equal(pool.statements.some(x=>x.sql==='ROLLBACK'),true);
  assert.equal(pool.statements.some(x=>x.sql.includes('INSERT INTO charges')),false);
});
test('enrollment rejects players not active on the assigned team',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM sporting_events e JOIN teams t'))return q([{id:'2',team_id:'3',status:'draft',sport_active:true,team_status:'active',current_patron_user_id:'9'}]);
    return q();
  });
  await assert.rejects(enrollParticipant(pool,{actorId:'9',roles:['PAT'],eventId:'2',memberId:'6'}),{code:'PARTICIPANT_NOT_ELIGIBLE'});
  assert.equal(pool.statements.some(x=>x.sql==='ROLLBACK'),true);
});
test('event creation uses current patron snapshot in the event record',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM teams t JOIN sports s'))return q([{id:'3',name:'Hockey first team',sport_id:'5',status:'active',is_active:true,patron_assignment_id:'8',patron_user_id:'9'}]);
    if(sql.includes('INSERT INTO sporting_events'))return q([{id:'11'}]);
    return q();
  });
  const e=await createEvent(pool,{actorId:'9',roles:['PAT'],body:{teamId:'3',eventType:'external',eventDate:'2026-11-20',venue:'Maringo field',opponent:'County Lions'}});
  assert.equal(e.id,'11');
  const inserted=pool.statements.find(x=>x.sql.includes('INSERT INTO sporting_events'));
  assert.deepEqual(inserted.params.slice(0,4),['5','3','8','9']);
});
test('event summary shows verified partial fee and both unpaid commission illustrations',async()=>{
  const pool=fakePool(sql=>{
    if(sql.includes('FROM sporting_events e JOIN teams t'))return q([{id:'11',team_id:'3',event_type:'external',status:'finalized',event_date:'2026-11-20',venue:'Field',opponent:'County Lions',team_name:'Hockey 1',sport_name:'Hockey',original_patron_user_id:'9',current_patron_user_id:'9',rate_percent:'20.00',policy_basis:'undecided'}]);
    if(sql.includes('FROM event_participants ep JOIN members m'))return q([{id:'80',member_id:'7',membership_number:'MSC-07',full_name:'Sample Player',charge_id:'50',amount:'500.00',collected:'200.00',charge_status:'outstanding'}]);
    return q();
  });
  const summary=await eventSummary(pool,{actorId:'9',roles:['PAT'],eventId:'11'});
  assert.equal(summary.assessed,'500.00');assert.equal(summary.verified,'200.00');assert.equal(summary.outstanding,'300.00');
  assert.equal(summary.commission.illustrationOnBilled,'100.00');assert.equal(summary.commission.illustrationOnCollected,'40.00');
  assert.equal(summary.commission.payable,false);
});
