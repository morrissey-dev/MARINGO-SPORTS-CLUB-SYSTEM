import express from 'express';
import { getPool } from '../db/pool.js';
import { authenticated, requireRole, requireSameOrigin, requireCsrf } from '../auth/routes.js';
import { InputError } from '../members/validation.js';
import { requiredId } from '../teams/policy.js';
import { assignPatron } from '../teams/service.js';

export function sportsRouter() {
  const router=express.Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();},authenticated);
  router.get('/',requireRole('ADM','REG','STO','PAT','FIN','MGT'),async (_req,res,next)=>{
    try {
      const result=await getPool().query(`SELECT s.id,s.name,p.user_id AS patron_user_id,u.full_name AS patron_name
        FROM sports s LEFT JOIN sport_patron_assignments p ON p.sport_id=s.id AND p.ended_at IS NULL
        LEFT JOIN users u ON u.id=p.user_id WHERE s.is_active=true ORDER BY s.name`);
      res.json({data:result.rows.map(s=>({id:String(s.id),name:s.name,
        patronUserId:s.patron_user_id?String(s.patron_user_id):null,patronName:s.patron_name}))});
    } catch(error){next(error);}
  });
  router.get('/patron-candidates',requireRole('ADM','MGT'),async(_req,res,next)=>{
    try {const result=await getPool().query(`SELECT u.id,u.full_name FROM users u
      JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
      WHERE u.is_active=true AND r.code='PAT' ORDER BY u.full_name LIMIT 100`);
      res.json({data:result.rows.map(u=>({id:String(u.id),fullName:u.full_name}))});}
    catch(e){next(e);}
  });
  router.post('/:id/patron-assignments',requireRole('ADM','MGT'),requireSameOrigin,requireCsrf,async(req,res,next)=>{
    try{
      const data=await assignPatron(getPool(),{actorId:req.staff.user_id,sportId:requiredId(req.params.id,'sportId'),patronUserId:req.body?.patronUserId});
      res.status(data.unchanged?200:201).json({data});
    }catch(e){if(e instanceof InputError)return res.status(e.code==='NOT_FOUND'?404:422)
      .json({error:{code:e.code,message:e.message}});if(e.code==='23505')return res.status(409).json({error:{code:'PATRON_CONFLICT',message:'The patron assignment changed. Refresh.'}});next(e);}
  });
  return router;
}
