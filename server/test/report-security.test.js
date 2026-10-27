import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_ROLES } from '../src/reports/policy.js';
import { encodeCsv } from '../../client/src/reportExport.js';

test('registrars see only membership aggregate reports, never income or incidents',()=>{
  const allowed=Object.entries(REPORT_ROLES).filter(([,r])=>r.includes('REG')).map(([k])=>k);
  assert.deepEqual(allowed,['memberships']);
  assert.ok(!REPORT_ROLES.income.includes('REG'));
  assert.ok(!REPORT_ROLES.equipment.includes('REG'));
});
test('patrons never see unscoped clubwide financial reports',()=>{
  assert.ok(Object.values(REPORT_ROLES).every(r=>!r.includes('PAT')));
  for(const r of ['income','overview','events','equipment']) assert.ok(REPORT_ROLES[r].includes('MGT'));
});
test('CSV quotes values and neutralizes formula and CRLF injection',()=>{
  const csv=encodeCsv([{sku:'=SUM(1,1)',name:'-2',qty:2},{sku:'  @cmd',name:'a"b\nnext',qty:1}]);
  assert.match(csv,/"'=SUM\(1,1\)"/);
  assert.match(csv,/"'-2"/);
  assert.match(csv,/"'  @cmd"/);
  assert.match(csv,/"a""b\nnext"/);
  assert.equal(encodeCsv([]),'');
});
