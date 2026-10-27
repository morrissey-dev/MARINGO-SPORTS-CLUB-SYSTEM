# Implementation Part 16 — Controlled Refund Payment and Reconciliation

**Status:** Source implementation; full PostgreSQL HTTP integration and React build must pass on GitHub CI before this milestone is accepted. This is not bank/mobile-money settlement integration and is not approved for production.

## Purpose

Part 15 recorded returned goods and an entitlement (`store_returns.refund_due`) after independent inspection. A return is **not** a cash refund. Part 16 adds a separate, controlled recording workflow for an actual outgoing refund from the club.

## Lifecycle

1. A store clerk records merchandise returned from a **completed** sale, with quantities and reason.
2. A different authorized officer accepts the return after inspecting resellable/damaged conditions, creating the refund entitlement. Only resellable returned goods increase stock.
3. A finance/management officer requests **one** cash or mobile-money refund for an accepted return with positive `refund_due`. The backend takes the amount from the recorded entitlement, **not the browser**.
4. The refund stays `pending`. It is **not a cash outflow** and cannot be counted as paid.
5. A *different* authorized finance/management officer can either reject or mark the refund `paid` **only after independently checking external evidence of actual repayment**, recording a unique voucher/transfer reference and explanatory verification note. A mere unverified reference is insufficient evidence of settlement.
6. A paid refund is immutable at the application API level and appears as negative `store_refund` cashflow **at its verification time**, separately from the original completed sale. There is no second stock movement and the original sales receipt is not erased.

### Limits and business assumptions

- **One refund payment request per accepted merchandise return.** The only allowed disbursement in this slice is the *full* validated `refund_due` amount. No partial payouts, multi-party split, replacement of rejected refunds, or amendments after paid.
- Rejected requests are terminal; if a payout needs to be re-opened, management must define an independently approved exception process rather than creating duplicate money records.
- Refund cashflow means **staff-verified disbursement evidence**, not automatic bank reconciliation. It does not automatically send cash or call an M-Pesa API.
- Customer identity verification, funds availability, policy on returns after a long delay and refund reversal procedures require real club approval before production.
- Disputes, chargebacks or correction of an incorrectly marked paid refund require a future audited adjustment workflow. Never delete a paid refund or secretly modify the original sale.

## API additions

All endpoints require authenticated staff and role `ADM`, `FIN` or `MGT`. POST requires same-origin + CSRF headers.

| Endpoint | Behavior |
|---|---|
| `GET /api/v1/sales/refunds` | Recent refund amounts, statuses and payment confirmation references for finance |
| `POST /api/v1/sales/returns/{returnId}/refunds` | Create pending refund; requires `Idempotency-Key` and method/reason |
| `POST /api/v1/sales/refunds/{refundId}/review` | Independent verifier rejects or confirms paid with evidence |

Request:

```json
{"method":"cash","reason":"Customer returned item after inspection"}
```

Payment confirmation (**only after actual payment evidence checked**):

```json
{"decision":"pay","evidenceReference":"CASH-VOUCHER-001","evidenceNote":"Signed voucher and cashbook disbursement independently confirmed"}
```

Rejection:

```json
{"decision":"reject","reason":"Supporting payment evidence cannot be verified"}
```

Notes: Client cannot choose the refund amount. The approved entitlement from `store_returns` is authoritative. Refund submission retries with the same key and payload return the same record; different keys cannot create another request for that return. Double review returns a conflict. The database uses a unique evidence-reference index for paid refunds.

## Database change

The additive migration `database/migrations/011_store_refunds.sql` creates `store_refunds`. Earlier migrations are unchanged. It stores the original return/sale linkage, exact `NUMERIC(12,2)` amount, method, pending/paid/rejected state, initiating officer, independent reviewer, timestamps and proof reference. Unique constraints enforce one refund per return and no reuse of a paid voucher/transfer reference.

## Reports

- `GET /api/v1/reports/income` has a new `store_refund` source with negative amounts **only if status is paid** and the independent verification occurred in the requested Nairobi reporting period.
- `store_sale` remains a separate positive source based on completed sales and verified tenders. The source rows are grouped by payment method; `netCollected` is now **net recorded cashflow**, not only gross sales.
- Merchandise returns do not affect income until a refund is independently confirmed. This avoids claiming a repayment for unverified cash/mobile-money references.
- The product-sales report remains the **original completed-sales figure before refunds** and explicitly points readers to Club cashflow for net receipts.
- Future patron commissions and equipment assessments remain provisional/unpaid; they do not change this refund ledger.

## Tests to run

At repository root:

```powershell
npm install
npm test
npm run build
```

With a separate dedicated PostgreSQL database (`*_test`) configured as documented in `docs/implementation-step10.md`:

```powershell
npm run test:integration
```

The integration run must confirm that return acceptance does not change recorded money; creating a pending refund does not affect income; a requester cannot verify their own disbursement; verification causes exactly one negative cashflow entry; repeat payout is rejected; stock remains unchanged during refund payment.

## Human acceptance

Use fictional records and test staff accounts to follow the new UAT scenarios. Finance must have a real, independent cash voucher or M-Pesa settlement confirmation before clicking *Confirm paid*. The club must validate the evidence and refund dispute policy before real disbursements.

**Git commit suggestion:** `feat: verify merchandise refund payments and reconcile cashflow`.
