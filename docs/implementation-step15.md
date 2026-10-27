# Implementation Part 15 — Controlled Merchandise Returns and Inspection

**Status:** Source implementation drafted, with automated regression tests. GitHub CI and PostgreSQL integration must pass before this milestone is considered verified. Your local PostgreSQL installation is a separate task; follow `docs/implementation-step12.md` to connect VS Code.

## Scope

A completed **store sale** may have one pending merchandise return request at a time, requested by an authorized store clerk or administrator. Each request records the original sale, original sale-line IDs, quantities and a reason. A distinct authorized finance/management reviewer either rejects the request or inspects every line as **resellable** or **damaged**.

- Approved resellable quantity is restored to `store_inventory` with an auditable positive `store_stock_movements` row linked to the approved return. A damaged return **never** increases available stock.
- A return cannot exceed the unreturned quantity sold, including across multiple accepted returns. The original sale row is locked during request and review, preventing competing approval races. Multiple requests for one sale are serialized.
- Reviewers cannot approve their own return intake; all changes and stock movements commit together or roll back.
- `Idempotency-Key` is required when creating a return; a repeated request with the same key and content returns the same record; different content conflicts. Frontend preserves the key across retries.
- The provisional **refund due** is calculated in exact integer cents, prorating the **original discounted amount** over the cumulative gross value of goods returned. The combined assessment cannot exceed the original paid sale total. It is **not** cash sent back to a buyer, a bank settlement, or an approved financial adjustment.
- **This release does not issue or verify refunds.** No new entries are written into payment/cash ledgers for an accepted return; the club income report continues to show original received sale money until a refund is actually processed in a future controlled workflow. Do not claim a refund was paid or treat the refund-due assessment as financial outflow.
- Existing physical stock receipts continue to represent supplier deliveries, never customer returns. The stock-movement log labels returns separately.

## API routes

| Method | Path | Roles | Result |
|---|---|---|---|
| GET | `/api/v1/sales/returns` | ADM/STO/FIN/MGT | Recent return statuses; amounts are *not paid* |
| GET | `/api/v1/sales/returns/:id` | ADM/STO/FIN/MGT | Full request lines for review |
| POST | `/api/v1/sales/:id/returns` | ADM/STO | Record one return request; Origin+CSRF+Idempotency-Key required |
| POST | `/api/v1/sales/returns/:id/review` | ADM/FIN/MGT | Inspect `accept` or `reject`, with independent reviewer |

Example request to record physical goods:

```json
{
  "reason": "Customer brought back an unused incorrect size",
  "lines": [{ "saleLineId": "8", "quantity": 1 }]
}
```

Example acceptance (only after physical inspection):

```json
{
  "decision": "accept",
  "conditions": [{ "saleLineId": "8", "condition": "resellable" }]
}
```

`reject` is `{ "decision": "reject" }`. Do not include conditions with rejected returns.

## Schema

Migration `database/migrations/010_store_returns.sql` adds `store_returns`, `store_return_lines` and new `store_stock_movements.return_id`. The migration updates the preexisting sale-movement-only uniqueness rule to allow independently documented returns against the same sale. Migrations `001`–`009` remain unchanged.

## Checks to perform on real PostgreSQL

From the repository root, after configuring **private** local `server/.env`:

```powershell
npm install
npm run db:check
npm run db:migrate
npm test
npm run build
```

Use a distinct fictitious test sale, not live funds or real youth records. The isolated CI test suite exercises a completed sale, return intake, idempotent replay, independent review, inventory restock, and unchanged cash-income figures before any actual refund. For full local isolated tests follow Part 10 with a dedicated `_test` database.

## Known limits and approvals needed

1. This is a **return and inspection workflow**, **not a customer refund payout**. A future financial workflow must obtain refund authorization, verify payment evidence, record an actual dated outflow once, and reconcile reports. It must also handle cash/mobile money and disputed refunds safely.
2. Club return periods, acceptable reasons, customer proof of purchase, damaged-item disposal and refund policy are **not supplied** in the original brief; management must approve them before live use.
3. Return quantity is item-count based. No serial-number, item-specific barcode or photographic proof is implemented.
4. The app exposes outstanding refund estimates but does not currently include them in the net-income report as cash outflows.
5. No real member, next-of-kin or minor records should enter the public repository or testing datasets.

**Proposed commit:** `feat: add independently reviewed store returns and stock audit trail`.
