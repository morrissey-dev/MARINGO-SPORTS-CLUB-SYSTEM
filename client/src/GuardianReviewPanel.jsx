import {useEffect,useState} from 'react';
export default function GuardianReviewPanel({staff,onUpdated}){
  const [pending,setPending]=useState([]),[evidence,setEvidence]=useState({});
  const [refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/v1/members/guardian-consent/pending',{credentials:'same-origin',signal:controller.signal})
      .then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error?.message||'Failed to load');return data;})
      .then(data=>setPending(data.data||[]))
      .catch(e=>{if(e.name!=='AbortError')setError(e.message)});
    return ()=>controller.abort();
  },[refresh]);
  async function approve(member){
    setBusy(true);setError('');setMessage('');
    try{
      const response=await fetch(`/api/v1/members/${member.id}/guardian-consent/verify`,{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':staff.csrfToken},
        body:JSON.stringify({evidenceReference:evidence[member.id]})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error?.message||'Verification failed');
      setMessage(`${member.membershipNumber}: guardian consent verified. Membership status: ${data.data.membershipStatus||'pending'}.`);
      setRefresh(n=>n+1);onUpdated?.();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <section className="payments-panel" aria-label="Guardian consent review">
    <h2>Guardian consent review</h2>
    <p className="helper">For authorized club management only. Verify actual consent outside this screen first, then enter an internal evidence reference; this form alone is not proof.</p>
    {message&&<div className="success-box" role="status">{message}</div>}
    {error&&<p className="auth-error" role="alert">{error}</p>}
    <div className="table-scroll"><table><thead><tr><th>Member</th><th>Consent</th><th>Evidence reference</th><th>Action</th></tr></thead><tbody>
      {pending.map(m=><tr key={m.id}>
        <td>{m.membershipNumber}<small className="payment-small">{m.fullName}</small></td>
        <td>Pending</td>
        <td><input aria-label={`Evidence for ${m.membershipNumber}`} value={evidence[m.id]||''} maxLength={100}
          onChange={e=>setEvidence(old=>({...old,[m.id]:e.target.value}))} placeholder="Consent file ID"/></td>
        <td><button disabled={busy||!evidence[m.id]||evidence[m.id].trim().length<6} onClick={()=>approve(m)}>Verify</button></td>
      </tr>)}
    </tbody></table>{pending.length===0&&<p className="helper">No pending guardian consent records.</p>}</div>
  </section>;
}
