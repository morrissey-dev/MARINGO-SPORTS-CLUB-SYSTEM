import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACE_LINKS, visibleWorkspaces } from './workspaceNavigation.js';

const names = roles => visibleWorkspaces(roles).map(item=>item.id);

test('guest or malformed roles do not expose staff links',()=>{
  assert.deepEqual(names([]),[]);
  assert.deepEqual(visibleWorkspaces(null),[]);
});
test('registrars see registration, payments, reports but no store or private guardian review',()=>{
  assert.deepEqual(names(['REG']),[
    'workspace-registration','workspace-directory','workspace-payments','workspace-reports']);
});
test('store clerk sees sales, equipment and reports, not registrations',()=>{
  assert.deepEqual(names(['STO']),['workspace-store','workspace-equipment','workspace-reports']);
});
test('patron sees assigned-feature entry points, but not finance/reports',()=>{
  assert.deepEqual(names(['PAT']),['workspace-teams','workspace-events','workspace-equipment']);
});
test('finance sees payments, events, stock, equipment and reports',()=>{
  assert.deepEqual(names(['FIN']),['workspace-payments','workspace-events','workspace-store','workspace-equipment','workspace-reports']);
});
test('administrator sees all current staff workspaces exactly once',()=>{
  assert.deepEqual(names(['ADM']),WORKSPACE_LINKS.map(x=>x.id));
});
test('multiple roles yield union, with no duplicate links',()=>{
  const ids=names(['REG','STO']);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(ids.includes('workspace-registration'));
  assert.ok(ids.includes('workspace-store'));
});
test('each workspace id and label is unique and anchor-compatible',()=>{
  assert.equal(new Set(WORKSPACE_LINKS.map(x=>x.id)).size, WORKSPACE_LINKS.length);
  for(const item of WORKSPACE_LINKS){
    assert.match(item.id,/^workspace-[a-z-]+$/);
    assert.ok(item.label.length>=4);
    assert.ok(item.roles.length>=1);
  }
});
test('captain role has no standalone page; do not misrepresent access',()=>{
  assert.deepEqual(names(['CAP']),[]);
});
