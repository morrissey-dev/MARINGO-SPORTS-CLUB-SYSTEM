# Part 13 — User Acceptance Testing (UAT) preparation and navigation improvements

**Status: scenarios prepared; user acceptance tests NOT executed.** PostgreSQL installation and the developer's local database connection remain outstanding. Never interpret passing unit/CI tests as approval by club users.

## What can be done while PostgreSQL installs?

- Review the UAT plan with intended users; agree what each role needs to accomplish.
- Check the new role-aware sidebar links and small-screen/keyboard navigation from the source, run automated navigation tests (`npm test`), and review the question list.
- Prepare **fictional** identities, roles, items, teams and events for later walkthroughs, but do not put them into real operational records or commit them to GitHub.
- Confirm unresolved club policies before a production release. **Do not approve commissions or assign personal surcharge liabilities without an agreed written rule.**

## Changes in this part

- The previously static sidebar labels are replaced by **clickable in-page links** filtered by the current staff roles. No new permission is granted: backend access control still decides authorization.
- The nav is usable from keyboard and stays visible as a horizontal, scrollable row on narrow screens. Destination outlines assist orientation; reduced-motion handling remains.
- Added `client/src/workspaceNavigation.js`, with deterministic filtering and no PII or backend calls; automated Node tests cover roles and duplicate-link prevention.
- Added a 36-scenario UAT worksheet, preconditions, evidence guidelines and blocker reporting. Unit tests **cannot** establish that the real UI works or that the club has accepted the system.

## Preconditions — do not run these tests against club member data

1. PostgreSQL is installed locally, and **`npm run db:check` succeeds** in the development database; see `docs/implementation-step12.md`.
2. Run `npm run db:migrate` and `npm run staff:create` from your local project root; create separate test staff roles using an authorized admin.
3. `npm test`, `npm run build`, `/api/v1/ready`, and staff login are checked locally.
4. Work on a **dedicated development database populated only with fabricated people and prices**; do not use real minors, payment references, mobile numbers or special-needs notes. Keep screenshots redacted.
5. Separate roles: REG, PAT, STO, FIN, MGT, ADM. CAP does **not** currently have a dedicated self-service frontend even though captain-specific records exist: treat captain UI requirements as a gap, not a test that passed.
6. Agree on an acceptance owner and record each test outcome accurately (PASS, FAIL, BLOCKED); blank outcomes are intentionally **unexecuted**.

## Test execution

Open `docs/uat-cases.csv` in a spreadsheet or CSV editor. Assign one tester to each scenario, use the `action_with_fictional_data` and `expected_result` columns, and fill actual results and evidence. Re-run failed cases after fixes. Do not mark BLOCKED cases as PASS. At least one registrar, patron, store clerk, finance officer and management reviewer should review their intended workflows; if people are unavailable, record this as **not yet validated**.

### Suggested fictional setup

- Adult member at age 18, one minor at age 17, and members at eligibility boundaries aged 12 and 35; age is computed by full date of birth, not birth year alone.
- A school/college/religious group with fictional contact data; two sports preferences ranked 1 and 2.
- One sport, patron, team, active team member and appointed captain; one internal and one external match with three participants.
- A product SKU with 10 units at configurable maximum; mock cash and *clearly invented* mobile reference values only.
- Equipment stock sufficient for partial return, a damaged unit and one lost unit; incident approved by a different authorized user.

## Critical acceptance rules

| ID | Acceptance rule | Why it matters |
|---|---|---|
| AC-01 | Member 12–35 inclusive at intake; group KSh 500/person, individual KSh 1,000 | Correct fee and eligibility |
| AC-02 | Minor activation requires verified guardian authorization plus paid dues | Child safeguarding |
| AC-03 | Pending cash/mobile-money references are not received income | Honest reporting |
| AC-04 | Second checkout cannot sell the last unit after first commits | No negative stock |
| AC-05 | 5% store discount only for subtotal strictly above KSh 10,000 | Accurate sales |
| AC-06 | Low-stock warning at **or below 20%** configured maximum | Reorder detection |
| AC-07 | External match: exactly KSh 500 per finalized player, once | No duplicate facilitation fees |
| AC-08 | Patron commission remains a provisional estimate pending policy approval | No unsupported payouts |
| AC-09 | Damage/loss assessment: 110% of approved market value; individual liability blocked pending policy | Avoid multiplying team debt |
| AC-10 | Reports separate billed, verified collected, reversed and outstanding | Prevent double counting |
| AC-11 | Every privilege checked on API even if user bypasses frontend | Security |
| AC-12 | A disconnected browser never falsely reports write success | Reliability |

## Bug report template

Record `Defect ID`, UAT case ID, tester role, page/API, test-only setup, clear reproduction steps, expected vs actual result, redacted screenshot/log, severity (critical/high/medium/low), and current owner. Never attach a real password, `DATABASE_URL`, CSRF token, child's contacts or personal payment evidence to issues in a public repository.

## Release decision gate

**BLOCKED for production** until local database setup and migrations work, actual staff walkthroughs pass, and security/privacy policies are approved. The green GitHub CI job checks software integrity; it cannot approve club procedures. Required management decisions remain: 15 vs 16 sports, consent proof, fee renewals, commission basis, equipment liability allocation, refund and retention policy.

### Minimum local commands after PostgreSQL installs

```powershell
git pull origin main
npm install
npm run db:check
npm run db:migrate
npm test
npm run build
npm run dev:server
# In a SECOND VS Code terminal:
npm run dev:client
```

Then visit `http://localhost:5173` and test with fictional records. If a local command fails, capture redacted error output and fix it before UAT sign-off.

**Suggested Git commit:** `feat: add role-aware staff navigation and UAT acceptance kit`.
