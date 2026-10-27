import express from 'express';
import { getPool } from '../db/pool.js';
import { authenticated,requireRole,requireSameOrigin,requireCsrf } from '../auth/routes.js';
import { InputError } from '../members/validation.js';
import { createEvent,enrollParticipant,finalizeEvent,removeParticipant,cancelDraftEvent,listEvents,eventSummary } from './service.js';

const handle=fn=>async(req,res,next)=>{
  try{const data=await fn(req);return res.status(data.unchanged?200:201).json({data});}
  catch(e){next(e);}
};
function statusFor(code){
  if(code==='FORBIDDEN')return 403;
  if(['EVENT_NOT_FOUND','TEAM_NOT_FOUND','PARTICIPANT_NOT_FOUND'].includes(code))return 404;
  if(['PARTICIPANT_EXISTS','EVENT_LOCKED','TEAM_INACTIVE','PATRON_REQUIRED','ROSTER_CHANGED'].includes(code))return 409;
  return 422;
}
export function eventsRouter(){
  const router=express.Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();},authenticated);
  router.get('/',requireRole('ADM','MGT','PAT','FIN'),async(req,res,next)=>{
    try{res.json({data:await listEvents(getPool(),{roles:req.staff.roles,actorId:req.staff.user_id})});}
    catch(e){next(e);}
  });
  router.get('/:id/facilitation-summary',requireRole('ADM','MGT','PAT','FIN'),async(req,res,next)=>{
    try{res.json({data:await eventSummary(getPool(),{roles:req.staff.roles,actorId:req.staff.user_id,eventId:req.params.id})});}
    catch(e){next(e);}
  });
  const staff=req=>({actorId:req.staff.user_id,roles:req.staff.roles});
  router.post('/',requireRole('ADM','PAT'),requireSameOrigin,requireCsrf,
    handle(req=>createEvent(getPool(),{...staff(req),body:req.body})));
  router.post('/:id/participants',requireRole('ADM','PAT'),requireSameOrigin,requireCsrf,
    handle(req=>enrollParticipant(getPool(),{...staff(req),eventId:req.params.id,memberId:req.body?.memberId})));
  router.delete('/:id/participants/:memberId',requireRole('ADM','PAT'),requireSameOrigin,requireCsrf,
    handle(req=>removeParticipant(getPool(),{...staff(req),eventId:req.params.id,memberId:req.params.memberId})));
  router.post('/:id/cancel',requireRole('ADM','PAT'),requireSameOrigin,requireCsrf,
    handle(req=>cancelDraftEvent(getPool(),{...staff(req),eventId:req.params.id})));
  router.post('/:id/finalize-roster',requireRole('ADM','PAT'),requireSameOrigin,requireCsrf,
    handle(req=>finalizeEvent(getPool(),{...staff(req),eventId:req.params.id})));
  router.use((err,_req,res,next)=>{
    if(err instanceof InputError)return res.status(statusFor(err.code))
      .json({error:{code:err.code,message:err.message,fieldErrors:err.fieldErrors||{}}});
    if(err.code==='23505')return res.status(409).json({error:{code:'EVENT_CONFLICT',message:'Conflicting event record. Refresh and try again.'}});
    next(err);
  });
  return router;
}
