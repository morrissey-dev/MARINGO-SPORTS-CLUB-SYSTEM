import { useEffect, useState } from 'react';

async function request(path,staff,options={}) {
  const response=await fetch(`/api/v1${path}`,{credentials:'same-origin',...options,
    headers:{...(options.body?{'Content-Type':'application/json','X-CSRF-Token':staff.csrfToken}:{})}});
  const json=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(json?.error?.message||`Request failed (${response.status})`);
  return json?.data;
}

export default function SportsTeamsPanel({staff,sports,onPatronAssigned}) {
  const [teams,setTeams]=useState([]),[candidates,setCandidates]=useState([]);
  const [sportId,setSportId]=useState(''),[patronUserId,setPatronUserId]=useState('');
  const [teamName,setTeamName]=useState(''),[teamSportId,setTeamSportId]=useState('');
  const [teamId,setTeamId]=useState(''),[memberId,setMemberId]=useState('');
  const [roster,setRoster]=useState([]),[status,setStatus]=useState(''),[error,setError]=useState('');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const canAssign=staff.roles.some(r=>['ADM','MGT'].includes(r));
  const canManage=staff.roles.some(r=>['ADM','PAT'].includes(r));
  const visibleSports=staff.roles.includes('ADM') ? sports : sports.filter(s=>String(s.patronUserId)===String(staff.id));

  async function refresh() {
    const data=await request('/teams',staff);
    setTeams(data||[]);
  }
  useEffect(()=>{
    let cancelled=false;
    async function load(){
      try{
        const [loadedTeams,loadedCandidates]=await Promise.all([
          request('/teams',staff),canAssign?request('/sports/patron-candidates',staff):Promise.resolve([])
        ]);
        if(!cancelled){setTeams(loadedTeams||[]);setCandidates(loadedCandidates||[]);setError('');}
      }catch(e){if(!cancelled)setError(e.message);}finally{if(!cancelled)setLoading(false);}
    }
    load();return ()=>{cancelled=true;};
  },[staff.id]);
  useEffect(()=>{
    if(!teamId){setRoster([]);return;}
    let cancelled=false;
    request(`/teams/${teamId}/members`,staff).then(data=>{if(!cancelled)setRoster(data||[]);})
      .catch(e=>{if(!cancelled){setRoster([]);setError(e.message);}});
    return ()=>{cancelled=true;};
  },[teamId,teams,staff.id]);

  async function change(event,endpoint,body,success) {
    event.preventDefault();setBusy(true);setError('');setStatus('');
    try{
      const result=await request(endpoint,staff,{method:'POST',body:JSON.stringify(body)});
      await refresh();
      if(success)success(result);
      setStatus(result.unchanged?'No change needed.':'Saved successfully.');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const selected=teams.find(t=>String(t.id)===String(teamId));
  return <section className="sports-teams-panel" aria-label="Sports and teams management">
    <h2>Sports, patrons and teams</h2>
    <p className="helper">Management assigns a patron to each sport. The patron creates teams, enrolls paid active members, and appoints a captain from that team.</p>
    {loading&&<p role="status">Loading teams…</p>}
    {error&&<p role="alert" className="auth-error">{error}</p>}
    {status&&<p role="status" className="success-box">{status}</p>}
    {canAssign&&<form onSubmit={e=>change(e,`/sports/${sportId}/patron-assignments`,{patronUserId},()=>onPatronAssigned?.())} className="team-form">
      <h3>Assign a sport patron</h3>
      <div className="team-row"><label>Sport<select required value={sportId} onChange={e=>setSportId(e.target.value)}><option value="">Choose sport</option>{sports.map(s=><option key={s.id} value={s.id}>{s.name}{s.patronName?` — ${s.patronName}`:''}</option>)}</select></label>
      <label>Staff patron<select required value={patronUserId} onChange={e=>setPatronUserId(e.target.value)}><option value="">Choose patron</option>{candidates.map(p=><option value={p.id} key={p.id}>{p.fullName}</option>)}</select></label></div>
      <button disabled={busy||!sportId||!patronUserId}>Assign patron</button>
    </form>}
    {canManage&&<form className="team-form" onSubmit={e=>change(e,'/teams',{sportId:teamSportId,name:teamName},()=>setTeamName(''))}>
      <h3>Create a team</h3><div className="team-row"><label>Sport<select required value={teamSportId} onChange={e=>setTeamSportId(e.target.value)}><option value="">Choose sport</option>{visibleSports.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Team name<input minLength={2} maxLength={100} value={teamName} onChange={e=>setTeamName(e.target.value)} placeholder="e.g. Football Juniors" required/></label></div>
      <button disabled={busy||!teamSportId||teamName.trim().length<2}>Create team</button>
    </form>}
    <div className="team-form"><h3>Current teams ({teams.length})</h3>
      <div className="table-scroll"><table><thead><tr><th>Sport</th><th>Team</th><th>Members</th><th>Captain</th></tr></thead><tbody>
      {teams.map(t=><tr key={t.id}><td>{t.sportName}</td><td>{t.name}</td><td>{t.memberCount}</td><td>{t.captainName||'Not assigned'}</td></tr>)}
      {!teams.length&&<tr><td colSpan="4">No teams found for your role.</td></tr>}
      </tbody></table></div>
    </div>
    <div className="team-form"><h3>Team roster and captain</h3>
      <label>Selected team<select value={teamId} onChange={e=>setTeamId(e.target.value)}><option value="">Choose team</option>{teams.map(t=><option key={t.id} value={t.id}>{t.sportName} — {t.name}</option>)}</select></label>
      {selected&&<><p className="helper">Only already-registered, active, fully paid members can be added. Enter their member ID (not their personal phone number).</p>
      {canManage&&<form onSubmit={e=>change(e,`/teams/${teamId}/members`,{memberId},()=>setMemberId(''))} className="team-row team-inline">
        <label>Active member ID<input value={memberId} onChange={e=>setMemberId(e.target.value)} inputMode="numeric" pattern="[0-9]+" required/></label>
        <button disabled={busy||!memberId}>Add member</button>
      </form>}
      <div className="table-scroll"><table><thead><tr><th>Member number</th><th>Name</th><th>Role</th><th>Action</th></tr></thead><tbody>
      {roster.map(m=><tr key={m.id}><td>{m.membershipNumber}</td><td>{m.fullName}</td><td>{m.isCaptain?'Captain':'Member'}</td>
        <td>{canManage&&!m.isCaptain&&<button disabled={busy} onClick={async()=>{
           setBusy(true);setError('');try{await request(`/teams/${teamId}/captain-assignments`,staff,{method:'POST',body:JSON.stringify({memberId:m.id})});await refresh();setStatus('Captain appointed.');}
           catch(e){setError(e.message);}finally{setBusy(false);}
         }}>Appoint captain</button>}</td></tr>)}
      {!roster.length&&<tr><td colSpan="4">No active team members.</td></tr>}
      </tbody></table></div></>}
    </div>
    <p className="helper">The original case lists 15 sport names although it refers to 16. We have not invented a sixteenth sport.</p>
  </section>;
}
