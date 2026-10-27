import {createHash} from 'node:crypto';
import {InputError} from '../members/validation.js';
import {idempotencyKey,stableJson} from '../members/registration.js';
import {positiveId} from './policy.js';
import {validateReturnRequest,validateReturnDecision,proratedRefundDue} from './returns-policy.js';
const fail=(code,message)=>new InputError(code,message);
async function transaction(pool,fn){const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}catch(err){await db.query('ROLLBACK');throw err;}finally{db.release();}}
async function audit(db,actorId,action,returnId,data={}){
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata_summary)
  VALUES($1,$2,'store_return',$3,$4)`,[actorId,action,String(returnId),JSON.stringify(data)]);
}
export async function createStoreReturn(pool,{actorId,saleId,body,key}){
  const id=positiveId(saleId,'sale');const input=validateReturnRequest(body);
  const keyHash=createHash('sha256').update(String(actorId)+':'+idempotencyKey(key)).digest('hex');
  const payloadHash=createHash('sha256').update(stableJson({saleId:id,...input})).digest('hex');
  return transaction(pool,async db=>{
    const sale=await db.query(`SELECT id,status FROM store_sales WHERE id=$1 FOR UPDATE`,[id]);
    if(!sale.rowCount)throw fail('SALE_NOT_FOUND','Sale not found.');
    if(sale.rows[0].status!=='completed')throw fail('SALE_NOT_COMPLETED','Only completed sales accept physical returns.');
    const old=await db.query('SELECT id,status,request_payload_hash FROM store_returns WHERE request_key_hash=$1',[keyHash]);
    if(old.rowCount){
      if(old.rows[0].request_payload_hash!==payloadHash)throw fail('IDEMPOTENCY_CONFLICT','This return request key was already used with different details.');
      return {id:String(old.rows[0].id),saleId:id,status:old.rows[0].status,replayed:true};
    }
    const pending=await db.query(`SELECT id FROM store_returns WHERE sale_id=$1 AND status='pending_review'`,[id]);
    if(pending.rowCount)throw fail('RETURN_ALREADY_PENDING','Review the previous return request for this sale first.');
    const sold=await db.query(`SELECT id,qty FROM store_sale_lines WHERE sale_id=$1`,[id]);
    const soldMap=new Map(sold.rows.map(l=>[String(l.id),Number(l.qty)]));
    const used=await db.query(`SELECT l.sale_line_id,COALESCE(SUM(l.quantity),0)::int AS quantity
      FROM store_return_lines l JOIN store_returns r ON r.id=l.return_id
      WHERE r.sale_id=$1 AND r.status='accepted' GROUP BY l.sale_line_id`,[id]);
    const usedMap=new Map(used.rows.map(l=>[String(l.sale_line_id),Number(l.quantity)]));
    for(const line of input.lines){
      const original=soldMap.get(line.saleLineId);
      if(original===undefined)throw fail('RETURN_LINE_NOT_IN_SALE','Only items from this sale can be returned.');
      if(line.quantity>original-(usedMap.get(line.saleLineId)||0))throw fail('RETURN_EXCEEDS_SOLD','Already returned or exceeds quantity originally sold.');
    }
    const created=await db.query(`INSERT INTO store_returns(sale_id,received_by_user_id,reason,request_key_hash,request_payload_hash)
      VALUES($1,$2,$3,$4,$5) RETURNING id`,[id,actorId,input.reason,keyHash,payloadHash]);
    const returnId=String(created.rows[0].id);
    for(const line of input.lines)await db.query(`INSERT INTO store_return_lines(return_id,sale_line_id,quantity)
      VALUES($1,$2,$3)`,[returnId,line.saleLineId,line.quantity]);
    await audit(db,actorId,'store.return.request',returnId,{saleId:id});
    return {id:returnId,saleId:id,status:'pending_review',lines:input.lines,refundStatus:'not_processed'};
  });
}
export async function reviewStoreReturn(pool,{actorId,returnId,body}){
  const id=positiveId(returnId,'return');
  return transaction(pool,async db=>{
    // Read sale id, then lock sale before return for a consistent order with create.
    const pointer=await db.query('SELECT sale_id FROM store_returns WHERE id=$1',[id]);
    if(!pointer.rowCount)throw fail('RETURN_NOT_FOUND','Return request not found.');
    const saleId=String(pointer.rows[0].sale_id);
    const lockedSale=await db.query('SELECT id,status,subtotal,total FROM store_sales WHERE id=$1 FOR UPDATE',[saleId]);
    const record=await db.query('SELECT * FROM store_returns WHERE id=$1 FOR UPDATE',[id]);
    if(record.rows[0].status!=='pending_review')throw fail('RETURN_ALREADY_REVIEWED','This return was already reviewed.');
    if(lockedSale.rows[0].status!=='completed')throw fail('SALE_NOT_COMPLETED','Sale must be completed.');
    if(String(record.rows[0].received_by_user_id)===String(actorId))throw fail('SEPARATION_OF_DUTIES','A different authorized officer must review this return.');
    const lines=await db.query(`SELECT l.sale_line_id,l.quantity,s.item_id,s.qty AS sold_qty,s.unit_price_snapshot
      FROM store_return_lines l JOIN store_sale_lines s ON s.id=l.sale_line_id WHERE l.return_id=$1 ORDER BY s.item_id`,[id]);
    const decision=validateReturnDecision(body,lines.rows.map(l=>String(l.sale_line_id)));
    if(decision.decision==='reject'){
      await db.query(`UPDATE store_returns SET status='rejected',reviewed_by_user_id=$2,reviewed_at=now() WHERE id=$1`,[id,actorId]);
      await audit(db,actorId,'store.return.reject',id);
      return {id,saleId,status:'rejected',refundStatus:'not_processed'};
    }
    const summary=await db.query(`SELECT l.sale_line_id,COALESCE(SUM(l.quantity),0)::int AS quantity
      FROM store_return_lines l JOIN store_returns r ON r.id=l.return_id
      WHERE r.sale_id=$1 AND r.status='accepted' GROUP BY l.sale_line_id`,[saleId]);
    const usedMap=new Map(summary.rows.map(l=>[String(l.sale_line_id),Number(l.quantity)]));
    let currentGross=0n;
    const restored=[];
    for(const line of lines.rows){
      const count=Number(line.quantity),sold=Number(line.sold_qty),used=usedMap.get(String(line.sale_line_id))||0;
      if(count>sold-used)throw fail('RETURN_EXCEEDS_SOLD','Quantity already returned to stock; refresh and review again.');
    }
    // Source line totals can be large: do all monetary prorations in bigint cents.
    const saleLines=await db.query('SELECT id,qty,unit_price_snapshot FROM store_sale_lines WHERE sale_id=$1',[saleId]);
    const cents=s=>{const [whole,dec='']=String(s).split('.');return BigInt(whole)*100n+BigInt(dec.padEnd(2,'0'));};
    for(const row of saleLines.rows){
      const used=usedMap.get(String(row.id))||0;
      currentGross+=BigInt(used)*cents(row.unit_price_snapshot);
    }
    const newGross=lines.rows.reduce((sum,l)=>sum+BigInt(l.quantity)*cents(l.unit_price_snapshot),currentGross);
    const money=n=>`${n/100n}.${String(n%100n).padStart(2,'0')}`;
    const prior=await db.query(`SELECT COALESCE(SUM(refund_due),0)::text AS due FROM store_returns WHERE sale_id=$1 AND status='accepted'`,[saleId]);
    const refundDue=proratedRefundDue({saleSubtotal:String(lockedSale.rows[0].subtotal),saleTotal:String(lockedSale.rows[0].total),
      grossReturnedBefore:money(currentGross),grossReturnedAfter:money(newGross),priorRefundDue:prior.rows[0].due});
    const inspect=new Map(decision.conditions.map(c=>[c.saleLineId,c.condition]));
    for(const line of lines.rows){
      const condition=inspect.get(String(line.sale_line_id));
      await db.query('UPDATE store_return_lines SET condition=$2 WHERE return_id=$1 AND sale_line_id=$3',[id,condition,line.sale_line_id]);
      if(condition==='resellable'){
        await db.query('SELECT available_qty FROM store_inventory WHERE item_id=$1 FOR UPDATE',[line.item_id]);
        await db.query('UPDATE store_inventory SET available_qty=available_qty+$2,updated_at=now() WHERE item_id=$1',[line.item_id,line.quantity]);
        await db.query(`INSERT INTO store_stock_movements(item_id,quantity_delta,movement_type,sale_id,return_id,created_by_user_id)
          VALUES($1,$2,'return',$3,$4,$5)`,[line.item_id,line.quantity,saleId,id,actorId]);
        restored.push({itemId:String(line.item_id),quantity:Number(line.quantity)});
      }
    }
    await db.query(`UPDATE store_returns SET status='accepted',reviewed_by_user_id=$2,reviewed_at=now(),refund_due=$3 WHERE id=$1`,[id,actorId,refundDue]);
    await audit(db,actorId,'store.return.accept',id,{saleId,refundDue,restocked:restored});
    return {id,saleId,status:'accepted',refundDue,restocked:restored,refundStatus:'awaiting_separate_payment_processing'};
  });
}
export async function listStoreReturns(pool){
  const r=await pool.query(`SELECT r.id,r.sale_id,r.status,r.reason,r.refund_due,r.created_at,r.reviewed_at,
    u.full_name AS received_by,COUNT(l.id)::int AS lines,f.id AS refund_id,f.status AS refund_status
    FROM store_returns r JOIN users u ON u.id=r.received_by_user_id
    JOIN store_return_lines l ON l.return_id=r.id
    LEFT JOIN store_refunds f ON f.return_id=r.id
    GROUP BY r.id,u.full_name,f.id,f.status ORDER BY r.id DESC LIMIT 80`);
  return r.rows.map(x=>({id:String(x.id),saleId:String(x.sale_id),status:x.status,reason:x.reason,
    refundDue:x.refund_due,refundStatus:x.refund_status || (x.status==='accepted'?'not_requested':'not_eligible'),refundId:x.refund_id?String(x.refund_id):null,
    createdAt:x.created_at,reviewedAt:x.reviewed_at,receivedBy:x.received_by,lines:x.lines}));
}
export async function getStoreReturn(pool,returnId){
  const id=positiveId(returnId,'return');
  const r=await pool.query(`SELECT id,sale_id,status,reason,refund_due,received_by_user_id,reviewed_by_user_id
    FROM store_returns WHERE id=$1`,[id]);
  if(!r.rowCount)throw fail('RETURN_NOT_FOUND','Return request not found.');
  const lines=await pool.query(`SELECT l.sale_line_id,l.quantity,l.condition,s.sku_snapshot,s.name_snapshot
    FROM store_return_lines l JOIN store_sale_lines s ON s.id=l.sale_line_id WHERE l.return_id=$1 ORDER BY l.id`,[id]);
  const row=r.rows[0];return {id,saleId:String(row.sale_id),status:row.status,reason:row.reason,refundDue:row.refund_due,
    receivedByUserId:String(row.received_by_user_id),lines:lines.rows.map(l=>({saleLineId:String(l.sale_line_id),quantity:Number(l.quantity),
      condition:l.condition,sku:l.sku_snapshot,name:l.name_snapshot})),
    refundStatus:row.status==='accepted'?'awaiting_separate_payment_processing':'not_processed'};
}
