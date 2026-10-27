import { createHash } from 'node:crypto';
import { InputError } from '../members/validation.js';
import { centsToMoney,moneyToCents } from '../payments/policy.js';
import { stableJson,idempotencyKey } from '../members/registration.js';
import { positiveId,quantity,validateItem,validateReceipt,validateSale,validateBuyer,calculateSale,lowStock,validateTender,validateVerificationEvidence } from './policy.js';

const fail=(code,message)=>new InputError(code,message);
const sha=v=>createHash('sha256').update(v).digest('hex');
async function transaction(pool,operation){
  const db=await pool.connect();
  try{await db.query('BEGIN');const value=await operation(db);await db.query('COMMIT');return value;}
  catch(err){await db.query('ROLLBACK');throw err;}
  finally{db.release();}
}
async function audit(db,actorId,action,entityType,id,metadata={}){
  await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata_summary)
    VALUES($1,$2,$3,$4,$5)`,[actorId,action,entityType,String(id),JSON.stringify(metadata)]);
}
async function idempotent(db,{actorId,operation,key,body},callback){
  const hash=idempotencyKey(key),payload=sha(stableJson(body));
  await db.query(`INSERT INTO idempotency_requests(actor_user_id,operation,key_hash,payload_hash)
    VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[actorId,operation,hash,payload]);
  const prev=await db.query(`SELECT payload_hash,response_json,response_status FROM idempotency_requests
    WHERE actor_user_id=$1 AND operation=$2 AND key_hash=$3 FOR UPDATE`,[actorId,operation,hash]);
  if(prev.rows[0].payload_hash!==payload)throw fail('IDEMPOTENCY_CONFLICT','This request key was used with different details.');
  if(prev.rows[0].response_status) return {...prev.rows[0].response_json,replayed:true};
  const result=await callback();
  await db.query(`UPDATE idempotency_requests SET response_json=$4,response_status=201
    WHERE actor_user_id=$1 AND operation=$2 AND key_hash=$3`,[actorId,operation,hash,JSON.stringify(result)]);
  return result;
}
const mappedItem=r=>({id:String(r.id),sku:r.sku,name:r.name,variant:r.variant,unitPrice:r.unit_price,
  maxStockLevel:Number(r.max_stock_level),availableQty:Number(r.available_qty),active:r.active,
  reorder:lowStock(Number(r.available_qty),Number(r.max_stock_level))});
export async function listItems(pool,{reorderOnly=false}={}){
  const result=await pool.query(`SELECT i.id,i.sku,i.name,i.variant,i.unit_price,i.max_stock_level,i.active,
    b.available_qty FROM store_items i JOIN store_inventory b ON b.item_id=i.id
    WHERE ($1::boolean=false OR b.available_qty*5<=i.max_stock_level)
    ORDER BY i.name,i.sku LIMIT 300`,[reorderOnly]);
  return result.rows.map(mappedItem);
}
export async function createItem(pool,{actorId,body}){
  const item=validateItem(body);
  return transaction(pool,async db=>{
    const created=await db.query(`INSERT INTO store_items(sku,name,variant,unit_price,max_stock_level,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[item.sku,item.name,item.variant,item.unitPrice,item.maxStockLevel,actorId]);
    const id=String(created.rows[0].id);
    await db.query('INSERT INTO store_inventory(item_id) VALUES($1)',[id]);
    await audit(db,actorId,'store.item.create','store_item',id,{sku:item.sku});
    return {id,...item,availableQty:0,active:true,reorder:true};
  });
}
export async function updateItem(pool,{actorId,itemId,body}){
  const id=positiveId(itemId,'item');
  if(!body||typeof body!=='object'||Array.isArray(body))throw fail('INVALID_ITEM','Item details required.');
  const price=body.unitPrice===undefined?null:centsToMoney(moneyToCents(body.unitPrice));
  const maximum=body.maxStockLevel===undefined?null:quantity(body.maxStockLevel,1000000);
  if(price===null && maximum===null && body.active===undefined)throw fail('INVALID_ITEM','Specify a price, stock benchmark or active status.');
  if(body.active!==undefined && typeof body.active!=='boolean')throw fail('INVALID_ITEM','Active must be true or false.');
  return transaction(pool,async db=>{
    const existing=await db.query('SELECT id,name,variant,unit_price,max_stock_level,active FROM store_items WHERE id=$1 FOR UPDATE',[id]);
    if(!existing.rowCount)throw fail('ITEM_NOT_FOUND','Item not found.');
    const item=existing.rows[0];
    const finalPrice=price??item.unit_price;
    if(item.name.toLowerCase()==='sports shoes'&&(moneyToCents(String(finalPrice))<100000||moneyToCents(String(finalPrice))>400000))
      throw fail('INVALID_SHOE_VARIANT','Sports shoes price must be KSh 1,000.00–4,000.00.');
    await db.query(`UPDATE store_items SET unit_price=COALESCE($2,unit_price),
      max_stock_level=COALESCE($3,max_stock_level),active=COALESCE($4,active) WHERE id=$1`,
      [id,price,maximum,body.active??null]);
    await audit(db,actorId,'store.item.update','store_item',id,{newPrice:price,newMax:maximum,active:body.active??null});
    return {id,updated:true};
  });
}
export async function receiveStock(pool,{actorId,body,key}){
  const input=validateReceipt(body);
  return transaction(pool,db=>idempotent(db,{actorId,operation:'store.receipt',key,body:input},async()=>{
    const item=await db.query(`SELECT i.id,i.active FROM store_items i WHERE i.id=$1`,[input.itemId]);
    if(!item.rowCount||!item.rows[0].active)throw fail('ITEM_NOT_FOUND','Item missing or inactive.');
    // Lock inventory in the same order that checkout locks it.
    const balance=await db.query('SELECT available_qty FROM store_inventory WHERE item_id=$1 FOR UPDATE',[input.itemId]);
    if(!balance.rowCount)throw fail('INVENTORY_NOT_FOUND','Inventory row is missing.');
    const current=Number(balance.rows[0].available_qty);
    if(!Number.isSafeInteger(current+input.quantity) || current+input.quantity>2147483647)throw fail('STOCK_OVERFLOW','Stock quantity would overflow.');
    const receipt=await db.query(`INSERT INTO stock_receipts(item_id,quantity,source_reference,received_by_user_id,actor_key_hash)
      VALUES($1,$2,$3,$4,$5) RETURNING id`,[input.itemId,input.quantity,input.sourceReference,actorId,sha(`${actorId}:${key}`)]);
    const id=String(receipt.rows[0].id);
    await db.query('UPDATE store_inventory SET available_qty=available_qty+$2,updated_at=now() WHERE item_id=$1',[input.itemId,input.quantity]);
    await db.query(`INSERT INTO store_stock_movements(item_id,quantity_delta,movement_type,stock_receipt_id,created_by_user_id)
      VALUES($1,$2,'receipt',$3,$4)`,[input.itemId,input.quantity,id,actorId]);
    await audit(db,actorId,'store.stock.receive','stock_receipt',id,{itemId:input.itemId,quantity:input.quantity});
    return {id,itemId:input.itemId,quantity:input.quantity,availableQty:current+input.quantity};
  }));
}
export async function createSale(pool,{actorId,body,key}){
  const lines=validateSale(body);
  const buyerMemberNumber=validateBuyer(body?.buyerMemberNumber);
  return transaction(pool,db=>idempotent(db,{actorId,operation:'sale.create',key,body:{lines,buyerMemberNumber}},async()=>{
    const ids=lines.map(x=>x.itemId);
    const products=await db.query(`SELECT id,sku,name,unit_price,active FROM store_items WHERE id=ANY($1::bigint[])`,[ids]);
    if(products.rowCount!==lines.length || products.rows.some(x=>!x.active))throw fail('ITEM_NOT_FOUND','Some selected products are unavailable.');
    const lookup=new Map(products.rows.map(p=>[String(p.id),p]));
    const details=lines.map(l=>{const p=lookup.get(l.itemId);return {itemId:l.itemId,qty:l.qty,
      sku:p.sku,name:p.name,unitPrice:String(p.unit_price)};});
    const totals=calculateSale(details);
    let buyerId=null;
    if(buyerMemberNumber){
      const buyer=await db.query('SELECT id FROM members WHERE membership_number=$1',[buyerMemberNumber]);
      if(!buyer.rowCount)throw fail('BUYER_NOT_FOUND','Member number not found.');
      buyerId=String(buyer.rows[0].id);
    }
    const inserted=await db.query(`INSERT INTO store_sales(created_by_user_id,buyer_member_id,subtotal,discount,total)
      VALUES($1,$2,$3,$4,$5) RETURNING id`,[actorId,buyerId,totals.subtotal,totals.discount,totals.total]);
    const id=String(inserted.rows[0].id);
    for(const line of details){
      await db.query(`INSERT INTO store_sale_lines(sale_id,item_id,sku_snapshot,name_snapshot,qty,unit_price_snapshot,line_total)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,line.itemId,line.sku,line.name,line.qty,line.unitPrice,
          centsToMoney(moneyToCents(line.unitPrice)*line.qty)]);
    }
    await audit(db,actorId,'sale.create','store_sale',id,{subtotal:totals.subtotal,discount:totals.discount});
    return {id,status:'draft',buyerMemberNumber,...totals,lines:details};
  }));
}
async function lockSale(db,id){
  const sale=await db.query('SELECT id,status,total,created_by_user_id FROM store_sales WHERE id=$1 FOR UPDATE',[id]);
  if(!sale.rowCount)throw fail('SALE_NOT_FOUND','Sale not found.');
  return sale.rows[0];
}
async function finalizeStock(db,id,actorId){
  const lines=await db.query('SELECT item_id,qty FROM store_sale_lines WHERE sale_id=$1 ORDER BY item_id',[id]);
  if(!lines.rowCount)throw fail('EMPTY_SALE','No sale lines found.');
  // Row locks serialise competing checkouts; use consistent ordering.
  for(const line of lines.rows){
    const stock=await db.query('SELECT available_qty FROM store_inventory WHERE item_id=$1 FOR UPDATE',[line.item_id]);
    if(!stock.rowCount||Number(stock.rows[0].available_qty)<Number(line.qty))
      throw fail('INSUFFICIENT_STOCK',`Not enough stock for item ${line.item_id}. Refresh inventory and resolve the payment if already received.`);
    await db.query(`UPDATE store_inventory SET available_qty=available_qty-$2,updated_at=now()
      WHERE item_id=$1 AND available_qty >= $2`,[line.item_id,line.qty]);
    await db.query(`INSERT INTO store_stock_movements(item_id,quantity_delta,movement_type,sale_id,created_by_user_id)
      VALUES($1,$2,'sale',$3,$4)`,[line.item_id,-Number(line.qty),id,actorId]);
  }
  await db.query("UPDATE store_sales SET status='completed',completed_at=now() WHERE id=$1",[id]);
}
export async function checkoutSale(pool,{actorId,saleId,body,key}){
  const id=positiveId(saleId,'sale');const tender=validateTender(body);
  return transaction(pool,db=>idempotent(db,{actorId,operation:`sale.checkout.${id}`,key,body:tender},async()=>{
    const sale=await lockSale(db,id);
    if(sale.status!=='draft')throw fail('SALE_LOCKED','Sale already submitted, cancelled or completed. Refresh the sale.');
    if(tender.method==='cash'){
      // POS cashier asserts physical cash received; this is not a mobile settlement.
      await db.query(`INSERT INTO store_sale_tenders(sale_id,method,amount,status,recorded_by_user_id,verified_by_user_id,verified_at,verification_evidence)
        VALUES($1,'cash',$2,'verified',$3,$3,now(),'cash-received-by-clerk')`,[id,sale.total,actorId]);
      await finalizeStock(db,id,actorId);
      await audit(db,actorId,'sale.cash.complete','store_sale',id,{amount:String(sale.total)});
      return {id,status:'completed',total:String(sale.total),method:'cash'};
    }
    // Mobile payment recorded, NOT verified by the text of the reference alone.
    await db.query(`INSERT INTO store_sale_tenders(sale_id,method,reference,amount,status,recorded_by_user_id)
      VALUES($1,'mobile_money',$2,$3,'pending',$4)`,[id,tender.reference,sale.total,actorId]);
    await db.query("UPDATE store_sales SET status='pending_mobile' WHERE id=$1",[id]);
    await audit(db,actorId,'sale.mobile.pending','store_sale',id,{method:'mobile_money'});
    return {id,status:'pending_mobile',total:String(sale.total),method:'mobile_money',reference:tender.reference};
  }));
}
export async function verifyMobileSale(pool,{actorId,saleId,body}){
  const id=positiveId(saleId,'sale');
  const evidence=validateVerificationEvidence(body?.evidenceReference);
  return transaction(pool,async db=>{
    const sale=await lockSale(db,id);
    if(sale.status==='completed')throw fail('SALE_LOCKED','Sale already completed; no repeat verification allowed.');
    if(sale.status!=='pending_mobile')throw fail('SALE_NOT_PENDING','Only a pending mobile payment can be verified.');
    const tender=await db.query('SELECT method,status,recorded_by_user_id,amount FROM store_sale_tenders WHERE sale_id=$1 FOR UPDATE',[id]);
    if(!tender.rowCount||tender.rows[0].method!=='mobile_money'||tender.rows[0].status!=='pending')
      throw fail('SALE_NOT_PENDING','Pending mobile tender not found.');
    if(String(tender.rows[0].recorded_by_user_id)===String(actorId))
      throw fail('SEPARATION_OF_DUTIES','A different authorized reviewer must verify the mobile-money payment.');
    // Stock verification is within this same transaction. If stock is now unavailable,
    // preserve the pending record for manual reconciliation/refund instead of fictitious completion.
    await finalizeStock(db,id,actorId);
    await db.query(`UPDATE store_sale_tenders SET status='verified',verified_by_user_id=$2,
      verified_at=now(),verification_evidence=$3 WHERE sale_id=$1`,[id,actorId,evidence]);
    await audit(db,actorId,'sale.mobile.verified','store_sale',id,{verified:true});
    return {id,status:'completed',method:'mobile_money',total:String(sale.total)};
  });
}
export async function cancelDraftSale(pool,{actorId,saleId}){
  const id=positiveId(saleId,'sale');
  return transaction(pool,async db=>{
    const sale=await lockSale(db,id);
    if(sale.status!=='draft')throw fail('SALE_LOCKED','Only an unpaid draft may be cancelled.');
    await db.query("UPDATE store_sales SET status='cancelled' WHERE id=$1",[id]);
    await audit(db,actorId,'sale.draft.cancel','store_sale',id);
    return {id,status:'cancelled'};
  });
}
export async function listSales(pool){
  const r=await pool.query(`SELECT s.id,s.status,s.subtotal,s.discount,s.total,s.created_at,s.completed_at,
    t.method,t.reference,t.status AS payment_status FROM store_sales s
    LEFT JOIN store_sale_tenders t ON t.sale_id=s.id
    LEFT JOIN members m ON m.id=s.buyer_member_id ORDER BY s.id DESC LIMIT 80`);
  return r.rows.map(x=>({id:String(x.id),status:x.status,subtotal:x.subtotal,discount:x.discount,
    total:x.total,buyerMemberNumber:x.buyer_member_number,createdAt:x.created_at,completedAt:x.completed_at,method:x.method,
    reference:x.reference,paymentStatus:x.payment_status}));
}
export async function getSale(pool,id){
  const saleId=positiveId(id,'sale');
  const sale=await pool.query(`SELECT s.*,t.method,t.reference,t.status AS payment_status
    FROM store_sales s LEFT JOIN store_sale_tenders t ON t.sale_id=s.id WHERE s.id=$1`,[saleId]);
  if(!sale.rowCount)throw fail('SALE_NOT_FOUND','Sale not found.');
  const lines=await pool.query(`SELECT item_id,sku_snapshot,name_snapshot,qty,unit_price_snapshot,line_total
    FROM store_sale_lines WHERE sale_id=$1 ORDER BY id`,[saleId]);
  const s=sale.rows[0];
  return {id:saleId,status:s.status,subtotal:s.subtotal,discount:s.discount,total:s.total,
    method:s.method,paymentStatus:s.payment_status,reference:s.reference,
    lines:lines.rows.map(l=>({itemId:String(l.item_id),sku:l.sku_snapshot,name:l.name_snapshot,
      quantity:l.qty,unitPrice:l.unit_price_snapshot,lineTotal:l.line_total}))};
}
