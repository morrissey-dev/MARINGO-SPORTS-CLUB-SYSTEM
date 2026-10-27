import {useState} from 'react';

const empty = () => ({fullName:'',dateOfBirth:'',gender:'',phone:'',subCounty:'',schoolOrCollege:'',
  registrationType:'individual',organizationId:'',sportIds:[],nextOfKin:{fullName:'',relationship:'',phone:''},
  guardian:{fullName:'',relationship:'',phone:''}});
const years = (dob, now = new Date()) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const [y,m,d]=dob.split('-').map(Number),[Y,M,D]=today.split('-').map(Number);
  return Y-y-(M<m||(M===m&&D<d)?1:0);
};
const fetchJson=async(path,opts={})=>{
  const response=await fetch(path,{credentials:'same-origin',...opts});
  const json=await response.json().catch(()=>null);
  if(!response.ok) {
    const error=new Error(json?.error?.message || `Request failed (${response.status})`);
    error.code=json?.error?.code;
    throw error;
  }
  return json;
};
export default function RegistrationPanel({staff,sports,organizations,onOrganizationAdded,onCreated}) {
  const [form,setForm]=useState(empty);
  const [organization,setOrganization]=useState({name:'',type:'school'});
  const [showOrg,setShowOrg]=useState(false);
  const [busy,setBusy]=useState(false);
  const [orgBusy,setOrgBusy]=useState(false);
  const [error,setError]=useState('');
  const [orgError,setOrgError]=useState('');
  const [success,setSuccess]=useState(null);
  const [key,setKey]=useState(null);
  const age=years(form.dateOfBirth);
  const minor=age!==null&&age>=0&&age<18;
  const eligible=age!==null&&age>=12&&age<=35;
  const fee=form.registrationType==='group'?'500.00':'1000.00';
  function update(name,value){setForm(old=>({...old,[name]:value}));setKey(null);setSuccess(null);}
  function updateContact(section,name,value){setForm(old=>({...old,[section]:{...old[section],[name]:value}}));setKey(null);setSuccess(null);}
  function toggleSport(id){
    setForm(old=>({...old,sportIds:old.sportIds.includes(id)?old.sportIds.filter(s=>s!==id):[...old.sportIds,id]}));
    setKey(null);setSuccess(null);
  }
  function moveSport(index,delta){
    setForm(old=>{const copy=[...old.sportIds];const next=index+delta;
      if(next>=0&&next<copy.length) [copy[index],copy[next]]=[copy[next],copy[index]];
      return {...old,sportIds:copy};});setKey(null);setSuccess(null);
  }
  async function createOrganization(event){
    event.preventDefault();setOrgBusy(true);setOrgError('');
    try{
      const result=await fetchJson('/api/v1/organizations',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':staff.csrfToken},body:JSON.stringify(organization)});
      onOrganizationAdded(result.data);
      update('organizationId',result.data.id);
      setShowOrg(false);setOrganization({name:'',type:'school'});
    }catch(e){setOrgError(e.message)}finally{setOrgBusy(false)}
  }
  async function save(event){
    event.preventDefault();setError('');setBusy(true);setSuccess(null);
    const requestKey=key||crypto.randomUUID();
    if(!key)setKey(requestKey); // preserve key for uncertain network failures
    const body={...form,sportIds:form.sportIds,organizationId:form.registrationType==='group'?form.organizationId:null};
    if(!minor) delete body.guardian;
    try{
      const result=await fetchJson('/api/v1/members',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':staff.csrfToken,'Idempotency-Key':requestKey},body:JSON.stringify(body)});
      setSuccess(result.data);onCreated?.();setForm(empty());setKey(null);
    }catch(e){setError(`${e.message}${e.code==='POSSIBLE_DUPLICATE'?' Ask the registration officer to check existing records.':''}`)}finally{setBusy(false)}
  }
  return (
    <section className="registration" aria-label="New member registration">
      <div className="registration-heading"><h2>Register a member</h2><p>Record a membership application. The fee will be <strong>outstanding</strong> until payment is verified.</p></div>
      {success&&<div className="success-box" role="status"><strong>Application recorded: {success.membershipNumber}</strong>
        <p>{success.fullName} • {success.ageBand} • KSh {success.membershipFee} billed • Payment outstanding.</p>
        {success.guardianConsent==='pending'&&<p>Guardian consent is pending verification. The member is not active.</p>}
      </div>}
      <form onSubmit={save} className="registration-form">
        <fieldset><legend>Personal details</legend>
          <div className="form-grid">
            <label>Full name <input value={form.fullName} onChange={e=>update('fullName',e.target.value)} maxLength={150} required/></label>
            <label>Date of birth <input type="date" value={form.dateOfBirth} onChange={e=>update('dateOfBirth',e.target.value)} required/></label>
            <label>Gender (optional) <select value={form.gender} onChange={e=>update('gender',e.target.value)}><option value="">Prefer not to state / not provided</option><option>Female</option><option>Male</option><option>Other</option></select></label>
            <label>Phone (optional) <input type="tel" value={form.phone} maxLength={30} onChange={e=>update('phone',e.target.value)}/></label>
            <label>Sub-county <input value={form.subCounty} maxLength={100} onChange={e=>update('subCounty',e.target.value)} required/></label>
            <label>School / college (optional) <input value={form.schoolOrCollege} maxLength={150} onChange={e=>update('schoolOrCollege',e.target.value)}/></label>
          </div>
          {age!==null && <p className={eligible?'helper':'auth-error'}>Age: {age} years. {eligible?'Eligible age range.':'New registration must be ages 12–35.'}</p>}
        </fieldset>
        <fieldset><legend>Membership</legend>
          <div className="form-grid"><label>Registration type
            <select value={form.registrationType} onChange={e=>update('registrationType',e.target.value)}><option value="individual">Individual — KSh 1,000</option><option value="group">Group member — KSh 500</option></select>
          </label>
          {form.registrationType==='group'&& <label>Organization
            <select value={form.organizationId} onChange={e=>update('organizationId',e.target.value)} required><option value="">Select organization</option>{organizations.map(o=><option key={o.id} value={o.id}>{o.name} ({o.type})</option>)}</select>
          </label>}</div>
          {form.registrationType==='group'&&<button type="button" className="secondary-button" onClick={()=>setShowOrg(v=>!v)}>{showOrg?'Close organization form':'+ Add school, college or religious organization'}</button>}
          <p className="helper">Membership fee to be billed: KSh {fee}. No payment is collected by this form.</p>
        </fieldset>
        <fieldset><legend>Sports interests, in priority order</legend>
          <div className="sports-picker">{sports.map(s=><label key={s.id} className="sport-option"><input type="checkbox" checked={form.sportIds.includes(s.id)} onChange={()=>toggleSport(s.id)}/>{s.name}</label>)}</div>
          {form.sportIds.length>0&&<div className="priorities"><strong>Preference order</strong>
            <ol>{form.sportIds.map((id,index)=><li key={id}><span>{sports.find(s=>s.id===id)?.name||id}</span>
              <button type="button" aria-label={`Move ${sports.find(s=>s.id===id)?.name} up`} onClick={()=>moveSport(index,-1)} disabled={index===0}>↑</button>
              <button type="button" aria-label={`Move ${sports.find(s=>s.id===id)?.name} down`} onClick={()=>moveSport(index,1)} disabled={index===form.sportIds.length-1}>↓</button></li>)}</ol>
          </div>}
        </fieldset>
        <fieldset><legend>Next of kin</legend><div className="form-grid">
          <label>Full name <input value={form.nextOfKin.fullName} maxLength={150} onChange={e=>updateContact('nextOfKin','fullName',e.target.value)} required/></label>
          <label>Relationship <input value={form.nextOfKin.relationship} maxLength={80} onChange={e=>updateContact('nextOfKin','relationship',e.target.value)} required/></label>
          <label>Phone <input type="tel" value={form.nextOfKin.phone} maxLength={30} onChange={e=>updateContact('nextOfKin','phone',e.target.value)} required/></label>
        </div></fieldset>
        {minor&&<fieldset className="guardian-fieldset"><legend>Guardian details — required for minors</legend><p className="helper">Creating a record does not verify consent. An authorized manager must check the guardian's approval before membership activation.</p><div className="form-grid">
          <label>Guardian name <input value={form.guardian.fullName} maxLength={150} onChange={e=>updateContact('guardian','fullName',e.target.value)} required/></label>
          <label>Relationship <input value={form.guardian.relationship} maxLength={80} onChange={e=>updateContact('guardian','relationship',e.target.value)} required/></label>
          <label>Guardian phone <input type="tel" value={form.guardian.phone} maxLength={30} onChange={e=>updateContact('guardian','phone',e.target.value)} required/></label>
        </div></fieldset>}
        {error&&<p className="auth-error" role="alert">{error}</p>}
        <div className="form-actions"><button type="submit" disabled={busy||!eligible||form.sportIds.length===0||sports.length===0}>{busy?'Recording…':'Record application & membership charge'}</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={()=>{setForm(empty());setError('');setKey(null);}}>Clear form</button></div>
      </form>
      {showOrg&&form.registrationType==='group'&&<form className="organization-form" onSubmit={createOrganization}><h3>Add organization</h3>
        <div className="form-grid"><label>Organization name <input value={organization.name} onChange={e=>setOrganization(s=>({...s,name:e.target.value}))} required minLength={2}/></label>
          <label>Organization type <select value={organization.type} onChange={e=>setOrganization(s=>({...s,type:e.target.value}))}><option value="school">School</option><option value="college">College</option><option value="religious">Religious organization</option></select></label></div>
        {orgError&&<p role="alert" className="auth-error">{orgError}</p>}
        <button disabled={orgBusy}>{orgBusy?'Saving…':'Add organization'}</button>
      </form>}
    </section>
  );
}
