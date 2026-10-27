// Read-only CSV export for visible aggregate rows (no private membership fields).
// Prefix spreadsheet formula-like cells to prevent formula execution on opening CSV.
const cell=x=>typeof x==='boolean'?(x?'Yes':'No'):x==null?'':String(x);
export function encodeCsv(rows){
  if(!Array.isArray(rows) || !rows.length)return '';
  const headers=Object.keys(rows[0]);
  const safe=x=>{
    const raw=cell(x);
    const escaped=/^\s*[=+@\-\t\r]/.test(raw)?`'${raw}`:raw;
    return `"${escaped.replaceAll('"','""')}"`;
  };
  return [headers.map(safe).join(','),...rows.map(row=>headers.map(key=>safe(row[key])).join(','))].join('\r\n');
}
