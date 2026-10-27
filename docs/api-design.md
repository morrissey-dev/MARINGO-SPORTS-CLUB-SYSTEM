# Maringo Sports Club Management System (MSCMS)
## Step 3 — REST API Design · v0.1

**Status:** Draft API contract, not working code.  
**Method:** 1 Million Devs system-design sequence + AI Safari (decomposition, user-centered workflows, fairness, privacy, verification).  
**Inputs:** `docs/requirements.md` and `docs/estimates.md`.  
**Next:** `docs/data-model.md`.

## 1. API foundations

An API is a contract for how the club interface communicates with the server. A `GET` fetches records, `POST` creates or performs a transaction, `PATCH` updates selected fields, `PUT` replaces a complete collection, and `DELETE` removes an allowed association. A `GET` must never change stock or create financial transactions.

- Base URL path: **`/api/v1`** (versioned).
- Request/response format: **JSON**; exports may be CSV/PDF.
- Login: HTTPS, same-origin HTTP-only secure session cookies, CSRF protection for data-changing requests, login rate limiting.
- Every request has server-side authorization and input validation. Roles: **ADM** administrator, **REG** registration officer, **STO** store clerk, **PAT** patron (only assigned teams/sports), **CAP** captain (only own equipment), **FIN** finance officer, **MGT** management.
- Staff user accounts and registered member records are **different** entities. Member self-service is not needed in the initial version.
- Money in JSON: **decimal strings in KES**, e.g. `"1000.00"`; calculate on server with exact decimal arithmetic (integer cents or SQL NUMERIC). Never trust a price sent by the browser.
- Dates: birth dates as `YYYY-MM-DD`; timestamps are timezone-aware ISO 8601, shown in Kenyan local time.
- List endpoints return `{"data":[],"pagination":{"page":1,"pageSize":20,"total":0}}`; maximum pageSize 100. Search/sort/filter query parameters must be whitelisted.
- Monetary changes, sale checkout, equipment issue/returns and batch registrations use an **`Idempotency-Key`** header; a retry with the same key and same payload must not post twice. Same key with different payload -> `409 Conflict`.
- Important records (payments, sale receipts, stock movements, membership histories) cannot be hard-deleted. Use audited reversal/void workflows.
- Never log passwords, sensitive health/special-needs details or minors' next-of-kin information.

### Standard status and error format

- `200` successful read/update; `201` new resource; `204` allowed deletion.
- `400` malformed request; `401` not logged in; `403` not authorized; `404` not found; `409` conflicting state; `422` invalid business input; `429` rate limit; `500` unexpected server issue.

```json
{
  "error": {
    "code": "AGE_NOT_ELIGIBLE",
    "message": "Registration is available to ages 12–35.",
    "fieldErrors": {"dateOfBirth": "Outside eligible range"},
    "requestId": "req_example_123"
  }
}
```

## 2. Proposed endpoints

All paths below are relative to `/api/v1` and **do not yet exist in code**. Access checks must also enforce record-specific permissions, not just the role label.

### A. Authentication and staff

| Method | Path | Purpose | Who |
|---|---|---|---|
| POST | `/auth/login` | Authenticate staff | Public, rate limited |
| POST | `/auth/logout` | End current session | Logged-in staff |
| GET | `/auth/me` | Current user and roles | Logged-in staff |
| GET | `/users` | List staff accounts, excluding secrets | ADM |
| POST | `/users` | Create staff account/assign role | ADM |
| PATCH | `/users/{id}` | Change/disable staff access | ADM |

### B. Membership and sports — FIRST IMPLEMENTATION SLICE

| Method | Path | Purpose | Who |
|---|---|---|---|
| GET | `/organizations` | Find organizations | REG, ADM |
| POST | `/organizations` | Register school, college or religious group | REG, ADM |
| GET | `/members` | Search/filter/page member records; limit private fields | REG, ADM; PAT on assigned team |
| POST | `/members` | Register individual or group-affiliated person; create fee charge | REG, ADM |
| GET | `/members/{id}` | Retrieve permitted profile | REG, ADM; authorized PAT limited view |
| PATCH | `/members/{id}` | Update permitted member data; audit change | REG, ADM |
| POST | `/group-registrations` | Validate/import members from one group; return row-level errors | REG, ADM |
| GET | `/sports` | Sports selection list | Logged-in staff |
| POST | `/sports` | Add verified new sport | ADM |
| PUT | `/members/{id}/sports-preferences` | Replace priorities for selected sports | REG, ADM |
| GET | `/members/{id}/membership-charges` | Charges, payments and balances | REG, FIN, ADM |

**Rules:** On new registration age must be 12–35 inclusive, derived from full date of birth; bands minor 12–17, middle 18–25, senior 26–35. Individual membership charge KSh 1,000; group member KSh 500. Prevent duplicated sport selection/priorities; preferences do not imply actual team placement. For minors, require a verified guardian-consent process. Apply stricter access to special-needs and next-of-kin data.

### C. Sports teams and events

| Method | Path | Purpose | Who |
|---|---|---|---|
| POST | `/sports/{id}/patron-assignments` | Appoint patron with effective dates | MGT, ADM |
| GET | `/teams` | List teams per sport | PAT, MGT, ADM |
| POST | `/teams` | Create team | PAT for assigned sport, ADM |
| POST | `/teams/{id}/members` | Add eligible club member to team | Assigned PAT |
| POST | `/teams/{id}/captain-assignments` | Appoint captain **from team members** | Assigned PAT |
| GET | `/events` | View events by sport/status/date | Authorized staff |
| POST | `/events` | Schedule internal/external event | Assigned PAT, ADM |
| POST | `/events/{id}/participants` | Enroll participating members | Assigned PAT |
| POST | `/events/{id}/finalize-roster` | Lock participants; create exactly-once external-event fees | Assigned PAT, subject to policy |
| GET | `/events/{id}/facilitation-summary` | Assessments, collections and outstanding balances | Assigned PAT, FIN, MGT |
| GET | `/patron-commissions` | Commission owed/approved/paid | FIN, MGT; patron sees own |
| POST | `/patron-commissions/{id}/approve` | Controlled approval before payout | FIN/authorized approver |

**Rules:** External events charge **KSh 500 per participating member**. Finalization cannot create duplicate bills. Proposed (NOT confirmed) patron commission: **20% of confirmed collected fees**, adjusted for refunds. Retain historical event/patron/captain assignments.

### D. Store, stock and sales

| Method | Path | Purpose | Who |
|---|---|---|---|
| GET | `/store/items` | Items, variants, unit prices and inventory quantities | STO, FIN, ADM |
| POST | `/store/items` | Add item/SKU/price (including shoe price variants) | STO, authorized approver |
| PATCH | `/store/items/{id}` | Controlled catalogue and pricing update | Authorized STO/ADM |
| POST | `/store/stock-receipts` | Record incoming stock | STO |
| POST | `/store/stock-adjustments` | Document counted stock change and reason; approval required | STO + approver |
| GET | `/store/stock-movements` | History of receipts, sales, issues, returns | STO, FIN, MGT |
| GET | `/store/reorder-alerts` | Items at/below 20% of maximum stock | STO, MGT |
| POST | `/sales` | Create draft sale; server calculates subtotal/discount | STO |
| GET | `/sales/{id}` | Read draft/paid/void status and lines | STO, FIN |
| POST | `/sales/{id}/checkout` | Verify tender and atomically complete payment + stock deduction | STO, authorized verification |
| POST | `/sales/{id}/void` | Controlled void/reversal workflow | FIN, ADM |

**Rules:** Discount is 5% **only when subtotal > KSh 10,000**. Exactly KSh 10,000 means no discount. Preserve the unit price of each finalized sale line even if catalogue prices change. Checkout requires a server-side stock recheck and one database transaction: save receipt and stock movements or roll back everything. Never oversell. Trigger alert on stock **<= 20% of configured maximum**. Stock **sold** versus equipment **temporarily issued** need separate state tracking.

**Cash vs mobile money:** Initially, the app records cash and mobile-money payment details; it does **not** confirm M-Pesa settlement automatically. An entered reference must remain pending until verified by an authorized staff procedure. Do not claim payment is confirmed simply because a reference string exists. Automated M-Pesa integration can be considered later.

### E. Equipment

> **Part 8 implementation update:** The implemented endpoints use `/api/v1/equipment/items`, `/api/v1/equipment/stock-receipts`, `/api/v1/equipment/loans`, `/api/v1/equipment/loans/{id}/issue`, `/api/v1/equipment/loans/{id}/returns`, `/api/v1/equipment/incidents`, and `/api/v1/equipment/incidents/{id}/confirm`. The original paths in this section are planning placeholders and are not implemented as aliases. See `docs/implementation-step8.md` for actual payloads, roles and safeguards. Captains do not yet have staff or self-service login. Incident assessment does not allocate debts.



| Method | Path | Purpose | Who |
|---|---|---|---|
| POST | `/equipment-loans` | Request equipment for an event/team captain | Assigned PAT, own CAP |
| POST | `/equipment-loans/{id}/issue` | Clerk releases items with quantity/condition | STO |
| POST | `/equipment-loans/{id}/returns` | Receive inspected quantities and record condition | STO |
| POST | `/equipment-incidents` | Record loss/damage and market-value evidence | STO, assigned PAT |
| GET | `/equipment-incidents/{id}` | View appropriate incident details | STO, FIN, MGT; related PAT |
| POST | `/equipment-incidents/{id}/confirm` | Approve incident and total surcharge | MGT, authorized approver |

**Rules:** Total surcharge for approved lost/damaged equipment = **market value × 1.10**. The brief does NOT say how a single surcharge should be divided between captain and team members. **Do not automatically assign individual debts** until the club decides this policy. Keep equipment issue, return and inspection history immutable.

### F. Finance and reporting

| Method | Path | Purpose | Who |
|---|---|---|---|
| POST | `/payments` | Record an allocated payment for membership, event fee, or approved surcharge | FIN, approved REG membership collection |
| GET | `/payments` | Search/audit payments and statuses | FIN, ADM |
| POST | `/payments/{id}/reverse` | Authorized reversal/refund with reason | FIN + approval |
| GET | `/reports/memberships` | Category, registrations, billed/paid | REG, FIN, MGT aggregates |
| GET | `/reports/sales` | Receipts, discounts, units | STO, FIN, MGT |
| GET | `/reports/inventory` | Stock quantities, history, reorder alerts | STO, MGT |
| GET | `/reports/events` | Participation, fees, collections, commission | Related PAT, FIN, MGT |
| GET | `/reports/equipment` | Borrowed, overdue, incident/surcharge status | STO, FIN, MGT |
| GET | `/reports/income` | Money received by source, refunds, commission expenses | FIN, MGT |

**No double counting:** Sales checkout creates its own internal receipt; `POST /payments` must reject arbitrary second "sales payments." Charges are amounts *billed*, payments are amounts *collected*, and commission is an *expense*. Date-filtered reports must reconcile with ledger records and show reversals.

## 3. Worked API examples (dummy records)

### Example A: Register a club member

`POST /api/v1/members` with staff authentication and an `Idempotency-Key`.

```json
{
  "fullName": "Example Member",
  "gender": "female",
  "dateOfBirth": "2009-06-15",
  "contact": {"phone": "+254700000000"},
  "nextOfKin": {"name": "Example Guardian", "relationship": "parent", "phone": "+254711000000"},
  "subCounty": "Example Sub-county",
  "schoolOrCollege": "Example School",
  "enrollmentType": "INDIVIDUAL",
  "organizationId": null,
  "sportsPreferences": [
    {"sportId": "sport_football", "priority": 1},
    {"sportId": "sport_basketball", "priority": 2}
  ],
  "guardianConsentRecordId": "consent_example_001"
}
```

The server independently verifies the referenced consent record (a client-supplied ID alone is not consent). Height, weight and special-needs details are not mandatory unless justified and access-protected.

Expected `201 Created`:

```json
{
  "data": {
    "id": "mem_000123",
    "membershipCategory": "MINOR",
    "enrollmentType": "INDIVIDUAL",
    "membershipCharge": {
      "id": "chg_000123", "amountKes": "1000.00",
      "paidKes": "0.00", "balanceKes": "1000.00", "status": "UNPAID"
    }
  }
}
```

For a **GROUP** enrolment with an eligible `organizationId`, server fee becomes `"500.00"` per member.

### Example B: Pay the membership fee

`POST /api/v1/payments`, authorized clerk/finance officer and unique idempotency key:

```json
{
  "obligationType": "MEMBERSHIP",
  "obligationId": "chg_000123",
  "amountKes": "1000.00",
  "method": "CASH",
  "externalReference": null
}
```

Success (`201 Created`):

```json
{
  "data": {
    "id": "pay_000987",
    "status": "CONFIRMED",
    "amountKes": "1000.00",
    "obligationId": "chg_000123",
    "remainingBalanceKes": "0.00"
  }
}
```

For `MOBILE_MONEY`, create `PENDING_VERIFICATION` rather than pretending settlement is automatic. Enforce constraints on amount and duplicates.

### Example C: Buy store items

`POST /api/v1/sales`:

```json
{
  "memberId": "mem_000123",
  "items": [
    {"storeItemId": "sku_hockey_stick", "quantity": 5},
    {"storeItemId": "sku_track_suit", "quantity": 1}
  ]
}
```

The backend looks up unit prices: `5 × KSh 2,000 + 1 × KSh 1,000 = KSh 11,000`, discount `KSh 550`, payable `KSh 10,450`.

Draft response (`201 Created`):

```json
{
  "data": {
    "id": "sale_demo_001",
    "status": "DRAFT",
    "subtotalKes": "11000.00",
    "discountKes": "550.00",
    "totalKes": "10450.00",
    "stockDeducted": false
  }
}
```

Only `POST /api/v1/sales/sale_demo_001/checkout` can complete the sale; on checkout, verify payment authorization, recheck availability, save price snapshots and reduce stock **atomically**. A retry must not deduct stock twice.

### Example D: External event charges and commission

For a confirmed **EXTERNAL** event with ten participating members:

- Billed facilitation: `10 × KSh 500 = KSh 5,000`.
- If KSh 4,000 is verified as collected, and the club approves the **collections-based** commission rule, patron commission = `20% × KSh 4,000 = KSh 800`.
- Return separate fields: `billedKes: "5000.00"`, `collectedKes: "4000.00"`, `balanceKes: "1000.00"`, `commissionKes: "800.00"`.
- Finalizing the event roster twice must **not** generate twenty player charges.

## 4. Acceptance tests before calling an endpoint finished

| Test | Expected result |
|---|---|
| Register age 11 or 36 | `422`, no member or charge created |
| Register exactly ages 12, 18, 26 and 35 | Accepted in correct band |
| Register minor without verified consent | Rejected, no sensitive data saved |
| Duplicated sport priorities | Rejected without partial update |
| Group registration | Exactly KSh 500 assessed per accepted group member |
| Sale subtotal KSh 10,000 | Zero discount |
| Sale subtotal KSh 11,000 | KSh 550 discount; KSh 10,450 payable |
| Two clerks check out last SKU | No negative stock or double sale |
| Retry sale/payment with same idempotency key | Only one committed transaction |
| Re-finalize external-event roster | No duplicate facilitation fees |
| Equipment assessed at market value KSh 2,000 | Incident total KSh 2,200; no guessed individual liabilities |
| Unauthorized staff calls finance/admin API | `403` or limited/appropriately redacted data |
| Report totals after refunds | Match confirmed payment and reversal ledger |

## 5. API design trade-offs / pending decisions

1. **One REST API and one relational database** are suitable for planning estimates (typical 5, peak 15 staff sessions); avoid unnecessary microservices.
2. **Explicit action endpoints** such as `/checkout`, `/issue`, `/finalize-roster` prevent arbitrary client-side status changes.
3. **Server-side business rules** are authoritative; frontend previews are informative only.
4. **Automatic payment integration, offline stock mutation queues and member portal** are future extensions, not assumed MVP requirements.
5. **Open matters:** 15 sports listed vs 16 asserted; membership renewal; commission basis; age-out rules; group validation; equipment surcharge allocation; legal/safeguarding workflow. Document, confirm, then encode.

**Next:** Step 4, `docs/data-model.md` — determine tables, primary/foreign keys, unique constraints, historical price snapshots, ledger relationships, ER diagram and database transactions.

**Suggested Git commit:** `docs: define MSCMS REST API endpoints and transaction rules`.
