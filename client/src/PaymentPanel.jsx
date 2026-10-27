import {useCallback,useEffect,useState} from 'react';

const ksh=v=>`KSh ${Number(v||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
async function request(path,opts={}){
  const r=await fetch(path,{credentials:'same-origin',...opts});
  const result=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(result?.error?.message||`Request failed (${r.status}).`);
  return result.data;
}
export default function PaymentPanel({staff,onUpdated}){
  const canRecord=staff.roles.some(r=>['ADM','FIN','REG'].includes(r));
  const canReview=staff.roles.some(r=>['ADM','FIN','MGT'].includes(r));
  const [search,setSearch]=useState('');
  const [searchInput,setSearchInput]=useState('');
  const [charges,setCharges]=useState([]);
  const [selected,setSelected]=useState(null);
  const [method,setMethod]=useState('cash');
  const [amount,setAmount]=useState('');
  const [reference,setReference]=useState('');
  const [pending,setPending]=useState([]);
  const [verified,setVerified]=useState([]);
  const [evidence,setEvidence]=useState({});
  const [reasons,setReasons]=useState({});
  const [status,setStatus]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [retryKey,setRetryKey]=useState('');
  const [refresh,setRefresh]=useState(0);
  const reload=useCallback(()=>setRefresh(r=>r+1),[]);

  useEffect(()=>{
    const controller=new AbortController();
    request(`/api/v1/payments/charges?search=${encodeURIComponent(search)}`,{signal:controller.signal})
      .then(setCharges).catch(e=>{if(e.name!=='AbortError')setError(e.message)});
    if(canReview){
      request('/api/v1/payments?status=pending',{signal:controller.signal})
        .then(setPending).catch(e=>{if(e.name!=='AbortError')setError(e.message)});
      request('/api/v1/payments?status=verified',{signal:controller.signal})
        .then(setVerified).catch(e=>{if(e.name!=='AbortError')setError(e.message)});
    }
    return ()=>controller.abort();
  },[refresh,search,canReview]);

  function chooseCharge(charge){
    const remaining=Math.max(0,Math.round(Number(charge.amount)*100)-Math.round(Number(charge.verifiedAmount)*100));
    setSelected(charge);setAmount(`${Math.floor(remaining/100)}.${String(remaining%100).padStart(2,'0')}`);
    setReference('');setRetryKey('');setStatus('');setError('');
  }
  async function record(event){
    event.preventDefault();if(!selected)return;
    setBusy(true);setError('');setStatus('');
    const key=retryKey||crypto.randomUUID();
    if(!retryKey)setRetryKey(key);
    try{
      const payment=await request('/api/v1/payments',{
        method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':staff.csrfToken,'Idempotency-Key':key},
        body:JSON.stringify({chargeId:selected.chargeId,amount,method,reference:method==='mobile_money'?reference:''})
      });
      setStatus(`Payment #${payment.id} recorded as pending. An independent officer must verify it before the balance changes.`);
      setRetryKey('');setSelected(null);reload();onUpdated?.();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function action(path,payload,message){
    setBusy(true);setStatus('');setError('');
    try{
      const result=await request(path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':staff.csrfToken},
        body:JSON.stringify(payload)});
      setStatus(`${message} Remaining membership balance: ${ksh(result.balance)}. Status: ${result.membershipStatus}.`);
      reload();onUpdated?.();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <section className="payments-panel" aria-label="Membership payments">
    <h2>Membership payment recording & verification</h2>
    <p className="helper">A payment is not income until an authorized officer independently verifies it. Never verify a mobile-money payment based on an entered reference alone.</p>
    {status&&<div role="status" className="success-box">{status}</div>}
    {error&&<p role="alert" className="auth-error">{error}</p>}
    {canRecord&&<>
      <h3>Record a payment</h3>
      <form onSubmit={e=>{e.preventDefault();setSearch(searchInput.trim());}} className="payment-search">
        <label>Find a member or membership number<input value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder="Search member name or MSC number" /></label>
        <button type="submit">Search charges</button>
      </form>
      <div className="table-scroll"><table><thead><tr><th>Member</th><th>Charged</th><th>Verified</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {charges.map(c=><tr key={c.chargeId}><td>{c.membershipNumber}<small className="payment-small">{c.fullName}</small></td>
          <td>{ksh(c.amount)}</td><td>{ksh(c.verifiedAmount)}</td><td>{c.chargeStatus}</td>
          <td><button type="button" disabled={busy||c.chargeStatus!=='outstanding'} onClick={()=>chooseCharge(c)}>Record</button></td></tr>)}
      </tbody></table></div>
      {selected&&<form onSubmit={record} className="payment-form">
        <h4>New payment for {selected.membershipNumber} — {selected.fullName}</h4>
        <div className="form-grid">
          <label>Amount (KSh)<input required inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);setRetryKey('')}} pattern="[0-9]+\.[0-9]{2}" /></label>
          <label>Method<select value={method} onChange={e=>{setMethod(e.target.value);setRetryKey('')}}><option value="cash">Cash</option><option value="mobile_money">Mobile money</option></select></label>
          {method==='mobile_money'&&<label>Mobile-money reference<input required value={reference} onChange={e=>{setReference(e.target.value);setRetryKey('')}} maxLength={40} /></label>}
        </div>
        <p className="helper">Recording does not confirm receipt or activate membership. A separate staff account must verify.</p>
        <div className="form-actions"><button disabled={busy} type="submit">{busy?'Saving…':'Save pending payment'}</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={()=>{setSelected(null);setRetryKey('')}}>Cancel</button></div>
      </form>}
    </>}
    {canReview&&<>
      <h3>Pending verification</h3>
      <p className="helper">Use a reference to independently checked payment evidence. You cannot approve a payment you recorded yourself.</p>
      <div className="table-scroll"><table><thead><tr><th>Member</th><th>Amount</th><th>Method / reference</th><th>Verification evidence</th><th>Action</th></tr></thead><tbody>
        {pending.map(p=><tr key={p.id}><td>{p.membershipNumber}<small className="payment-small">{p.fullName}</small></td>
          <td>{ksh(p.amount)}</td><td>{p.method}{p.reference?` / ${p.reference}`:''}</td>
          <td><input aria-label={`Verification evidence for payment ${p.id}`} value={evidence[p.id]||''}
            onChange={e=>setEvidence(v=>({...v,[p.id]:e.target.value}))} placeholder="Evidence ID" maxLength={100}/></td>
          <td><button type="button" disabled={busy||String(p.recordedByUserId)===String(staff.id)||!(evidence[p.id]||'').trim()} onClick={()=>action(`/api/v1/payments/${p.id}/verify`,{evidenceReference:evidence[p.id]},`Payment #${p.id} verified.`)}>Verify</button></td></tr>)}
      </tbody></table>{pending.length===0&&<p className="helper">No pending payments found.</p>}</div>
      <h3>Verified payments and corrections</h3>
      <p className="helper">Only use reversal after management checks the underlying evidence; it restores an outstanding charge without deleting the audit trail.</p>
      <div className="table-scroll"><table><thead><tr><th>Member</th><th>Amount</th><th>Reversal reason</th><th>Action</th></tr></thead><tbody>
        {verified.map(p=><tr key={p.id}><td>{p.membershipNumber}</td><td>{ksh(p.amount)}</td><td>
          <input aria-label={`Reversal reason for payment ${p.id}`} value={reasons[p.id]||''} maxLength={300} placeholder="Reason (10+ chars)" onChange={e=>setReasons(r=>({...r,[p.id]:e.target.value}))}/></td>
          <td><button disabled={busy||(reasons[p.id]||'').trim().length<10} type="button" onClick={()=>action(`/api/v1/payments/${p.id}/reverse`,{reason:reasons[p.id]},`Payment #${p.id} reversed.`)}>Reverse</button></td></tr>)}
      </tbody></table></div>
    </>}
  </section>;
}
