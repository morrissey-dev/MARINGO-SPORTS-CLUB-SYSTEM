# Implementation Part 6 — Sporting Events and Facilitation Fees

**Baseline:** Published Part 5 project. This increment is additive; migrations `001`–`005` are unchanged.  
**Scope:** Internal/external fixtures, event rosters, KSh 500 external-match assessment, verified/partial facilitation fee collections, and *provisional* patron commission reporting.  
**Not implemented:** commission approval/disbursement, external payment provider, inventory/store, equipment losses, production release.

## Business rules implemented

1. Admin or the currently assigned sport patron can create an event for an active team. An event is `draft` until its roster is finalized. `internal` events do not require an opponent; `external` events do.
2. A roster participant must already belong to the selected team **and** have an active, fully-paid membership when added and again when finalizing. The roster is unique per event/member.
3. A draft roster can be amended or cancelled. After finalization, no further member changes are permitted. An event cannot finalize with zero participants.
4. On finalization, PostgreSQL holds a row lock on the event, then creates **one `charges` row of KSh 500** for each external-match participant, plus `facilitation_charges` references, inside the same transaction. An internal event creates **no** facilitation charge.
5. Re-finalization returns an `unchanged` response and **does not create additional fees**. If any database operation fails, the transaction is rolled back.
6. Finance or admin can record cash/mobile-money fee payments through the existing `/payments` endpoint; they remain pending. Another authorized officer must verify independently before totals show as collected. Existing member-payment activation code is left intact.
7. Patron commission uses **20%**, but the case study does not state whether the basis is amounts **billed** or verified money **collected**. The application shows **both illustrations**, stores a provisional patron snapshot and an undecided basis, and does **not** create a payable expense or permit payout.
8. Only authorized management/finance users and the currently assigned patron may view event/roster details; only authorized admin/current patron may change a draft. Financial data and member names are excluded from public endpoints.

## New database tables (migration 006)

- `sporting_events`: sport, team, event type/date/opponent/venue, creating user, effective patron assignment, lifecycle status.
- `event_participants`: unique `(event_id,member_id)` and optional `charge_id` once finalized.
- `facilitation_charges`: fee snapshot and one-to-one reference to a participant and a generic charge.
- `patron_commission_projections`: historical patron, 20% snapshot, `policy_basis = undecided`, `status = provisional`. It is **not** a commission payable ledger.

Existing `charges`, `payments` and `payment_allocations` are reused for facilitation; the membership charge reconciliation logic is not applied to facilitation charges. Existing migrations must never be rewritten after use.

## Endpoints

All authenticated routes are under `/api/v1`; writes also require same origin and CSRF token.

| Method | Path | Roles / meaning |
|---|---|---|
| `GET` | `/events` | ADM/MGT/FIN all; PAT scoped to currently assigned sports |
| `GET` | `/events/:id/facilitation-summary` | ADM/MGT/FIN; assigned PAT: participants, charges, verified receipts and non-payable commission illustrations |
| `POST` | `/events` | ADM/current PAT schedules event |
| `POST` | `/events/:id/participants` | ADM/current PAT adds eligible player to draft |
| `DELETE` | `/events/:id/participants/:memberId` | ADM/current PAT removes draft player; cannot erase finalized fee |
| `POST` | `/events/:id/finalize-roster` | ADM/current PAT atomically posts assessed fees once |
| `POST` | `/events/:id/cancel` | ADM/current PAT cancels a draft only |
| `POST` | `/payments` | Extended: ADM/FIN may record pending facilitation payment; REG remains limited to membership payments |
| `POST` | `/payments/:id/verify` | Existing independent checker path; updates fee status |
| `POST` | `/payments/:id/reverse` | Existing authorized reversal path; updates fee status |

### Example: create a match

`POST /api/v1/events`:

```json
{"teamId":"3","eventType":"external","eventDate":"2026-11-20","venue":"Maringo Field","opponent":"County Juniors"}
```

Then `POST /api/v1/events/11/participants` with `{"memberId":"6"}` for each eligible player. Finally call `POST /api/v1/events/11/finalize-roster` with `{}`. Each recorded external participant generates an assessed KSh 500 charge and a unique charge ID displayed in the event summary.

**Amounts:** Payment payloads always use *decimal strings*, e.g. `"500.00"`, not JavaScript floats. HTTP responses use KSh decimal strings and raw IDs as strings.

## Running the update

1. From the root: `npm install` (Node.js 22.12+ and locally installed PostgreSQL required).
2. Set up private `server/.env` based on `server/.env.example` if this is a fresh checkout. Never commit it.
3. Run `npm run db:check`, `npm run db:migrate`; migration `006_events_facilitation.sql` should be applied exactly once.
4. Run `npm test` and `npm run build`, then `npm run dev:server` and `npm run dev:client` in separate terminals.
5. Sign in and create a sport patron, active team and active test member; create internal and external fixtures, enroll players and finalize.
6. In an external finalized fixture, note a participant `chargeId` in the summary. With FIN/ADM access, record a pending payment; have a *different* authorized officer verify it using the Payments panel.
7. Confirm fee totals increase only on verification and decrease after reversal. Do not pay commission figures while the basis is unresolved.

**Local verification note:** In the build environment available for drafting, 52 Node policy/mock-service tests passed. Offline `npm install` failed because the required Vite dependency is not cached, and no PostgreSQL instance was available; a genuine database migration + end-to-end API run and frontend production build **still need to be completed**.

## Suggested manual acceptance checks

- Finalize external event with 3 players: fees KSh 1,500, commission illustrations KSh 300 billed vs KSh 0 collected before payments.
- Record and verify only KSh 500: billed KSh 1,500, verified KSh 500, illustrated commissions KSh 300 vs KSh 100, **not payable**.
- Finalize twice: no duplicate charges.
- Internal event with 3 players: zero charges and no commission.
- Attempt player from a different team, inactive member, non-patron access or late draft change: rejected.
- Two concurrent finalizations: only one event commit; the other returns unchanged.
- Reverse a verified facilitation payment: fee returns to outstanding without deactivating an unrelated membership.
- Confirm role permissions and sensitive data never leak in unauthorized responses.

**Known policy decisions still pending:** commission basis (billed vs collected); finalized roster corrections/refunds; event eligibility after membership expiration or payment reversal; canceling a finalized match; real-world proof for mobile money/cash reconciliation; member age-based team eligibility.

**Commit message:** `feat: add sports events facilitation fee assessments and provisional commissions`

**Next:** Part 7 — Store inventory, sale checkout and automatic discount rule with controlled stock movements.
