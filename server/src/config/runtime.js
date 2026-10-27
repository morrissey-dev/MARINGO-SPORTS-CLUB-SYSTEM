// Startup validation. Importing this module never opens a network connection.
// Never print complete DATABASE_URLs or secret values when validation fails.
const DEFAULT_PORT = 4000;
const DEFAULT_HOST = '127.0.0.1';
const LOCAL_HOSTS = new Set(['localhost','127.0.0.1','[::1]']);

export function validateRuntimeEnvironment(env = process.env) {
  const errors = [];
  const mode = env.NODE_ENV || 'development';
  if (!['development','test','production'].includes(mode)) {
    errors.push('NODE_ENV must be development, test, or production.');
  }
  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be a TCP port between 1 and 65535.');
  }
  const host = env.API_HOST || DEFAULT_HOST;
  // Explicit binding to a public interface is a conscious deployment decision,
  // never the default; use TLS termination / firewall before enabling.
  if (!['127.0.0.1','::1','0.0.0.0'].includes(host)) {
    errors.push('API_HOST must be 127.0.0.1, ::1, or 0.0.0.0.');
  }
  if (!env.CSRF_SECRET || !/^[a-f0-9]{64,}$/i.test(env.CSRF_SECRET) || /^([a-f0-9])\1+$/i.test(env.CSRF_SECRET)) {
    errors.push('CSRF_SECRET must be a cryptographically random hex string of at least 64 characters.');
  }
  let origin;
  try {
    const url = new URL(env.APP_ORIGIN);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || url.origin !== env.APP_ORIGIN) {
      throw new Error('invalid origin');
    }
    origin = url;
  } catch { errors.push('APP_ORIGIN must be an exact http(s) origin with no path or trailing slash.'); }
  let database;
  try {
    database = new URL(env.DATABASE_URL);
    if (!['postgres:','postgresql:'].includes(database.protocol) || !database.hostname || !database.pathname || database.pathname === '/') {
      throw new Error('invalid PostgreSQL URL');
    }
  } catch { errors.push('DATABASE_URL must be a PostgreSQL connection URL.'); }
  if (mode === 'production') {
    if (origin && origin.protocol !== 'https:') errors.push('Production APP_ORIGIN must use HTTPS.');
    if (origin && LOCAL_HOSTS.has(origin.hostname)) errors.push('Production APP_ORIGIN cannot be localhost.');
    if (database && /(?:change_this_password|password|example)/i.test(database.password || '')) {
      errors.push('Change the example database password before production deployment.');
    }
  }
  return {valid:errors.length===0, errors, port, host, mode};
}
