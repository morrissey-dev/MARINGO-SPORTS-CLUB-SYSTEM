import express from 'express';
import { getPool } from '../db/pool.js';
import { authenticated, requireRole, requireCsrf, requireSameOrigin } from '../auth/routes.js';
import { parseId, InputError } from '../members/validation.js';
import { recordPayment, verifyPayment, reversePayment } from './service.js';

function bad(res,error){
  const notFound=['PAYMENT_NOT_FOUND','CHARGE_NOT_FOUND'].includes(error.code);
  const conflict=['IDEMPOTENCY_CONFLICT','CHARGE_ALREADY_PAID','CHARGE_VOID','OVERPAYMENT',
    'MAKER_CHECKER_REQUIRED','PAYMENT_NOT_PENDING','PAYMENT_NOT_VERIFIED'].includes(error.code);
  return res.status(notFound?404:conflict?409:422).json({error:{code:error.code,message:error.message}});
}

export function paymentsRouter(){
  const router=express.Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();},authenticated);
  // Summary of membership charges, filtered for a responsible staff user.
  router.get('/charges',requireRole('ADM','REG','FIN','MGT'),async(req,res,next)=>{
    try{
      const search=String(req.query.search||'').trim().slice(0,80);
      const result=await getPool().query(`SELECT c.id AS charge_id,c.amount,c.status AS charge_status,m.id AS member_id,
        m.membership_number,m.full_name,m.status AS member_status,ms.registration_type,
        COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id
          WHERE a.charge_id=c.id AND p.status='verified'),0)::text AS verified_amount
        FROM charges c JOIN membership_charges mc ON mc.charge_id=c.id
        JOIN memberships ms ON ms.id=mc.membership_id JOIN members m ON m.id=c.member_id
        WHERE ($1::text='' OR m.membership_number ILIKE '%'||$1||'%' OR m.full_name ILIKE '%'||$1||'%')
        ORDER BY c.id DESC LIMIT 40`,[search]);
      return res.json({data:result.rows.map(x=>({chargeId:String(x.charge_id),memberId:String(x.member_id),
        membershipNumber:x.membership_number,fullName:x.full_name,memberStatus:x.member_status,
        registrationType:x.registration_type,amount:x.amount,verifiedAmount:x.verified_amount,chargeStatus:x.charge_status}))});
    }catch(e){next(e);}
  });
  router.get('/members/:memberId/summary',requireRole('ADM','REG','FIN','MGT'),async(req,res,next)=>{
    const memberId=parseId(req.params.memberId);
    if(!memberId)return res.status(404).json({error:{code:'NOT_FOUND',message:'Member not found.'}});
    try{
      const result=await getPool().query(`SELECT c.id,c.amount,c.status,m.membership_number,m.status AS member_status,
        COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id
        WHERE a.charge_id=c.id AND p.status='verified'),0)::text AS collected
        FROM members m JOIN charges c ON c.member_id=m.id JOIN membership_charges mc ON mc.charge_id=c.id
        WHERE m.id=$1 ORDER BY c.id DESC LIMIT 20`,[memberId]);
      if(!result.rowCount) return res.status(404).json({error:{code:'NOT_FOUND',message:'Member or membership charge not found.'}});
      return res.json({data:result.rows.map(x=>({chargeId:String(x.id),membershipNumber:x.membership_number,
        amount:x.amount,collected:x.collected,chargeStatus:x.status,memberStatus:x.member_status}))});
    }catch(e){next(e);}
  });
  router.get('/',requireRole('ADM','FIN','MGT'),async(req,res,next)=>{
    try{
      const status=['pending','verified','reversed','rejected'].includes(req.query.status)?req.query.status:'pending';
      const result=await getPool().query(`SELECT p.id,p.charge_id,p.amount,p.status,p.method,p.transfer_reference,
        p.recorded_at,p.recorded_by_user_id,m.membership_number,m.full_name
        FROM payments p JOIN charges c ON c.id=p.charge_id JOIN members m ON m.id=c.member_id
        WHERE p.status=$1 ORDER BY p.id DESC LIMIT 40`,[status]);
      return res.json({data:result.rows.map(p=>({id:String(p.id),chargeId:String(p.charge_id),
        amount:p.amount,status:p.status,method:p.method,reference:p.transfer_reference,
        recordedAt:p.recorded_at,recordedByUserId:String(p.recorded_by_user_id),
        membershipNumber:p.membership_number,fullName:p.full_name}))});
    }catch(e){next(e);}
  });
  router.post('/',requireRole('ADM','REG','FIN'),requireSameOrigin,requireCsrf,async(req,res,next)=>{
    try{
      const result=await recordPayment(getPool(),{actorId:req.staff.user_id,body:req.body,key:req.get('Idempotency-Key')});
      return res.status(result.status).json({data:result.data,replayed:result.replayed});
    }catch(e){if(e instanceof InputError)return bad(res,e);
      if(e.code==='23505')return res.status(409).json({error:{code:'DUPLICATE_REFERENCE',message:'Mobile-money reference already recorded. Search payments instead.'}});
      next(e);}
  });
  router.post('/:id/verify',requireRole('ADM','FIN','MGT'),requireSameOrigin,requireCsrf,async(req,res,next)=>{
    const id=parseId(req.params.id);
    if(!id)return res.status(404).json({error:{code:'NOT_FOUND',message:'Payment not found.'}});
    try{const result=await verifyPayment(getPool(),{actorId:req.staff.user_id,paymentId:id,evidenceReference:req.body?.evidenceReference});
      return res.json({data:result});}catch(e){if(e instanceof InputError)return bad(res,e);next(e);}
  });
  router.post('/:id/reverse',requireRole('ADM','FIN','MGT'),requireSameOrigin,requireCsrf,async(req,res,next)=>{
    const id=parseId(req.params.id);
    if(!id)return res.status(404).json({error:{code:'NOT_FOUND',message:'Payment not found.'}});
    try{const result=await reversePayment(getPool(),{actorId:req.staff.user_id,paymentId:id,reason:req.body?.reason});
      return res.json({data:result});}catch(e){if(e instanceof InputError)return bad(res,e);next(e);}
  });
  return router;
}
