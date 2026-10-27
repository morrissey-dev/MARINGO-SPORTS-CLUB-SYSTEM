import {useEffect,useState} from 'react';
export default function MemberDirectory({refresh}) {
  const [members,setMembers]=useState([]);
  const [query,setQuery]=useState('');
  const [submitted,setSubmitted]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setError('');
    fetch(`/api/v1/members?search=${encodeURIComponent(submitted)}`,{credentials:'same-origin',signal:controller.signal})
      .then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Cannot load members');return j;})
      .then(data=>setMembers(data.data||[]))
      .catch(e=>{if(e.name!=='AbortError')setError(e.message)})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false)});
    return ()=>controller.abort();
  },[refresh,submitted]);
  return <section className="directory" aria-label="Member applications">
    <div className="section-heading"><div><h2>Recent applications</h2><p>Restricted to authorized registration staff. Payments are not collected here.</p></div></div>
    <form className="search-row" onSubmit={e=>{e.preventDefault();setSubmitted(query.trim())}}><input aria-label="Search by name or membership number" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name or membership number"/><button type="submit">Search</button></form>
    {busy&&<p role="status">Loading applications…</p>}
    {error&&<p role="alert" className="auth-error">{error}</p>}
    <div className="table-scroll"><table><thead><tr><th>Member number</th><th>Name</th><th>Type</th><th>Fee (KSh)</th><th>Application status</th></tr></thead>
      <tbody>{members.map(m=><tr key={m.id}><td>{m.membershipNumber}</td><td>{m.fullName}</td><td>{m.registrationType}</td><td>{m.membershipFee}</td><td>{m.memberStatus==='pending_consent'?'Guardian verification pending':m.memberStatus==='draft'?'Pending payment / approval':m.memberStatus}</td></tr>)}</tbody></table>
      {!busy&&members.length===0&&<p className="helper">No matching applications.</p>}</div>
    <p className="helper">Showing at most 20 matching records. Additional pages and exports will be added later.</p>
  </section>
}
