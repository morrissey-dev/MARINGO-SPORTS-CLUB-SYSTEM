import { useEffect,useState } from 'react';

async function api(path,staff,options={}){
  const response=await fetch(`/api/v1${path}`,{
    credentials:'same-origin',...options,
    headers:{...(options.body?{'Content-Type':'application/json','X-CSRF-Token':staff.csrfToken}:{}),...(options.headers||{})}
  });
  const json=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(json?.error?.message||`Request failed (${response.status})`);
  return json?.data;
}
export default function EventsPanel({staff}){
  const [teams,setTeams]=useState([]),[events,setEvents]=useState([]),[selectedId,setSelectedId]=useState('');
  const [detail,setDetail]=useState(null),[teamId,setTeamId]=useState(''),[eventType,setEventType]=useState('external');
  const [eventDate,setEventDate]=useState(new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())),[venue,setVenue]=useState(''),[opponent,setOpponent]=useState('');
  const [memberId,setMemberId]=useState(''),[feeMemberId,setFeeMemberId]=useState(''),[amount,setAmount]=useState('500.00');
  const [method,setMethod]=useState('cash'),[reference,setReference]=useState('');
  const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const canSchedule=staff.roles.some(r=>['ADM','PAT'].includes(r));
  const canCollect=staff.roles.some(r=>['ADM','FIN'].includes(r));

  async function refresh(){
    const eventsLoaded=await api('/events',staff);setEvents(eventsLoaded||[]);
  }
  async function refreshDetail(id=selectedId){
    if(!id){setDetail(null);return;}
    setDetail(await api(`/events/${id}/facilitation-summary`,staff));
  }
  useEffect(()=>{
    let cancelled=false;
    Promise.all([api('/events',staff),canSchedule?api('/teams',staff):Promise.resolve([])])
      .then(([all,availableTeams])=>{if(!cancelled){setEvents(all||[]);setTeams(availableTeams||[]);}})
      .catch(e=>{if(!cancelled)setError(e.message);});
    return ()=>{cancelled=true;};
  },[staff.id]);
  useEffect(()=>{
    if(!selectedId){setDetail(null);return;}
    let cancelled=false;
    api(`/events/${selectedId}/facilitation-summary`,staff)
      .then(result=>{if(!cancelled)setDetail(result);})
      .catch(e=>{if(!cancelled){setError(e.message);setDetail(null);}});
    return ()=>{cancelled=true;};
  },[selectedId,staff.id]);
  async function submit(action){
    setBusy(true);setError('');setMessage('');
    try{const result=await action();await refresh();setMessage(typeof result==='string'?result:'Action completed.');}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const selected=events.find(e=>e.id===selectedId);
  const selectedFee=detail?.participants.find(p=>p.memberId===feeMemberId);
  return <section className="events-panel" aria-label="Sporting events and facilitation fees">
    <h2>Sporting events and facilitation fees</h2>
    <p className="helper">Create fixtures, build verified rosters, and finalize external-match fees at KSh 500 per participant. Internal events have no facilitation charge.</p>
    {error&&<p role="alert" className="auth-error">{error}</p>}
    {message&&<p role="status" className="success-box">{message}</p>}
    {canSchedule&&<form className="event-section" onSubmit={e=>{e.preventDefault();submit(async()=>{
      const created=await api('/events',staff,{method:'POST',body:JSON.stringify({teamId,eventType,eventDate,venue,opponent})});
      setSelectedId(created.id);setVenue('');setOpponent('');
    });}}>
      <h3>Schedule an event</h3>
      <div className="event-fields">
        <label>Team<select required value={teamId} onChange={e=>setTeamId(e.target.value)}><option value="">Choose team</option>{teams.map(t=><option key={t.id} value={t.id}>{t.sportName} — {t.name}</option>)}</select></label>
        <label>Type<select value={eventType} onChange={e=>setEventType(e.target.value)}><option value="internal">Internal</option><option value="external">External match</option></select></label>
        <label>Date<input type="date" required value={eventDate} onChange={e=>setEventDate(e.target.value)}/></label>
        <label>Venue<input required minLength={2} maxLength={150} value={venue} onChange={e=>setVenue(e.target.value)} /></label>
        {eventType==='external'&&<label>Opponent<input required minLength={2} maxLength={150} value={opponent} onChange={e=>setOpponent(e.target.value)} /></label>}
      </div>
      <button disabled={busy||!teamId||!venue.trim()||(eventType==='external'&&!opponent.trim())}>Create event</button>
    </form>}
    <div className="event-section">
      <h3>Scheduled events ({events.length})</h3>
      <label>Open an event<select value={selectedId} onChange={e=>{setSelectedId(e.target.value);setMemberId('');setFeeMemberId('');}}><option value="">Choose event</option>
        {events.map(e=><option key={e.id} value={e.id}>{e.eventDate} · {e.sportName} · {e.teamName} ({e.status})</option>)}</select></label>
      {selected&&<p className="helper">{selected.eventType==='external'?'External match':'Internal event'} at {selected.venue} · {selected.participantCount} participant(s) · {selected.status}</p>}
    </div>
    {detail&&<div className="event-section">
      <h3>Participant roster and fees</h3>
      {canSchedule&&detail.status==='draft'&&<form onSubmit={e=>{e.preventDefault();submit(async()=>{
        await api(`/events/${selectedId}/participants`,staff,{method:'POST',body:JSON.stringify({memberId})});
        setMemberId('');await refreshDetail();
      });}} className="event-inline">
        <label>Active team member ID<input inputMode="numeric" pattern="[0-9]+" value={memberId} required onChange={e=>setMemberId(e.target.value)}/></label>
        <button disabled={busy}>Add player</button>
      </form>}
      <div className="table-scroll"><table><thead><tr><th>Member</th><th>Charge ID</th><th>Assessed</th><th>Verified</th><th>Balance</th><th>Actions</th></tr></thead><tbody>
        {detail.participants.map(p=><tr key={p.id}><td>{p.memberNumber} · {p.fullName}</td><td>{p.chargeId||'After finalizing'}</td><td>KSh {p.fee}</td><td>KSh {p.paid}</td><td>KSh {p.balance}</td><td>{canSchedule&&detail.status==='draft'&&<button disabled={busy}
          type="button" onClick={()=>submit(async()=>{await api(`/events/${selectedId}/participants/${p.memberId}`,staff,{method:'DELETE',headers:{'X-CSRF-Token':staff.csrfToken}});await refreshDetail();return 'Player removed from draft roster.';})}>Remove</button>}</td></tr>)}
        {!detail.participants.length&&<tr><td colSpan="6">No players have been enrolled.</td></tr>}
      </tbody></table></div>
      {canSchedule&&detail.status==='draft'&&<button disabled={busy||!detail.participants.length} onClick={()=>submit(async()=>{
        const result=await api(`/events/${selectedId}/finalize-roster`,staff,{method:'POST',body:'{}'});
        await refreshDetail();return result.unchanged?'Roster already finalized.':`Finalized: ${result.chargesCreated||0} external-match charges posted.`;
      })}>Finalize roster and assess external fees</button>}
      {canSchedule&&detail.status==='draft'&&<button type="button" disabled={busy} onClick={()=>{
        if(!window.confirm('Cancel this draft event? This cannot be undone.'))return;
        submit(async()=>{await api(`/events/${selectedId}/cancel`,staff,{method:'POST',body:'{}'});await refreshDetail();return 'Draft event cancelled.';});
      }}>Cancel draft event</button>}
      <p className="helper"><strong>Assessed:</strong> KSh {detail.assessed} · <strong>Verified:</strong> KSh {detail.verified} · <strong>Unpaid:</strong> KSh {detail.outstanding}</p>
      {detail.eventType==='external'&&detail.commission.status==='provisional'&&<div className="event-warning">
        <strong>Patron commission — estimate only (20%)</strong>
        <p>Billed-fee illustration: KSh {detail.commission.illustrationOnBilled}. Verified-receipts illustration: KSh {detail.commission.illustrationOnCollected}.</p>
        <p>Club management has not confirmed the basis. Neither amount is payable yet.</p>
      </div>}
      {canCollect&&detail.eventType==='external'&&detail.status==='finalized'&&<form className="event-section" onSubmit={e=>{e.preventDefault();submit(async()=>{
        if(!selectedFee?.chargeId)throw new Error('Select a member fee.');
        const recorded=await api('/payments',staff,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},
          body:JSON.stringify({chargeId:selectedFee.chargeId,amount,method,reference:method==='mobile_money'?reference:undefined})});
        await refreshDetail();setReference('');
        return `Payment ${recorded.id} recorded as pending. Another authorized officer must verify it.`;
      });}}>
        <h4>Record pending facilitation payment</h4>
        <p className="helper">A different finance/management officer must independently verify payment in the Payments panel.</p>
        <div className="event-fields">
          <label>Player fee<select required value={feeMemberId} onChange={e=>setFeeMemberId(e.target.value)}><option value="">Select unpaid player fee</option>{detail.participants.filter(p=>Number(p.balance)>0).map(p=><option value={p.memberId} key={p.id}>{p.memberNumber} — KSh {p.balance} outstanding</option>)}</select></label>
          <label>Amount (KES)<input value={amount} onChange={e=>setAmount(e.target.value)} pattern="(0|[1-9][0-9]*)\.[0-9]{2}" required /></label>
          <label>Method<select value={method} onChange={e=>setMethod(e.target.value)}><option value="cash">Cash</option><option value="mobile_money">Mobile money</option></select></label>
          {method==='mobile_money'&&<label>Transfer reference<input value={reference} onChange={e=>setReference(e.target.value)} required/></label>}
        </div>
        <button disabled={busy||!feeMemberId}>Record pending payment</button>
      </form>}
    </div>}
  </section>;
}
