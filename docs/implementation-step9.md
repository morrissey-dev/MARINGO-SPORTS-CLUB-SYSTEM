# MSCMS — Implementation Part 9: Reports and Financial Reconciliation

**Scope:** read-only, role-restricted operational and financial summaries. Extends Part 8 without altering earlier database migrations or previously deployed business transactions.

## New files and changes

- `server/src/reports/policy.js`: strict period validation and exact decimal summation.
- `server/src/reports/service.js`: parameterized SQL reports, aggregated to exclude minors' personal details.
- `server/src/reports/routes.js`: secure report API and per-report role permissions.
- `client/src/ReportsPanel.jsx`, `client/src/reportExport.js`: staff report tabs, inclusive dates, responsive tables and CSV exports protected against spreadsheet formulas.
- `database/migrations/009_reports_indexes.sql`: indexes on already recorded timestamps; no data rewriting.
- Tests `server/test/report-policy.test.js`, `server/test/report-service.test.js`, `server/test/report-security.test.js`; `app.js`, `App.jsx`, CSS and README extended.

## API endpoints

All routes require authenticated staff sessions. They are **GET only**, and include `Cache-Control: no-store`.

| Route | Roles | What it shows |
|---|---|---|
| `/api/v1/reports/overview` | ADM, FIN, MGT | Recorded net receipts by source and method (same contract as income) |
| `/api/v1/reports/income` | ADM, FIN, MGT | Verified receipts and dated reversals; **not profit** |
| `/api/v1/reports/memberships` | ADM, REG, FIN, MGT | New registrations by individual/group, billed amounts, lifetime verified receipts, age-at-registration bands |
| `/api/v1/reports/sports` | ADM, MGT, FIN | Current sports catalogue, interests, teams, captains and appointed patrons |
| `/api/v1/reports/sales` | ADM, STO, FIN, MGT | Completed sale totals, discount totals, gross sales by SKU |
| `/api/v1/reports/inventory` | ADM, STO, FIN, MGT | Current saleable inventory, low-stock threshold, receipt/sale movements for period |
| `/api/v1/reports/events` | ADM, FIN, MGT | Events by event date, attendees, assessed fees, lifetime receipts and two **non-payable** commission estimates |
| `/api/v1/reports/equipment` | ADM, STO, FIN, MGT | Current equipment balances, issued/overdue loans, incident valuations for selected period |

Example: `GET /api/v1/reports/income?from=2026-10-01&to=2026-10-27`.

Dates `from` and `to` are **inclusive** Kenyan calendar dates, validated as real `YYYY-MM-DD`; maximum 366 consecutive days. Default is 30 Nairobi calendar days ending today. The backend converts to a half-open UTC timestamp interval: `>= 00:00 +03:00` on `from`, `< 00:00 +03:00` on the day after `to`. Invalid ranges return HTTP 422; unauthorized staff get 403; missing or expired login gets 401. No sensitive member details are returned by these aggregate routes.

## Reconciliation rules: why these distinctions matter

### Source of recognized collections

1. **Membership/facilitation:** count `payment_allocations.amount` **once**, at `payments.verified_at`, for a payment whose status is `verified` or `reversed` (verified once, later reversed); do not count `pending` or `rejected` payment records. For a reversed payment, create an offset event of the same magnitude at `payments.reversed_at`. This ensures dated reporting continues to show an earlier receipt even if it was later reversed. This is an internal accounting reversal and **not evidence of a cash refund to the member**.
2. **Store:** count **only** `store_sales` where `status='completed'` and verified tender exists. Store tender is not stored in the membership `payments` table, so adding it exactly once does not double count.
3. **Surcharges:** the income report reserves a `surcharge` source category if/when charged and paid by a future approved policy. Part 8 incident valuations are **not charges, payments, or received cash**.
4. **Commission:** policy is undecided (20% of assessed vs verified facilitation fees). The events report shows both projections; **no commission is booked as an actual expense and no payment can be authorized by Part 9.** Consequently net profit and commission expense fields intentionally return `null`, not made-up KSh 0 figures.
5. **Do not call this a bank reconciliation:** the system cannot independently match bank statements/M-Pesa confirmations to recorded receipts. It presents **net recorded verified collections**, not third-party settlement proof or audited profit.

### Snapshots versus periods

- Income, sales and payment reversals use **transaction timestamps inside the selected period**.
- Membership report selects **memberships registered during the period**, and labels their current status and lifetime verified receipts separately. These are *not necessarily* payments collected during the period.
- Event report selects **event dates inside the period**, but its `collectedLifetime` includes all verified amounts against that event as of today; this is not period cashflow.
- Store inventory, sports roles and equipment balances are **current snapshots**, not reconstructed as-of dates; period stock receipts/sales and equipment incident confirmation counts are clearly labelled.
- The staff interface exports **only the displayed aggregate table**, not an unbounded full financial ledger or private member file. Events are capped at 100, store/sports/equipment lists at 200, with explicit truncation flags. Aggregate income, however, is calculated over the whole requested period.

### Worked example (illustrative)

- Membership payments verified KSh 1,000, reversal of KSh 200 in period -> net membership collections KSh 800.
- Facilitation verified KSh 500 -> KSh 500.
- Completed store sale subtotal KSh 12,000 with 5% discount -> actual sale revenue KSh 11,400.
- Total **recorded net receipts = KSh 12,700**, irrespective of KSh 1,100 approved lost-equipment assessment (uncollected).
- Commission at 20% would be KSh 100 on this received KSh 500 *if* that policy is approved, **but is not yet an expense**.

## Security, audit and privacy

- Finance/management/administrator view all financial aggregates. Registrars get only membership cohort reports; store clerks get store/inventory/equipment reports. Patrons **do not** have access to cross-club reports until a properly scoped patron report exists.
- Report endpoints never expose phone numbers, next-of-kin, guardians, member special needs or birth dates. Age bands are aggregated using age at enrollment; no names exported.
- The existing transaction record/audit ledgers remain the source of truth; Part 9 creates no posted financial transactions.
- CSV formula injection is escaped in frontend exports; always test CSV output before sharing externally.

## Running in VS Code

```powershell
# From project root; use your private server/.env (do NOT push it)
git pull origin main
npm install
npm run db:check
npm run db:migrate
npm test
npm run build
npm run dev:server
# Open a separate terminal:
npm run dev:client
```

Open `http://localhost:5173`, sign in with an authorized staff account, scroll to **Club reports and financial reconciliation**, select dates and report tab. Export uses aggregated displayed rows only.

## Tests and remaining verification

- Run `node --test server/test/*.test.js` from project root for dependency-free Node tests.
- New tests cover Nairobi/UTC boundaries, inclusive ranges, invalid dates, exact cents, signed reversals, no duplicate sale-payment count, commission vs income separation, product discounts, 20% low-stock threshold and result caps.
- **Still required on a configured machine:** apply migration 009 to actual PostgreSQL and execute real report SQL with fixture data; run `npm run build` with npm dependencies installed; simulate finance permissions through HTTP, and reconcile results to test ledger entries. Do not call the project production-ready until these pass.

## Next milestone

Part 10: end-to-end PostgreSQL/API integration, production build, security/usability testing and fixes. Remaining business-policy work (commission payout, incident allocation, refunds, 16th sport) must not be invented or forced into the financial books.

**Commit suggestion:** `feat: add role-restricted reconciliation and operational reports`.
