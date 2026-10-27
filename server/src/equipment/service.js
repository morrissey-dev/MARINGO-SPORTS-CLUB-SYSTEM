import {createHash} from 'node:crypto';
import {InputError} from '../members/validation.js';
import {stableJson,idempotencyKey} from '../members/registration.js';
import {centsToMoney,moneyToCents} from '../payments/policy.js';
import {id,count,text,newItem,receipt,loanRequest,returnRequest,surcharge,canRequest,canRead} from './policy.js';
const fail=(code,msg)=>new InputError(code,msg);
const sha=s=>createHash('sha256').update(s).digest('hex');
const sqlTransaction=async(pool,fn)=>{const db=await pool.connect();try{await db.query('BEGIN');const value=await fn(db);await db.query('COMMIT');return value;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}};
async function audit(db,user,action,type,recordId,details={}){
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata_summary) VALUES($1,$2,$3,$4,$5)`,[user,action,type,String(recordId),JSON.stringify(details)]);
}
async function once(db,{actorId,operation,key,body},fn){
  const keyHash=idempotencyKey(key),payloadHash=sha(stableJson(body));
  await db.query(`INSERT INTO idempotency_requests(actor_user_id,operation,key_hash,payload_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[actorId,operation,keyHash,payloadHash]);
  const prior=await db.query(`SELECT response_status,response_json,payload_hash FROM idempotency_requests WHERE actor_user_id=$1 AND operation=$2 AND key_hash=$3 FOR UPDATE`,[actorId,operation,keyHash]);
  if(!prior.rowCount)throw fail('SERVER_ERROR','Unable to verify request key.');
  if(prior.rows[0].payload_hash!==payloadHash)throw fail('IDEMPOTENCY_CONFLICT','Request key already used for different details.');
  if(prior.rows[0].response_status)return {...prior.rows[0].response_json,replayed:true};
  const result=await fn();
  await db.query(`UPDATE idempotency_requests SET response_json=$4,response_status=201 WHERE actor_user_id=$1 AND operation=$2 AND key_hash=$3`,[actorId,operation,keyHash,JSON.stringify(result)]);
  return result;
}
export async function listEquipment(pool){
  const r=await pool.query(`SELECT t.id,t.code,t.name,t.market_value,t.active,b.available_qty,b.issued_qty,b.damaged_qty,b.missing_qty
    FROM equipment_types t JOIN equipment_balances b ON b.equipment_type_id=t.id ORDER BY t.name LIMIT 300`);
  return r.rows.map(x=>({id:String(x.id),code:x.code,name:x.name,marketValue:x.market_value,active:x.active,
    availableQty:+x.available_qty,issuedQty:+x.issued_qty,damagedQty:+x.damaged_qty,missingQty:+x.missing_qty}));
}
export async function addEquipment(pool,{actorId,body}){
  const input=newItem(body);
  return sqlTransaction(pool,async db=>{
    const created=await db.query(`INSERT INTO equipment_types(code,name,market_value,created_by_user_id) VALUES($1,$2,$3,$4) RETURNING id`,[input.code,input.name,input.marketValue,actorId]);
    const equipmentTypeId=String(created.rows[0].id);
    await db.query('INSERT INTO equipment_balances(equipment_type_id) VALUES($1)',[equipmentTypeId]);
    await audit(db,actorId,'equipment.item.create','equipment_type',equipmentTypeId,{code:input.code});
    return {id:equipmentTypeId,...input,availableQty:0,issuedQty:0,damagedQty:0,missingQty:0};
  });
}
export async function receiveEquipment(pool,{actorId,body,key}){
  const input=receipt(body);
  return sqlTransaction(pool,db=>once(db,{actorId,operation:'equipment.receipt',key,body:input},async()=>{
    const item=await db.query('SELECT active FROM equipment_types WHERE id=$1',[input.equipmentTypeId]);
    if(!item.rowCount||!item.rows[0].active)throw fail('EQUIPMENT_NOT_FOUND','Equipment type is not active.');
    const balance=await db.query('SELECT available_qty FROM equipment_balances WHERE equipment_type_id=$1 FOR UPDATE',[input.equipmentTypeId]);
    if(!balance.rowCount)throw fail('EQUIPMENT_NOT_FOUND','Equipment balance missing.');
    if(+balance.rows[0].available_qty+input.quantity>2147483647)throw fail('STOCK_OVERFLOW','Equipment balance overflow.');
    const created=await db.query(`INSERT INTO equipment_receipts(equipment_type_id,quantity,source_reference,received_by_user_id) VALUES($1,$2,$3,$4) RETURNING id`,[input.equipmentTypeId,input.quantity,input.sourceReference,actorId]);
    await db.query(`UPDATE equipment_balances SET available_qty=available_qty+$2,updated_at=now() WHERE equipment_type_id=$1`,[input.equipmentTypeId,input.quantity]);
    await db.query(`INSERT INTO equipment_movements(equipment_type_id,movement_type,receipt_id,available_delta,created_by_user_id) VALUES($1,'receipt',$2,$3,$4)`,[input.equipmentTypeId,created.rows[0].id,input.quantity,actorId]);
    await audit(db,actorId,'equipment.stock.receive','equipment_receipt',created.rows[0].id,{equipmentTypeId:input.equipmentTypeId,quantity:input.quantity});
    return {id:String(created.rows[0].id),equipmentTypeId:input.equipmentTypeId,availableQty:+balance.rows[0].available_qty+input.quantity};
  }));
}
async function loanMeta(db,loanId,lock=false){
  const r=await db.query(`SELECT l.id,l.team_id,l.captain_member_id,l.event_id,l.status,l.due_date::text,
    t.name AS team_name,t.status AS team_status,s.is_active AS sport_active,pa.user_id AS current_patron_user_id,
    ca.member_id AS current_captain_id,m.full_name AS captain_name
    FROM equipment_loans l JOIN teams t ON t.id=l.team_id JOIN sports s ON s.id=t.sport_id
    JOIN members m ON m.id=l.captain_member_id
    LEFT JOIN sport_patron_assignments pa ON pa.sport_id=t.sport_id AND pa.ended_at IS NULL
    LEFT JOIN team_captain_assignments ca ON ca.team_id=t.id AND ca.ended_at IS NULL
    WHERE l.id=$1 ${lock?'FOR UPDATE OF l':''}`,[id(loanId,'loan')]);
  if(!r.rowCount)throw fail('LOAN_NOT_FOUND','Equipment loan not found.');
  return r.rows[0];
}
export async function requestLoan(pool,{actorId,roles,body,key}){
  const input=loanRequest(body);
  return sqlTransaction(pool,db=>once(db,{actorId,operation:'equipment.loan.request',key,body:input},async()=>{
    const r=await db.query(`SELECT t.id,t.status,s.is_active,pa.user_id AS patron_user_id,ca.member_id AS captain_member_id
      FROM teams t JOIN sports s ON s.id=t.sport_id
      LEFT JOIN sport_patron_assignments pa ON pa.sport_id=t.sport_id AND pa.ended_at IS NULL
      LEFT JOIN team_captain_assignments ca ON ca.team_id=t.id AND ca.ended_at IS NULL
      WHERE t.id=$1 FOR UPDATE OF t`,[input.teamId]);
    if(!r.rowCount)throw fail('TEAM_NOT_FOUND','Team not found.');
    const t=r.rows[0];
    if(!canRequest(roles,actorId,t.patron_user_id))throw fail('FORBIDDEN','Only the assigned patron or manager can request for this team.');
    if(t.status!=='active'||!t.is_active)throw fail('TEAM_INACTIVE','Team or sport is inactive.');
    if(!t.captain_member_id)throw fail('CAPTAIN_REQUIRED','Appoint an active team captain before requesting equipment.');
    const cap=await db.query(`SELECT 1 FROM team_members tm JOIN members m ON m.id=tm.member_id
      WHERE tm.team_id=$1 AND tm.member_id=$2 AND tm.left_at IS NULL AND m.status='active'
      AND EXISTS(SELECT 1 FROM memberships ms WHERE ms.member_id=m.id AND ms.status='active')`,[input.teamId,t.captain_member_id]);
    if(!cap.rowCount)throw fail('CAPTAIN_NOT_ELIGIBLE','The captain is not an active team member.');
    if(input.eventId){const ev=await db.query('SELECT id FROM sporting_events WHERE id=$1 AND team_id=$2 AND status <> \'cancelled\'',[input.eventId,input.teamId]);
      if(!ev.rowCount)throw fail('INVALID_EVENT','Event must belong to this team and not be cancelled.');}
    const equipment=await db.query('SELECT id,active FROM equipment_types WHERE id=ANY($1::bigint[])',[input.lines.map(x=>x.equipmentTypeId)]);
    if(equipment.rowCount!==input.lines.length||equipment.rows.some(x=>!x.active))throw fail('EQUIPMENT_NOT_FOUND','One or more equipment types are unavailable.');
    const created=await db.query(`INSERT INTO equipment_loans(team_id,event_id,captain_member_id,requested_by_user_id,due_date,purpose)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[input.teamId,input.eventId,t.captain_member_id,actorId,input.dueDate,input.purpose]);
    const loanId=String(created.rows[0].id);
    for(const x of input.lines)await db.query(`INSERT INTO equipment_loan_lines(loan_id,equipment_type_id,issued_qty) VALUES($1,$2,$3)`,[loanId,x.equipmentTypeId,x.quantity]);
    await audit(db,actorId,'equipment.loan.request','equipment_loan',loanId,{teamId:input.teamId,lines:input.lines.length});
    return {id:loanId,teamId:input.teamId,captainMemberId:String(t.captain_member_id),status:'requested',dueDate:input.dueDate};
  }));
}
export async function issueLoan(pool,{actorId,loanId}){
  return sqlTransaction(pool,async db=>{
    const loan=await loanMeta(db,loanId,true);
    if(loan.status!=='requested')throw fail('LOAN_LOCKED','This loan has already been issued or closed.');
    if(loan.team_status!=='active'||!loan.sport_active||String(loan.current_captain_id)!==String(loan.captain_member_id))
      throw fail('CAPTAIN_CHANGED','The assigned captain or team changed. Review the loan before issuance.');
    const active=await db.query(`SELECT 1 FROM team_members tm JOIN members m ON m.id=tm.member_id WHERE tm.team_id=$1 AND tm.member_id=$2
      AND tm.left_at IS NULL AND m.status='active' AND EXISTS(SELECT 1 FROM memberships ms WHERE ms.member_id=m.id AND ms.status='active')`,[loan.team_id,loan.captain_member_id]);
    if(!active.rowCount)throw fail('CAPTAIN_NOT_ELIGIBLE','Captain is no longer eligible.');
    const lines=await db.query(`SELECT l.id,l.equipment_type_id,l.issued_qty,t.market_value,t.active
      FROM equipment_loan_lines l JOIN equipment_types t ON t.id=l.equipment_type_id
      WHERE l.loan_id=$1 ORDER BY l.equipment_type_id FOR UPDATE OF l`,[loan.id]);
    if(!lines.rowCount)throw fail('INVALID_LOAN','Loan has no equipment lines.');
    // Lock balances in ascending type ID order to avoid deadlocks across overlapping loans.
    for(const line of lines.rows){
      if(!line.active)throw fail('EQUIPMENT_NOT_FOUND','Loan contains an inactive equipment type.');
      const bal=await db.query(`SELECT available_qty FROM equipment_balances WHERE equipment_type_id=$1 FOR UPDATE`,[line.equipment_type_id]);
      if(!bal.rowCount||+bal.rows[0].available_qty<+line.issued_qty)throw fail('INSUFFICIENT_EQUIPMENT','Not enough usable equipment to issue this loan.');
      await db.query(`UPDATE equipment_balances SET available_qty=available_qty-$2,issued_qty=issued_qty+$2,updated_at=now() WHERE equipment_type_id=$1`,[line.equipment_type_id,line.issued_qty]);
      await db.query('UPDATE equipment_loan_lines SET market_value_snapshot=$2 WHERE id=$1',[line.id,line.market_value]);
      await db.query(`INSERT INTO equipment_movements(equipment_type_id,movement_type,loan_id,available_delta,issued_delta,created_by_user_id)
        VALUES($1,'issue',$2,$3,$4,$5)`,[line.equipment_type_id,loan.id,-line.issued_qty,line.issued_qty,actorId]);
    }
    await db.query(`UPDATE equipment_loans SET status='issued',issued_by_user_id=$2,issued_at=now() WHERE id=$1`,[loan.id,actorId]);
    await audit(db,actorId,'equipment.loan.issue','equipment_loan',loan.id,{lineCount:lines.rowCount});
    return {id:String(loan.id),status:'issued',captainMemberId:String(loan.captain_member_id)};
  });
}
async function loanLineState(db,loanId){
  const r=await db.query(`SELECT l.id,l.equipment_type_id,l.issued_qty,l.market_value_snapshot,t.name,t.code,
    COALESCE((SELECT SUM(rl.usable_qty+rl.damaged_qty+rl.missing_qty) FROM equipment_return_lines rl
      JOIN equipment_returns er ON er.id=rl.return_id WHERE rl.loan_line_id=l.id AND er.loan_id=l.loan_id),0)::integer AS accounted_qty
    FROM equipment_loan_lines l JOIN equipment_types t ON t.id=l.equipment_type_id
    WHERE l.loan_id=$1 ORDER BY l.equipment_type_id`,[loanId]);
  return r.rows;
}
export async function returnLoan(pool,{actorId,loanId,body,key}){
  const input=returnRequest(body),loanKey=id(loanId,'loan');
  return sqlTransaction(pool,db=>once(db,{actorId,operation:`equipment.loan.${loanKey}.return`,key,body:input},async()=>{
    const loan=await loanMeta(db,loanKey,true);
    if(!['issued','partially_returned'].includes(loan.status))throw fail('LOAN_LOCKED','Only issued loans can be returned.');
    const lines=await loanLineState(db,loan.id);
    const byLine=new Map(lines.map(x=>[String(x.id),x]));
    let accountedNow=0;
    for(const line of input.lines){
      const current=byLine.get(line.loanLineId);
      if(!current)throw fail('INVALID_LOAN_LINE','Return line is not part of this loan.');
      const n=line.usableQty+line.damagedQty+line.missingQty;
      if(n>Number(current.issued_qty)-Number(current.accounted_qty))throw fail('OVER_RETURN','This return exceeds equipment still issued.');
      accountedNow+=n;
    }
    // All selected loan lines are known; balance locks follow ascending item ID.
    const ordered=input.lines.map(x=>({...x,equipmentTypeId:byLine.get(x.loanLineId).equipment_type_id,marketValue:byLine.get(x.loanLineId).market_value_snapshot}))
      .sort((a,b)=>BigInt(a.equipmentTypeId)<BigInt(b.equipmentTypeId)?-1:1);
    const created=await db.query(`INSERT INTO equipment_returns(loan_id,inspected_by_user_id,notes) VALUES($1,$2,$3) RETURNING id`,[loan.id,actorId,input.notes]);
    const returnId=String(created.rows[0].id),incidents=[];
    for(const x of ordered){
      const balance=await db.query('SELECT issued_qty FROM equipment_balances WHERE equipment_type_id=$1 FOR UPDATE',[x.equipmentTypeId]);
      const total=x.usableQty+x.damagedQty+x.missingQty;
      if(!balance.rowCount||Number(balance.rows[0].issued_qty)<total)throw fail('ISSUED_BALANCE_MISMATCH','Equipment issued balance does not match the loan.');
      const rl=await db.query(`INSERT INTO equipment_return_lines(return_id,loan_line_id,usable_qty,damaged_qty,missing_qty)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,[returnId,x.loanLineId,x.usableQty,x.damagedQty,x.missingQty]);
      const returnLineId=String(rl.rows[0].id);
      await db.query(`UPDATE equipment_balances SET available_qty=available_qty+$2,issued_qty=issued_qty-$5,
        damaged_qty=damaged_qty+$3,missing_qty=missing_qty+$4,updated_at=now() WHERE equipment_type_id=$1`,
        [x.equipmentTypeId,x.usableQty,x.damagedQty,x.missingQty,total]);
      await db.query(`INSERT INTO equipment_movements(equipment_type_id,movement_type,return_line_id,available_delta,issued_delta,damaged_delta,missing_delta,created_by_user_id)
        VALUES($1,'return',$2,$3,$4,$5,$6,$7)`,[x.equipmentTypeId,returnLineId,x.usableQty,-total,x.damagedQty,x.missingQty,actorId]);
      for(const [kind,qty] of [['damaged',x.damagedQty],['missing',x.missingQty]])if(qty){
        const incident=await db.query(`INSERT INTO equipment_incidents(return_line_id,incident_type,quantity,reported_market_value)
          VALUES($1,$2,$3,$4) RETURNING id`,[returnLineId,kind,qty,x.marketValue]);
        incidents.push({id:String(incident.rows[0].id),type:kind,quantity:qty,status:'reported'});
      }
    }
    const totalRemaining=lines.reduce((sum,l)=>sum+Number(l.issued_qty)-Number(l.accounted_qty),0)-accountedNow;
    const status=totalRemaining===0?'closed':'partially_returned';
    await db.query('UPDATE equipment_loans SET status=$2 WHERE id=$1',[loan.id,status]);
    await audit(db,actorId,'equipment.loan.return','equipment_loan',loan.id,{returnId,accountedNow,incidents:incidents.length});
    return {returnId,loanId:String(loan.id),status,remainingQty:totalRemaining,incidents};
  }));
}
export async function approveIncident(pool,{actorId,incidentId,body}){
  const incidentKey=id(incidentId,'incident');
  const marketValue=centsToMoney(moneyToCents(body?.approvedMarketValue));
  const evidence=text(body?.evidenceReference,8,200,'Evidence reference');
  return sqlTransaction(pool,async db=>{
    const r=await db.query(`SELECT ei.id,ei.status,ei.quantity,ei.incident_type,er.inspected_by_user_id
      FROM equipment_incidents ei JOIN equipment_return_lines rl ON rl.id=ei.return_line_id
      JOIN equipment_returns er ON er.id=rl.return_id WHERE ei.id=$1 FOR UPDATE OF ei`,[incidentKey]);
    if(!r.rowCount)throw fail('INCIDENT_NOT_FOUND','Incident not found.');
    if(r.rows[0].status!=='reported')throw fail('INCIDENT_LOCKED','Incident was already approved.');
    if(String(r.rows[0].inspected_by_user_id)===String(actorId))throw fail('SEPARATION_OF_DUTIES','An independent manager must confirm the inspection valuation.');
    const amount=surcharge(+r.rows[0].quantity,marketValue);
    await db.query(`UPDATE equipment_incidents SET status='confirmed',approved_market_value=$2,surcharge_total=$3,
      evidence_reference=$4,confirmed_by_user_id=$5,confirmed_at=now() WHERE id=$1`,[incidentKey,marketValue,amount,evidence,actorId]);
    await audit(db,actorId,'equipment.incident.confirm','equipment_incident',incidentKey,{approvedMarketValue:marketValue,surchargeTotal:amount,liabilityAllocation:'not decided'});
    return {id:incidentKey,status:'confirmed',type:r.rows[0].incident_type,quantity:+r.rows[0].quantity,
      approvedMarketValue:marketValue,surchargeTotal:amount,liabilityAssigned:false};
  });
}
export async function listLoans(pool,{actorId,roles}){
  const broad=roles.some(r=>['ADM','MGT','STO','FIN'].includes(r));
  const r=await pool.query(`SELECT l.id,l.team_id,l.event_id,l.status,l.due_date::text,l.captain_member_id,
    m.full_name AS captain_name,t.name AS team_name,pa.user_id AS patron_user_id
    FROM equipment_loans l JOIN members m ON m.id=l.captain_member_id JOIN teams t ON t.id=l.team_id
    LEFT JOIN sport_patron_assignments pa ON pa.sport_id=t.sport_id AND pa.ended_at IS NULL
    WHERE $1::boolean OR pa.user_id=$2 ORDER BY l.id DESC LIMIT 100`,[broad,actorId]);
  return r.rows.map(x=>({id:String(x.id),teamId:String(x.team_id),teamName:x.team_name,
    eventId:x.event_id?String(x.event_id):null,captainMemberId:String(x.captain_member_id),captainName:x.captain_name,
    status:x.status,dueDate:x.due_date}));
}
export async function loanDetails(pool,{actorId,roles,loanId}){
  const loan=await loanMeta(pool,loanId);
  if(!canRead(roles,actorId,loan.current_patron_user_id))throw fail('FORBIDDEN','You cannot access this loan.');
  const lines=await loanLineState(pool,loan.id);
  return {id:String(loan.id),teamId:String(loan.team_id),teamName:loan.team_name,
    eventId:loan.event_id?String(loan.event_id):null,captainMemberId:String(loan.captain_member_id),captainName:loan.captain_name,
    status:loan.status,dueDate:loan.due_date,lines:lines.map(x=>({id:String(x.id),equipmentTypeId:String(x.equipment_type_id),
      code:x.code,name:x.name,issuedQty:+x.issued_qty,accountedQty:+x.accounted_qty,remainingQty:+x.issued_qty- +x.accounted_qty}))};
}
export async function listIncidents(pool,{actorId,roles}){
  const broad=roles.some(r=>['ADM','MGT','STO','FIN'].includes(r));
  const r=await pool.query(`SELECT ei.id,ei.incident_type,ei.quantity,ei.status,ei.reported_market_value,
    ei.approved_market_value,ei.surcharge_total,er.loan_id,et.name AS equipment_name,
    t.name AS team_name,pa.user_id AS patron_user_id
    FROM equipment_incidents ei JOIN equipment_return_lines erl ON erl.id=ei.return_line_id
    JOIN equipment_returns er ON er.id=erl.return_id JOIN equipment_loan_lines ell ON ell.id=erl.loan_line_id
    JOIN equipment_types et ON et.id=ell.equipment_type_id JOIN equipment_loans l ON l.id=er.loan_id
    JOIN teams t ON t.id=l.team_id LEFT JOIN sport_patron_assignments pa ON pa.sport_id=t.sport_id AND pa.ended_at IS NULL
    WHERE $1::boolean OR pa.user_id=$2 ORDER BY ei.id DESC LIMIT 100`,[broad,actorId]);
  return r.rows.map(x=>({id:String(x.id),type:x.incident_type,quantity:+x.quantity,status:x.status,
    reportedMarketValue:x.reported_market_value,approvedMarketValue:x.approved_market_value,surchargeTotal:x.surcharge_total,
    loanId:String(x.loan_id),equipmentName:x.equipment_name,teamName:x.team_name,liabilityAssigned:false}));
}
