import express from 'express';
import { getPool } from '../db/pool.js';
import { authenticated, requireRole, requireCsrf, requireSameOrigin } from '../auth/routes.js';
import { InputError,validateOrganization } from '../members/validation.js';
export function organizationsRouter(){
  const router=express.Router();
  router.use(authenticated,requireRole('ADM','REG'));
  router.get('/',async(req,res,next)=>{
    try{
      const records=await getPool().query('SELECT id,name,type FROM organizations ORDER BY name LIMIT 200');
      res.json({data:records.rows});
    }catch(error){next(error);}
  });
  router.post('/',requireSameOrigin,requireCsrf,async(req,res,next)=>{
    try{
      const {name,type}=validateOrganization(req.body);
      const record=await getPool().query('INSERT INTO organizations(name,type) VALUES($1,$2) RETURNING id,name,type',[name,type]);
      res.status(201).json({data:record.rows[0]});
    }catch(error){
      if(error instanceof InputError) return res.status(422).json({error:{code:error.code,message:error.message}});
      if(error?.code==='23505') return res.status(409).json({error:{code:'ORGANIZATION_EXISTS',message:'Organization already exists for this type.'}});
      next(error);
    }
  });
  return router;
}
