# Part 12 — Connect Maringo to local PostgreSQL (Windows / VS Code)

**Goal:** Configure a development PostgreSQL database on your own PC; migrate schema; create a first staff administrator; verify database readiness and sign in with fake/test data. **This is a local setup guide, not a deployed or production-ready release.**

The GitHub CI integration database is temporary and separate from your laptop. A green GitHub check does **not** connect your Windows machine to PostgreSQL.

## A. Install requirements

- Node.js **22.12+** and npm: verify `node -v` and `npm -v`.
- PostgreSQL **14+** running locally; pgAdmin 4 is optional but convenient.
- VS Code and the existing Git clone: `https://github.com/morrissey-dev/MARINGO-SPORTS-CLUB-SYSTEM`.

Official Windows installers: https://www.postgresql.org/download/windows/ . The interactive installer includes PostgreSQL and pgAdmin. During setup remember the administrative `postgres` password, use port 5432 if free, and ensure the PostgreSQL Windows service is running.

## B. Create a dedicated *development* database

Open pgAdmin 4 → Servers → your local PostgreSQL → Databases → select **postgres** maintenance database → **Query Tool**. Run the following statements **one at a time** (do not execute as one transaction), replacing the placeholder with a long unique password that you keep privately:

```sql
CREATE ROLE maringo_dev WITH LOGIN PASSWORD 'REPLACE_WITH_PRIVATE_STRONG_PASSWORD';
```

```sql
CREATE DATABASE maringo_club_dev OWNER maringo_dev;
```

You may instead use `psql` logged in as `postgres`. For the connection string below, choose a strong URL-safe password (letters, digits, hyphen, underscore), or URL-percent-encode any reserved characters before inserting it into `DATABASE_URL`.

**Do not store the database password in the README, GitHub, screenshots, or a chat.** The database role should not be a superuser. Do not use an actual/live club database for development tests.

## C. Pull the project and create the private environment file

In the VS Code **PowerShell terminal**, from your repository root:

```powershell
git pull origin main
node -v
npm -v
npm install
Copy-Item .\server\.env.example .\server\.env
```

Open `server/.env` in VS Code. Set `DATABASE_URL` with the **exact local password** you entered above, and set `CSRF_SECRET` to a unique random hex secret.

Generate a suitable random token in PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste only its output after `CSRF_SECRET=` in your local `server/.env`. Never commit your real `.env`; the root `.gitignore` already excludes it. If `server/.env` exists, **do not overwrite it**; update its values safely.

Expected local configuration (illustrative placeholders):

```dotenv
NODE_ENV=development
API_HOST=127.0.0.1
PORT=4000
APP_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://maringo_dev:YOUR_URL_SAFE_PASSWORD@127.0.0.1:5432/maringo_club_dev
CSRF_SECRET=PASTE_YOUR_64_CHARACTER_RANDOM_HEX_VALUE
```

Do not use those placeholders literally. The `APP_ORIGIN` setting must have **no trailing slash**. The Vite frontend proxy already points at `127.0.0.1:4000`.

## D. Connect, migrate and create the first staff administrator

Still at repository root:

```powershell
npm run db:check
npm run db:migrate
npm run staff:create
```

Expected outputs:

- `db:check`: **PostgreSQL connection successful (SELECT 1).**
- `db:migrate`: sequential `Applied:` lines on first run or `Already applied:` on rerun; records tracked in `schema_migrations`.
- `staff:create`: interactive name, email, hidden password (12+ characters). This is a club **staff account** separate from the PostgreSQL `maringo_dev` database role.

If a migration fails, **do not** erase tables to make it pass; preserve the error and inspect the cause. Rerunning a migrated schema safely relies on unchanged migration checksums.

## E. Start the app and verify the real connection

Open two VS Code terminals from the repository root.

Terminal 1:

```powershell
npm run dev:server
```

Terminal 2:

```powershell
npm run dev:client
```

Visit:
- Frontend: http://localhost:5173
- HTTP liveness: http://127.0.0.1:4000/api/v1/health
- **Database readiness:** http://127.0.0.1:4000/api/v1/ready

The `/ready` endpoint should report `status: ready` **only** when PostgreSQL accepts `SELECT 1`; `/health` alone is not proof of DB connection. Sign in using the staff administrator you created. Use fictional names for test registrations.

From the project root, optional quality checks:

```powershell
npm test
npm run build
```

## F. Troubleshooting quick reference

| Symptom | Likely cause and next check |
|---|---|
| `ECONNREFUSED`, connection timeout | PostgreSQL service stopped, wrong hostname/port, Windows firewall or `5432` unavailable |
| `password authentication failed`, SQLSTATE `28P01` | Wrong `maringo_dev` password or URL special characters not percent-encoded |
| `database ... does not exist`, SQLSTATE `3D000` | Database was not created or wrong database name in URL |
| `role ... does not exist` | `CREATE ROLE` was not completed in the intended local PostgreSQL instance |
| `permission denied for schema public` | Database/schema ownership or grants need correction by local PostgreSQL admin; don't make the app a superuser |
| `DATABASE_URL is missing` | `server/.env` missing, wrong folder, or value not saved; run from repository root with workspace npm commands |
| `CSRF_SECRET must be ...` | Generate a random **64+ hexadecimal-character** secret and save it to `server/.env` |
| `APP_ORIGIN must be an exact ... origin` | Use `http://localhost:5173` without a trailing slash |
| Frontend says database unavailable | Test `/ready`, terminal errors and `npm run db:check` before touching React code |
| `git pull` reports conflicts | Stop and reconcile tracked changes; never discard uncommitted work |
| `staff:create` says email exists | You likely created the admin already; use existing staff login or a different authorized email |

If something fails, share the **error text with all passwords, connection strings, tokens and private member data redacted**.

## G. Separate test database for automated integration

**Optional, after the development DB works.** Do not point `npm run test:integration` at `maringo_club_dev`. The integration runner intentionally requires a database whose name ends in `_test`, creates a disposable schema and removes that schema after completing. Follow `docs/implementation-step10.md` to create `maringo_club_test` and set `MSCMS_TEST_DATABASE_URL` only for that isolated test.

## H. Acceptance gate for user testing

Continue to Part 13 user-acceptance work only after: DB connection check succeeds; migration succeeds; `/ready` is ready; admin login works; fictional registration and basic store flows work; unit and frontend build checks pass. Confirm club privacy, guardian-consent and fee rules before entering real member records.

**This documentation-only step adds no production deployment, real credentials or real personal data.**

**Suggested commit:** `docs: add local PostgreSQL onboarding and env template`.
