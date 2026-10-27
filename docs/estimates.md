# Maringo Sports Club Management System (MSCMS)
## Step 2 — Scale and Traffic Estimates (1 Million Devs) · v0.1

**Status:** Planning estimates only; **none of the usage figures below are supplied by Maringo Sports Club**. Revisit after consultation or observing actual transactions.  
**Preceding document:** `docs/requirements.md` (requirements baseline v0.1).  
**Next document:** `docs/api-design.md` (resource-oriented API contract).

## 1. Why estimate before building?

1 Million Devs' system-design method asks us to estimate **normal traffic** and **peak traffic** before choosing a technical architecture. The objective is to identify likely bottlenecks and avoid overengineering. AI Safari adds constraint-aware choices: low-cost deployment, reliable transactions and bandwidth-efficient screens.

**Important:** Registered members are *records*, not automatically concurrent application users. A first release used mainly by staff will have a very different workload from a future public member portal.

## 2. Planning assumptions

| Parameter | Proposed baseline for planning | Status / explanation |
| --- | ---: | --- |
| Registered members by the end of Year 1 | 3,000 | Hypothetical, not club data |
| Member records in a growth/stress scenario | 30,000 | 10× baseline used for robustness tests; not a forecast |
| Staff user accounts | 25 | Hypothetical total across management, registration, store, finance and patrons |
| Simultaneously active staff — typical | 5 | Hypothetical concurrency |
| Simultaneously active staff — peak | 15 | Intake or tournament activity |
| Sports | 15 explicitly listed; one sport unresolved | The brief says 16 but lists 15 |
| Saleable product categories | 8 listed | Sports shoes require priced variants/SKUs |
| Saleable SKUs | About 30 initially | Hypothetical variants/sizes, not a catalogue requirement |
| Registration days/year | 60 intake days | Simplification for estimate; registration may actually be year-round |
| Registrations per intake day — average | 50 | 60 × 50 = 3,000/year |
| Registrations on a peak intake day | 200 | Includes individuals and bulk/group intake |
| Store sales per operating day — typical | 30 | Hypothetical |
| Store sales on a busy day | 100 | Hypothetical tournament or sale day |
| Operating days/year | 300 | Hypothetical |
| Products per sale — average | 3 sale lines | Hypothetical |
| Sports events/week | 12 | Hypothetical, ~624/year |
| External events/week | 4 of the above 12 | Hypothetical, ~208/year |
| Participating members/external event | 15 | Hypothetical, ~3,120 participant charges/year |
| Main daily usage window | 8 hours | Operational estimate; web application can be available beyond these hours |
| First release | Staff-facing web app; manual cash and M-Pesa-reference recording | No live payment integration assumed |

**Validation note:** Registration average and peak should not both be multiplied across every day. The average intake-day volume gives a baseline yearly estimate; peak-day volume is a load-test scenario.

## 3. Transaction volume estimates

### Membership transactions

- **Baseline annual registration records:** `50 registrations/intake day × 60 intake days = 3,000 registrations/year`.
- **Peak-day registration records:** `200 registrations/day`.
- **Bulk import example:** 10 groups × 20 members = 200 records. Imports should validate entries individually, detect duplicates and provide a success/error summary; they must not block other users indefinitely.
- **Membership charges:** approximately 3,000 new-registration charges/year in this simplified scenario. Payment entries may be more numerous if partial payments are supported later.

### Store transactions

- **Sales:** `30 sales/day × 300 operating days = 9,000 sales/year`.
- **Sale line items:** `9,000 sales/year × 3 lines/sale = 27,000 sale lines/year`.
- **Peak:** `100 sales/day × 3 lines/sale = 300 sale lines/day`.
- **Stock movements:** At least one stock movement per applicable sale line; extra movements arise from receipts, corrections, equipment issues and returns. Estimate **30,000–45,000 movements/year**, depending on how product and equipment inventory are modelled; this range is not an observed count.

### Sports events and fees

- **All events:** `12 events/week × 52 weeks = 624 events/year`.
- **External events:** `4/week × 52 weeks = 208 external events/year`.
- **Player-event charges:** `208 external events × 15 players = 3,120 assessments/year` (assuming every player participates in only one row per event; individuals can appear across events).
- **Facilitation charges assessed, if every assumed external event happens and all 15 players are chargeable:** `3,120 × KSh 500 = KSh 1,560,000/year` — an **illustrative gross billed amount**, **not** a prediction of cash income.
- **Illustrative patrons' commissions, if the approved basis equals this assessed amount:** `KSh 1,560,000 × 20% = KSh 312,000/year`. If commission is based on collections, the payable amount will differ where fees remain unpaid.

**Do not predict total club income** from the membership and sales volumes without knowing the mix of individual/group registrations, actual basket values, collections and refunds.

## 4. API request volume

We estimate traffic for the first version based on staff actions: registration, searching, sales, event tracking, dashboard loads and reports. Each user action might cause several API calls.

| Traffic indicator | Planning value | Calculation / meaning |
| --- | ---: | --- |
| Typical requests per operating day | 12,000 | Explicit load-test assumption, not derived from club logs |
| Average requests/second over an 8-hour window | ~0.42 requests/s | `12,000 ÷ (8 × 60 × 60)` |
| Typical concurrent logged-in users | 5 | User sessions are not equivalent to requests/s |
| Peak concurrent logged-in users | 15 | Hypothetical staff workload |
| Sustained busy-period traffic | 2–5 requests/s | Target scenario to test during enrollment and tournaments |
| Short burst test | 20 requests/s for 60 seconds | Test robustness only, not a forecast |

**Interpretation:** A straightforward single-backend application should be adequate at this scale *if* queries are indexed, reports use appropriate filters, and database transactions are correct. Load tests must confirm performance; calculated estimates are not proof of capacity.

### Example high-traffic situation

On tournament day, staff could be registering participants, selling sportswear, checking equipment out and recording facilitation fees simultaneously. Such activity creates **write conflicts**, particularly if two clerks sell the last stock unit. Ensuring correct stock quantities is more important than optimizing for enormous traffic volumes.

## 5. Storage estimates

Rough first-year planning calculation for **structured database data only**, before allowing for indexes, audit history and growth:

| Data group | Assumption | Rough amount |
| --- | --- | ---: |
| Member profiles | 3,000 × ~2 KB | ~6 MB |
| Sales headers | 9,000 × ~0.7 KB | ~6.3 MB |
| Sale lines | 27,000 × ~0.6 KB | ~16.2 MB |
| Stock movements | 35,000 × ~0.4 KB | ~14 MB |
| Event participants | 624 events × ~15 rows × ~0.5 KB | ~4.7 MB |
| Payment, audit and other rows | Variable; not specified by brief | Allow tens of MB or more |

These per-row figures are **illustrative rounded assumptions**, not PostgreSQL measurements. Actual space depends on schema, row overhead, indexes, JSON content and retention. For initial planning, reserve **~0.2–0.5 GB of database growth per year** and budget **~1–3 GB over the first three years**, including headroom. Measure real growth after implementation and revise.

- Photos, scanned consent forms and PDF attachments are *not* included in the structured-data calculations; store authorized attachments separately with restricted access and storage limits if these are added.
- Backups use **additional** storage. Backup history, restore time and retention must be planned independently.
- Special-needs and children's data require stricter privacy controls; do not collect more sensitive data merely because the database has room.

## 6. Initial performance and reliability goals (proposed)

| Area | Initial, testable target |
| --- | --- |
| Common searches and registrations | 95% of requests complete in <2 seconds under the chosen 5 requests/s busy-period test, on the target environment |
| Simple dashboard views | 95% in <3 seconds under the same test |
| Reports | Filtered reports should have progress/timeout handling; benchmark realistic data sets separately |
| Sales accuracy | No overselling, duplicate stock reductions or unpaired sales/stock changes under concurrent requests |
| Payment accuracy | One idempotent payment submission should never create multiple receipts/credits |
| Recovery | Daily automated backups at minimum; successfully test restoration before use with real transactions |
| Security | Server-enforced access control and audit trails for sensitive actions |
| Connectivity | Keep pages lightweight, minimize repeat API fetches and show recoverable errors when the network drops |

Targets must be adjusted after a realistic hardware and user-workflow test. Do not silently promise 99.9% availability or strict recovery-point times without budgeting and verifying the operational setup.

## 7. Architecture recommendation derived from the estimates

**Start with a modular monolith:**

```
Staff browsers (mobile / desktop)
              |
         HTTPS web app
              |
    Single backend REST API
  (auth + membership + sports
   + store + events + finance)
              |
        PostgreSQL database
              |
      Encrypted regular backups
```

- React frontend + Node.js/Express backend + PostgreSQL is a reasonable educational and practical stack. SQLite can serve early local prototypes, but PostgreSQL is preferable when multiple staff post concurrent payments and stock changes.
- A small hosting environment is enough to **start benchmarking**; for example, an application instance of about 1–2 virtual CPUs and 2–4 GB RAM, plus a small PostgreSQL instance where possible. These are **trial starting points**, not guaranteed production sizing.
- Use efficient pagination/search and relational indexes before considering caches.
- Use database transactions, unique constraints and idempotency keys for payment and sales operations.
- Do **not** add microservices, message queues, load balancers or Redis by default. Introduce them only if evidence from load tests or functional needs justifies them.
- For low-bandwidth use, compress assets and minimize requests. Do not queue offline cash/mobile-money claims or stock-changing operations without a tested reconciliation design.

## 8. Critical risks and how to test them

| Risk | What may fail | Planned validation |
| --- | --- | --- |
| Concurrent purchases | Two clerks sell the last available item | Run simultaneous sales; only allowed available units can be sold |
| Duplicate submissions | Network retry creates two sales or payments | Retry same idempotency key; expect one committed transaction |
| Large group imports | Slow processing, duplicates, invalid ages | Import 200 profiles with some invalid rows; review per-row error summary |
| Reports under load | Large queries slow registration and sales | Generate filtered monthly/yearly reports while normal writes continue |
| Network interruption | Clerk cannot tell if payment/sale succeeded | Retry/query transaction by stable reference rather than blind resubmission |
| Patron commission | Commission counted twice or before approval | Verify commission uniqueness and review/approval status |
| Child-sensitive data | Unauthorized disclosure via exports or logs | Test access privileges, masking and export permissions |
| Backup failure | Transactions cannot be recovered | Perform a complete restore into a test environment |

## 9. What the club needs to confirm

1. Approximately how many members currently exist, and how many new members register each term or year?
2. Is registration year-round or concentrated around school intakes?
3. How many employees/patrons will actually log into the system, and from how many devices at once?
4. How many store sales and team events occur on ordinary days and major tournament days?
5. Must the club operate during internet outages, and if so, which tasks need offline access?
6. Are member photos, scanned forms or receipts needed, and for how long should they be kept?
7. Are there different branches/stores, or only one store?

Until these are answered, keep all estimates marked **assumptions**, not club facts.

## 10. Completion checklist and next step

- [x] Distinguish member records from active system users.
- [x] State typical and peak traffic assumptions.
- [x] Estimate registrations, sales, events, API usage and storage.
- [x] Identify correctness bottlenecks and performance tests.
- [x] Recommend the simplest reasonable architecture.
- [ ] Validate assumptions with club stakeholders.
- [ ] Replace estimates with measured data after a working prototype is in use.

**Next:** Create `docs/api-design.md`, starting with membership registration, sports preferences and membership payments, then extend it to inventory, events and equipment. Define method, path, request/response examples, roles, validations and error codes before implementation.

**Suggested commit:** `docs: estimate MSCMS traffic storage and scaling assumptions`
