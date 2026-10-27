import 'dotenv/config';
import { createApp } from './app.js';

if (!process.env.CSRF_SECRET || process.env.CSRF_SECRET.length < 48 || !process.env.APP_ORIGIN) {
  console.error('Set a random CSRF_SECRET (48+ characters) and APP_ORIGIN in server/.env before starting.');
  process.exit(1);
}

const port = Number(process.env.PORT || 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be a valid TCP port.');
  process.exit(1);
}

const app = createApp();
app.listen(port, '127.0.0.1', () => {
  console.log(`MSCMS API ready at http://localhost:${port}/api/v1/health`);
  console.log('Staff login, member registration and membership payment recording are available.');
});
