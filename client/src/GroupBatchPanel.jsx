import {useState} from 'react';
import {GROUP_HEADERS,prepareGroupCsv,GROUP_LIMIT} from './groupCsv.js';

export default function GroupBatchPanel({staff,sports,organizations,onCreated}) {
 const [organizationId,setOrganizationId]=useState('');
 const [csv,setCsv]=useState('');
 const [members,setMembers]=useState([]);
 const [key,setKey]=useState(null);
 const [error,setError]=useState('');
 const [success,setSuccess]=useState(null);
 const [busy,setBusy]=useState(false);
 const [confirmed,setConfirmed]=useState(false);
 function resetPending(){setMembers([]);setKey(null);setError('');setSuccess(null);setConfirmed(false);}
 function preview(){
   setError('');setSuccess(null);setKey(null);setConfirmed(false);
   try {
     if(!organizationId)throw Error('Select an organization first.');
     const parsed=prepareGroupCsv(csv,sports);
     setMembers(parsed);
   }catch(e){setMembers([]);setError(e.message);}
 }
 async function submit(){
   if(!confirmed||!members.length||!organizationId)return;
   setError('');setBusy(true);
   const submissionKey=key||crypto.randomUUID();
   if(!key)setKey(submissionKey);
   try{
     const response=await fetch('/api/v1/group-registrations',{
       method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':staff.csrfToken,'Idempotency-Key':submissionKey},
       body:JSON.stringify({organizationId,members})
     });
     const result=await response.json().catch(()=>null);
     if(!response.ok)throw Error(result?.error?.message||`Submission failed (${response.status}).`);
     setSuccess(result.data);onCreated?.();setMembers([]);setCsv('');setKey(null);setConfirmed(false);
   }catch(e){setError(`${e.message} If the result is uncertain, retry this unchanged batch to avoid duplicate registration.`);}
   finally{setBusy(false);}
 }
 return <section className="registration" aria-label="Group member intake">
   <div className="registration-heading"><h2>Group member intake (CSV)</h2>
     <p>Register up to {GROUP_LIMIT} people from one school, college or religious organization together. The entire batch posts or none of it does. Every applicant receives a separate outstanding KSh 500 membership charge.</p>
   </div>
   <label>Registered organization
     <select value={organizationId} onChange={e=>{setOrganizationId(e.target.value);resetPending();}} disabled={busy}>
       <option value="">Select organization</option>
       {organizations.map(o=><option key={o.id} value={o.id}>{o.name} ({o.type})</option>)}
     </select>
   </label>
   <p className="helper">Create the organization using the individual registration section if it is not yet listed.</p>
   <details><summary>Required CSV columns and sports format</summary>
     <p className="helper">The first row must contain these headings in order. In the sports column, use sports names separated by a vertical bar, in priority order (e.g., Football|Chess). Surround the field with double quotes if it contains a comma. Leave guardian fields blank for adults; fill all three for minors.</p>
     <code className="csv-header">{GROUP_HEADERS.join(',')}</code>
   </details>
   <label htmlFor="group-csv-input">Paste CSV rows (temporary; not saved to this device)</label>
   <textarea id="group-csv-input" rows={6} value={csv} maxLength={50000} disabled={busy}
     placeholder={`${GROUP_HEADERS.join(',')}\n...`}
     onChange={e=>{setCsv(e.target.value);resetPending();}}/>
   <button type="button" className="secondary-button" disabled={busy||!csv.trim()} onClick={preview}>Validate and preview group</button>
   {members.length>0&&<div className="group-preview"><h3>Review {members.length} member{members.length!==1?'s':''} · KSh {(members.length*500).toFixed(2)} to be billed</h3>
     <p className="helper">Check the names, birth dates, sport preferences and guardian details against the original consent documents. A submitted form does not verify guardian consent or record payment.</p>
     <div className="table-scroll"><table><thead><tr><th>Member</th><th>Birth date</th><th>Sports selected</th><th>Guardian contact</th></tr></thead>
       <tbody>{members.map((m,i)=><tr key={i}><td>{m.fullName}</td><td>{m.dateOfBirth}</td><td>{m.sportIds.length}</td><td>{m.guardian?'Provided; verification pending':'Not provided (adult only)'}</td></tr>)}</tbody>
     </table></div>
     <label className="confirm-batch"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/> I have checked the group application details and will record charges, not payments.</label>
     <button type="button" disabled={busy||!confirmed} onClick={submit}>{busy?'Recording group…':`Register ${members.length} members`}</button>
   </div>}
   {error&&<p className="auth-error" role="alert">{error}</p>}
   {success&&<div className="success-box" role="status"><strong>Batch recorded: {success.groupReference}</strong><p>{success.count} member(s); KSh {success.totalBilled} billed and outstanding. Guardian consent and payment approvals remain separate.</p></div>}
 </section>;
}
