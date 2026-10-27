import express from 'express';
import { getPool } from '../db/pool.js';
import { verifyPassword, digest, makeToken, deriveCsrf, safeMatchHex } from './crypto.js';
import { normalizeEmail, rolesMayAccess } from './policy.js';

const SESSION_HOURS=8;
const COOKIE='mscms_session';
const MAX_ATTEMPTS=5;
const WINDOW_MS=15*60*1000;
const attempts=new Map(); // MVP single-process throttle. Replace with shared store for multi-instance deployment.

function cookieToken(req) {
  const raw=req.headers.cookie ?? '';
  const found=raw.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${COOKIE}=`));
  const token=found?.slice(COOKIE.length+1);
  return /^[a-f0-9]{64}$/.test(token??'') ? token : null;
}
function makeCookie(token) {
  return `${COOKIE}=${token}; HttpOnly; Path=/api/v1; SameSite=Strict; Max-Age=${SESSION_HOURS*3600}${process.env.NODE_ENV==='production'?'; Secure':''}`;
}
function clearCookie(){
  return `${COOKIE}=; HttpOnly; Path=/api/v1; SameSite=Strict; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`;
}
function respondError(res,code,message,status=400){return res.status(status).json({error:{code,message}});}
export function requireSameOrigin(req,res,next) {
  const expected=process.env.APP_ORIGIN;
  if (!expected || req.get('origin')!==expected) return respondError(res,'BAD_ORIGIN','Request must come from this application.',403);
  next();
}
function blocked(key) {
  const now=Date.now();
  const attempt=attempts.get(key);
  if (!attempt || now > attempt.expires) { attempts.delete(key); return false; }
  return attempt.count>=MAX_ATTEMPTS;
}
function failed(key) {
  const now=Date.now();
  const record=attempts.get(key);
  if (!record || now>record.expires) attempts.set(key,{count:1,expires:now+WINDOW_MS});
  else record.count++;
  if (attempts.size>2000) {
    for (const [k,v] of attempts) if (now>v.expires) attempts.delete(k);
    if (attempts.size>2000) attempts.delete(attempts.keys().next().value);
  }
}
export async function authenticated(req,res,next) {
  try {
    const token=cookieToken(req);
    if (!token) return respondError(res,'UNAUTHENTICATED','Sign in required.',401);
    const data=await getPool().query(`SELECT s.user_id, u.full_name, u.email,
      COALESCE(array_agg(r.code) FILTER (WHERE r.code IS NOT NULL), ARRAY[]::varchar[]) AS roles
      FROM staff_sessions s JOIN users u ON u.id=s.user_id
      LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
      WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.is_active
      GROUP BY s.user_id,u.full_name,u.email`,[digest(token)]);
    if (!data.rowCount) return respondError(res,'UNAUTHENTICATED','Session expired. Sign in again.',401);
    req.staff={...data.rows[0],csrf:deriveCsrf(token,process.env.CSRF_SECRET),tokenHash:digest(token)};
    next();
  } catch(error){ next(error); }
}
export function requireRole(...allowed) {
  return (req,res,next) => rolesMayAccess(req.staff?.roles,allowed)
    ? next() : respondError(res,'FORBIDDEN','You are not authorized for this action.',403);
}
export function requireCsrf(req,res,next) {
  const actual=req.get('X-CSRF-Token');
  if (!safeMatchHex(actual,req.staff.csrf)) return respondError(res,'CSRF_REQUIRED','Refresh the page and try again.',403);
  next();
}
export function authRouter() {
  const router=express.Router();
  router.post('/login',requireSameOrigin,async (req,res,next)=>{
    const email=normalizeEmail(req.body?.email);
    const password=req.body?.password;
    if (!email || typeof password!=='string' || password.length>256) return respondError(res,'INVALID_LOGIN','Email or password is invalid.',401);
    const limitKey=`${req.ip}:${email}`;
    if (blocked(limitKey)) return respondError(res,'TOO_MANY_ATTEMPTS','Too many attempts. Try again later.',429);
    try {
      const pool=getPool();
      const user=await pool.query('SELECT id,full_name,email,password_hash FROM users WHERE lower(email)=$1 AND is_active=true',[email]);
      if (!user.rowCount || !(await verifyPassword(password,user.rows[0].password_hash))) {
        failed(limitKey);
        return respondError(res,'INVALID_LOGIN','Email or password is invalid.',401);
      }
      const token=makeToken();
      await pool.query("INSERT INTO staff_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now() + interval '8 hours')",[user.rows[0].id,digest(token)]);
      const roles=await pool.query('SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1',[user.rows[0].id]);
      attempts.delete(limitKey);
      res.setHeader('Set-Cookie',makeCookie(token));
      return res.json({data:{id:user.rows[0].id,fullName:user.rows[0].full_name,email:user.rows[0].email,roles:roles.rows.map(r=>r.code),csrfToken:deriveCsrf(token,process.env.CSRF_SECRET)}});
    } catch(error) { next(error); }
  });
  router.get('/me',authenticated,(req,res)=>res.json({data:{id:req.staff.user_id,fullName:req.staff.full_name,email:req.staff.email,roles:req.staff.roles,csrfToken:req.staff.csrf}}));
  router.post('/logout',requireSameOrigin,authenticated,requireCsrf,async(req,res,next)=>{
    try {
      await getPool().query('UPDATE staff_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[req.staff.tokenHash]);
      res.setHeader('Set-Cookie',clearCookie());
      res.status(204).end();
    }catch(error){next(error);}
  });
  return router;
}
