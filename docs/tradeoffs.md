# Maringo Sports Club Management System (MSCMS)
## Step 6 — Bottlenecks, Trade-offs and Implementation Readiness · v0.1

**Status:** Proposed engineering decisions and test scenarios; not measured production results or approved club policy.  
**Method:** 1 Million Devs: requirements → estimates → API design → relational model → architecture → **bottlenecks/trade-offs**. AI Safari: decomposition; user-centred, constraint-aware, dignity/privacy-respecting design; OCEAN verification.  
**Inputs:** `docs/requirements.md`, `docs/estimates.md`, `docs/api-design.md`, `docs/data-model.md`, `docs/architecture.md`.  
**Next:** incremental VS Code implementation with automated tests and meaningful Git commits.

## 1. Why this step matters

A **bottleneck** is a constraint that causes errors, slowdowns, or reduced throughput. A **trade-off** is a deliberate choice between approaches that optimize different goals. Maringo's key risk is not internet-scale traffic: it is **trustworthy handling of payments, stock, member information, and shared equipment** while multiple staff use the system. Our objective is the simplest maintainable system that demonstrably meets these needs.

### Baseline: hypothetical planning numbers, not actual club observations

| Dimension | Normal / baseline | Peak / stress scenario |
|---|---:|---:|
| Members | 3,000 Year 1 | 30,000 test dataset |
| Staff accounts | 25 total | 15 simultaneously active |
| API load | 0.42 req/s over an 8-hour business day, assuming 12,000 requests/day | 2–5 req/s sustained; 20 req/s for a 60-second burst |
| New registrations | 50 per average intake day, assuming 60 intake days/year | 200 on peak day / 200-record import |
| Sales | 30 per normal operating day; 9,000 per 300-day year | 100 on a busy day |
| Events | 624 annually at 12/week | clustered tournament-day registration, fees and stock activity |

These figures are **hypotheses for sizing and tests**, not promises about Maringo's actual membership or performance. Sessions are not requests/second, and imports are not interchangeable with interactive registration traffic. Review them with the club before production sizing.

## 2. Prioritized risks

| Priority | Bottleneck / risk | Likely failure | Mitigation to implement | How to prove it works |
|---|---|---|---|---|
| **P0** | Concurrent store checkout | Last item sold twice; negative stock | Short DB transaction; lock inventory rows in stable ID order or conditional atomic update; save sale/payment evidence/stock movements together | With stock = 1 and 2 simultaneous checkouts, exactly one commits; ending available = 0 |
| **P0** | Payment verification and retry | Duplicate paid balances or payment marked received without evidence | Idempotency key, unique reference where applicable, pending vs confirmed, finance verification and reversal audit | Replay same request/key 10 times; exactly one payment posting and one relevant allocation; unverified mobile transfer excluded from income |
| **P0** | Child and special-needs data exposure | Information visible in logs, exports or wrong staff screens | Per-record RBAC, explicit field selection, protected notes and consent, redacted logs | Test unassigned patron and store clerk cannot retrieve protected member/guardian fields |
| **P0** | Equipment double-issue/loss | Items loaned twice, inaccurate balances or duplicate surcharge | Transactional issue/return/incident movements, unique source identifiers, review workflow | Two captains requesting one unit cannot both receive it; surcharge created only after approval |
| **P1** | Large group registrations | Long request, partially created charges, duplicates | Validate before writes; bounded batches; unique keys; documented all-or-nothing or per-row acceptance | Import 200 records with invalid/duplicate entries; outcomes reconcile exactly with membership and charge rows |
| **P1** | Report queries | Reports compete with sales/registration | Date ranges, pagination, selective indexes, `EXPLAIN ANALYZE`, bounded exports; consider job/background export only if necessary | Run monthly reports during 5 req/s traffic; verify no lost writes and response target |
| **P1** | Server or database outage | Uncertain transaction states or data loss | Health checks, transaction status lookup, encrypted backups, practiced restore | Interrupt after commit before response; replay returns existing transaction; restore test passes |
| **P1** | Weak or interrupted connectivity | Users repeatedly submit forms or assume money was received | Small client assets, visible loading/unknown states, status lookup, retry same key; no offline checkout by default | Simulate disconnect during checkout and confirm no double posting and no false success screen |
| **P2** | Growing audit and ledger tables | Large slow queries, difficult backups | Index key filters; paginate histories; archive only under approved policy | Run same tests against 30k-member stress dataset and verify backup restoration |
| **P2** | Excessive application complexity | Slow feature changes, insecure inconsistent rules | One modular backend, shared transaction/money/permissions modules and automated tests | A business-rule change updates one authoritative calculation and passes integration tests |

**P0** means protect before any production use; **P1** should be handled for operational readiness; **P2** should be measured and improved as needed. This ordering is a proposed engineering priority, not a guarantee of probability.

## 3. Key trade-off decisions

### T-01 — Modular monolith versus microservices

- **Option A:** One Express backend with separate membership, sports/events, store/sales, equipment and finance modules. **Selected for MVP.**
- **Option B:** Several independently deployed services with separate data access and messaging.
- **Reason:** At 5–15 concurrent staff and 2–5 requests/s peak test target, microservices would add operational cost, authentication boundaries and distributed failure modes without a demonstrated payoff.
- **Cost of chosen approach:** A poorly structured monolith can become tightly coupled. Counter it with module boundaries, focused services, typed data contracts, integration tests and reviewed migrations.
- **Revisit when:** measured traffic, multiple independent teams, availability needs or separately scalable workloads justify the added complexity.

### T-02 — PostgreSQL versus SQLite and document databases

- **Option A:** PostgreSQL with transactions, foreign keys, constraints and row-level concurrency. **Selected for shared-staff MVP.**
- **Option B:** SQLite, attractive for local prototyping, but requiring deliberate configuration/testing of concurrent writers.
- **Option C:** Document database, flexible but less natural for these charge/stock/association integrity rules.
- **Reason:** Sales, fees, event participants and equipment histories have strong relational connections. One SQL transaction can protect multiple related writes.
- **Cost:** More setup and backup administration than a single SQLite file. Use local Postgres or a managed instance; do not expose the database publicly.
- **Revisit when:** real operational conditions differ substantially; don't change persistence technologies casually after transactional code is built.

### T-03 — Exact database transactions versus fast but unsafe writes

- **Option A:** Atomic checkout, equipment issue/return, event roster finalization and payment application. **Selected, mandatory.**
- **Option B:** Update receipt and stock in separate independent requests, risking partial completion.
- **Reason:** Correctness of money and inventory is more important than shaving milliseconds from a small-volume system.
- **Cost:** Locks may briefly serialize transactions on the same stock item; keep transactions short and monitor contention.
- **Revisit when:** measured lock wait times are problematic; first improve indexes and transaction design, not consistency guarantees.

### T-04 — Manual mobile-money verification versus immediate integration

- **Option A:** Record a payment as pending until authorized confirmation; cash confirmation follows a clear clerk/finance control. **Selected for MVP.**
- **Option B:** Provider API/webhook verification (possible future extension, credentials and agreements required).
- **Reason:** A typed reference does not prove settlement; no official provider integration details were supplied.
- **Cost:** Staff reconciliation work and slower confirmation; mitigate with status queues, unique references, audit trail and consistent procedures.
- **Revisit when:** transaction volumes and verified provider requirements justify integration. A provider webhook must be signature-verified and idempotent; never trust unsigned events.

### T-05 — Live balance table plus stock ledger versus recalculating all movements on each checkout

- **Option A:** `inventory_balances` updated in the same transaction as append-only `stock_movements`. **Selected.**
- **Option B:** Sum every historical movement for every checkout.
- **Reason:** Fast availability lookup combined with reconstructable audit history.
- **Cost:** Requires strict synchronization between both representations and periodic reconciliation queries.
- **Revisit when:** reconciliation exposes discrepancies; investigate and repair data under audited procedure, never bypass movement logging.

### T-06 — Server-calculated money versus client-side calculated prices

- **Option A:** Exact-decimal calculations and policy rules in backend/database, with client displaying a preview. **Selected.**
- **Option B:** Trust price, age group, surcharge or commission sent by browser.
- **Reason:** Tampered or stale frontend values can corrupt finances; snapshot prices/rates on committed transactions.
- **Cost:** Additional validation and tests on server.
- **Examples:** KSh 10,000 subtotal → KSh 0 discount; KSh 10,001 → KSh 500.05 discount and KSh 9,500.95 due, assuming cent precision and exact 5%. Fees: individual 1,000 / group 500; surcharge at 110% approved value.

### T-07 — Immediate SQL reports versus separate analytics platform

- **Option A:** Indexed, date-filtered SQL queries and bounded CSV/PDF exports. **Selected initially.**
- **Option B:** Cache, reporting replica, data warehouse or asynchronous export worker.
- **Reason:** Estimated structured data is small; data integrity and accurate reconciliation matter more than adding another infrastructure layer.
- **Cost:** Very large reports can compete with writes; restrict filters and benchmark using realistic data.
- **Revisit when:** p95 report times or database load exceed approved targets; verify query plans before adding new services.

### T-08 — Always-online transactional actions versus offline queued writes

- **Option A:** Lightweight responsive UI, retry with the same idempotency key, clear offline/unknown state. **Selected for money and stock writes.**
- **Option B:** Local offline queue that later replays registrations, payments and stock mutations.
- **Reason:** Offline edits risk double spending stock, conflicting equipment counts and misleading paid receipts, especially on shared devices.
- **Cost:** Some workflows pause when connectivity fails. Low-bandwidth forms and stable retry/reconciliation reduce disruption.
- **Revisit when:** site interviews demonstrate sustained offline operations and a specific conflict-resolution, security and consent strategy has been designed and tested.

### T-09 — Staff-only portal versus public member accounts

- **Option A:** Authorized staff-facing UI in first release. **Selected.**
- **Option B:** Every youth/guardian gets a login and access to personal records.
- **Reason:** The brief focuses on the club's internal transactions, not self-service accounts. Adding youth accounts raises identity verification, safeguarding and support complexity.
- **Cost:** Staff assist members with requests.
- **Revisit when:** actual members and guardians identify a validated self-service need, and access/consent safeguards are approved.

### T-10 — Human review versus fully automated penalties

- **Option A:** Incident evidence, approved market-value snapshot, 10% surcharge, human review and manually approved allocation. **Selected.**
- **Option B:** Automatically charge every captain/team member once a clerk marks damage.
- **Reason:** The brief does not define individual allocation. Automatic billing could multiply one loss and unfairly affect minors.
- **Cost:** Manual review takes time. Do not implement split calculations until the club decides how one team's liability is fairly shared and disputes handled.

## 4. Numerical boundary tests (business-rule verification)

| Scenario | Inputs | Expected outcome |
|---|---|---|
| Age | 11, 12, 17, 18, 25, 26, 35, 36 (on test date) | 11/36 ineligible; 12/17 minor; 18/25 middle; 26/35 senior |
| Membership | 3 individual and 4 group members | 3 × 1,000 + 4 × 500 = **KSh 5,000 billed**, not necessarily collected |
| Sale at exact threshold | KSh 10,000 | Discount **KSh 0** |
| Sale above threshold | KSh 11,000 | Discount **KSh 550**, payable **KSh 10,450** |
| Stock low alert | Max 100; available 21 → 20 → 19 | No alert at 21; alert at 20 and 19 |
| Last-unit race | 1 available; 2 clerks simultaneously buy 1 | Exactly 1 completed sale; final available 0 |
| External event | 10 participants | **KSh 5,000 billed**; collected may differ |
| Commission if collection basis approved | KSh 4,000 confirmed collected | **KSh 800** payable after approval; if billing basis approved, amount differs |
| Damaged gear | 1 unit × KSh 2,000 approved market value | **KSh 2,200 incident surcharge**; no unapproved person-level split |
| Payment replay | Same idempotency key 10 times | 1 committed payment/effect; later replies replay original result |
| Income report | Confirmed receipts with refund/reversal | Gross collection, reversals and net collection separated; no sales double count |

**Rounding:** Use fixed-precision KES money, with an explicitly documented rounding policy and test cases for fractional cents. Never use binary floating-point to accumulate or persist financial amounts.

## 5. Measurable non-functional targets (engineering acceptance proposals)

These are **benchmarks to verify**, not current performance claims or service-level promises. Use a staging environment resembling intended hosting.

| Dimension | Proposed target / test | Evidence |
|---|---|---|
| Normal operation | 5 simulated staff sessions with typical mixed reads/writes | No failed authorized actions; capture latency/error histogram |
| Busy period | Sustained 5 requests/s for 10 min across member search, registrations, sales and event screens | For common API reads/registrations, p95 <2 s (subject to data and environment); no database integrity failures |
| Short burst | 20 requests/s for 60 s | Report p95/p99, error rate, CPU/RAM, DB utilization and connection pool wait; no corruption or duplicate postings |
| Registration import | 200 fake members with duplicates, invalid ages and missing guardian evidence | Deterministic row-level outcomes; no duplicate charges; no sensitive data in logs |
| Stress dataset | 30,000 fake members; realistic sale lines, event participants and stock movements | Index-friendly query plans and acceptable paginated search; record timings rather than assume performance |
| Checkout contention | 20 simultaneous attempts against 5 available units | At most 5 units successfully sold; no negative balances; receipts reconcile |
| Idempotency | Retry same key/payload; replay key with different payload | Same payload yields same result; changed payload returns conflict |
| Report accuracy | One-month collections + verified refunds + commissions | Reconcile to underlying payment and expense records, with clear accounting basis |
| Data protection | Role-specific negative-access tests on minors, guardians, special-needs fields and exports | Forbidden responses are blocked or redacted; no sensitive fields in logs |
| Backups | Scheduled encrypted backup plus full restoration to isolated test database | Dated restore test record, validation of row counts and financial reconciliation |
| Offline UX | Disconnect at checkout before response and after commit | UI never claims success without response/status check; no duplicate action after retry |

**Important:** `20 req/s` is a test burst, not the production capacity of an unmeasured server. Tests should state hardware, dataset size, version and number of simultaneous workers.

## 6. Focused bottleneck test procedures

### A. Inventory overselling test
1. Seed SKU `STICK-001` with `available_qty = 1`, `maximum_stock_level = 100`.
2. Start two independent checkout requests for one unit each at the same instant, each with a distinct idempotency key.
3. Transaction A must lock/check stock and complete; B must wait/recheck and fail with insufficient stock, or vice versa.
4. Assert: exactly one finalized sale, one applicable stock-out movement, zero on-hand units, zero negative quantities, corresponding verified payment/receipt consistent with the winner.
5. Replay the winner's original request/key; assert no new sale, receipt or movement.

### B. Payment verification test
1. Create a mobile-money record containing a submitted reference with status `PENDING_VERIFICATION`.
2. Assert the income report and the charge's paid balance do not increase from that unverified reference.
3. Verify it only through an authorized process with evidence; apply the payment to its charge exactly once.
4. Reverse it through a permitted workflow; verify report totals reflect the reversal and keep the audit history.

### C. Equipment issue / return test
1. Seed 2 returnable items in available inventory.
2. Issue 1 to an authorized captain for a valid event; available 1, issued 1.
3. Record safe return; available 2, issued 0.
4. Repeat, but mark damage; available stays 1, damaged becomes 1, issued 0; create an incident for human review.
5. Once approved, assess 110% of market value; prevent the same incident from being posted twice. Do not create individual team debts pending policy.

### D. Group-registration test
1. Prepare 200 fake applicants including a duplicate, an age 11 record, an age 36 record and a minor lacking validated guardian authorization.
2. Validate all records and show precise row outcomes without leaking private details.
3. Assert accepted rows have exactly one membership and correctly assessed individual/group charge.
4. Assert no invalid row becomes active, no duplicate member fee is created, and retrying an import does not duplicate accepted records.
5. Decide and document **all-or-nothing** versus **valid-rows-only** import semantics before coding the endpoint.

## 7. Observability and recovery without overengineering

Record only necessary, non-sensitive operational metrics:
- request duration p50/p95/p99, route, success/failure status and request ID;
- DB query durations, connection pool utilization, lock waits and slow queries;
- sale failures due to stock, pending-payment counts, replay/conflict counts, stock reconciliation discrepancies;
- registration validation errors aggregated by type, not by personal identity;
- backup job success, backup age, and date/results of last restoration exercise.

Do not log passwords, guardian phone numbers, private special-needs notes, precise youth personal details or payment authentication secrets. Apply least-privilege access to monitoring. Start with framework logs, database health monitoring and simple dashboards; only add specialized logging or tracing infrastructure when needed.

### Failure policy

- **Uncertain response:** The client must query transaction status or retry with the *same* idempotency key. It must not blindly create a new sale, member or payment.
- **Database unavailable:** Reject authoritative writes safely; show service unavailable. Do not maintain a shadow authoritative inventory in a browser.
- **Payment verified but stock now gone:** Stop checkout; escalate for authorized refund or resolution. A draft sale never reserves stock in MVP.
- **Server restarts mid-transaction:** Database commit or rollback decides outcome; restart must not create partial posted balances.
- **Refund versus stock return:** A refund does not silently restock; inventory return is a separate inspected/audited movement.
- **Backup recovery:** Define RPO/RTO with management; minimum proposed daily backup is not enough if the club cannot tolerate losing one day's transactions. Practice restoration, including constraint and reconciliation checks.

## 8. Security, ethics, and operational constraints (AI Safari)

**User-centered design:** Test real workflows with registration staff, store clerks, patrons and finance. A payment verification process that staff cannot perform reliably is a product failure even if the code is fast.

**Constraint-aware:** Make web pages small and usable on low-bandwidth links and older devices. Explicitly test network interruption and electricity downtime. Do not promise automatic offline financial processing without a tested safe reconciliation process.

**Privacy and dignity:** Children's records and sensitive needs information must be minimized, consented to through appropriate procedures, restricted by job function, and excluded from unnecessary reports, logs and test fixtures. Follow applicable Kenyan data-protection and child-safeguarding requirements when implementing.

**Fairness:** Do not infer ability, eligibility or liability from gender, sub-county, disability or school beyond valid organizational rules. A damaged-item financial charge requires evidence and human review; avoid automatically charging every team member.

**OCEAN / verification:** Verify claims against the problem, stakeholders and repeatable tests. This document separates **given business rules**, **proposed technical choices** and **unresolved policies**; no AI output is a substitute for actual code testing or legal/stakeholder review.

## 9. Decision register: confirm before implementation

| Decision ID | Question | Present status | Blocked behavior |
|---|---|---|---|
| D-01 | Brief says 16 sports but lists 15; which is missing? | Open | Hard-coded final catalog / assertion of 16 |
| D-02 | Is membership one-time, annual or renewable? What happens after age 35? | Open | Renewal invoices and age-out automation |
| D-03 | How is minor guardian consent recorded and verified? | Open | Activating minor registrations without approved evidence |
| D-04 | Is patron 20% commission based on charges billed or actual collected fees? | Open; collection-based recommended provisionally | Automatic commission approval/payout |
| D-05 | How is one 110% damage/loss surcharge split among captain and players? | Open | Automatic per-member surcharge creation |
| D-06 | What evidence verifies cash and M-Pesa receipts, and who approves reversals? | Open | Automatic mobile payment confirmation / unapproved adjustments |
| D-07 | Should stock be pooled by quantity or individual equipment asset tag? | MVP: pooled quantity proposed | Asset-level loss tracking until confirmed |
| D-08 | Group import all-or-nothing or valid rows with errors? | Open | Batch write semantics |
| D-09 | Storage/backup residency, retention, RPO/RTO and report access? | Open | Claims of compliance / reliability guarantee |

Keep open questions visible in documentation and configuration. Do not invent a policy merely to make implementation easier.

## 10. Implementation entry plan: first thin vertical slice

After this design review, start **one end-to-end membership registration feature**, not all modules at once. Proposed sequence:

1. **Repository foundation:** VS Code project, Git, README, `docs/`, `client/`, `server/`, `database/migrations/`, `.env.example`, `.gitignore`; do not commit secrets.
2. **Backend scaffold:** Express app, `/api/v1/health` read-only health route, centralized error handler, environment schema, PostgreSQL connection, migrations and typed validation.
3. **Auth foundation:** Staff login, session/security middleware, roles and audit actor context **before live personal information is handled**.
4. **Membership minimal schema:** `members`, `organizations`, `memberships`, `sports`, `member_sport_preferences`, relevant consent/guardian proof records and charge tables; implement migrations with foreign keys, uniqueness constraints and sample **fake** data.
5. **First functional endpoints:** `GET /sports`, `GET /organizations`, `POST /members`, `GET /members`, `GET /members/{id}`, `PUT /members/{id}/sports-preferences`; fees and confirmed payments only when their controls are ready.
6. **Frontend registration:** Accessible form, error messaging, live *preview* of age and fee; server remains authoritative; test low-bandwidth use.
7. **Tests:** Age boundaries, duplicates, sports priority, group fees, minors' consent handling, negative permission tests, idempotency and transaction rollback.
8. **Commit per meaningful milestone**, such as `chore: initialize MSCMS app structure`, `feat: add membership registration API`, `test: cover membership validation rules`. Only proceed to events/store when the first slice passes tests.

**Do not paste an enormous generated application over existing code.** If using AI-assisted coding in VS Code, specify target files, ask for minimal diffs, request tests, and inspect `git diff` after each change.

## 11. Definition of done for Step 6

- [x] Top bottlenecks prioritized according to the proposed first-release workload.
- [x] Alternatives and costs documented for architecture, storage, money, stock, payments, reporting and connectivity.
- [x] Reproducible concurrency, failure, import, security and reconciliation test scenarios proposed.
- [x] Unknown policies identified rather than silently invented.
- [x] Clear first coding milestone and Git workflow documented.
- [ ] Stakeholder validation, real load-test evidence and deployment verification — future implementation work, not yet completed.

**Suggested commit message:** `docs: evaluate MSCMS bottlenecks and architecture trade-offs`.
