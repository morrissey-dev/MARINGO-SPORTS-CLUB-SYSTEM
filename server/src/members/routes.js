import express from 'express';
import { getPool } from '../db/pool.js';
import { authenticated, requireRole, requireCsrf, requireSameOrigin } from '../auth/routes.js';
import { registerMember } from './registration.js';
import { InputError,parseId } from './validation.js';
import { reconcileCharge } from '../payments/service.js';

const bad=(res,error)=>res.status(error.code==='IDEMPOTENCY_CONFLICT'||error.code==='POSSIBLE_DUPLICATE'?409:
  error.code==='ORGANIZATION_NOT_FOUND'?404:422).json({error:{code:error.code,message:error.message,fieldErrors:error.fieldErrors||{}}});

export function membersRouter(){
  const router=express.Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();},authenticated);
  router.get('/',requireRole('ADM','REG'),async(req,res,next)=>{
    try{
      const page=Math.max(1,Math.min(100000,Number(req.query.page)||1));
      const pageSize=20;
      const search=String(req.query.search||'').trim().slice(0,100);
      const result=await getPool().query(`SELECT m.id,m.membership_number,m.full_name,m.status, m.created_at,
        m.date_of_birth, ms.registration_type, mc.fee_rate_snapshot AS membership_fee,
        c.status AS payment_status
        FROM members m LEFT JOIN LATERAL (
          SELECT * FROM memberships WHERE member_id=m.id ORDER BY id DESC LIMIT 1
        ) ms ON true LEFT JOIN membership_charges mc ON mc.membership_id=ms.id
        LEFT JOIN charges c ON c.id=mc.charge_id
        WHERE ($1::text='' OR m.membership_number ILIKE '%'||$1||'%' OR m.full_name ILIKE '%'||$1||'%')
        ORDER BY m.id DESC LIMIT $2 OFFSET $3`,[search,pageSize,(page-1)*pageSize]);
      return res.json({data:result.rows.map(m=>({id:String(m.id),membershipNumber:m.membership_number,fullName:m.full_name,
        memberStatus:m.status,registrationType:m.registration_type,membershipFee:m.membership_fee,
        paymentStatus:m.payment_status,dateOfBirth:m.date_of_birth})),pagination:{page,pageSize}});
    }catch(error){next(error);}
  });
  router.get('/guardian-consent/pending',requireRole('ADM','MGT'),async(req,res,next)=>{
    try{
      const result=await getPool().query(`SELECT m.id,m.membership_number,m.full_name,g.status
        FROM guardian_consents g JOIN members m ON m.id=g.member_id
        WHERE g.status='pending' ORDER BY g.id ASC LIMIT 50`);
      return res.json({data:result.rows.map(row=>({id:String(row.id),membershipNumber:row.membership_number,
        fullName:row.full_name,guardianConsent:row.status}))});
    }catch(error){next(error);}
  });
  router.get('/:id',requireRole('ADM','REG'),async(req,res,next)=>{
    const id=parseId(req.params.id);if(!id) return res.status(404).json({error:{code:'NOT_FOUND',message:'Member not found.'}});
    try{
      const result=await getPool().query(`SELECT m.id,m.membership_number,m.full_name,m.gender,m.date_of_birth,m.phone,m.sub_county,
         m.school_or_college,m.status, ms.registration_type,ms.organization_id,ms.status AS membership_status,
         mc.fee_rate_snapshot AS membership_fee, c.status AS payment_status
         FROM members m LEFT JOIN LATERAL (
           SELECT * FROM memberships WHERE member_id=m.id ORDER BY id DESC LIMIT 1
         ) ms ON true LEFT JOIN membership_charges mc ON mc.membership_id=ms.id
         LEFT JOIN charges c ON c.id=mc.charge_id WHERE m.id=$1`,[id]);
      if(!result.rowCount) return res.status(404).json({error:{code:'NOT_FOUND',message:'Member not found.'}});
      const prefs=await getPool().query(`SELECT s.id,s.name,sp.priority FROM member_sport_preferences sp
         JOIN sports s ON s.id=sp.sport_id WHERE sp.member_id=$1 ORDER BY sp.priority`,[id]);
      const consent=await getPool().query(`SELECT status FROM guardian_consents WHERE member_id=$1 ORDER BY id DESC LIMIT 1`,[id]);
      const row=result.rows[0];
      return res.json({data:{id:String(row.id),membershipNumber:row.membership_number,fullName:row.full_name,
        gender:row.gender,dateOfBirth:row.date_of_birth,phone:row.phone,subCounty:row.sub_county,
        schoolOrCollege:row.school_or_college,memberStatus:row.status,registrationType:row.registration_type,
        organizationId:row.organization_id,membershipStatus:row.membership_status,membershipFee:row.membership_fee,
        paymentStatus:row.payment_status,guardianConsent:consent.rows[0]?.status||'not_required',sports:prefs.rows}});
    }catch(error){next(error);}
  });
  router.post('/',requireRole('ADM','REG'),requireSameOrigin,requireCsrf,async(req,res,next)=>{
    try {
      const result=await registerMember(getPool(),{actorId:req.staff.user_id,body:req.body,key:req.get('Idempotency-Key')});
      res.setHeader('Cache-Control','no-store');
      res.status(result.status).json({data:result.data,replayed:result.replayed});
    }catch(error){if(error instanceof InputError) return bad(res,error);next(error);}
  });
  // Verification records evidence, but DOES NOT mark membership paid or activate it.
  router.post('/:id/guardian-consent/verify',requireRole('ADM','MGT'),requireSameOrigin,requireCsrf,async(req,res,next)=>{
    const id=parseId(req.params.id);
    const ref=typeof req.body?.evidenceReference==='string'?req.body.evidenceReference.trim():'';
    if(!id) return res.status(404).json({error:{code:'NOT_FOUND',message:'Member not found.'}});
    if(!/^[A-Za-z0-9/_-]{6,100}$/.test(ref)) return res.status(422).json({error:{code:'INVALID_EVIDENCE',message:'Enter a valid non-sensitive evidence reference (6–100 characters).'}});
    const client=await getPool().connect();
    try{
      await client.query('BEGIN');
      // Lock charge before member to match payment verification lock order and avoid a deadlock.
      const linkedCharge=await client.query(`SELECT c.id,c.member_id,c.amount,c.status,mc.membership_id
        FROM charges c JOIN membership_charges mc ON mc.charge_id=c.id
        WHERE c.member_id=$1 AND c.charge_type='membership' ORDER BY c.id DESC LIMIT 1 FOR UPDATE OF c`,[id]);
      const member=await client.query('SELECT id,status FROM members WHERE id=$1 FOR UPDATE',[id]);
      if(!member.rowCount) {await client.query('ROLLBACK');return res.status(404).json({error:{code:'NOT_FOUND',message:'Member not found.'}});}
      const consent=await client.query('SELECT id,status FROM guardian_consents WHERE member_id=$1 ORDER BY id DESC LIMIT 1 FOR UPDATE',[id]);
      if(!consent.rowCount) {await client.query('ROLLBACK');return res.status(422).json({error:{code:'NOT_MINOR',message:'No guardian consent record exists for this member.'}});}
      if(consent.rows[0].status==='verified') {
        await client.query('COMMIT');return res.json({data:{memberId:id,guardianConsent:'verified',memberStatus:member.rows[0].status},replayed:true});
      }
      if(consent.rows[0].status!=='pending') throw new InputError('INVALID_CONSENT','Only pending guardian consent may be verified.');
      await client.query(`UPDATE guardian_consents SET status='verified',verified_at=now(),verified_by_user_id=$2,evidence_reference=$3
        WHERE id=$1`,[consent.rows[0].id,req.staff.user_id,ref]);
      await client.query(`UPDATE members SET status='draft',updated_at=now() WHERE id=$1 AND status='pending_consent'`,[id]);
      const updated=linkedCharge.rowCount?await reconcileCharge(client,linkedCharge.rows[0]):null;
      await client.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata_summary)
        VALUES($1,'guardian_consent.verify','member',$2,$3)`,[req.staff.user_id,id,JSON.stringify({consentId:consent.rows[0].id})]);
      await client.query('COMMIT');
      return res.json({data:{memberId:id,guardianConsent:'verified',memberStatus:updated?.memberStatus||'draft',
        membershipStatus:updated?.membershipStatus||'pending',paymentStatus:updated?.balance==='0.00'?'paid':'outstanding'}});
    }catch(error){await client.query('ROLLBACK');if(error instanceof InputError)return bad(res,error);next(error);}
    finally{client.release();}
  });
  return router;
}
