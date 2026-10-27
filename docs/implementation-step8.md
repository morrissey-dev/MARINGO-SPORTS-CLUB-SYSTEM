# MSCMS Implementation — Part 8: Equipment loans and inspections

**State:** Implementation source prepared and Node tests passed. Live database migration, actual web sign-in, end-to-end concurrent request testing and client build are **not yet verified** in this environment. Do not use with real minors or real funds until those checks are complete.

## What changed

Additive migration: `database/migrations/008_equipment.sql`. New backend feature: `server/src/equipment/` (policy, service and routes), with tests in `server/test/equipment-*.test.js`. React staff interface: `client/src/EquipmentPanel.jsx`, displayed in `App.jsx`. Existing store-sale tables and migrations 001–007 are unchanged. All previously stored source files remain.

## Why equipment is not store stock

The **shop** sells items and permanently reduces sellable stock. The **equipment register** holds loanable club property. A loan temporarily decreases **available** quantity and increases **issued** quantity. A usable return reverses that change; a damaged return moves to **damaged**; missing equipment is marked **missing under review**. Thus the counts remain reconcilable and no shop sale is posted for loaned equipment. If the club later moves the same physical item between shop and equipment storage, introduce an auditable transfer workflow rather than editing counters manually.

### Workflow

1. Admin/management adds equipment types and approved baseline market value. Clerk records physical stock receipts with reference number. Each equipment receipt increases available quantity exactly once.
2. Assigned patron or administrator/manager requests a loan for an **active team's current, active captain** and due date; optionally links a non-cancelled team event. This does **not** deduct stock. Current staff roles do not include a captain self-service login; the patron records a request on the captain's behalf.
3. Store clerk physically hands items to that captain then clicks Issue. The backend checks that the captain still leads the active team and stock is available, locks loan and equipment balances, saves the valuation snapshot, and moves **available → issued** inside one transaction. Since the app has no electronic captain signature yet, use appropriate paper handover evidence outside the app; a click must not be treated as proof of signature.
4. At return, clerk inspects each outstanding loan line. Enter how many items are usable, damaged or unaccounted for. Multiple partial returns are permitted but cannot exceed the original issued amount. On completion, the loan status becomes `closed`, meaning every quantity was accounted for — **not** necessarily that damage disputes are resolved.
5. Damaged and missing quantities create `reported` incident records. A different authorized manager from the inspecting clerk may confirm a market valuation with evidence; the server then calculates `quantity × approved market value × 1.10` using exact decimal arithmetic and records the result. **It does not create a payment charge or assign debt to captains or players**, because the allocation policy remains undecided. Approved valuations are not automatically paid or collectible.

### Access and privacy

- ADM/MGT: add equipment types, request loans, confirm incident valuations.
- STO/ADM: record receipts, issue requested loans, inspect returns.
- PAT: request loans only for currently assigned sports and see only their current sports' loans and incidents.
- FIN: read loan and incident summaries (no confirmation/issue permission).
- Captains are members, **not** staff accounts. No member portal or minors' personal contact details appear in the equipment UI.
- All mutations require a logged-in staff session, CSRF token, matching origin and per-route authorization. The backend checks team assignments and inventory state, never trusting browser quantities.

### API additions (under `/api/v1/equipment`)

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/items` | ADM,MGT,STO,FIN,PAT | Equipment inventory |
| POST | `/items` | ADM,MGT | `code,name,marketValue` |
| POST | `/stock-receipts` | ADM,STO | `equipmentTypeId,quantity,sourceReference`; **Idempotency-Key required** |
| GET | `/loans` | ADM,MGT,STO,FIN,PAT | Scoped for patrons |
| GET | `/loans/:id` | ADM,MGT,STO,FIN,PAT | Line-level outstanding quantities; scoped |
| POST | `/loans` | ADM,MGT,PAT | `teamId,eventId?,dueDate,purpose,lines:[{equipmentTypeId,quantity}]`; **Idempotency-Key required** |
| POST | `/loans/:id/issue` | ADM,STO | Issues all requested lines atomically, only once |
| POST | `/loans/:id/returns` | ADM,STO | `lines:[{loanLineId,usableQty,damagedQty,missingQty}],notes?`; **Idempotency-Key required** |
| GET | `/incidents` | ADM,MGT,STO,FIN,PAT | Scoped for patrons; no personal debts |
| POST | `/incidents/:id/confirm` | ADM,MGT | `approvedMarketValue,evidenceReference`; once only |

The original Step 3 API design used placeholder `/equipment-loans` and `/equipment-incidents` paths. This implementation uses an equipment-specific namespace (`/api/v1/equipment/*`); this is the **current implementation contract**. Update client calls accordingly; do not assume the placeholder paths exist.

### Examples

```json
{"teamId":"3","dueDate":"2026-12-15","purpose":"Training","lines":[{"equipmentTypeId":"2","quantity":3}]}
```

```json
{"lines":[{"loanLineId":"55","usableQty":1,"damagedQty":1,"missingQty":1}],"notes":"Inspected by store clerk"}
```

For two damaged items with confirmed market value KSh 2,000.00 **each**, surcharge assessment is `2 × 2,000 × 1.10 = KSh 4,400.00`, recorded on the incident but **not allocated**.

## Run on a computer with Node 22.12+ and PostgreSQL

```powershell
# From project root (existing clone):
git pull origin main
npm install
npm run db:check
npm run db:migrate
npm test
npm run build
```

Launch in separate terminals:

```powershell
npm run dev:server
npm run dev:client
```

The first deployment requires the earlier environment configuration and staff creation described in `docs/implementation-step2.md`.

### Manual end-to-end acceptance cases

1. Add `HOCK-STICK`, price KSh 2,000, receive 5 items. Verify 5 available, 0 issued.
2. Create an active team and captain; patron requests 3 sticks. Stock remains 5 available.
3. Clerk issues the request. Stock becomes 2 available, 3 issued.
4. Clerk reports 1 usable, 1 damaged, 1 missing. Stock becomes 3 available, 0 issued, 1 damaged, 1 missing. Two reported incidents appear.
5. Manager confirms damaged valuation at KSh 2,000 with documentary reference. Surcharge displays KSh 2,200 and `liabilityAssigned:false`; no member charge is generated.
6. Retry the exact return with its original request key: same recorded result; do not double-count. Retry with a different key after closure: reject cleanly.
7. Simultaneous issues on two different loans that compete for the final stick: at most one succeeds; no negative count.
8. Attempt to issue after the captain changes, return 4 when only 3 are outstanding, view another patron's loan, confirm the same incident twice; verify clear rejection and audit trail.
9. Verify old membership, event payments and shop sales still work after migration. Confirm `store_inventory` did not change during equipment operations.
10. Check accessible forms and low-bandwidth behavior on mobile; no hidden confirmation of uncommitted work.

### Outstanding policy and features

Equipment liability allocation (including youth safeguarding), appeals/reviews, digital captain handover acknowledgment, reversible stock corrections, maintenance/repair, recovered missing equipment, asset-level serial numbers and printable issue/return slips remain future development. Incident valuation is **not an enforceable debt** without an approved process. Receipt origin and incident evidence are references, not uploaded documentation. Plan a production database trial and backup/restore rehearsal before real use.

**Suggested Git commit:** `feat: track equipment issues returns and incident valuations`
