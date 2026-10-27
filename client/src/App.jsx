import EventsPanel from './EventsPanel.jsx';
import SportsTeamsPanel from './SportsTeamsPanel.jsx';
import RegistrationPanel from './RegistrationPanel.jsx';
import MemberDirectory from './MemberDirectory.jsx';
import PaymentPanel from './PaymentPanel.jsx';
import GuardianReviewPanel from './GuardianReviewPanel.jsx';
import { useEffect, useState } from 'react';

const plannedModules = [
  { title: 'Membership', description: 'Registration, fee assessment and payment verification', icon: '01', phase: 'Part 4 operational' },
  { title: 'Sports and teams', description: 'Patron assignments, teams and captains', icon: '02', phase: 'Part 5 operational' },
  { title: 'Store and sales', description: 'Products, receipts, stock alerts', icon: '03', phase: 'Planned' },
  { title: 'Events and fees', description: 'Fixtures, roster finalization and facilitation fee tracking', icon: '04', phase: 'Part 6 operational' },
  { title: 'Equipment', description: 'Issuance, returns, surcharges', icon: '05', phase: 'Planned' },
  { title: 'Reports', description: 'Revenue, participation, inventory', icon: '06', phase: 'Planned' },
];

export default function App() {
  const [api, setApi] = useState({ state: 'checking', message: 'Checking API…' });
  const [staff, setStaff] = useState(null);
  const [checkingLogin, setCheckingLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sports, setSports] = useState([]);
  const [organizations,setOrganizations]=useState([]);
  const [refreshMembers,setRefreshMembers]=useState(0);
  const [refreshSports,setRefreshSports]=useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/health', { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('API offline'); return response.json(); })
      .then((data) => { if (data.status !== 'ok') throw new Error('Unexpected API status'); setApi({state:'ok',message:'Backend API reachable'}); })
      .catch((e) => { if(e.name!=='AbortError') setApi({state:'error',message:'Backend unreachable. Start npm run dev:server.'}); });
    fetch('/api/v1/auth/me', { credentials: 'same-origin', signal: controller.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((json) => { if(json?.data) setStaff(json.data); })
      .catch(() => {})
      .finally(() => { if(!controller.signal.aborted) setCheckingLogin(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!staff) { setSports([]); setOrganizations([]); return; }
    const controller=new AbortController();
    fetch('/api/v1/sports',{credentials:'same-origin',signal:controller.signal})
      .then(r=>r.ok?r.json():null)
      .then(result=>{ if(result?.data) setSports(result.data); })
      .catch(()=>{});
    if(staff.roles.some(r=>['REG','ADM'].includes(r))){
      fetch('/api/v1/organizations',{credentials:'same-origin',signal:controller.signal})
        .then(r=>r.ok?r.json():null)
        .then(result=>{if(result?.data) setOrganizations(result.data);})
        .catch(()=>{});
    }
    return ()=>controller.abort();
  }, [staff?.id,refreshSports]);

  async function signIn(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const response=await fetch('/api/v1/auth/login',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email,password})
      });
      const data=await response.json();
      if(!response.ok) throw new Error(data?.error?.message||'Sign-in failed');
      setStaff(data.data); setPassword('');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function signOut() {
    if(!staff) return;
    setError(''); setBusy(true);
    try {
      const response=await fetch('/api/v1/auth/logout',{
        method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':staff.csrfToken}
      });
      if(!response.ok) throw new Error('Could not sign out. Refresh and try again.');
      setStaff(null);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">M</div><div><strong>Maringo</strong><small>SPORTS CLUB</small></div></div>
        <div className="sidebar-section">WORKSPACE</div>
        <div className="nav-item active"><span>◉</span> {staff?'Overview':'Staff sign-in'}</div>
        <div className="sidebar-section">MODULES</div>
        <div className="nav-item muted">● Member registration</div>
        <div className="nav-item muted">◎ Sports & teams</div>
        <div className="nav-item muted">◎ Store & inventory</div>
        <div className="nav-item muted">◎ Events & finances</div>
        <div className="sidebar-foot">Implementation — Part 5<br /><span>Sports, patrons and teams</span></div>
      </aside>
      <main className="content">
        <header><span>Management workspace</span><span className="tag">DEVELOPMENT • PART 5</span></header>
        <div className="main-body">
          <p className="eyebrow">MARINGO COUNTY · YOUTH DEVELOPMENT</p>
          <h1>Building a better way to manage sport.</h1>
          <p className="intro">A secure workspace for membership, payments, sport patrons and team rosters. Store and event transactions remain in development.</p>
          <div className="status-panel">
            <div className={`status-dot ${api.state}`} aria-hidden="true" />
            <div><strong>System connection</strong><p role="status" aria-live="polite">{api.message}</p></div>
            <span className="status-caption">API health only, not database status</span>
          </div>
          {!staff ? (
            <section className="auth-card" aria-label="Staff sign-in">
              <h2>Authorized staff sign-in</h2>
              <p>After PostgreSQL migrations, create your first administrator from the terminal with <code>npm run staff:create</code>.</p>
              {checkingLogin ? <p>Checking session…</p> : (
                <form onSubmit={signIn}>
                  <label htmlFor="email">Work email</label>
                  <input id="email" type="email" value={email} autoComplete="username" onChange={e=>setEmail(e.target.value)} required />
                  <label htmlFor="password">Password</label>
                  <input id="password" type="password" value={password} autoComplete="current-password" onChange={e=>setPassword(e.target.value)} required />
                  {error && <p className="auth-error" role="alert">{error}</p>}
                  <button disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
                </form>
              )}
            </section>
          ) : (
            <>
              <section className="auth-card signed-in">
                <div><h2>Welcome, {staff.fullName}</h2><p>Signed in as {staff.email}. Roles: {staff.roles.join(', ') || 'No roles assigned'}.</p></div>
                <button onClick={signOut} disabled={busy}>{busy?'Signing out…':'Sign out'}</button>
              </section>
              {error && <p role="alert" className="auth-error">{error}</p>}
              <div className="section-heading"><div><h2>Development modules</h2><p>Registration, payments, teams and sporting events are implemented. Store and equipment modules remain planned.</p></div><span className="count">6 modules</span></div>
              <div className="cards">
                {plannedModules.map(item=>(
                  <article className="module" key={item.title}>
                    <div className="module-top"><span className="module-num">{item.icon}</span><span className="module-phase">{item.phase}</span></div>
                    <h3>{item.title}</h3><p>{item.description}</p>
                  </article>
                ))}
              </div>
              <div className="note"><strong>Sports catalogue</strong><p>{sports.length ? `${sports.length} verified sports available: ${sports.map(s=>s.name).join(', ')}.` : 'Unable to load the sports catalogue. Run migrations and verify your database connection.'}</p></div>
              {staff.roles.some(role=>['REG','ADM'].includes(role))&&<>
                <RegistrationPanel staff={staff} sports={sports} organizations={organizations}
                  onOrganizationAdded={o=>setOrganizations(items=>[...items,o].sort((a,b)=>a.name.localeCompare(b.name)))}
                  onCreated={()=>setRefreshMembers(n=>n+1)}/>
                <MemberDirectory refresh={refreshMembers}/>
              </>}
              {staff.roles.some(role=>['ADM','MGT'].includes(role))&&<GuardianReviewPanel staff={staff} onUpdated={()=>setRefreshMembers(n=>n+1)}/>}
              {staff.roles.some(role=>['ADM','REG','FIN','MGT'].includes(role))&&<PaymentPanel staff={staff} onUpdated={()=>setRefreshMembers(n=>n+1)}/>}
              {staff.roles.some(role=>['ADM','MGT','PAT'].includes(role))&&<SportsTeamsPanel staff={staff} sports={sports} onPatronAssigned={()=>setRefreshSports(n=>n+1)}/>}
              {staff.roles.some(role=>['ADM','MGT','PAT','FIN'].includes(role))&&<EventsPanel staff={staff}/>}
              <div className="note"><strong>Pending functionality</strong><p>Events and facilitation fees are available. Commission amounts are illustrative only pending club policy approval. Store sales, equipment and comprehensive reports remain future milestones.</p></div>
            </>
          )}
          <footer>MSCMS · Guided by AI Safari and 1 Million Devs</footer>
        </div>
      </main>
    </div>
  );
}
