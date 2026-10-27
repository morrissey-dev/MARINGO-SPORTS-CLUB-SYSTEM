import { InputError } from '../members/validation.js';
import { requiredId,validateEvent,canManageEvent,canViewEvent,commissionPreview,EVENT_FEE_CENTS } from './policy.js';
import { moneyToCents,centsToMoney } from '../payments/policy.js';

const problem=(code,message)=>new InputError(code,message);
const denied=()=>problem('FORBIDDEN','Only the currently assigned patron or an administrator can change this event.');
async function transact(pool,cb){
  const db=await pool.connect();
  try{await db.query('BEGIN');const r=await cb(db);await db.query('COMMIT');return r;}
  catch(e){await db.query('ROLLBACK');throw e;}
  finally{db.release();}
}
async function log(db,actor,action,eventId,metadata={}){
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata_summary)
    VALUES($1,$2,'sporting_event',$3,$4)`,[actor,action,String(eventId),JSON.stringify(metadata)]);
}
async function lockedEvent(db,eventId,actorId,roles){
  const id=requiredId(eventId,'eventId');
  const r=await db.query(`SELECT e.id,e.team_id,e.sport_id,e.event_type,e.status,e.event_date,
    e.patron_assignment_id,spa.user_id AS original_patron_user_id,
    cur.user_id AS current_patron_user_id,t.status AS team_status,s.is_active AS sport_active
    FROM sporting_events e JOIN teams t ON t.id=e.team_id JOIN sports s ON s.id=e.sport_id
    JOIN sport_patron_assignments spa ON spa.id=e.patron_assignment_id
    LEFT JOIN sport_patron_assignments cur ON cur.sport_id=e.sport_id AND cur.ended_at IS NULL
    WHERE e.id=$1 FOR UPDATE OF e`,[id]);
  if(!r.rowCount)throw problem('EVENT_NOT_FOUND','Event not found.');
  const e=r.rows[0];
  if(!canManageEvent(roles,actorId,e.current_patron_user_id))throw denied();
  if(e.status!=='draft')throw problem('EVENT_LOCKED','This event roster is no longer editable.');
  if(e.team_status!=='active'||!e.sport_active)throw problem('TEAM_INACTIVE','Team or sport is inactive.');
  return e;
}
export function createEvent(pool,{actorId,roles,body}){
  const input=validateEvent(body);
  return transact(pool,async db=>{
    const q=await db.query(`SELECT t.id,t.name,t.sport_id,t.status,s.is_active,
      spa.id AS patron_assignment_id,spa.user_id AS patron_user_id
      FROM teams t JOIN sports s ON s.id=t.sport_id
      LEFT JOIN sport_patron_assignments spa ON spa.sport_id=t.sport_id AND spa.ended_at IS NULL
      WHERE t.id=$1 FOR UPDATE OF t`,[input.teamId]);
    if(!q.rowCount)throw problem('TEAM_NOT_FOUND','Team not found.');
    const team=q.rows[0];
    if(team.status!=='active'||!team.is_active)throw problem('TEAM_INACTIVE','Team or sport is inactive.');
    if(!team.patron_assignment_id)throw problem('PATRON_REQUIRED','Assign a patron to the sport before creating events.');
    if(!canManageEvent(roles,actorId,team.patron_user_id))throw denied();
    const result=await db.query(`INSERT INTO sporting_events(sport_id,team_id,patron_assignment_id,created_by_user_id,
      event_type,event_date,venue,opponent) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id`,[team.sport_id,team.id,team.patron_assignment_id,actorId,input.eventType,input.eventDate,input.venue,input.opponent]);
    const id=String(result.rows[0].id);
    await log(db,actorId,'event.create',id,{eventType:input.eventType,teamId:input.teamId});
    return {id,teamId:input.teamId,eventType:input.eventType,eventDate:input.eventDate,venue:input.venue,
      opponent:input.opponent,status:'draft',participantCount:0};
  });
}
export function enrollParticipant(pool,{actorId,roles,eventId,memberId}){
  const id=requiredId(memberId,'memberId');
  return transact(pool,async db=>{
    const event=await lockedEvent(db,eventId,actorId,roles);
    const member=await db.query(`SELECT m.id,m.full_name,m.membership_number FROM team_members tm
      JOIN members m ON m.id=tm.member_id
      WHERE tm.team_id=$1 AND tm.member_id=$2 AND tm.left_at IS NULL AND m.status='active'
      AND EXISTS(SELECT 1 FROM memberships ms WHERE ms.member_id=m.id AND ms.status='active')
      FOR SHARE OF m`,[event.team_id,id]);
    if(!member.rowCount)throw problem('PARTICIPANT_NOT_ELIGIBLE','Member must belong to the selected team and have active membership.');
    const created=await db.query(`INSERT INTO event_participants(event_id,member_id,enrolled_by_user_id)
      VALUES($1,$2,$3) ON CONFLICT(event_id,member_id) DO NOTHING RETURNING id`,[event.id,id,actorId]);
    if(!created.rowCount)throw problem('PARTICIPANT_EXISTS','This member is already on the event roster.');
    await log(db,actorId,'event.participant.add',event.id,{memberId:id});
    return {eventId:String(event.id),memberId:id,fullName:member.rows[0].full_name,
      membershipNumber:member.rows[0].membership_number};
  });
}
export function removeParticipant(pool,{actorId,roles,eventId,memberId}){
  const id=requiredId(memberId,'memberId');
  return transact(pool,async db=>{
    const e=await lockedEvent(db,eventId,actorId,roles);
    const removed=await db.query(`DELETE FROM event_participants WHERE event_id=$1 AND member_id=$2
      AND charge_id IS NULL RETURNING id`,[e.id,id]);
    if(!removed.rowCount)throw problem('PARTICIPANT_NOT_FOUND','Draft participant not found.');
    await log(db,actorId,'event.participant.remove',e.id,{memberId:id});
    return {eventId:String(e.id),memberId:id,removed:true};
  });
}
export function cancelDraftEvent(pool,{actorId,roles,eventId}){
  return transact(pool,async db=>{
    const e=await lockedEvent(db,eventId,actorId,roles);
    // Draft events have no facilitation charges; historical cancellations remain visible.
    await db.query(`UPDATE sporting_events SET status='cancelled' WHERE id=$1`,[e.id]);
    await log(db,actorId,'event.cancel',e.id,{reason:'draft cancelled'});
    return {eventId:String(e.id),status:'cancelled'};
  });
}
export function finalizeEvent(pool,{actorId,roles,eventId}){
  return transact(pool,async db=>{
    // The event row lock serializes repeated finalize requests, including across backend processes.
    const id=requiredId(eventId,'eventId');
    const entry=await db.query(`SELECT e.id,e.status,e.event_type,e.team_id,e.sport_id,
      spa.user_id AS original_patron_user_id,cur.user_id AS current_patron_user_id
      FROM sporting_events e JOIN sport_patron_assignments spa ON spa.id=e.patron_assignment_id
      LEFT JOIN sport_patron_assignments cur ON cur.sport_id=e.sport_id AND cur.ended_at IS NULL
      WHERE e.id=$1 FOR UPDATE OF e`,[id]);
    if(!entry.rowCount)throw problem('EVENT_NOT_FOUND','Event not found.');
    const e=entry.rows[0];
    if(!canManageEvent(roles,actorId,e.current_patron_user_id))throw denied();
    if(e.status==='finalized')return {eventId:id,status:'finalized',unchanged:true};
    if(e.status!=='draft')throw problem('EVENT_LOCKED','Cannot finalize a cancelled event.');
    const roster=await db.query(`SELECT ep.id,ep.member_id,m.status,
      EXISTS(SELECT 1 FROM memberships ms WHERE ms.member_id=m.id AND ms.status='active') AS active_membership,
      EXISTS(SELECT 1 FROM team_members tm WHERE tm.team_id=$2 AND tm.member_id=m.id AND tm.left_at IS NULL) AS current_team_member
      FROM event_participants ep JOIN members m ON m.id=ep.member_id WHERE ep.event_id=$1 ORDER BY ep.id FOR SHARE OF m`,[id,e.team_id]);
    if(!roster.rowCount)throw problem('EMPTY_ROSTER','Add at least one player before finalizing.');
    if(roster.rows.some(r=>r.status!=='active'||!r.active_membership||!r.current_team_member))
      throw problem('ROSTER_CHANGED','A participant is no longer an active team member. Review the roster.');
    if(e.event_type==='external'){
      for(const item of roster.rows){
        const charge=await db.query(`INSERT INTO charges(member_id,charge_type,amount,status)
          VALUES($1,'facilitation','500.00','outstanding') RETURNING id`,[item.member_id]);
        await db.query(`INSERT INTO facilitation_charges(charge_id,event_participant_id,fee_snapshot)
          VALUES($1,$2,'500.00')`,[charge.rows[0].id,item.id]);
        await db.query(`UPDATE event_participants SET charge_id=$2 WHERE id=$1`,[item.id,charge.rows[0].id]);
      }
      await db.query(`INSERT INTO patron_commission_projections(event_id,patron_user_id,rate_percent,policy_basis,status)
        VALUES($1,$2,20.00,'undecided','provisional')`,[id,e.original_patron_user_id]);
    }
    await db.query(`UPDATE sporting_events SET status='finalized',finalized_at=now() WHERE id=$1`,[id]);
    await log(db,actorId,'event.finalize',id,{eventType:e.event_type,participants:roster.rowCount,
      chargesCreated:e.event_type==='external'?roster.rowCount:0});
    return {eventId:id,status:'finalized',participantCount:roster.rowCount,
      chargesCreated:e.event_type==='external'?roster.rowCount:0,
      assessedAmount:centsToMoney(e.event_type==='external'?EVENT_FEE_CENTS*roster.rowCount:0),unchanged:false};
  });
}
export async function listEvents(pool,{roles,actorId}){
  const all=roles.some(r=>['ADM','FIN','MGT'].includes(r));
  const result=await pool.query(`SELECT e.id,e.team_id,t.name AS team_name,e.sport_id,s.name AS sport_name,
    e.event_type,e.event_date::text,e.venue,e.opponent,e.status,
    (SELECT count(*)::integer FROM event_participants p WHERE p.event_id=e.id) AS participant_count,
    spa.user_id AS original_patron_user_id
    FROM sporting_events e JOIN teams t ON t.id=e.team_id JOIN sports s ON s.id=e.sport_id
    JOIN sport_patron_assignments spa ON spa.id=e.patron_assignment_id
    LEFT JOIN sport_patron_assignments cur ON cur.sport_id=e.sport_id AND cur.ended_at IS NULL
    WHERE ($1::boolean OR cur.user_id=$2) ORDER BY e.event_date DESC,e.id DESC LIMIT 100`,[all,actorId]);
  return result.rows.map(x=>({id:String(x.id),teamId:String(x.team_id),teamName:x.team_name,
    sportId:String(x.sport_id),sportName:x.sport_name,eventType:x.event_type,eventDate:x.event_date,
    venue:x.venue,opponent:x.opponent,status:x.status,participantCount:x.participant_count}));
}
export async function eventSummary(pool,{roles,actorId,eventId}){
  const id=requiredId(eventId,'eventId');
  const r=await pool.query(`SELECT e.id,e.team_id,e.event_type,e.status,e.event_date::text,e.venue,e.opponent,
    t.name AS team_name,s.name AS sport_name,original.user_id AS original_patron_user_id,
    current_patron.user_id AS current_patron_user_id,cp.rate_percent,cp.policy_basis
    FROM sporting_events e JOIN teams t ON t.id=e.team_id JOIN sports s ON s.id=e.sport_id
    JOIN sport_patron_assignments original ON original.id=e.patron_assignment_id
    LEFT JOIN sport_patron_assignments current_patron ON current_patron.sport_id=e.sport_id AND current_patron.ended_at IS NULL
    LEFT JOIN patron_commission_projections cp ON cp.event_id=e.id WHERE e.id=$1`,[id]);
  if(!r.rowCount)throw problem('EVENT_NOT_FOUND','Event not found.');
  const e=r.rows[0];
  if(!canViewEvent(roles,actorId,e.current_patron_user_id))throw problem('FORBIDDEN','This event is not assigned to your role.');
  const rows=await pool.query(`SELECT ep.id,ep.member_id,m.membership_number,m.full_name,ep.charge_id,
    c.amount,c.status AS charge_status,
    COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id
      WHERE pa.charge_id=ep.charge_id AND p.status='verified'),0)::text AS collected
    FROM event_participants ep JOIN members m ON m.id=ep.member_id
    LEFT JOIN charges c ON c.id=ep.charge_id WHERE ep.event_id=$1 ORDER BY ep.id`,[id]);
  let billed=0,verified=0;
  const participants=rows.rows.map(x=>{
    const amt=x.amount===null?0:moneyToCents(String(x.amount));
    const raw=String(x.collected);
    const got=Number(raw)===0 ? 0 : moneyToCents(raw.includes('.')?raw:`${raw}.00`);
    billed+=amt;verified+=got;
    return {id:String(x.id),memberId:String(x.member_id),memberNumber:x.membership_number,
      fullName:x.full_name,chargeId:x.charge_id?String(x.charge_id):null,fee:centsToMoney(amt),
      paid:centsToMoney(got),balance:centsToMoney(amt-got),chargeStatus:x.charge_status||null};
  });
  const commission=commissionPreview(billed,verified);
  return {id,teamId:String(e.team_id),teamName:e.team_name,sportName:e.sport_name,
    eventType:e.event_type,eventDate:e.event_date,status:e.status,venue:e.venue,opponent:e.opponent,
    participants,assessed:centsToMoney(billed),verified:centsToMoney(verified),
    outstanding:centsToMoney(billed-verified),commission:{status:e.policy_basis?'provisional':'not_applicable',
      ratePercent:e.rate_percent||null,policyBasis:e.policy_basis||null,
      illustrationOnBilled:centsToMoney(commission.billed),illustrationOnCollected:centsToMoney(commission.collected),
      payable:false,notice:'Commission calculation basis is not approved; do not pay this projection.'}};
}
