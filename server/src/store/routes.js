import express from 'express';
import { getPool } from '../db/pool.js';
import { authenticated,requireRole,requireSameOrigin,requireCsrf } from '../auth/routes.js';
import { InputError } from '../members/validation.js';
import { listItems,createItem,updateItem,receiveStock,createSale,checkoutSale,verifyMobileSale,cancelDraftSale,listSales,getSale } from './service.js';
import {createStoreReturn,reviewStoreReturn,listStoreReturns,getStoreReturn} from './returns-service.js';

const statusFor=code=>{
  if(['ITEM_NOT_FOUND','SALE_NOT_FOUND','INVENTORY_NOT_FOUND','RETURN_NOT_FOUND'].includes(code))return 404;
  if(['SALE_LOCKED','SALE_NOT_PENDING','INSUFFICIENT_STOCK','IDEMPOTENCY_CONFLICT','STOCK_OVERFLOW','SEPARATION_OF_DUTIES','SALE_NOT_COMPLETED','RETURN_ALREADY_PENDING','RETURN_EXCEEDS_SOLD','RETURN_ALREADY_REVIEWED','IDEMPOTENCY_CONFLICT'].includes(code))return 409;
  return 422;
};
const respond=operation=>async(req,res,next)=>{
  try{const data=await operation(req);res.status(data.replayed?200:201).json({data});}
  catch(err){next(err);}
};
const protect=[requireSameOrigin,requireCsrf];
export function storeRouter(){
  const router=express.Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();},authenticated);
  router.get('/items',requireRole('ADM','STO','FIN','MGT'),async(_req,res,next)=>{
    try{res.json({data:await listItems(getPool())});}catch(err){next(err);}
  });
  router.get('/reorder-alerts',requireRole('ADM','STO','MGT'),async(_req,res,next)=>{
    try{res.json({data:await listItems(getPool(),{reorderOnly:true})});}catch(err){next(err);}
  });
  router.get('/stock-movements',requireRole('ADM','STO','MGT','FIN'),async(_req,res,next)=>{
    try{
      const r=await getPool().query(`SELECT m.id,m.item_id,i.sku,m.quantity_delta,m.movement_type,m.created_at,
        m.stock_receipt_id,m.sale_id,m.return_id FROM store_stock_movements m JOIN store_items i ON i.id=m.item_id
        ORDER BY m.id DESC LIMIT 80`);
      res.json({data:r.rows.map(x=>({id:String(x.id),itemId:String(x.item_id),sku:x.sku,
        delta:Number(x.quantity_delta),type:x.movement_type,createdAt:x.created_at,
        receiptId:x.stock_receipt_id?String(x.stock_receipt_id):null,saleId:x.sale_id?String(x.sale_id):null,returnId:x.return_id?String(x.return_id):null}))});
    }catch(err){next(err);}
  });
  router.post('/items',requireRole('ADM','MGT'),...protect,respond(req=>createItem(getPool(),{actorId:req.staff.user_id,body:req.body})));
  router.patch('/items/:id',requireRole('ADM','MGT'),...protect,respond(req=>updateItem(getPool(),{
    actorId:req.staff.user_id,itemId:req.params.id,body:req.body})));
  router.post('/stock-receipts',requireRole('ADM','STO'),...protect,respond(req=>receiveStock(getPool(),{
    actorId:req.staff.user_id,body:req.body,key:req.get('Idempotency-Key')})));
  router.use((err,_req,res,next)=>{
    if(err instanceof InputError)return res.status(statusFor(err.code)).json({error:{code:err.code,message:err.message}});
    if(err.code==='23505')return res.status(409).json({error:{code:'STORE_CONFLICT',message:'This SKU or stock receipt is already recorded.'}});
    next(err);
  });
  return router;
}
export function salesRouter(){
  const router=express.Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();},authenticated);
  router.get('/',requireRole('ADM','STO','FIN','MGT'),async(_req,res,next)=>{
    try{res.json({data:await listSales(getPool())});}catch(err){next(err);}
  });
  router.get('/returns',requireRole('ADM','STO','FIN','MGT'),async(_req,res,next)=>{
    try{res.json({data:await listStoreReturns(getPool())});}catch(err){next(err);}
  });
  router.get('/returns/:id',requireRole('ADM','STO','FIN','MGT'),async(req,res,next)=>{
    try{res.json({data:await getStoreReturn(getPool(),req.params.id)});}catch(err){next(err);}
  });
  router.post('/returns/:id/review',requireRole('ADM','FIN','MGT'),...protect,async(req,res,next)=>{
    try{res.status(200).json({data:await reviewStoreReturn(getPool(),{actorId:req.staff.user_id,returnId:req.params.id,body:req.body})});}
    catch(err){next(err);}
  });
  router.get('/:id',requireRole('ADM','STO','FIN','MGT'),async(req,res,next)=>{
    try{res.json({data:await getSale(getPool(),req.params.id)});}catch(err){next(err);}
  });
  router.post('/',requireRole('ADM','STO'),...protect,respond(req=>createSale(getPool(),{
    actorId:req.staff.user_id,body:req.body,key:req.get('Idempotency-Key')})));
  router.post('/:id/checkout',requireRole('ADM','STO'),...protect,respond(req=>checkoutSale(getPool(),{
    actorId:req.staff.user_id,saleId:req.params.id,body:req.body,key:req.get('Idempotency-Key')})));
  router.post('/:id/verify-mobile',requireRole('ADM','FIN','MGT'),...protect,respond(req=>verifyMobileSale(getPool(),{
    actorId:req.staff.user_id,saleId:req.params.id,body:req.body,key:req.get('Idempotency-Key')})));
  router.post('/:id/returns',requireRole('ADM','STO'),...protect,respond(req=>createStoreReturn(getPool(),{
    actorId:req.staff.user_id,saleId:req.params.id,body:req.body})));
  router.post('/:id/cancel',requireRole('ADM','STO'),...protect,respond(req=>cancelDraftSale(getPool(),{
    actorId:req.staff.user_id,saleId:req.params.id})));
  router.use((err,_req,res,next)=>{
    if(err instanceof InputError)return res.status(statusFor(err.code)).json({error:{code:err.code,message:err.message}});
    if(err.code==='23505')return res.status(409).json({error:{code:'SALE_CONFLICT',message:'Duplicate or conflicting sale/return. Refresh and check the existing record.'}});
    next(err);
  });
  return router;
}
