import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredId, teamName, canManageSport, maySeeTeam } from '../src/teams/policy.js';
test('validates team names and keeps leading/trailing space out',()=>{
 assert.equal(teamName('  Rugby Academy  '),'Rugby Academy');
 for(const value of ['', 'X', ' '.repeat(3), 'Ab\ncd', 'A'.repeat(101), undefined]) assert.throws(()=>teamName(value));
});
test('requires valid member, team and sport identifiers',()=>{
 assert.equal(requiredId('12','teamId'),'12');
 for(const x of ['0','-1','NaN','1 OR 1=1','1.5',null]) assert.throws(()=>requiredId(x,'teamId'));
});
test('patron is restricted to the exact currently assigned staff user',()=>{
 assert.equal(canManageSport(['PAT'],'3','3'),true);
 assert.equal(canManageSport(['PAT'],'3','4'),false);
 assert.equal(canManageSport(['REG'],'3','3'),false);
 assert.equal(canManageSport(['ADM'],'3',null),true);
 assert.equal(canManageSport(['MGT'],'3','3'),false);
});
test('management may read rosters but cannot change teams',()=>{
 assert.equal(maySeeTeam(['MGT'],'2',null),true);
 assert.equal(maySeeTeam(['PAT'],'2','3'),false);
 assert.equal(maySeeTeam(['PAT'],'2','2'),true);
});
