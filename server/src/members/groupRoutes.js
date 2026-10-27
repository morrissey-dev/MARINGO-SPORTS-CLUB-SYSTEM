import express from 'express';
import { getPool } from '../db/pool.js';
import { authenticated,requireRole,requireCsrf,requireSameOrigin } from '../auth/routes.js';
import { registerGroupBatch } from './groupBatch.js';
import { InputError } from './validation.js';
export function groupRegistrationRouter(){
 const router=express.Router();
 router.use(authenticated);
 router.post('/',requireRole('ADM','REG'),requireSameOrigin,requireCsrf,async(req,res,next)=>{
   try {const result=await registerGroupBatch(getPool(),{
     actorId:req.staff.user_id,body:req.body,key:req.get('Idempotency-Key')});
     res.setHeader('Cache-Control','no-store');
     return res.status(result.status).json({data:result.data,replayed:result.replayed});
   } catch(error) {
     if(!(error instanceof InputError)) return next(error);
     const code=error.code==='IDEMPOTENCY_CONFLICT'||error.code==='DUPLICATE_BATCH_MEMBER'||error.code==='POSSIBLE_DUPLICATE'?409:
       error.code==='ORGANIZATION_NOT_FOUND'?404:422;
     return res.status(code).json({error:{code:error.code,message:error.message,fieldErrors:error.fieldErrors||{}}});
   }
 });
 return router;
}
