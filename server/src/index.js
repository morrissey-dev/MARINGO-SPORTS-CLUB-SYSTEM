import 'dotenv/config';
import { createApp } from './app.js';
import { validateRuntimeEnvironment } from './config/runtime.js';
import { closePool } from './db/pool.js';

const config = validateRuntimeEnvironment(process.env);
if (!config.valid) {
  for (const message of config.errors) console.error('Configuration error:', message);
  process.exit(1);
}

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`MSCMS API listening on ${config.host}:${config.port} (${config.mode})`);
  console.log('Liveness: /api/v1/health; database readiness: /api/v1/ready');
});
server.on('error', error => {
  console.error('API startup failed:', error?.code || 'unknown');
  process.exitCode = 1;
});
let shuttingDown = false;
async function shutDown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: stopping API`);
  // Stop accepting requests; finish active requests before closing database pool.
  const guard = setTimeout(() => {
    console.error('Shutdown exceeded 10 seconds.');
    process.exit(1);
  }, 10_000);
  guard.unref();
  try {
    await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
    await closePool();
    clearTimeout(guard);
  } catch (error) {
    console.error('Shutdown failed:', error?.code || error?.name || 'unknown');
    process.exitCode = 1;
  }
}
process.on('SIGTERM', () => { void shutDown('SIGTERM'); });
process.on('SIGINT', () => { void shutDown('SIGINT'); });
