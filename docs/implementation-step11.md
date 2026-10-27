# Part 11 — Release Readiness and Verification

**Status: NOT certified for production.** These additions are designed to make verification repeatable and surface failures early. Do not upload real members' data, cash records, special-needs notes or minors' information until the live checks, club policies and security review have been completed.

## What changed

1. Two different health concepts: `GET /api/v1/health` checks HTTP liveness; `GET /api/v1/ready` checks PostgreSQL with `SELECT 1`. Database not available → HTTP 503 with a safe response, never connection details. The staff interface now uses readiness to show a meaningful database error.
2. Startup validation checks `PORT`, `API_HOST`, `NODE_ENV`, `APP_ORIGIN`, `DATABASE_URL`, and a random 64+ hex-character `CSRF_SECRET`. In production, `APP_ORIGIN` must be an HTTPS public origin. The backend still binds to loopback by default; an HTTPS reverse proxy is expected.
3. HTTP server supports SIGTERM/SIGINT graceful shutdown and closes its PostgreSQL pool, with a 10-second termination guard.
4. API response hardening for JSON: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and a minimal Content Security Policy. HSTS enabled only with `NODE_ENV=production`. Configure TLS termination correctly before exposing traffic.
5. Keyboard-visible focus and a skip-to-content link, and reduced-motion support on the React workspace.
6. GitHub Actions workflow `.github/workflows/ci.yml` runs unit tests, React build and isolated PostgreSQL HTTP integration suite on pushes/PRs. It **does not deploy** and uses only fictional data.

## Development verification on your PC

1. Install **Node.js 22.12+**, npm and PostgreSQL; checkout the latest repo and run `npm install`.
2. Copy `server/.env.example` to `server/.env`, then set real local DB credentials, `APP_ORIGIN=http://localhost:5173`, and generate `CSRF_SECRET` with:
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
3. Execute `npm run db:check` and `npm run db:migrate` on a **new development DB**, not your production database.
4. Execute `npm test`, `npm run build`, then `npm run dev:server` and `npm run dev:client` in separate terminals.
5. Check `http://localhost:4000/api/v1/health` returns `status: ok`. Check `/api/v1/ready` returns `status: ready` only when PostgreSQL is accessible.
6. Create your first authorized admin (`npm run staff:create`) if needed and check login, logout, role-controlled screens, new adult/minor registration, payment approval by a separate reviewer, sales, equipment issue/return and report totals with **fictional** records.

### Real integration check — intentionally isolated

Create a separate disposable PostgreSQL database, such as `maringo_ci_test`, and provide the full URL only in your local terminal environment, **not in GitHub**:

PowerShell:
```powershell
$env:MSCMS_TEST_DATABASE_URL = 'postgresql://testuser:YOUR_PASSWORD@localhost:5432/maringo_ci_test'
# DATABASE_URL in server/.env must not equal the test URL.
npm run test:integration
Remove-Item Env:MSCMS_TEST_DATABASE_URL
```

The script rejects databases not ending in `_test`, creates a **random, disposable schema**, executes all migrations there, creates dummy staff/members, runs real HTTP requests, checks a stock race and report reconciliation, then drops its schema. Do not reuse credentials to your live club database.

### CI outcomes

- GitHub Actions may require repository workflow permissions and access to hosted runners. A newly added workflow file is **not evidence that CI passed**. Review the latest run and investigate failures before merging or releasing.
- Because the project currently lacks a committed `package-lock.json`, CI uses `npm install`. Generate and review a genuine lockfile in an online development environment and replace it with `npm ci` for reproducible builds.
- Tests may reveal previously undetected SQL/route mismatches; fix the actual failures in a new commit instead of disabling CI.

## Deployment architecture: proposed, not executed

```text
Browser -- HTTPS --> reverse proxy (same host)
                         |-- /           -> built React static files
                         |-- /api/v1/... -> Express on 127.0.0.1:4000
                                               |-> private PostgreSQL
```

Set `NODE_ENV=production`, `APP_ORIGIN=https://club.your-real-domain.example`, and secrets from a private environment file; never commit them. Generate React static assets with `npm run build`, serve them over HTTPS with an SPA fallback to `/index.html`, proxy `/api/` to `http://127.0.0.1:4000`, and forward the correct origin and host headers. `server/.env.example` is only a *template*, not real credentials. The backend does not currently run TLS itself. No specific domain or server is assumed to exist.

### Suggested production go/no-go checklist

- [ ] Club confirms 15 vs 16 sports; age/renewal rules; guardian consent recordkeeping.
- [ ] Club approves patron commission accounting base, equipment liability allocation and refund policy.
- [ ] Tests run with real PostgreSQL and current migrations against a separate database.
- [ ] Browser build completes and manual end-to-end test completes on desktop and entry-level phone.
- [ ] Role and field-level access is checked using separate test staff accounts.
- [ ] Security audit: session lifecycle, CSRF, login brute-force, dependency vulnerabilities, backup permissions, sensitive fields and all exports.
- [ ] Domain, HTTPS certificate and HTTP security headers verified; sensitive paths not exposed.
- [ ] Encrypted backups to a separate protected location with **measured restore tests**.
- [ ] Defined retention, incident-response contact, onboarding and resignation/offboarding processes.
- [ ] Correct date/time interpretation (Africa/Nairobi), transaction reconciliation and stock concurrency tested.
- [ ] Tested rollback plan and confirmed RPO/RTO with management. Neither is currently guaranteed.

### Recoverability: no destructive shortcuts

Before a production release, back up PostgreSQL using approved credentials and storage (`pg_dump --format=custom ...`), test a restore into a **different** database (`pg_restore -d ...`), and never treat a SQL `ROLLBACK` as a way to undo an already committed migration. All schema changes should be additive and reviewed. Keep application and database schema versions together; verify a staging deploy before replacing a production service. Do not put database dumps in a public GitHub repository.

**Current limits:** No deployed app, no real PostgreSQL check in this working environment, no verified full React build, no live payment gateway, no approved payout or liability allocation. This phase adds safety checks but does **not** turn the current prototype into an approved club production system.
