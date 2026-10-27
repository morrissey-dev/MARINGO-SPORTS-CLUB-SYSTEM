import {useEffect,useState} from 'react';
const money=value=>`KSh ${Number(value||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
async function api(path,staff,body,key){
  const response=await fetch(`/api/v1${path}`,{method:body?'POST':'GET',credentials:'same-origin',
    headers:body?{'Content-Type':'application/json','X-CSRF-Token':staff.csrfToken,...(key?{'Idempotency-Key':key}:{})}:{},
    ...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error?.message||'Refund request could not be completed.');
  return data.data;
}
export default function RefundsPanel({staff,returns,onChanged}){
  const [refunds,setRefunds]=useState([]),[returnId,setReturnId]=useState(''),[method,setMethod]=useState('cash');
  const [reason,setReason]=useState(''),[requestKey,setRequestKey]=useState('');
  const [reviewId,setReviewId]=useState(''),[decision,setDecision]=useState('pay'),[reference,setReference]=useState(''),[evidenceNote,setEvidenceNote]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  async function refresh(){setRefunds(await api('/sales/refunds',staff));}
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[staff.id]);
  async function action(fn){setBusy(true);setMessage('');setError('');try{await fn();await refresh();await onChanged();}catch(e){setError(e.message);}finally{setBusy(false);}}
  const eligible=returns.filter(r=>r.status==='accepted'&&r.refundStatus==='not_requested'&&Number(r.refundDue)>0);
  const pending=refunds.filter(r=>r.status==='pending');
  return <div className="store-section" id="store-refunds-payment" aria-label="Refund payments">
    <h3>Verified customer refunds</h3>
    <p className="helper">Only an accepted return creates a refund entitlement. Requesting a refund does not mean money was sent. A different finance/management officer must confirm the actual payout with evidence before the income report records an outflow.</p>
    {error&&<p className="auth-error" role="alert">{error}</p>}{message&&<p className="success-box" role="status">{message}</p>}
    <form onSubmit={e=>{e.preventDefault();const key=requestKey||crypto.randomUUID();setRequestKey(key);action(async()=>{
      const created=await api(`/sales/returns/${returnId}/refunds`,staff,{method,reason},key);
      setRequestKey('');setReturnId('');setReason('');setMessage(`Refund #${created.id} awaiting independent payout verification.`);
    });}}>
      <h4>Request refund payment</h4>
      <div className="store-fields">
        <label>Accepted return<select value={returnId} required onChange={e=>{setReturnId(e.target.value);setRequestKey('');}}><option value="">Select accepted return</option>{eligible.map(r=><option key={r.id} value={r.id}>Return #{r.id} — {money(r.refundDue)}</option>)}</select></label>
        <label>Repayment method<select value={method} onChange={e=>{setMethod(e.target.value);setRequestKey('');}}><option value="cash">Cash</option><option value="mobile_money">Mobile money</option></select></label>
        <label>Reason<input required minLength="10" maxLength="500" value={reason} onChange={e=>{setReason(e.target.value);setRequestKey('');}} placeholder="Customer returned wrong size" /></label>
      </div><button type="submit" disabled={busy||!returnId}>Record pending refund</button>
    </form>
    <h4>Refund history</h4>
    <div className="table-scroll"><table><thead><tr><th>Refund</th><th>Return</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead><tbody>
      {refunds.map(r=><tr key={r.id}><td>#{r.id}</td><td>#{r.returnId}</td><td>{money(r.amount)}</td><td>{r.method}</td><td>{r.status}</td></tr>)}
    </tbody></table></div>
    {pending.length>0&&<form onSubmit={e=>{e.preventDefault();action(async()=>{
      const body=decision==='pay'?{decision:'pay',evidenceReference:reference,evidenceNote}:{decision:'reject',reason:evidenceNote};
      const result=await api(`/sales/refunds/${reviewId}/review`,staff,body);
      setReviewId('');setReference('');setEvidenceNote('');setMessage(`Refund #${result.id}: ${result.status}.`);
    });}}>
      <h4>Independent payout verification</h4>
      <p className="helper">The officer who requested the refund cannot verify it. Only confirm payment after examining actual repayment evidence; entering a reference alone is not proof of settlement.</p>
      <div className="store-fields">
        <label>Pending refund<select required value={reviewId} onChange={e=>setReviewId(e.target.value)}><option value="">Select pending refund</option>{pending.map(r=><option key={r.id} value={r.id}>#{r.id} — {money(r.amount)} ({r.method})</option>)}</select></label>
        <label>Decision<select value={decision} onChange={e=>setDecision(e.target.value)}><option value="pay">Confirm paid (after independent evidence review)</option><option value="reject">Reject request</option></select></label>
        {decision==='pay'&&<label>Cash voucher / verified transfer reference<input required minLength="6" maxLength="100" value={reference} onChange={e=>setReference(e.target.value)}/></label>}
        <label>{decision==='pay'?'Repayment evidence note':'Rejection reason'}<input required minLength="10" maxLength="500" value={evidenceNote} onChange={e=>setEvidenceNote(e.target.value)}/></label>
      </div><button type="submit" disabled={busy||!reviewId}>Record reviewed decision</button>
    </form>}
  </div>;
}
