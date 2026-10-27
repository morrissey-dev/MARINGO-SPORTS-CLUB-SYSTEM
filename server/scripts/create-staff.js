import 'dotenv/config';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { getPool } from '../src/db/pool.js';
import { hashPassword } from '../src/auth/crypto.js';
import { normalizeEmail } from '../src/auth/policy.js';

function askSecret(label) {
  return new Promise((resolve,reject)=>{
    if (!input.isTTY || !input.setRawMode) return reject(new Error('A private interactive terminal is required. Do not pass passwords as command arguments.'));
    output.write(label);
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    let value='';
    const onKey=(ch,key)=>{
      if(key?.ctrl && (key.name==='c'||key.name==='d')) return done(new Error('Cancelled'));
      if(key?.name==='return'||key?.name==='enter') return done(null,value);
      if(key?.name==='backspace') {value=value.slice(0,-1);return;}
      if(key?.ctrl || key?.meta || !ch || /[\r\n\x00-\x1f]/.test(ch))return;
      value+=ch;
      if(value.length>256) done(new Error('Maximum 256 characters'));
    };
    function done(err,result){ input.removeListener('keypress',onKey);input.setRawMode(false); input.pause();output.write('\n');err?reject(err):resolve(result); }
    input.on('keypress',onKey);
  });
}

if (process.env.NODE_ENV==='production') { console.error('Use an approved staff provisioning process in production.'); process.exit(1); }
if (!input.isTTY) {
  console.error('Run npm run staff:create in an interactive VS Code terminal, not a pipe.');
  process.exit(1);
}
const rl=createInterface({input,output});
let pool;
try {
  const fullName=(await rl.question('Staff member full name: ')).trim();
  const email=normalizeEmail(await rl.question('Staff member email: '));
  const requestedRole=(await rl.question('Role code (REG, FIN, MGT, STO, PAT or CAP): ')).trim().toUpperCase();
  if(!['REG','FIN','MGT','STO','PAT','CAP'].includes(requestedRole)) throw new Error('Choose a permitted role code.');
  if (fullName.length<2 || !email) throw new Error('Provide a valid full name and email.');
  rl.close();
  const password=await askSecret('New password (12+ characters; hidden): ');
  const confirm=await askSecret('Confirm password (hidden): ');
  if(password!==confirm) throw new Error('Passwords did not match.');
  const hash=await hashPassword(password);
  pool=getPool();
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const role=await client.query("SELECT id FROM roles WHERE code=$1",[requestedRole]);
    if(!role.rowCount) throw new Error('First run: npm run db:migrate');
    const added=await client.query('INSERT INTO users(full_name,email,password_hash) VALUES($1,$2,$3) RETURNING id',[fullName,email,hash]);
    await client.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)',[added.rows[0].id,role.rows[0].id]);
    await client.query('INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id) VALUES($1,$2,$3,$4)',[added.rows[0].id,'bootstrap_staff','user',String(added.rows[0].id)]);
    await client.query('COMMIT');
    console.log(`Staff account created with ${requestedRole} role. You may now sign in on the React page.`);
  } catch(error){ await client.query('ROLLBACK');throw error; }
  finally {client.release();}
} catch(error) {
  console.error('Could not create staff account:',error.code==='23505'?'This email already exists.':error.message);
  process.exitCode=1;
} finally {rl.close();if(pool)await pool.end();}
