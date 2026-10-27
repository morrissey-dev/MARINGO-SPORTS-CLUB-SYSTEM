import express from 'express';
import {getPool} from '../db/pool.js';
import {authenticated,requireRole,requireSameOrigin,requireCsrf} from '../auth/routes.js';
import {InputError} from '../members/validation.js';
import {listEquipment,addEquipment,receiveEquipment,requestLoan,issueLoan,returnLoan,approveIncident,listLoans,loanDetails,listIncidents} from './service.js';
const protect=[requireSameOrigin,requireCsrf];
const who=req=>({actorId:req.staff.user_id,roles:req.staff.roles});
const errorStatus=code=>code==='FORBIDDEN'?403:
  ['LOAN_NOT_FOUND','INCIDENT_NOT_FOUND','TEAM_NOT_FOUND','EQUIPMENT_NOT_FOUND'].includes(code)?404:
  ['IDEMPOTENCY_CONFLICT','LOAN_LOCKED','INCIDENT_LOCKED','INSUFFICIENT_EQUIPMENT','OVER_RETURN','CAPTAIN_CHANGED',
  'ISSUED_BALANCE_MISMATCH','SEPARATION_OF_DUTIES','CAPTAIN_NOT_ELIGIBLE','CAPTAIN_REQUIRED','TEAM_INACTIVE','STOCK_OVERFLOW'].includes(code)?409:422;
const execute=(f,status=201)=>async(req,res,next)=>{try{const result=await f(req);res.status(result?.replayed?200:status).json({data:result});}catch(e){next(e);}};
const errorHandler=(err,_req,res,next)=>{
  if(err instanceof InputError)return res.status(errorStatus(err.code)).json({error:{code:err.code,message:err.message,fieldErrors:err.fieldErrors||{}}});
  if(err.code==='23505')return res.status(409).json({error:{code:'EQUIPMENT_CONFLICT',message:'Duplicate equipment code, source reference or transaction. Refresh and check records.'}});
  next(err);
};
export function equipmentRouter(){
  const router=express.Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();},authenticated);
  router.get('/items',requireRole('ADM','MGT','STO','FIN','PAT'),execute(req=>listEquipment(getPool()),200));
  router.get('/loans',requireRole('ADM','MGT','STO','FIN','PAT'),execute(req=>listLoans(getPool(),who(req)),200));
  router.get('/loans/:id',requireRole('ADM','MGT','STO','FIN','PAT'),execute(req=>loanDetails(getPool(),{...who(req),loanId:req.params.id}),200));
  router.get('/incidents',requireRole('ADM','MGT','STO','FIN','PAT'),execute(req=>listIncidents(getPool(),who(req)),200));
  router.post('/items',requireRole('ADM','MGT'),...protect,execute(req=>addEquipment(getPool(),{actorId:req.staff.user_id,body:req.body})));
  router.post('/stock-receipts',requireRole('ADM','STO'),...protect,execute(req=>receiveEquipment(getPool(),{actorId:req.staff.user_id,body:req.body,key:req.get('Idempotency-Key')})));
  router.post('/loans',requireRole('ADM','MGT','PAT'),...protect,execute(req=>requestLoan(getPool(),{...who(req),body:req.body,key:req.get('Idempotency-Key')})));
  router.post('/loans/:id/issue',requireRole('ADM','STO'),...protect,execute(req=>issueLoan(getPool(),{actorId:req.staff.user_id,loanId:req.params.id})));
  router.post('/loans/:id/returns',requireRole('ADM','STO'),...protect,execute(req=>returnLoan(getPool(),{actorId:req.staff.user_id,loanId:req.params.id,body:req.body,key:req.get('Idempotency-Key')})));
  router.post('/incidents/:id/confirm',requireRole('ADM','MGT'),...protect,execute(req=>approveIncident(getPool(),{actorId:req.staff.user_id,incidentId:req.params.id,body:req.body})));
  router.use(errorHandler);
  return router;
}
