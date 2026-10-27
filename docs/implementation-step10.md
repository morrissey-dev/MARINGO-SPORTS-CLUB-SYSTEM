# Implementation Part 10 — Integration testing and system strengthening

**Status:** Implementation and static/unit verification completed; LIVE PostgreSQL integration and Vite production build still require a configured developer or CI machine. Do not represent these checks as passed until executed. No new production SQL migration in this part.

## Why this part matters

Individual unit tests do not demonstrate that all the PostgreSQL migrations run, that HTTP authentication works, that roles and CSRF are enforced in a running server, that two clerks cannot oversell the final item, or that income reports reconcile actual recorded payments. This stage adds a **real PostgreSQL + real Express HTTP** integration smoke runner for those cross-module workflows.

## Changes from Part 9

1. Added `server/scripts/integration-check.js`: an opt-in, destructive-to-**temporary-test-schema-only** integration runner. It creates its own temporary schema in an explicitly named `*_test` database, migrates schema, adds fictional staff, sends real HTTP requests to the API, verifies database state, and drops the schema in `finally`.
2. Added workspace `npm run test:integration`. This does **not** run as part of `npm test`, and requires a deliberately configured separate PostgreSQL database.
3. Fixed `listSales`: its joined buyer membership number was omitted from the SELECT while the response mapper expected it.
4. Added per-request API headers `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`. Added safe HTTP `413 PAYLOAD_TOO_LARGE` instead of a generic 500 on oversized JSON.
5. Added unit regressions for membership number in sales lists, income report boundaries, and Kenyan civil-day date handling. Added an HTTP regression which **skips** when npm dependencies are unavailable; a skipped test is not a pass.
6. Kept all existing database migrations, records, API paths and earlier source files. No production data or secrets are bundled.

## Automated checks available immediately

```powershell
npm install
npm test
npm run build
```

`npm test` runs unit/service tests. `npm run build` tests Vite and React compilation. Neither alone proves database transactions or the real HTTP application work.

### Dedicated integration database — REQUIRED before running live test

Install PostgreSQL and create a database **reserved only for automated testing**. In PostgreSQL, as a database administrator, an example is:

```sql
CREATE ROLE maringo_test LOGIN PASSWORD 'replace-with-a-unique-test-password';
CREATE DATABASE maringo_club_test OWNER maringo_test;
```

Use a unique local password, never put it into GitHub, and never reuse your production credentials. The integration runner explicitly refuses a database name not ending `_test`, or when its connection URL equals `DATABASE_URL` in the current process. It creates a random schema and removes the schema on completion; nothing is written to `public` or to the production database.

In VS Code PowerShell, inside the project directory:

```powershell
$env:MSCMS_TEST_DATABASE_URL = "postgresql://maringo_test:YOUR_PASSWORD@localhost:5432/maringo_club_test"
npm run test:integration
Remove-Item Env:MSCMS_TEST_DATABASE_URL
```

For test environments with non-default ports or cloud test databases, change the test URL as needed. The account must be allowed to create/drop schemas in that dedicated test database. The runner does NOT issue `CREATE DATABASE`, change existing database users, or use the production `DATABASE_URL`. It selects the isolated schema via PostgreSQL startup options for every connection, including the child migration process. It verifies `current_schema()` before proceeding.

If a crash prevents cleanup, inspect the dedicated test database for schema names beginning `mscms_p10_` and remove only the failed run's specific schema after confirming it is unused. The runner never displays passwords in normal output.

### Live integration assertions

1. Creates test schema and successfully applies the entire numbered migration sequence; checks sports catalogue count (15 actual sports named in problem statement).
2. Authenticates an administrator and finance reviewer with freshly generated fake passwords and real session cookies.
3. Rejects unauthenticated requests, missing Origin and missing CSRF token.
4. Registers a fictitious adult, charges KSh 1,000, rejects ineligible birth date, and verifies retries don't duplicate members.
5. Records a pending cash payment and verifies that a different authorized reviewer approves it before adult membership activation.
6. Registers a fictitious minor, verifies the fee, confirms they remain inactive, then verifies guardian consent and checks activation.
7. Creates a stock item, receives one unit, creates two sales and **concurrently** tries to check out the final unit: exactly one success, one stock conflict, no negative balance.
8. Checks the sales API includes the buyer member number, and verifies club income reports include exactly one membership receipt and one completed store sale, with no double counting.
9. Ends the HTTP server, closes its pooled PostgreSQL sessions and drops the test-only schema.

**Out of scope in the initial live runner:** complete end-to-end team events and loan equipment lifecycles, refunds, performance/load tests, production deployment, browser automation, bank/M-Pesa settlement validation. These still need further QA before production.

## Suggested full verification checklist

| Check | Offline code checks | Requires configured environment |
|---|---|---|
| Existing and regression unit tests | Yes | No |
| Backend JavaScript syntax (`node --check`) | Yes | No |
| Actual Express route / HTTP headers | No if npm missing | Yes |
| All migrations, realistic DB transactions | No | Yes: test PostgreSQL |
| Double checkout of same final stock item | Logic-only unit tests | Yes: live integration script |
| React production compilation | No if Vite missing | Yes: `npm run build` |
| Mobile-money settlement accuracy | No | External human verification / later integration |
| User-centered accessibility, lower bandwidth, small screens | Partial | Manual/automated browser testing |
| Backup recovery and real-world privacy review | No | Deployment/staging review |

## Safeguards and known policy questions

- Always use fictitious member names and contacts in demonstrations and automated tests; protect details of minors and special-needs records.
- Membership fee is a charge, not recorded income. Only verified payments count as collections.
- Cash sale completion requires an authorized clerk's assertion. Mobile-money sale completion requires independent verification; a typed reference is not proof.
- Patron commission remains **provisional** until management chooses billed vs verified-collected basis.
- Do not allocate damaged/lost equipment liability to individuals until policy is agreed.
- Actual available sports in the case study: 15 named, though the case describes 16.
- Full end-to-end/real DB checks are a **gate**, not a task to silently claim as complete when prerequisites are missing.

## Git and continuation

Suggested commit: `test: add isolated PostgreSQL integration runner and harden API`

After running integration on your laptop, save test output **without real credentials or personal information** and report any errors. First fix integration defects; only after successful PostgreSQL and React build verification should the club enter a user-acceptance/staging phase.
