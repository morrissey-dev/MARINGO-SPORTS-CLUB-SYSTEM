import express from 'express';
import { authenticated,requireRole } from '../auth/routes.js';
import { getPool } from '../db/pool.js';
import { InputError } from '../members/validation.js';
import { getReport } from './service.js';
import { REPORT_ROLES } from './policy.js';

export function reportsRouter({pool=getPool, report=getReport}={}) {
  const router=express.Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();},authenticated);
  for(const [kind,roles] of Object.entries(REPORT_ROLES)) {
    router.get(`/${kind}`,requireRole(...roles),async(req,res,next)=>{
      try {res.json({data:await report(pool(),kind,req.query)});}
      catch(error){next(error);}
    });
  }
  router.use((err,_req,res,next)=>{
    if(err instanceof InputError) return res.status(422).json({error:{code:err.code,message:err.message}});
    next(err);
  });
  return router;
}
