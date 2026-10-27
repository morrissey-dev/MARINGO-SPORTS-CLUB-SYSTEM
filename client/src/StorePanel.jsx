import { useCallback,useEffect,useState } from 'react';
const fmt=v=>`KSh ${Number(v||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
async function request(path,staff,options={}){
  const response=await fetch(`/api/v1${path}`,{credentials:'same-origin',...options,headers:{
    ...(options.body?{'Content-Type':'application/json','X-CSRF-Token':staff.csrfToken}:{}),...(options.headers||{})}});
  const json=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(json?.error?.message||`Request failed (${response.status}).`);
  return json.data;
}
export default function StorePanel({staff}){
  const canSell=staff.roles.some(r=>['STO','ADM'].includes(r));
  const canManage=staff.roles.some(r=>['ADM','MGT'].includes(r));
  const canReview=staff.roles.some(r=>['ADM','MGT','FIN'].includes(r));
  const [items,setItems]=useState([]),[sales,setSales]=useState([]),[movements,setMovements]=useState([]);
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [sku,setSku]=useState(''),[name,setName]=useState(''),[variant,setVariant]=useState(''),[price,setPrice]=useState(''),[maximum,setMaximum]=useState(100);
  const [stockItem,setStockItem]=useState(''),[receiptQty,setReceiptQty]=useState(1),[source,setSource]=useState('');
  const [buyerMemberNumber,setBuyerMemberNumber]=useState(''),[cart,setCart]=useState([]),[sale,setSale]=useState(null),[method,setMethod]=useState('cash'),[reference,setReference]=useState('');
  const [pendingKey,setPendingKey]=useState(null),[receiptKey,setReceiptKey]=useState(''),[draftKey,setDraftKey]=useState(''),[evidence,setEvidence]=useState({});
  const [editItem,setEditItem]=useState(''),[newPrice,setNewPrice]=useState(''),[newMax,setNewMax]=useState('');
  const refresh=useCallback(async()=>{
    const [all,history,ledger]=await Promise.all([
      request('/store/items',staff),request('/sales',staff),request('/store/stock-movements',staff)]);
    setItems(all);setSales(history);setMovements(ledger);
  },[staff.id]);
  useEffect(()=>{let cancelled=false;refresh().catch(e=>{if(!cancelled)setError(e.message);});return ()=>{cancelled=true;};},[refresh]);
  async function act(operation){
    setBusy(true);setError('');setMessage('');
    try{const result=await operation();await refresh();return result;}
    catch(e){setError(e.message);return null;}
    finally{setBusy(false);}
  }
  const post=(path,body,key)=>request(path,staff,{method:'POST',
    headers:key?{'Idempotency-Key':key}:{},body:JSON.stringify(body)});
  function addToCart(item){
    setDraftKey('');
    if(sale){setError('Finish or cancel the existing draft before starting another sale.');return;}
    setCart(previous=>{
      const current=previous.find(x=>x.itemId===item.id);
      return current?previous.map(x=>x.itemId===item.id?{...x,quantity:Math.min(x.quantity+1,10000)}:x)
        :[...previous,{itemId:item.id,quantity:1,sku:item.sku,name:item.name,unitPrice:item.unitPrice}];
    });
  }
  const draftTotal=cart.reduce((sum,l)=>sum+Math.round(Number(l.unitPrice)*100)*l.quantity,0);
  const discount=draftTotal>1000000?Math.floor((draftTotal*5+50)/100):0;
  const pending=sales.filter(s=>s.status==='pending_mobile');
  return <section className="store-panel" aria-label="Store and inventory">
    <h2>Club store and inventory</h2>
    <p className="helper">Stock receipts are recorded separately from sales. Inventory changes only when cash is received or a different authorized officer verifies a mobile payment.</p>
    {error&&<p role="alert" className="auth-error">{error}</p>}
    {message&&<p role="status" className="success-box">{message}</p>}
    <div className="store-section"><h3>Product catalogue and stock</h3>
      <p className="helper">At or below 20% of the configured stock benchmark, an item needs attention. The initial benchmark is a placeholder, not a confirmed club target.</p>
      <div className="table-scroll"><table><thead><tr><th>Product</th><th>Price</th><th>Available</th><th>Stock benchmark</th><th>Alert</th><th>Action</th></tr></thead><tbody>
        {items.map(item=><tr key={item.id}>
          <td><strong>{item.name}</strong>{item.variant&&<span> — {item.variant}</span>}<small className="payment-small">{item.sku}{!item.active?' (inactive)':''}</small></td>
          <td>{fmt(item.unitPrice)}</td><td>{item.availableQty}</td><td>{item.maxStockLevel}</td>
          <td>{item.reorder?<span className="store-alert">Low stock</span>:'OK'}</td>
          <td>{canSell&&<button type="button" disabled={busy||!item.active} onClick={()=>addToCart(item)}>Add to sale</button>}</td></tr>)}
      </tbody></table></div>
    </div>
    {canManage&&<form className="store-section" onSubmit={e=>{e.preventDefault();act(async()=>{
      const value=await post('/store/items',{sku,name,variant,unitPrice:price,maxStockLevel:Number(maximum)});
      setSku('');setName('');setVariant('');setPrice('');setMessage(`Added product ${value.sku}.`);
    });}}>
      <h3>Add a priced product or variant</h3>
      <p className="helper">The case supplies no single price for sports shoes: create a separate SKU for each priced variant (KSh 1,000–4,000).</p>
      <div className="store-fields">
        <label>SKU<input required value={sku} onChange={e=>setSku(e.target.value)} placeholder="SHOES-42-A" /></label>
        <label>Product name<input required value={name} onChange={e=>setName(e.target.value)} placeholder="Sports shoes" /></label>
        <label>Variant<input value={variant} onChange={e=>setVariant(e.target.value)} placeholder="Size 42, model A" /></label>
        <label>Unit price, KSh<input required inputMode="decimal" pattern="[0-9]+\.[0-9]{2}" value={price} onChange={e=>setPrice(e.target.value)} placeholder="2000.00" /></label>
        <label>Maximum stock benchmark<input required type="number" min="1" max="1000000" value={maximum} onChange={e=>setMaximum(e.target.value)} /></label>
      </div><button type="submit" disabled={busy}>Save product</button>
    </form>}
    {canManage&&<form className="store-section" onSubmit={e=>{e.preventDefault();act(async()=>{
      if(!newMax&&!newPrice)throw new Error('Enter at least one change.');
      await request(`/store/items/${editItem}`,staff,{method:'PATCH',body:JSON.stringify({
        ...(newMax?{maxStockLevel:Number(newMax)}:{}),...(newPrice?{unitPrice:newPrice}:{})})});
      setNewMax('');setNewPrice('');setMessage('Catalogue price/benchmark updated. Historical sales retain earlier prices.');
    });}}>
      <h3>Update current price or stock benchmark</h3>
      <div className="store-fields">
        <label>Product<select required value={editItem} onChange={e=>setEditItem(e.target.value)}><option value="">Choose product</option>{items.map(x=><option key={x.id} value={x.id}>{x.sku} ({fmt(x.unitPrice)}, max {x.maxStockLevel})</option>)}</select></label>
        <label>New price, KSh (optional)<input value={newPrice} pattern="[0-9]+\.[0-9]{2}" onChange={e=>setNewPrice(e.target.value)} placeholder="1250.00" /></label>
        <label>New maximum-stock benchmark (optional)<input type="number" min="1" max="1000000" value={newMax} onChange={e=>setNewMax(e.target.value)} /></label>
      </div><button disabled={busy} type="submit">Update product</button>
    </form>}
    {canSell&&<form className="store-section" onSubmit={e=>{e.preventDefault();const key=receiptKey||crypto.randomUUID();setReceiptKey(key);act(async()=>{
      const result=await post('/store/stock-receipts',{itemId:stockItem,quantity:Number(receiptQty),sourceReference:source},key);
      setSource('');setReceiptQty(1);setReceiptKey('');setMessage(`Receipt #${result.id} recorded. Available quantity: ${result.availableQty}.`);
    });}}>
      <h3>Receive stock</h3>
      <div className="store-fields"><label>Product<select required value={stockItem} onChange={e=>{setStockItem(e.target.value);setReceiptKey('');}}><option value="">Choose product</option>{items.filter(x=>x.active).map(x=><option key={x.id} value={x.id}>{x.sku} — {x.name}</option>)}</select></label>
        <label>Quantity<input type="number" required min="1" max="10000" value={receiptQty} onChange={e=>{setReceiptQty(e.target.value);setReceiptKey('');}}/></label>
        <label>Supplier / delivery reference<input required value={source} onChange={e=>{setSource(e.target.value);setReceiptKey('');}} placeholder="DELIVERY-2026-01" /></label></div>
      <button type="submit" disabled={busy}>Record stock receipt</button>
    </form>}
    {canSell&&<div className="store-section"><h3>Create and complete a sale</h3>
      {!sale?<>
        {cart.length?<div className="table-scroll"><table><thead><tr><th>Product</th><th>Quantity</th><th>Unit price</th><th>Line total</th><th></th></tr></thead><tbody>
          {cart.map(line=><tr key={line.itemId}><td>{line.sku}</td><td><input aria-label={`Quantity for ${line.sku}`} type="number" min="1" max="10000" value={line.quantity} onChange={e=>{setDraftKey('');setCart(rows=>rows.map(r=>r.itemId===line.itemId?{...r,quantity:Number(e.target.value)}:r));}}/></td>
            <td>{fmt(line.unitPrice)}</td><td>{fmt(Number(line.unitPrice)*line.quantity)}</td><td><button type="button" disabled={busy} onClick={()=>{setDraftKey('');setCart(rows=>rows.filter(r=>r.itemId!==line.itemId));}}>Remove</button></td></tr>)}
        </tbody></table></div>:<p className="helper">Add products from the catalogue above to start a sale.</p>}
        <div className="store-fields"><label>Buyer membership number (optional)<input value={buyerMemberNumber} onChange={e=>{setBuyerMemberNumber(e.target.value);setDraftKey('');}} placeholder="MSC-00000001" /></label></div>
        <p><strong>Preview:</strong> Subtotal {fmt(draftTotal/100)} · Discount {fmt(discount/100)} · Total {fmt((draftTotal-discount)/100)}</p>
        <button type="button" disabled={busy||!cart.length||cart.some(l=>!Number.isInteger(l.quantity)||l.quantity<1)} onClick={()=>{const key=draftKey||crypto.randomUUID();setDraftKey(key);act(async()=>{
          const created=await post('/sales',{lines:cart.map(({itemId,quantity})=>({itemId,quantity})),buyerMemberNumber},key);
          setSale(created);setCart([]);setDraftKey('');setBuyerMemberNumber('');setMessage(`Draft sale #${created.id} created. Confirm the payment method.`);
        });}}>Save draft sale</button>
      </>:<form onSubmit={e=>{e.preventDefault();const key=pendingKey?.saleId===sale.id?pendingKey.key:crypto.randomUUID();setPendingKey({saleId:sale.id,key});act(async()=>{
        const result=await post(`/sales/${sale.id}/checkout`,{method,reference:method==='mobile_money'?reference:''},key);
        setMessage(result.status==='completed'?`Cash sale #${sale.id} completed. Receipt available in sales history.`:
          `Sale #${sale.id} awaiting independent verification; stock has not been reduced.`);
        setSale(null);setPendingKey(null);setReference('');
      });}}>
        <h4>Draft sale #{sale.id} · Total {fmt(sale.total)}</h4>
        <div className="store-fields"><label>Payment method<select value={method} onChange={e=>{setMethod(e.target.value);setPendingKey(null);}}><option value="cash">Cash received</option><option value="mobile_money">Mobile money — pending verification</option></select></label>
          {method==='mobile_money'&&<label>Mobile-money reference<input required value={reference} onChange={e=>{setReference(e.target.value);setPendingKey(null);}} /></label>}</div>
        <p className="helper">For cash, confirm you physically received the full amount. Mobile money remains pending until verified by a different authorized user.</p>
        <button type="submit" disabled={busy}>Confirm {method==='cash'?'cash receipt':'pending mobile payment'}</button>{' '}
        <button type="button" disabled={busy} onClick={()=>act(async()=>{
          await post(`/sales/${sale.id}/cancel`,{});setMessage('Unpaid draft cancelled.');setSale(null);setPendingKey(null);
        })}>Cancel unpaid draft</button>
      </form>}
    </div>}
    {canReview&&<div className="store-section"><h3>Pending mobile-money verification</h3>
      <p className="helper">Verify settlement against trusted payment evidence, not solely against the reference typed by the clerk. The reviewer must be a different staff account.</p>
      {pending.length===0?<p className="helper">No pending mobile sales.</p>:<div className="table-scroll"><table><thead><tr><th>Sale</th><th>Reference</th><th>Amount</th><th>Independent evidence</th><th>Action</th></tr></thead><tbody>
        {pending.map(s=><tr key={s.id}><td>#{s.id}</td><td>{s.reference}</td><td>{fmt(s.total)}</td>
          <td><input aria-label={`Evidence for sale ${s.id}`} value={evidence[s.id]||''} onChange={e=>setEvidence(old=>({...old,[s.id]:e.target.value}))} placeholder="RECON-2026-01" /></td>
          <td><button disabled={busy||!(evidence[s.id]||'').trim()} onClick={()=>act(async()=>{
            const result=await post(`/sales/${s.id}/verify-mobile`,{evidenceReference:evidence[s.id]});
            setEvidence(old=>({...old,[s.id]:''}));setMessage(`Sale #${result.id} verified and completed. Stock deducted.`);
          })}>Verify</button></td></tr>)}
      </tbody></table></div>}
    </div>}
    <div className="store-section"><h3>Recent sales</h3><div className="table-scroll"><table><thead><tr><th>Sale</th><th>Status</th><th>Method</th><th>Subtotal</th><th>Discount</th><th>Total</th><th>Action</th></tr></thead><tbody>
      {sales.map(s=><tr key={s.id}><td>#{s.id}</td><td>{s.status}</td><td>{s.method||'—'}</td><td>{fmt(s.subtotal)}</td><td>{fmt(s.discount)}</td><td><strong>{fmt(s.total)}</strong></td><td>{canSell&&s.status==='draft'?<button type="button" disabled={busy} onClick={()=>act(async()=>{const saved=await request(`/sales/${s.id}`,staff);setSale(saved);setMessage(`Resumed draft sale #${s.id}.`);})}>Resume</button>:s.status==='completed'?<button type="button" disabled={busy} onClick={()=>act(async()=>{const saved=await request(`/sales/${s.id}`,staff);setMessage(`Receipt #${saved.id}: ${saved.lines.map(l=>`${l.qty} × ${l.name}`).join(', ')}. Total ${fmt(saved.total)}. Method: ${saved.method}.`);})}>View receipt</button>:null}</td></tr>)}
    </tbody></table></div></div>
    <div className="store-section"><h3>Recent stock movements</h3><div className="table-scroll"><table><thead><tr><th>Item SKU</th><th>Movement</th><th>Quantity</th><th>Source</th></tr></thead><tbody>
      {movements.slice(0,20).map(m=><tr key={m.id}><td>{m.sku}</td><td>{m.type}</td><td>{m.delta>0?'+':''}{m.delta}</td><td>{m.receiptId?`Receipt ${m.receiptId}`:`Sale ${m.saleId}`}</td></tr>)}
    </tbody></table></div></div>
    <p className="helper">Refunds, sale returns and equipment lending will have separate, auditable workflows in future implementations. Do not use stock receipts to conceal returns.</p>
  </section>;
}
