import express from 'express';
import { getPool } from '../db/pool.js';
import { authenticated, requireRole, requireSameOrigin, requireCsrf } from '../auth/routes.js';
import { InputError } from '../members/validation.js';
import { requiredId, maySeeTeam } from './policy.js';
import { createTeam, addTeamMember, appointCaptain, removeTeamMember } from './service.js';

const writeErrors=(res,e)=>{
  const status=e.code==='FORBIDDEN'?403:e.code==='NOT_FOUND'?404:
    ['TEAM_MEMBER_EXISTS','CAPTAIN_MUST_BE_REPLACED','TEAM_INACTIVE','SPORT_INACTIVE'].includes(e.code)?409:422;
  return res.status(status).json({error:{code:e.code,message:e.message,fieldErrors:e.fieldErrors||{}}});
};
const act=fn=>async(req,res,next)=>{try{const data=await fn(req);res.status(data?.unchanged?200:201).json({data});}
  catch(e){if(e instanceof InputError)return writeErrors(res,e);
    if(e.code==='23505')return res.status(409).json({error:{code:'ALREADY_EXISTS',message:'A conflicting current assignment or team already exists.'}});
    next(e);}};
const staff=req=>({actorId:req.staff.user_id,roles:req.staff.roles});

export function teamsRouter(){
  const router=express.Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();},authenticated);
  router.get('/',requireRole('ADM','MGT','PAT'),async(req,res,next)=>{
    try{
      const sportId=req.query.sportId?requiredId(req.query.sportId,'sportId'):null;
      // Patrons can only view teams whose sport they CURRENTLY oversee.
      const result=await getPool().query(`SELECT t.id,t.name,t.status,t.sport_id,s.name AS sport_name,
        p.user_id AS patron_user_id,pc.member_id AS captain_member_id,m.full_name AS captain_name,
        (SELECT count(*)::integer FROM team_members tm WHERE tm.team_id=t.id AND tm.left_at IS NULL) AS member_count
        FROM teams t JOIN sports s ON s.id=t.sport_id
        LEFT JOIN sport_patron_assignments p ON p.sport_id=t.sport_id AND p.ended_at IS NULL
        LEFT JOIN team_captain_assignments pc ON pc.team_id=t.id AND pc.ended_at IS NULL
        LEFT JOIN members m ON m.id=pc.member_id
        WHERE ($1::bigint IS NULL OR t.sport_id=$1) AND ($2::boolean OR p.user_id=$3)
        ORDER BY t.id DESC LIMIT 100`,[sportId,req.staff.roles.some(r=>['ADM','MGT'].includes(r)),req.staff.user_id]);
      res.json({data:result.rows.map(t=>({id:String(t.id),name:t.name,status:t.status,sportId:String(t.sport_id),
        sportName:t.sport_name,patronUserId:t.patron_user_id?String(t.patron_user_id):null,
        captainMemberId:t.captain_member_id?String(t.captain_member_id):null,captainName:t.captain_name,
        memberCount:t.member_count}))});
    }catch(e){if(e instanceof InputError)return writeErrors(res,e);next(e);}
  });
  router.get('/:id/members',requireRole('ADM','MGT','PAT'),async(req,res,next)=>{
    try{
      const id=requiredId(req.params.id,'teamId');
      const meta=await getPool().query(`SELECT t.id,p.user_id AS patron_user_id FROM teams t
        LEFT JOIN sport_patron_assignments p ON p.sport_id=t.sport_id AND p.ended_at IS NULL WHERE t.id=$1`,[id]);
      if(!meta.rowCount)throw new InputError('NOT_FOUND','Team not found.');
      if(!maySeeTeam(req.staff.roles,req.staff.user_id,meta.rows[0].patron_user_id)) throw new InputError('FORBIDDEN','You are not assigned to this team.');
      const result=await getPool().query(`SELECT m.id,m.membership_number,m.full_name,tm.joined_at,
        EXISTS(SELECT 1 FROM team_captain_assignments ca WHERE ca.team_id=$1 AND ca.member_id=m.id AND ca.ended_at IS NULL) AS is_captain
        FROM team_members tm JOIN members m ON m.id=tm.member_id
        WHERE tm.team_id=$1 AND tm.left_at IS NULL ORDER BY m.full_name,m.id LIMIT 200`,[id]);
      res.json({data:result.rows.map(m=>({id:String(m.id),membershipNumber:m.membership_number,
        fullName:m.full_name,isCaptain:m.is_captain,joinedAt:m.joined_at}))});
    }catch(e){if(e instanceof InputError)return writeErrors(res,e);next(e);}
  });
  router.post('/',requireRole('ADM','PAT'),requireSameOrigin,requireCsrf,act(req=>createTeam(getPool(),{...staff(req),body:req.body})));
  router.post('/:id/members',requireRole('ADM','PAT'),requireSameOrigin,requireCsrf,
    act(req=>addTeamMember(getPool(),{...staff(req),teamId:req.params.id,memberId:req.body?.memberId})));
  router.post('/:id/captain-assignments',requireRole('ADM','PAT'),requireSameOrigin,requireCsrf,
    act(req=>appointCaptain(getPool(),{...staff(req),teamId:req.params.id,memberId:req.body?.memberId})));
  router.delete('/:id/members/:memberId',requireRole('ADM','PAT'),requireSameOrigin,requireCsrf,async(req,res,next)=>{
    try{res.json({data:await removeTeamMember(getPool(),{...staff(req),teamId:req.params.id,memberId:req.params.memberId})});}
    catch(e){if(e instanceof InputError)return writeErrors(res,e);next(e);}
  });
  return router;
}
