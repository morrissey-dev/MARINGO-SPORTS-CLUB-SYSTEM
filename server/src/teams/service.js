import { InputError } from '../members/validation.js';
import { requiredId, teamName, canManageSport } from './policy.js';

const denied=()=>new InputError('FORBIDDEN','You are not the currently assigned patron for this sport.');
const missing=(what)=>new InputError('NOT_FOUND',`${what} not found.`);
const problem=(code,message)=>new InputError(code,message);

async function transact(pool,callback){
  const db=await pool.connect();
  try {await db.query('BEGIN'); const result=await callback(db);await db.query('COMMIT');return result;}
  catch(e){await db.query('ROLLBACK');throw e;}
  finally{db.release();}
}
async function audit(db,user,action,type,id,details={}){
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata_summary)
    VALUES($1,$2,$3,$4,$5)`,[user,action,type,String(id),JSON.stringify(details)]);
}

// Assigning a new patron closes previous assignment but preserves history.
export function assignPatron(pool,{actorId,sportId,patronUserId}){
  return transact(pool,async db=>{
    const id=requiredId(sportId,'sportId');const staffId=requiredId(patronUserId,'patronUserId');
    const sport=await db.query('SELECT id,name FROM sports WHERE id=$1 AND is_active=true FOR UPDATE',[id]);
    if(!sport.rowCount)throw missing('Active sport');
    const staff=await db.query(`SELECT u.id,u.full_name FROM users u JOIN user_roles ur ON ur.user_id=u.id
      JOIN roles r ON r.id=ur.role_id WHERE u.id=$1 AND u.is_active AND r.code='PAT'`,[staffId]);
    if(!staff.rowCount)throw problem('PATRON_ROLE_REQUIRED','Choose an active staff user with the PAT role.');
    const current=await db.query(`SELECT id,user_id FROM sport_patron_assignments WHERE sport_id=$1 AND ended_at IS NULL FOR UPDATE`,[id]);
    if(current.rowCount && String(current.rows[0].user_id)===String(staffId))
      return {sportId:id,sportName:sport.rows[0].name,patronUserId:staffId,patronName:staff.rows[0].full_name,unchanged:true};
    if(current.rowCount) await db.query('UPDATE sport_patron_assignments SET ended_at=now() WHERE id=$1',[current.rows[0].id]);
    const result=await db.query(`INSERT INTO sport_patron_assignments(sport_id,user_id,appointed_by_user_id)
      VALUES($1,$2,$3) RETURNING id`,[id,staffId,actorId]);
    await audit(db,actorId,'sport.patron.assign','sport',id,{assignmentId:String(result.rows[0].id),patronUserId:staffId});
    return {sportId:id,sportName:sport.rows[0].name,patronUserId:staffId,patronName:staff.rows[0].full_name};
  });
}

async function lockTeamAndCheck(db,{teamId,actorId,roles}){
  // Team row lock serializes simultaneous captain changes and member removals.
  const lookup=await db.query(`SELECT t.id,t.name,t.sport_id,t.status,s.is_active,
       p.user_id AS patron_user_id FROM teams t JOIN sports s ON s.id=t.sport_id
       LEFT JOIN sport_patron_assignments p ON p.sport_id=t.sport_id AND p.ended_at IS NULL
       WHERE t.id=$1 FOR UPDATE OF t`,[requiredId(teamId,'teamId')]);
  if(!lookup.rowCount)throw missing('Team');
  const t=lookup.rows[0];
  if(!canManageSport(roles,actorId,t.patron_user_id))throw denied();
  if(t.status!=='active'||!t.is_active)throw problem('TEAM_INACTIVE','The team or sport is inactive.');
  return t;
}
export function createTeam(pool,{actorId,roles,body}){
  return transact(pool,async db=>{
    const sportId=requiredId(body?.sportId,'sportId');const name=teamName(body?.name);
    const sport=await db.query(`SELECT s.id,s.name,s.is_active,p.user_id AS patron_user_id FROM sports s
      LEFT JOIN sport_patron_assignments p ON p.sport_id=s.id AND p.ended_at IS NULL WHERE s.id=$1 FOR UPDATE OF s`,[sportId]);
    if(!sport.rowCount)throw missing('Sport');
    if(!sport.rows[0].is_active)throw problem('SPORT_INACTIVE','Sport is inactive.');
    if(!canManageSport(roles,actorId,sport.rows[0].patron_user_id))throw denied();
    const result=await db.query(`INSERT INTO teams(sport_id,name,created_by_user_id)
      VALUES($1,$2,$3) RETURNING id,name,status`,[sportId,name,actorId]);
    await audit(db,actorId,'team.create','team',result.rows[0].id,{sportId});
    return {id:String(result.rows[0].id),name:result.rows[0].name,sportId,status:result.rows[0].status};
  });
}
export function addTeamMember(pool,{actorId,roles,teamId,memberId}){
  return transact(pool,async db=>{
    const team=await lockTeamAndCheck(db,{teamId,actorId,roles});
    const id=requiredId(memberId,'memberId');
    const member=await db.query(`SELECT m.id,m.membership_number,m.full_name FROM members m
      WHERE m.id=$1 AND m.status='active' AND EXISTS(SELECT 1 FROM memberships ms WHERE ms.member_id=m.id AND ms.status='active')
      FOR SHARE OF m`,[id]);
    if(!member.rowCount)throw problem('MEMBER_NOT_ACTIVE','Only active, paid members can join teams.');
    const existing=await db.query(`SELECT id FROM team_members WHERE team_id=$1 AND member_id=$2 AND left_at IS NULL`,[team.id,id]);
    if(existing.rowCount)throw problem('TEAM_MEMBER_EXISTS','Member is already on this team.');
    const result=await db.query(`INSERT INTO team_members(team_id,member_id,added_by_user_id) VALUES($1,$2,$3) RETURNING id`,[team.id,id,actorId]);
    await audit(db,actorId,'team.member.add','team',team.id,{membershipId:String(result.rows[0].id),memberId:id});
    return {teamId:String(team.id),memberId:id,memberName:member.rows[0].full_name,memberNumber:member.rows[0].membership_number};
  });
}
export function appointCaptain(pool,{actorId,roles,teamId,memberId}){
  return transact(pool,async db=>{
    const team=await lockTeamAndCheck(db,{teamId,actorId,roles});
    const id=requiredId(memberId,'memberId');
    const eligible=await db.query(`SELECT m.id,m.full_name FROM team_members tm JOIN members m ON m.id=tm.member_id
      WHERE tm.team_id=$1 AND tm.member_id=$2 AND tm.left_at IS NULL AND m.status='active'
      AND EXISTS(SELECT 1 FROM memberships ms WHERE ms.member_id=m.id AND ms.status='active')`,[team.id,id]);
    if(!eligible.rowCount)throw problem('CAPTAIN_NOT_ELIGIBLE','Captain must be an active club member already on this team.');
    const old=await db.query('SELECT id,member_id FROM team_captain_assignments WHERE team_id=$1 AND ended_at IS NULL FOR UPDATE',[team.id]);
    if(old.rowCount && String(old.rows[0].member_id)===String(id))
      return {teamId:String(team.id),memberId:id,memberName:eligible.rows[0].full_name,unchanged:true};
    if(old.rowCount)await db.query('UPDATE team_captain_assignments SET ended_at=now() WHERE id=$1',[old.rows[0].id]);
    const result=await db.query(`INSERT INTO team_captain_assignments(team_id,member_id,appointed_by_user_id)
      VALUES($1,$2,$3) RETURNING id`,[team.id,id,actorId]);
    await audit(db,actorId,'team.captain.assign','team',team.id,{assignmentId:String(result.rows[0].id),memberId:id});
    return {teamId:String(team.id),memberId:id,memberName:eligible.rows[0].full_name};
  });
}
export function removeTeamMember(pool,{actorId,roles,teamId,memberId}){
  return transact(pool,async db=>{
    const team=await lockTeamAndCheck(db,{teamId,actorId,roles});
    const id=requiredId(memberId,'memberId');
    const activeCaptain=await db.query(`SELECT id FROM team_captain_assignments WHERE team_id=$1 AND member_id=$2 AND ended_at IS NULL`,[team.id,id]);
    if(activeCaptain.rowCount)throw problem('CAPTAIN_MUST_BE_REPLACED','Appoint a different captain before removing this member.');
    const result=await db.query(`UPDATE team_members SET left_at=now()
      WHERE team_id=$1 AND member_id=$2 AND left_at IS NULL RETURNING id`,[team.id,id]);
    if(!result.rowCount)throw missing('Active team member');
    await audit(db,actorId,'team.member.remove','team',team.id,{memberId:id});
    return {teamId:String(team.id),memberId:id,removed:true};
  });
}
