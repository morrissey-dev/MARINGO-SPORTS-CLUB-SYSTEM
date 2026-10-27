import test from 'node:test';
import assert from 'node:assert/strict';
import { readinessResult } from '../src/readiness.js';
import { validateRuntimeEnvironment } from '../src/config/runtime.js';
const valid = {
  NODE_ENV:'development',
  PORT:'4000',
  APP_ORIGIN:'http://localhost:5173',
  API_HOST:'127.0.0.1',
  DATABASE_URL:'postgresql://staff:dummy@localhost:5432/maringo_test',
  CSRF_SECRET:'a1b2c3d4'.repeat(8)
};
test('readiness returns 200 when database query succeeds', async()=>{
  let checks=0;
  const result=await readinessResult(async()=>{checks++});
  assert.equal(checks,1);
  assert.deepEqual(result,{statusCode:200,body:{status:'ready'}});
});
test('readiness returns safe 503 without leaking DB errors',async()=>{
  const result=await readinessResult(async()=>{throw new Error('password in DB URL');});
  assert.deepEqual(result,{statusCode:503,body:{status:'not_ready'}});
  assert.doesNotMatch(JSON.stringify(result),/password/);
});
test('valid local configuration passes',()=>{
  const result=validateRuntimeEnvironment(valid);
  assert.equal(result.valid,true, result.errors.join(', '));
  assert.equal(result.port,4000);
  assert.equal(result.host,'127.0.0.1');
});
test('default port and host are loopback-safe',()=>{
  const result=validateRuntimeEnvironment({...valid,PORT:undefined,API_HOST:undefined});
  assert.equal(result.port,4000);
  assert.equal(result.host,'127.0.0.1');
  assert.equal(result.valid,true);
});
test('rejects placeholder secrets and malformed connection URLs',()=>{
  const result=validateRuntimeEnvironment({...valid,CSRF_SECRET:'replace_with_this_key',DATABASE_URL:'file:///tmp/test'});
  assert.equal(result.valid,false);
  assert.ok(result.errors.some(e=>e.startsWith('CSRF_SECRET')));
  assert.ok(result.errors.some(e=>e.startsWith('DATABASE_URL')));
});
test('rejects invalid port and non-origin APP_ORIGIN',()=>{
  const result=validateRuntimeEnvironment({...valid,PORT:'70000',APP_ORIGIN:'https://example.org/path'});
  assert.equal(result.valid,false);
  assert.ok(result.errors.some(e=>e.startsWith('PORT')));
  assert.ok(result.errors.some(e=>e.startsWith('APP_ORIGIN')));
});
test('production requires HTTPS public origin',()=>{
  const result=validateRuntimeEnvironment({...valid,NODE_ENV:'production'});
  assert.equal(result.valid,false);
  assert.ok(result.errors.some(e=>e.includes('HTTPS')));
  assert.ok(result.errors.some(e=>e.includes('localhost')));
});
test('production setup accepts a safe HTTPS origin',()=>{
  const result=validateRuntimeEnvironment({...valid,NODE_ENV:'production',APP_ORIGIN:'https://club.example.org'});
  assert.equal(result.valid,true,result.errors.join(', '));
});
test('production catches default database password',()=>{
  const result=validateRuntimeEnvironment({...valid,NODE_ENV:'production',APP_ORIGIN:'https://club.example.org',DATABASE_URL:'postgresql://staff:change_this_password@db.internal:5432/maringo'});
  assert.equal(result.valid,false);
  assert.ok(result.errors.some(e=>e.includes('example database password')));
});
