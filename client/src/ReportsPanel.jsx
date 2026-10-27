import {encodeCsv} from './reportExport.js';
import {useEffect,useState} from 'react';

const ALL_TABS=[
  {id:'overview',label:'Club cashflow',roles:['ADM','FIN','MGT']},
  {id:'memberships',label:'Memberships',roles:['ADM','REG','FIN','MGT']},
  {id:'sports',label:'Sports',roles:['ADM','FIN','MGT']},
  {id:'sales',label:'Store sales',roles:['ADM','STO','FIN','MGT']},
  {id:'inventory',label:'Stock',roles:['ADM','STO','FIN','MGT']},
  {id:'events',label:'Events',roles:['ADM','FIN','MGT']},
  {id:'equipment',label:'Equipment',roles:['ADM','STO','FIN','MGT']}
];
const toDate=(date)=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Africa/Nairobi'}).formatToParts(date)
  .filter(part=>['year','month','day'].includes(part.type))
  .reduce((o,p)=>({...o,[p.type]:p.value}),{});
function localDate(date){const p=toDate(date);return `${p.year}-${p.month}-${p.day}`;}
function defaultDates(){const today=localDate(new Date());const prior=new Date(Date.parse(`${today}T00:00:00Z`)-29*86400000);
  return {from:prior.toISOString().slice(0,10),to:today};}
const money=x=>`KSh ${Number(x??0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const title=key=>key.replace(/([A-Z])/g,' $1').replace(/_/g,' ').replace(/^./,x=>x.toUpperCase());
const cell=v=>typeof v==='boolean'?(v?'Yes':'No'):v==null?'—':String(v);
const priceKeys=new Set(['netCollected','billed','collectedLifetime','balanceNow','subtotal','discount','total','gross_sales','unit_price','assessed_fees','commission_on_assessed','commission_on_collected','assessed_surcharge_in_period']);
function Table({rows,columns}){
  if(!rows?.length)return <p className="helper">No matching records for this selection.</p>;
  const fields=columns||Object.keys(rows[0]);
  return <div className="report-table-scroll"><table><thead><tr>{fields.map(f=><th key={f}>{title(f)}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={r.id??r.sku??r.source??r.category??r.code??i}>{fields.map(f=><td key={f}>{priceKeys.has(f)?money(r[f]):cell(r[f])}</td>)}</tr>)}</tbody></table></div>;
}
function Figure({name,value}){return <div className="report-figure"><small>{name}</small><strong>{value}</strong></div>;}
// Reports intentionally use aggregated results only; no names/next-of-kin in CSV exports.

function downloadableRows(report,tab){
  if(tab==='overview')return report.sources;
  if(tab==='memberships')return report.categories;
  if(tab==='sports')return report.sports;
  if(tab==='sales')return report.products;
  if(tab==='inventory')return report.items;
  if(tab==='events')return report.events;
  return report.balances;
}
export default function ReportsPanel({staff}){
  const tabs=ALL_TABS.filter(t=>t.roles.some(r=>staff.roles.includes(r)));
  const [tab,setTab]=useState(tabs[0]?.id||'memberships');
  const [dates,setDates]=useState(defaultDates);
  const [applied,setApplied]=useState({...dates});
  const [state,setState]=useState({busy:true,error:'',data:null});
  useEffect(()=>{
    const controller=new AbortController();
    setState({busy:true,error:'',data:null});
    const q=new URLSearchParams(applied);
    fetch(`/api/v1/reports/${tab}?${q.toString()}`,{credentials:'same-origin',signal:controller.signal})
      .then(async res=>{const json=await res.json();if(!res.ok)throw new Error(json.error?.message||'Report could not be loaded.');return json.data;})
      .then(data=>setState({busy:false,error:'',data}))
      .catch(error=>{if(error.name!=='AbortError')setState({busy:false,error:error.message,data:null});});
    return ()=>controller.abort();
  },[tab,applied.from,applied.to]);
  const report=state.data;
  function saveCsv(){
    const rows=downloadableRows(report,tab); if(!rows.length)return;
    const csv=encodeCsv(rows); const url=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`maringo-${tab}-${applied.from}-to-${applied.to}.csv`;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  if(!tabs.length)return null;
  return <section className="store-panel reports-panel" aria-label="Club reports">
    <h2>Club reports and financial reconciliation</h2>
    <p className="helper">Role-restricted, read-only reports. Kenya date boundaries; cash received and amounts billed are intentionally separate. All figures are in KSh.</p>
    <div className="report-tabs" role="group" aria-label="Report type">{tabs.map(t=><button key={t.id} type="button" className={tab===t.id?'active':''} aria-pressed={tab===t.id} onClick={()=>setTab(t.id)}>{t.label}</button>)}</div>
    <form className="report-controls" onSubmit={e=>{e.preventDefault();setApplied({...dates});}}>
      <label>From <input type="date" required value={dates.from} onChange={e=>setDates(d=>({...d,from:e.target.value}))}/></label>
      <label>To <input type="date" required min={dates.from} value={dates.to} onChange={e=>setDates(d=>({...d,to:e.target.value}))}/></label>
      <button type="submit" disabled={state.busy}>Apply dates</button>
      <button type="button" disabled={!report || !downloadableRows(report,tab).length} onClick={saveCsv}>Export displayed rows (CSV)</button>
    </form>
    {state.busy&&<p role="status">Loading report…</p>}
    {state.error&&<p role="alert" className="auth-error">{state.error}</p>}
    {report&&<>
      <p className="helper">Reporting period: {report.period.from} to {report.period.to}, inclusive (Africa/Nairobi).</p>
      {(tab==='overview'||tab==='income')&&<><div className="report-figures"><Figure name="Net recorded collections" value={money(report.netCollected)}/><Figure name="Commission expense / profit" value="Not booked"/></div><h3>Collections by source</h3><Table rows={report.sources}/><h3>Collections by payment method</h3><Table rows={report.byMethod}/>{report.notes.map(n=><p className="helper" key={n}>{n}</p>)}</>}
      {tab==='memberships'&&<><h3>Membership registrations</h3><Table rows={report.categories}/><h3>Age at registration</h3><Table rows={report.ageBands}/><p className="helper">{report.note}</p></>}
      {tab==='sports'&&<><h3>Sports and current roles</h3><Table rows={report.sports}/><p className="helper">{report.note}</p></>}
      {tab==='sales'&&<><div className="report-figures"><Figure name="Verified completed sales" value={report.summary.completed_sales}/><Figure name="Completed sales before refunds" value={money(report.summary.total)}/><Figure name="Discounts given" value={money(report.summary.discount)}/></div><h3>Products sold (gross, before discounts)</h3><Table rows={report.products}/><p className="helper">{report.note}</p></>}
      {tab==='inventory'&&<><h3>Current stock and period movements</h3><Table rows={report.items}/><p className="helper">{report.note}</p></>}
      {tab==='events'&&<><h3>Events, fees and provisional commission</h3><Table rows={report.events}/><p className="helper">{report.note}</p></>}
      {tab==='equipment'&&<><div className="report-figures"><Figure name="Equipment loans issued" value={report.loans.issued_in_period}/><Figure name="Currently overdue" value={report.loans.overdue_now}/><Figure name="Approved assessments in period (not collected)" value={money(report.incidents.assessed_surcharge_in_period)}/></div><h3>Current equipment balances</h3><Table rows={report.balances}/><p className="helper">{report.note}</p></>}
      {report.truncated&&<p role="status" className="helper">Showing first 100 events or 200 stock items only. Narrow your reporting period or use filters before relying on exported totals.</p>}
    </>}
  </section>;
}
