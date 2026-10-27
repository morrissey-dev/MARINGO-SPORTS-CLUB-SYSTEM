# Implementation — Part 2: Staff Authentication and Membership Database

**Status:** New code and migration files prepared. No production accounts or club member records have been created. Local PostgreSQL integration must be run on your machine. The next part implements actual member registration endpoints and their transactional tests.

## What this stage adds

- Database migrations: `database/migrations/001_foundation.sql` creates staff accounts/roles/sessions, organizations, members, next-of-kin/guardian data, guardian consent, support details, memberships, sports preferences, fees and audit records. `002_reference_data.sql` seeds 7 role codes and the 15 sports listed in the question (which says 16 but names 15).
- `server/scripts/migrate.js` verifies migration checksums and runs all pending SQL migrations in one PostgreSQL transaction with an advisory lock. Do **not edit already-applied migrations**: add a new numbered file for later schema changes.
- `server/scripts/create-admin.js` interactively creates an administrator without sending its password as a terminal command argument. The entered password is hidden. No default accounts or passwords are shipped.
- Authentication API: `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`. Passwords are salted scrypt hashes; sessions are random, stored by SHA-256 hash in PostgreSQL, and transported by HTTP-only same-site cookies.
- Signed-in, role-limited `GET /api/v1/sports`. The frontend displays a genuine login form and, if signed in, shows the seeded sport names. Planned management modules are **not implemented yet**.
- CSRF: same-origin validation for sign-in and logout and an `X-CSRF-Token` required for authenticated logout; no cross-origin API access is enabled. For subsequent authenticated POST/PATCH/DELETE routes, use **both** same-origin validation and the CSRF token before database changes. The session CSRF is returned by `/auth/me` and derived securely on the backend; React keeps it in memory.

## Step-by-step setup (PowerShell + VS Code)

1. Extract the newest ZIP into a fresh project directory or carefully apply its changed files to your existing repository. **Do not delete your existing files or `.env`**. If your earlier project already contains local changes, commit them before adding this step. Open the folder in VS Code.
2. Ensure Node.js 22.12 or newer, npm, PostgreSQL and Git are installed. From project root run `npm install`.
3. Create a local PostgreSQL role/database if not done in Part 1. Use pgAdmin or `psql` as a PostgreSQL administrator:

   ```sql
   CREATE ROLE maringo_dev WITH LOGIN PASSWORD 'choose_a_private_local_password';
   CREATE DATABASE maringo_club OWNER maringo_dev;
   ```

4. Copy `server/.env.example` to `server/.env`. If you already have `.env`, **keep it**, adding `APP_ORIGIN` and `CSRF_SECRET` only. Edit the connection URL. The password in the example is a placeholder, not a real credential.
5. Generate a random CSRF secret from a terminal (its output is safe to paste into the untracked `.env`, **not** Git):

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Set `CSRF_SECRET` equal to those 64 characters. Set `APP_ORIGIN=http://localhost:5173` to match the Vite URL exactly (no trailing slash). Do not paste actual secrets into chats or issues.
6. From the project root, run:

   ```powershell
   npm run db:check
   npm run db:migrate
   npm run staff:create
   ```

   The last command asks for full name, email and a hidden password (minimum 12 characters). Run interactively inside VS Code; never use a default/public password. The script refuses to overwrite an existing account. **Create only a fictional/development account at this stage.**
7. Run the backend in terminal 1: `npm run dev:server`.
8. Run the frontend in terminal 2: `npm run dev:client`. Open `http://localhost:5173`. Sign in with the account created locally. The app should show your staff role and 15 seeded sports. Test logout and try wrong credentials to see expected rejection.
9. Run `npm test` from project root. This currently tests password hashing, CSRF derivation, age boundary rules, role checks and the existing health response. It is a **unit-test suite**, not proof of database/API integration.
10. Verify migration state in `psql`/pgAdmin with:

    ```sql
    SELECT filename, applied_at FROM schema_migrations ORDER BY filename;
    SELECT code, name FROM roles ORDER BY code;
    SELECT name FROM sports ORDER BY name;
    SELECT count(*) FROM users;
    ```

    If you have run `staff:create`, count of users should be at least one, **but do not share user email/password in screenshots**.

## Important restrictions

- Registration and fee charging **are not implemented**. Tables alone are not a working registration service.
- `members` defaults to `draft`. A PostgreSQL trigger rejects activating a minor without verified guardian authorization. Separately, the next registration service must enforce the 12–35 age rule at **initial registration**, before creating a real account or charge. Guardian-consent records must be reviewed by authorized staff. A next-of-kin entry is **not automatically legal guardian consent**.
- `member_support_details` is intentionally separate. Avoid collecting health/physical information unless justified, with approved access and retention procedures.
- The MVP login throttle operates in memory and is intended only for a **single backend process**. Multi-server production deployments will need central rate limiting, reverse-proxy security settings, secure HTTPS cookies and penetration/authorization testing.
- CSRF protection depends on the configured exact `APP_ORIGIN`; don't weaken it with permissive CORS. `Secure` cookies are enabled when `NODE_ENV=production`, so production **requires HTTPS**.
- This demo does **not** support password reset, account recovery, invite workflows, automated backups or a fully audited staff-administration UI yet. Do not deploy with real youth records until those operational requirements and safeguarding policies have been addressed.
- The sports catalogue intentionally contains 15 records; the sixteenth requested by the case statement needs clarification.

## Quick troubleshooting

| Symptom | Likely cause / action |
|---|---|
| `db:migrate` fails | Check `DATABASE_URL`, PostgreSQL status and DB permissions. The transaction rolls back. |
| `This email already exists` | First administrator already created; do not duplicate bootstrap. |
| Sign-in gives `BAD_ORIGIN` | The browser URL must match `APP_ORIGIN` exactly. Use `http://localhost:5173`, not `127.0.0.1:5173`, unless configured. |
| Sign-in shows 500 | Check server logs and PostgreSQL availability; make sure migrations ran. |
| Sports list unavailable after login | Migrations not applied or account missing staff permissions. |
| Cookie missing in production | Confirm HTTPS, `NODE_ENV=production`, proper origin and trusted reverse proxy setup. |
| `CSRF_REQUIRED` on logout | Refresh to get `/auth/me` and its latest token; never disable validation to work around it. |

## Suggested Git commit

`feat: add staff authentication and initial membership schema`

## Next stage

**Implementation — Part 3:** Authenticated member registration, organizations and guardian-consent review with backend DOB validation, ranked sport preferences, membership fee charge generated in a single transaction, and tests against a real temporary PostgreSQL test database.
