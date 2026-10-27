import test from 'node:test';
import assert from 'node:assert/strict';
import {GROUP_HEADERS,prepareGroupCsv,parseCsv} from './groupCsv.js';
const sports=[{id:'1',name:'Hockey'},{id:'2',name:'Chess'}];
const fake=(name,year='2002',sport='Hockey|Chess')=>[
 name,`${year}-03-20`,'Other','','Example Sub-County','','"'+sport+'"',
 'Fictional Kin','Sibling','0700000000','','',''].join(',');
const csv=(...rows)=>GROUP_HEADERS.join(',')+'\n'+rows.join('\n');
test('quoted commas, escaped quotes and CRLF parse correctly',()=>{
 const rows=parseCsv('a,b\r\n"one, two","he said ""hello"""\r\n');
 assert.deepEqual(rows,[['a','b'],['one, two','he said "hello"']]);
});
test('batch preview maps ordered sports names to stable IDs',()=>{
 const result=prepareGroupCsv(csv(fake('Fictional Adult')),sports);
 assert.equal(result.length,1);
 assert.deepEqual(result[0].sportIds,['1','2']);
 assert.equal(result[0].registrationType,undefined);
});
test('invalid CSV headers, too many rows and unknown sport fail safely',()=>{
 assert.throws(()=>prepareGroupCsv('wrong,header\nA,B',sports),/header/);
 assert.throws(()=>prepareGroupCsv(csv(...Array.from({length:21},(_,i)=>fake(`Fake Person ${i}`))),sports),/1–20/);
 assert.throws(()=>prepareGroupCsv(csv(fake('Fictional Adult','2002','Unlisted')),sports),/known/);
});
test('same name and birth date is rejected in preview',()=>{
 assert.throws(()=>prepareGroupCsv(csv(fake('Fictional Adult'),fake('Fictional Adult')),sports),/duplicate/);
});
test('minor requires guardian details in the CSV',()=>{
 assert.throws(()=>prepareGroupCsv(csv(fake('Fictional Youngster','2012')),sports),/guardian/);
 const minor=fake('Fictional Youngster','2012').replace(/,,,($|\n)/,',Fictional Guardian,Parent,0700000001');
 const complete=csv(minor);
 assert.equal(prepareGroupCsv(complete,sports)[0].guardian?.relationship,'Parent');
});
test('malformed dates and ages are rejected in preview',()=>{
 assert.throws(()=>prepareGroupCsv(csv(fake('Fictional Adult','2002').replace('2002-03-20','2002-02-30')),sports),/invalid calendar date/);
 assert.throws(()=>prepareGroupCsv(csv(fake('Fictional Youngster','2020')),sports),/between 12 and 35/);
});
