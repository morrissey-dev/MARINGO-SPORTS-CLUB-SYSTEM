/*
 * LIVE integration smoke test. NEVER targets production: an explicitly named
 * *_test PostgreSQL database is required, and every test runs in a throwaway
 * schema. Schema creation, migrations, API calls and cleanup use only dummy data.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { hashPassword } from '../src/auth/crypto.js';

const raw = process.env.MSCMS_TEST_DATABASE_URL;
if (!raw) {
  console.error('MSCMS_TEST_DATABASE_URL is required. Use a dedicated database named *_test; see docs/implementation-step10.md.');
  process.exit(2);
}
let url;
try { url = new URL(raw); } catch { console.error('Invalid test database URL.'); process.exit(2); }
const dbName = decodeURIComponent(url.pathname.slice(1));
if (!/^[-a-zA-Z0-9_]+_test$/.test(dbName) || /(?:^|_)(?:prod|production)(?:_|$)/i.test(dbName)) {
  console.error('Refusing to run: PostgreSQL database name must end with _test and must not identify production.');
  process.exit(2);
}
if (process.env.DATABASE_URL === raw) {
  console.error('Refusing to run: MSCMS_TEST_DATABASE_URL must be different from DATABASE_URL.');
  process.exit(2);
}
const schema = `mscms_p10_${randomBytes(6).toString('hex')}`;
const admin = new pg.Pool({connectionString:raw,max:2,connectionTimeoutMillis:5000});
let scopedPool;
let appServer;
let created = false;
const notes=[];
function passed(message){ notes.push(message); console.log(`PASS ${message}`); }
function key(){return `integration_${randomBytes(10).toString('hex')}`;}
function scopedConnectionUrl(base,schemaName){
  const value = new URL(base);
  // PostgreSQL connection options select the private schema for *all*
  // pooled app connections and the migration subprocess.
  value.searchParams.set('options',`-csearch_path=${schemaName},public`);
  return value.toString();
}
async function call(base,method,urlPart,{body,cookie,csrf,origin=true,idempotencyKey}={}) {
  const headers={'Content-Type':'application/json'};
  if(origin)headers.Origin='http://localhost:5173';
  if(cookie)headers.Cookie=cookie;
  if(csrf)headers['X-CSRF-Token']=csrf;
  if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
  const response=await fetch(`${base}/api/v1${urlPart}`,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'
  });
  const text=await response.text();
  const data=text?JSON.parse(text):null;
  return {status:response.status,data,cookie:response.headers.get('set-cookie')};
}
function expectStatus(response,code,description){
  assert.equal(response.status,code,`${description}: expected ${code}, received ${response.status}; response: ${JSON.stringify(response.data)}`);
  return response.data?.data;
}

try {
  const meta=await admin.query('SELECT current_database() AS name, current_user AS username');
  assert.equal(meta.rows[0].name,dbName,'Database URL pointed to unexpected database');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  created=true;
  const scopedUrl=scopedConnectionUrl(raw,schema);
  scopedPool=new pg.Pool({connectionString:scopedUrl,max:10,connectionTimeoutMillis:5000});
  const check=await scopedPool.query('SELECT current_schema() AS name');
  assert.equal(check.rows[0].name,schema,'Test pool is NOT confined to temporary schema');
  passed('dedicated test database and isolated PostgreSQL schema');

  const scriptsDir=path.dirname(fileURLToPath(import.meta.url));
  execFileSync(process.execPath,['migrate.js'],{
    cwd:scriptsDir,timeout:60000,stdio:['ignore','pipe','pipe'],
    env:{...process.env,DATABASE_URL:scopedUrl,NODE_ENV:'test'}
  });
  const migrationCount=await scopedPool.query('SELECT count(*)::int AS n FROM schema_migrations');
  assert.ok(migrationCount.rows[0].n>=9);
  const seeded=await scopedPool.query('SELECT count(*)::int AS n FROM sports');
  assert.equal(seeded.rows[0].n,15);
  passed(`${migrationCount.rows[0].n} migrations and 15 supplied sports`);

  const password=`Demo-Only-${randomBytes(16).toString('hex')}!`;
  const hash=await hashPassword(password);
  const addStaff=async (name,email,role)=>{
    const user=await scopedPool.query('INSERT INTO users(full_name,email,password_hash) VALUES($1,$2,$3) RETURNING id',
      [name,email,hash]);
    const id=String(user.rows[0].id);
    await scopedPool.query(`INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2`,[id,role]);
    return id;
  };
  const adminId=await addStaff('Demo Administrator','admin@example.invalid','ADM');
  await addStaff('Demo Finance Reviewer','finance@example.invalid','FIN');
  await addStaff('Demo Store Clerk','clerk@example.invalid','STO');

  // Load app *after* overriding env; getPool uses the same isolated URL.
  process.env.DATABASE_URL=scopedUrl;
  process.env.APP_ORIGIN='http://localhost:5173';
  process.env.CSRF_SECRET=randomBytes(32).toString('hex');
  process.env.NODE_ENV='test';
  const {createApp}=await import('../src/app.js');
  const {getPool}=await import('../src/db/pool.js');
  const app=createApp();
  appServer=await new Promise(resolve=>{
    const server=app.listen(0,'127.0.0.1',()=>resolve(server));
  });
  const base=`http://127.0.0.1:${appServer.address().port}`;
  const unauthorized=await call(base,'GET','/members');
  expectStatus(unauthorized,401,'unauthenticated members read');
  const login=await call(base,'POST','/auth/login',{body:{email:'admin@example.invalid',password}});
  const staff=expectStatus(login,200,'administrator login');
  assert.ok(staff.csrfToken && login.cookie);
  const cookie=login.cookie.split(';')[0];
  const wrongOrigin=await call(base,'POST','/members',{cookie,csrf:staff.csrfToken,origin:false,body:{}});
  expectStatus(wrongOrigin,403,'missing origin');
  const missingCsrf=await call(base,'POST','/members',{cookie,body:{}});
  expectStatus(missingCsrf,403,'missing CSRF');
  passed('HTTP login, session cookie, unauthorized access, Origin and CSRF protection');

  const sport=await scopedPool.query("SELECT id FROM sports WHERE name='Hockey'");
  const sportId=String(sport.rows[0].id);
  const register={fullName:'Demo Integration Adult',dateOfBirth:'2002-04-01',gender:'Other',
    phone:'0700000000',subCounty:'Demo Sub-county',registrationType:'individual',sportIds:[sportId],
    nextOfKin:{fullName:'Demo Contact',relationship:'Sibling',phone:'0700000001'}};
  const regKey=key();
  const createdMember=await call(base,'POST','/members',{cookie,csrf:staff.csrfToken,body:register,idempotencyKey:regKey});
  const member=expectStatus(createdMember,201,'member registration');
  assert.equal(member.membershipFee,'1000.00');
  assert.equal(member.memberStatus,'draft');
  const replay=await call(base,'POST','/members',{cookie,csrf:staff.csrfToken,body:register,idempotencyKey:regKey});
  assert.equal(replay.status,201);
  assert.equal(replay.data.data.id,member.id);
  assert.equal(replay.data.replayed,true);
  const badAge=await call(base,'POST','/members',{cookie,csrf:staff.csrfToken,
    body:{...register,fullName:'Demo Too Young',dateOfBirth:'2020-01-01'},idempotencyKey:key()});
  expectStatus(badAge,422,'ineligible age');
  passed('member registration, KSh 1,000 assessed fee, idempotent retry and age validation');

  // Part 14: atomic bulk group registration, idempotency, group-linkage and charges.
  const madeOrg=await call(base,'POST','/organizations',{cookie,csrf:staff.csrfToken,
    body:{name:'Fictional Integration School',type:'school'}});
  const org=expectStatus(madeOrg,201,'create demo school');
  const batchBody={organizationId:String(org.id),members:[
    {...register,fullName:'Fictional Group Adult One',phone:'',schoolOrCollege:'Fictional Integration School'},
    {...register,fullName:'Fictional Group Adult Two',phone:'',schoolOrCollege:'Fictional Integration School'}
  ].map(({registrationType,organizationId,...m})=>m)};
  const groupKey=key();
  const registeredGroup=await call(base,'POST','/group-registrations',{
    cookie,csrf:staff.csrfToken,body:batchBody,idempotencyKey:groupKey});
  const group=expectStatus(registeredGroup,201,'register two group members');
  assert.equal(group.count,2);
  assert.equal(group.totalBilled,'1000.00');
  const replayGroup=await call(base,'POST','/group-registrations',{
    cookie,csrf:staff.csrfToken,body:batchBody,idempotencyKey:groupKey});
  expectStatus(replayGroup,201,'group idempotency retry');
  assert.equal(replayGroup.data.replayed,true);
  const groupLinked=await scopedPool.query(`SELECT count(*)::int AS members,
    COALESCE(sum(c.amount),0)::text AS billed FROM memberships ms
    JOIN membership_charges mc ON mc.membership_id=ms.id JOIN charges c ON c.id=mc.charge_id
    WHERE ms.group_registration_id=$1`,[group.groupId]);
  assert.equal(groupLinked.rows[0].members,2);
  assert.equal(Number(groupLinked.rows[0].billed),1000);
  const rejectedGroup=await call(base,'POST','/group-registrations',{
    cookie,csrf:staff.csrfToken,body:{...batchBody,members:[batchBody.members[0],{...batchBody.members[1],dateOfBirth:'2020-01-01'}]},
    idempotencyKey:key()});
  expectStatus(rejectedGroup,422,'group intake rejects ineligible member');
  passed('atomic group intake, KSh 500/member, idempotency and row-level validation');


  const charges=await scopedPool.query("SELECT id,amount FROM charges WHERE member_id=$1 AND charge_type='membership'",[member.id]);
  assert.equal(charges.rows.length,1);
  const chargeId=String(charges.rows[0].id);
  const pending=await call(base,'POST','/payments',{cookie,csrf:staff.csrfToken,idempotencyKey:key(),
    body:{chargeId,amount:'1000.00',method:'cash'}});
  const payment=expectStatus(pending,201,'payment recording');
  assert.equal(payment.status,'pending');
  const financeLogin=await call(base,'POST','/auth/login',{body:{email:'finance@example.invalid',password}});
  const reviewer=expectStatus(financeLogin,200,'finance login');
  const reviewed=await call(base,'POST',`/payments/${payment.id}/verify`,{
    cookie:financeLogin.cookie.split(';')[0],csrf:reviewer.csrfToken,
    body:{evidenceReference:'TEST-RECEIPT-0001'}});
  expectStatus(reviewed,200,'payment verification');
  const active=await scopedPool.query('SELECT status FROM members WHERE id=$1',[member.id]);
  assert.equal(active.rows[0].status,'active');
  passed('independent payment verification and automatic membership activation');


  const minorRegistration={...register,fullName:'Demo Integration Minor',dateOfBirth:'2012-05-05',
    guardian:{fullName:'Demo Guardian',relationship:'Parent',phone:'0700000002'}};
  const minorResponse=await call(base,'POST','/members',{cookie,csrf:staff.csrfToken,
    body:minorRegistration,idempotencyKey:key()});
  const minor=expectStatus(minorResponse,201,'minor registration');
  assert.equal(minor.guardianConsent,'pending');
  const minorCharge=await scopedPool.query("SELECT id FROM charges WHERE member_id=$1 AND charge_type='membership'",[minor.id]);
  const minorPay=await call(base,'POST','/payments',{cookie,csrf:staff.csrfToken,idempotencyKey:key(),
    body:{chargeId:String(minorCharge.rows[0].id),amount:'1000.00',method:'cash'}});
  const minorPayment=expectStatus(minorPay,201,'minor payment recorded');
  const minorVerified=await call(base,'POST',`/payments/${minorPayment.id}/verify`,{
    cookie:financeLogin.cookie.split(';')[0],csrf:reviewer.csrfToken,
    body:{evidenceReference:'TEST-RECEIPT-0002'}});
  expectStatus(minorVerified,200,'minor payment verified');
  const stillPending=await scopedPool.query('SELECT status FROM members WHERE id=$1',[minor.id]);
  assert.notEqual(stillPending.rows[0].status,'active');
  const consent=await call(base,'POST',`/members/${minor.id}/guardian-consent/verify`,{
    cookie,csrf:staff.csrfToken,body:{evidenceReference:'TEST-GUARDIAN-0001'}});
  expectStatus(consent,200,'minor guardian consent verified');
  const minorActive=await scopedPool.query('SELECT status FROM members WHERE id=$1',[minor.id]);
  assert.equal(minorActive.rows[0].status,'active');
  passed('minor stays inactive after payment until separately verified guardian consent');

  const itemResult=await call(base,'POST','/store/items',{cookie,csrf:staff.csrfToken,
    body:{sku:'TESTSTICK01',name:'Demo Hockey Stick',unitPrice:'2500.00',maxStockLevel:10}});
  const item=expectStatus(itemResult,201,'create store item');
  const receipt=await call(base,'POST','/store/stock-receipts',{cookie,csrf:staff.csrfToken,
    idempotencyKey:key(),body:{itemId:item.id,quantity:1,sourceReference:'TEST-STOCK-0001'}});
  expectStatus(receipt,201,'stock receiving');
  const makeSale=async()=>{
    const r=await call(base,'POST','/sales',{cookie,csrf:staff.csrfToken,idempotencyKey:key(),
      body:{buyerMemberNumber:member.membershipNumber,lines:[{itemId:item.id,quantity:1}]}});
    return expectStatus(r,201,'create sale');
  };
  const [first,second]=await Promise.all([makeSale(),makeSale()]);
  const [firstCheckout,secondCheckout]=await Promise.all([first,second].map(x=>
    call(base,'POST',`/sales/${x.id}/checkout`,{cookie,csrf:staff.csrfToken,idempotencyKey:key(),body:{method:'cash'}})));
  assert.deepEqual([firstCheckout.status,secondCheckout.status].sort(),[201,409]);
  const inventory=await scopedPool.query('SELECT available_qty FROM store_inventory WHERE item_id=$1',[item.id]);
  assert.equal(inventory.rows[0].available_qty,0);
  const saleList=await call(base,'GET','/sales',{cookie});
  expectStatus(saleList,200,'sale listing');
  assert.equal(saleList.data.data.find(x=>x.status==='completed').buyerMemberNumber,member.membershipNumber);
  passed('two concurrent checkouts of last item: exactly one succeeds, stock stays nonnegative');

  const income=await call(base,'GET','/reports/income',{cookie});
  const report=expectStatus(income,200,'income report');
  assert.ok(report.sources.some(x=>x.source==='membership' && x.netCollected==='2000.00'));
  assert.ok(report.sources.some(x=>x.source==='store_sale' && x.netCollected==='2500.00'));
  passed('income report reconciles two verified membership receipts and one completed store sale');
  console.log(`\nSUCCESS: ${notes.length} live integration checkpoints passed in disposable schema ${schema}.`);
} catch(error) {
  console.error('INTEGRATION FAILED:',error.message);
  if(error.stderr)console.error(String(error.stderr).slice(-1800));
  process.exitCode=1;
} finally {
  if(appServer)await new Promise(resolve=>appServer.close(resolve));
  // Close the API's separate pooled sessions before deleting the test schema.
  try { const {getPool}=await import('../src/db/pool.js'); await getPool().end(); } catch {}
  if(scopedPool)await scopedPool.end();
  if(created) {
    try {await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}
    catch(err){console.error('WARNING: failed to remove temporary schema:',schema,err.message);process.exitCode=1;}
  }
  await admin.end();
}
