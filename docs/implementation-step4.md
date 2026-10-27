# Implementation — Part 4: Payment Recording, Verification and Membership Activation

**Status:** Implemented in source; 37 Node tests (unit and mocked-service) pass locally. **Live PostgreSQL migrations/API integration and Vite production build have NOT been verified here** (PostgreSQL and npm packages are unavailable in the current working environment). Do not use real financial or child data until a full staging test and club policy review.

## 1. Continuity: what was preserved and what changed

Part 4 was developed **from the entire Part 3 project folder**. No Part 3 file was removed and none of the previously applied database migrations (`001`, `002`, `003`) was changed.

- New additive migration: `database/migrations/004_membership_payments.sql`.
- New backend module: `server/src/payments/{policy,service,routes}.js`.
- New React modules: `client/src/PaymentPanel.jsx`, `client/src/GuardianReviewPanel.jsx`.
- New local-only staff role setup: `server/scripts/create-staff.js` and npm command `staff:create-role` (blocked in production).
- Updated app wiring and UI; minor amendment to export a reusable serialization helper; added guardian consent reconciliation and review listing.
- New tests: `server/test/payment-policy.test.js`, `server/test/payment-service.test.js`.

Authentication, basic member registration, sports selection, guardian consent data model, 15 seeded sports and the six-part design documents remain intact. Other planned modules have not been silently generated or marked completed.

## 2. Why payment requires two actions

**Recorded is not verified.** Cash receipt or a submitted M-Pesa reference is never sufficient proof by itself.

1. An `ADM`, `REG` or `FIN` staff user records a payment against a valid **membership charge** with `POST /api/v1/payments`. It starts with `status = pending`.
2. An **independent** `ADM`, `FIN` or `MGT` staff user checks the evidence outside the application and calls `POST /api/v1/payments/:id/verify` with a short **non-sensitive** reference to that evidence. The creator cannot verify their own payment.
3. Verified receipts are allocated to the membership charge **within a database transaction**, and the unpaid balance is recalculated. Partial payments are allowed. Verification exceeding the remaining balance fails (409).
4. A charge becomes paid only once verified receipts total the billed amount. The membership activates only if it is fully paid **and** any applicable guardian consent has been verified. Verification can occur in either order.
5. Reversed verified payments remain in the history but are excluded from verified collections. Membership/charge status is recalculated; a member may return to draft/pending status.

**Policy limitation:** This is a manual-operator finance workflow for MVP, not integrated M-Pesa or a full double-entry financial system. `verification_reference` is an attestation that approved evidence was examined, not automatic proof or a gateway callback. Staff must establish a meaningful maker/checker and reconciliation process before live use. Real refunds and cash-handling controls require club approval.

## 3. New database objects

`payments` has charge, exact decimal amount, method, optional unique mobile reference, lifecycle status, recorder, reviewer, verification reference, reversal officer, reason and timestamps. A unique reference remains reserved after reversal to prevent accidental duplicate recording.

`payment_allocations` records one membership-charge allocation per verified payment. This stage intentionally supports only **membership charges**; sales, event fees and equipment surcharges will extend this design later rather than using fabricated sales receipts.

Money is validated in the API as KSh **decimal strings with exactly two decimal places**, and PostgreSQL stores `NUMERIC(12,2)`. Server calculations use integer cents for totals and bounds. Clients never decide whether a charge was actually paid.

### Invariants

- No member activation based on pending payments.
- A minor's activation remains blocked until guardian consent is **verified** in the database.
- A payment is verified only after external evidence has been reviewed by a **different staff user**.
- `SUM(verified allocations)` for a charge must not exceed its billed amount.
- Duplicate mobile references fail with a conflict; an idempotency key prevents duplicate `POST /payments` records.
- All related status/ledger writes are in one PostgreSQL transaction and auditable; the UI never reports success before server commit.
- A reversed payment does not delete a ledger allocation and does not falsely leave a membership active.

## 4. APIs added in Part 4

All paths are prefixed `/api/v1`.

| Method | Path | Roles | Behavior |
|---|---|---|---|
| GET | `/payments/charges?search=` | ADM, REG, FIN, MGT | At most 40 member membership charges and verified totals |
| GET | `/payments/members/:memberId/summary` | ADM, REG, FIN, MGT | Member membership-charge totals |
| GET | `/payments?status=pending` | ADM, FIN, MGT | Pending or verified/reversed payment queue, 40 records |
| POST | `/payments` | ADM, REG, FIN | Record pending cash/mobile-money payment (must send `Idempotency-Key`) |
| POST | `/payments/:id/verify` | ADM, FIN, MGT | Independently verify payment, allocate money, recompute membership |
| POST | `/payments/:id/reverse` | ADM, FIN, MGT | Reverse verified payment after reason review |
| GET | `/members/guardian-consent/pending` | ADM, MGT | Restricted list for guardian-consent review |
| POST | `/members/:id/guardian-consent/verify` | ADM, MGT | Pre-existing endpoint, enhanced to activate if already fully paid |

**Required** for every modifying endpoint: staff cookie, request origin matching `APP_ORIGIN`, and `X-CSRF-Token` from session. `POST /payments` additionally requires an `Idempotency-Key` (16–128 alphanumeric, hyphens or underscores). Amount example: `"500.00"`.

### Recording example (fictional only)

```
POST /api/v1/payments
Idempotency-Key: example-payment-key-123456
X-CSRF-Token: <session token>
Content-Type: application/json

{"chargeId":"3","amount":"500.00","method":"mobile_money","reference":"DEMO000123"}
```

Response status 201, `data.status = "pending"`. No collected income and no member activation yet.

### Verification example

```
POST /api/v1/payments/1/verify
X-CSRF-Token: <session token>
Content-Type: application/json

{"evidenceReference":"FINANCE-CHK-2026-001"}
```

Response includes `status: "verified"`, `collected`, `balance`, `membershipStatus`, and `memberStatus`. A different staff account must have originally recorded it.

### Reversal example

```
POST /api/v1/payments/1/reverse
X-CSRF-Token: <session token>
Content-Type: application/json

{"reason":"Duplicate cash receipt confirmed by finance review"}
```

**Note:** Reversals are accounting corrections in the database; they are not live disbursements, refunds or M-Pesa reversals. Those require separately controlled procedures.

## 5. Set up in VS Code (PowerShell)

1. If you have a local project, **commit it to Git first**. Apply the new files, not a blind overwrite. This ZIP contains the whole codebase if you prefer a fresh copy. Do not replace your real `server/.env` with the example.
2. Check Node.js 22.12+ and your locally running PostgreSQL; copy `server/.env.example` to `server/.env` if it does not already exist.
3. From project root:

   ```powershell
   npm install
   npm run db:check
   npm run db:migrate
   npm test
   ```

   Migration `004_membership_payments.sql` will be applied if it was not already applied; older migrations' checksums are verified and those files are not modified.
4. If this is a fresh DB, create admin **once** with `npm run staff:create`. For testing two-user payment verification, in a **development environment only** create different staff accounts interactively with:

   ```powershell
   npm run staff:create-role
   ```

   Create for example one `REG` and one `FIN` user with distinct login accounts and secure, hidden passwords; do **not** use shared credentials. This local tool is not enabled in production.
5. In separate terminals run `npm run dev:server` and `npm run dev:client`; visit `http://localhost:5173` (or your configured `APP_ORIGIN`).
6. Register a **fictional** eligible adult member. Sign in as the registration officer and use **Membership payment recording & verification** to record KSh 1,000 as a pending receipt. Sign out, sign in as a finance user and verify with an actual **fictional test-evidence reference**. The charge/member status should become paid/active in a locally working integration test.
7. For a minor, test **both orders**: verify consent first, pay later; and pay first, verify consent later. The member must remain inactive until both requirements are met.

## 6. Tests and required local integration checks

The project currently passes **37 Node unit/mock-service tests**: 22 inherited and 15 new. Check via `npm test`. Coverage includes:

- KSh decimal validation; invalid and zero/negative amounts; cash vs mobile reference.
- Idempotent recording and key misuse rejection.
- Pending receipt has **no** allocation and no activation.
- Independent reviewer enforcement; full vs partial membership payments.
- Minors cannot become active just because a fee is paid.
- Reversal restores outstanding balance and retains an audit allocation.
- Verification cannot push collected money above the assessed charge.

**Must be tested against real PostgreSQL locally**: migration 004, unique mobile-reference constraint, serializing two verifiers, guardian consent/payment races, role/cookie/CSRF checks, portal form submission, HTTP errors, report balance totals, and frontend build (`npm run build`). We could not run these integration checks without a local PostgreSQL server and installed npm dependencies.

## 7. Open policies and safe limitations

- The club must approve independent evidence-verification procedures, refunds, reversals, who may hold money and how disputed payments are handled.
- Payments are only for membership charges in this increment; facilitation fees, item sales, equipment-loss surcharges and patron commissions are **not yet implemented**.
- Membership duration/renewal, 16th missing sport, 20% reorder settings and team surcharge allocations still require approval.
- The current pilot frontend has no large-group import, export tools or receipt printing. All payment reconciliation must be validated by a human.
- Because minors' data is involved, do not use the unvalidated development build for production registrations.

**Commit suggestion:** `feat: add verified membership payments and activation`

**Next increment:** sports teams, patrons and events — or store/inventory, depending on the chosen delivery priority. Keep the six-part design source of truth up to date before expanding transaction types.
