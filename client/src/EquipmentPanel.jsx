import {useCallback,useEffect,useState} from 'react';
const money=x=>`KSh ${Number(x||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
async function api(path,staff,method='GET',payload=null,key=null){
  const response=await fetch(`/api/v1/equipment${path}`,{credentials:'same-origin',method,headers:{
    ...(payload?{'Content-Type':'application/json','X-CSRF-Token':staff.csrfToken,'Idempotency-Key':key||crypto.randomUUID()}:{}),
    ...(!payload&&method!=='GET'?{'X-CSRF-Token':staff.csrfToken}:{})
  },...(payload?{body:JSON.stringify(payload)}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error?.message||`Equipment request failed (${response.status})`);
  return data.data;
}
function Label({children}){return <label style={{display:'block',marginTop:10}}>{children}</label>}
export default function EquipmentPanel({staff}){
  const roles=staff.roles;
  const canManage=roles.some(r=>['ADM','MGT'].includes(r));
  const canIssue=roles.some(r=>['ADM','STO'].includes(r));
  const canRequest=roles.some(r=>['ADM','MGT','PAT'].includes(r));
  const [items,setItems]=useState([]),[loans,setLoans]=useState([]),[incidents,setIncidents]=useState([]),[teams,setTeams]=useState([]);
  const [selected,setSelected]=useState(null),[status,setStatus]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [catalog,setCatalog]=useState({code:'',name:'',marketValue:''});
  const [receipt,setReceipt]=useState({equipmentTypeId:'',quantity:1,sourceReference:''});
  const [request,setRequest]=useState({teamId:'',eventId:'',purpose:'Training equipment',dueDate:'',equipmentTypeId:'',quantity:1});
  const [returnDraft,setReturnDraft]=useState({});
  const [inspectionNotes,setInspectionNotes]=useState('');
  const [confirm,setConfirm]=useState({});
  const [stableKey,setStableKey]=useState(null);
  const refresh=useCallback(async()=>{
    const [equipment,existing,issues]=await Promise.all([
      api('/items',staff),api('/loans',staff),api('/incidents',staff)]);
    setItems(equipment);setLoans(existing);setIncidents(issues);
  },[staff.id]);
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[refresh]);
  useEffect(()=>{
    if(canRequest)fetch('/api/v1/teams',{credentials:'same-origin'}).then(r=>r.ok?r.json():null)
      .then(data=>{if(data?.data)setTeams(data.data);}).catch(()=>{});
  },[staff.id]);
  const update=(setter,name,value)=>setter(prev=>({...prev,[name]:value}));
  async function run(callback){setBusy(true);setError('');setStatus('');try{const result=await callback();await refresh();setStatus('Saved successfully.');return result;}catch(e){setError(e.message);return null;}finally{setBusy(false);}}
  const showLoan=async id=>{setError('');try{const info=await api(`/loans/${id}`,staff);setSelected(info);setReturnDraft({});setStableKey(null);}catch(e){setError(e.message);}};
  async function submitRequest(e){e.preventDefault();const key=stableKey||crypto.randomUUID();setStableKey(key);
    const result=await run(()=>api('/loans',staff,'POST',{
      teamId:request.teamId,eventId:request.eventId||null,purpose:request.purpose,dueDate:request.dueDate,
      lines:[{equipmentTypeId:request.equipmentTypeId,quantity:Number(request.quantity)}]},key));
    if(result){setStableKey(null);setStatus(`Loan #${result.id} requested. No equipment has left stock yet.`);}
  }
  async function submitReturn(e){e.preventDefault();if(!selected)return;
    const key=stableKey||crypto.randomUUID();setStableKey(key);
    const lines=selected.lines.map(l=>({loanLineId:l.id,usableQty:Number(returnDraft[l.id]?.usableQty||0),
      damagedQty:Number(returnDraft[l.id]?.damagedQty||0),missingQty:Number(returnDraft[l.id]?.missingQty||0)}))
      .filter(l=>l.usableQty+l.damagedQty+l.missingQty>0);
    const result=await run(()=>api(`/loans/${selected.id}/returns`,staff,'POST',{lines,notes:inspectionNotes},key));
    if(result){setStableKey(null);await showLoan(selected.id);setStatus(`Return recorded. ${result.remainingQty} units still outstanding. ${result.incidents.length} incidents awaiting review.`);}
  }
  return <section className="store-panel" aria-label="Equipment management">
    <h2>Equipment loans, returns and incidents</h2>
    <p className="helper">Loaned equipment has its own inventory. Sales stock is never adjusted by an equipment loan. Reported loss and damage require management approval; no individual is charged automatically.</p>
    {error&&<p role="alert" className="auth-error">{error}</p>}
    {status&&<p role="status">{status}</p>}
    <h3>Equipment inventory</h3>
    <div style={{overflowX:'auto'}}><table><thead><tr><th>Equipment</th><th>Market value</th><th>Usable</th><th>Issued</th><th>Damaged</th><th>Missing</th></tr></thead><tbody>
      {items.map(x=><tr key={x.id}><td>{x.name} ({x.code})</td><td>{money(x.marketValue)}</td><td>{x.availableQty}</td><td>{x.issuedQty}</td><td>{x.damagedQty}</td><td>{x.missingQty}</td></tr>)}
    </tbody></table></div>
    {canManage&&<form onSubmit={e=>{e.preventDefault();run(()=>api('/items',staff,'POST',catalog)).then(r=>{if(r)setCatalog({code:'',name:'',marketValue:''});});}}>
      <h3>Add loanable equipment type</h3>
      <Label>Code <input value={catalog.code} onChange={e=>update(setCatalog,'code',e.target.value)} required /></Label>
      <Label>Name <input value={catalog.name} onChange={e=>update(setCatalog,'name',e.target.value)} required /></Label>
      <Label>Market value (KSh) <input type="number" min="0.01" step="0.01" value={catalog.marketValue} onChange={e=>update(setCatalog,'marketValue',e.target.value)} required /></Label>
      <button disabled={busy}>Add equipment type</button>
    </form>}
    {canIssue&&<form onSubmit={e=>{e.preventDefault();run(()=>api('/stock-receipts',staff,'POST',{...receipt,quantity:Number(receipt.quantity)})).then(r=>{if(r)setReceipt({...receipt,sourceReference:''});});}}>
      <h3>Receive equipment (not store products)</h3>
      <Label>Item <select value={receipt.equipmentTypeId} onChange={e=>update(setReceipt,'equipmentTypeId',e.target.value)} required><option value="">Select equipment</option>{items.filter(x=>x.active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Label>
      <Label>Quantity <input type="number" min="1" max="10000" value={receipt.quantity} onChange={e=>update(setReceipt,'quantity',e.target.value)} required /></Label>
      <Label>Source reference <input value={receipt.sourceReference} onChange={e=>update(setReceipt,'sourceReference',e.target.value)} required /></Label>
      <button disabled={busy}>Record receipt</button>
    </form>}
    {canRequest&&<form onSubmit={submitRequest}>
      <h3>Request loan for a current team captain</h3>
      <Label>Team <select required value={request.teamId} onChange={e=>update(setRequest,'teamId',e.target.value)}><option value="">Select team</option>{teams.filter(t=>t.status==='active').map(t=><option key={t.id} value={t.id}>{t.name} — {t.sportName}</option>)}</select></Label>
      <Label>Event ID (optional) <input value={request.eventId} onChange={e=>update(setRequest,'eventId',e.target.value)} placeholder="Event number, if applicable" /></Label>
      <Label>Purpose <input value={request.purpose} onChange={e=>update(setRequest,'purpose',e.target.value)} required /></Label>
      <Label>Due date <input type="date" value={request.dueDate} onChange={e=>update(setRequest,'dueDate',e.target.value)} required /></Label>
      <Label>Equipment type <select required value={request.equipmentTypeId} onChange={e=>update(setRequest,'equipmentTypeId',e.target.value)}><option value="">Select equipment</option>{items.filter(i=>i.active).map(i=><option key={i.id} value={i.id}>{i.name} — {i.availableQty} usable</option>)}</select></Label>
      <Label>Quantity <input type="number" min="1" max="10000" value={request.quantity} onChange={e=>update(setRequest,'quantity',e.target.value)} required /></Label>
      <button disabled={busy}>Request equipment</button>
      <p className="helper">This first interface supports one equipment type per request. The API supports up to 30 types per loan.</p>
    </form>}
    <h3>Equipment loans</h3>
    {loans.length===0?<p>No equipment loans recorded.</p>:<div style={{overflowX:'auto'}}><table><thead><tr><th>Loan</th><th>Team</th><th>Captain</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {loans.map(l=><tr key={l.id}><td>#{l.id}</td><td>{l.teamName}</td><td>{l.captainName}</td><td>{l.dueDate}</td><td>{l.status}</td>
        <td><button type="button" onClick={()=>showLoan(l.id)} disabled={busy}>Inspect</button>
          {canIssue&&l.status==='requested'&&<button type="button" disabled={busy} onClick={()=>run(()=>api(`/loans/${l.id}/issue`,staff,'POST'))}>Issue</button>}</td></tr>)}</tbody></table></div>}
    {selected&&<div className="note"><h3>Loan #{selected.id}: {selected.status}</h3><p>Captain: {selected.captainName} · Team: {selected.teamName}</p>
      <ul>{selected.lines.map(l=><li key={l.id}>{l.name}: issued {l.issuedQty}, accounted {l.accountedQty}, outstanding {l.remainingQty}</li>)}</ul>
      {canIssue&&['issued','partially_returned'].includes(selected.status)&&<form onSubmit={submitReturn}>
        <h3>Inspect return (one or more lines)</h3>
        {selected.lines.filter(l=>l.remainingQty>0).map(l=><div key={l.id}>
          <strong>{l.name} — {l.remainingQty} outstanding</strong>
          {['usableQty','damagedQty','missingQty'].map((field)=><Label key={field}>{field==='usableQty'?'Usable':field==='damagedQty'?'Damaged':'Missing'} quantity
            <input type="number" min="0" max={l.remainingQty} value={returnDraft[l.id]?.[field]||0}
              onChange={e=>setReturnDraft(d=>({...d,[l.id]:{...d[l.id],[field]:e.target.value}}))}/></Label>)}
        </div>)}
        <Label>Inspection notes <textarea value={inspectionNotes} maxLength={500} onChange={e=>setInspectionNotes(e.target.value)} /></Label>
        <button disabled={busy}>Record inspected return</button>
      </form>}</div>}
    <h3>Loss and damage reviews</h3>
    {incidents.length===0?<p>No incidents recorded.</p>:<div style={{overflowX:'auto'}}><table><thead><tr><th>Incident</th><th>Equipment</th><th>Type / quantity</th><th>Status</th><th>Surcharge</th><th>Management review</th></tr></thead><tbody>
      {incidents.map(i=><tr key={i.id}><td>#{i.id} (loan #{i.loanId})</td><td>{i.equipmentName}</td><td>{i.type}: {i.quantity}</td><td>{i.status}</td>
        <td>{i.surchargeTotal?money(i.surchargeTotal):'Pending approval'}</td><td>
          {canManage&&i.status==='reported'&&<form onSubmit={e=>{e.preventDefault();run(()=>api(`/incidents/${i.id}/confirm`,staff,'POST',{
            approvedMarketValue:confirm[i.id]?.value||i.reportedMarketValue,evidenceReference:confirm[i.id]?.evidence||''}));}}>
            <Label>Market value <input type="number" min="0.01" step="0.01" value={confirm[i.id]?.value??i.reportedMarketValue}
              onChange={e=>setConfirm(c=>({...c,[i.id]:{...c[i.id],value:e.target.value}}))}/></Label>
            <Label>Evidence reference <input required minLength={8} maxLength={200} value={confirm[i.id]?.evidence||''}
              onChange={e=>setConfirm(c=>({...c,[i.id]:{...c[i.id],evidence:e.target.value}}))}/></Label>
            <button disabled={busy}>Approve valuation</button>
          </form>}{i.status==='confirmed'&&<span>Approved; allocation pending club policy</span>}
        </td></tr>)}
    </tbody></table></div>}
  </section>;
}
