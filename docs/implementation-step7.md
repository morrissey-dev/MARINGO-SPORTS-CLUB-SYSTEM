# Implementation Part 7 — Store, Sales and Inventory

**Baseline:** GitHub `main` at Part 6; additive changes. **Do not edit previously applied migrations 001–006.**  
**Purpose:** A reliable, auditable retail inventory workflow built on the same Express/React/PostgreSQL project, with transactions protecting money and stock.

## What is implemented

- A **SKU-based catalogue**, with eight source product categories; seven have exact, preconfigured KSh prices. **Sports shoes are not seeded** because the original brief specifies a KSh **1,000–4,000 range**, not one agreed price. An authorized manager adds each shoes variant/SKU with its actual price.
- Demo `max_stock_level=100` per seeded SKU **is an illustrative, editable reorder benchmark**, not a confirmed club maximum. It triggers a low-stock alert when `available_qty * 5 <= max_stock_level`, including equality at 20%. It is not an enforced storage capacity; authorized staff can revise the benchmark.
- A store clerk can receive new stock with quantity, delivery reference, idempotency key and a **positive stock movement**, all in one database transaction.
- A store clerk creates a draft sale with **one or more distinct product lines and an optional, validated buyer membership number**, each preserving `sku`, name, unit price and quantity as sale-time snapshots. Backend uses exact integer-cent calculations and discounts the sale **only if the subtotal strictly exceeds KSh 10,000**, by 5%, rounded half up to cents. KSh 10,000.00 gets **zero** discount.
- For **cash checkout**, an authorized clerk asserts that the full amount was physically received; successful stock deduction, verified tender and receipt are written **atomically**. This operational assumption requires a cash-control policy from the club.
- For **mobile-money checkout**, entering a transfer reference only creates `pending_mobile`. **Stock is not deducted and revenue is not reported as received** from a reference alone. An ADM/MGT/FIN officer other than the original recorder must verify settlement using real evidence, then the backend locks inventory, checks stock and finalizes the sale plus stock movements in **one transaction**. Where goods have become unavailable, the pending case must be reviewed/refunded manually; do not mark a fictional completed sale.
- Inventory uses PostgreSQL row locks acquired in item-id order. Failed stock checks roll back every tentative write, avoiding negative stock and double selling. Postings use idempotency keys on receipt, draft creation and checkout.
- Staff can view recent purchases and stock movements. A draft may be cancelled; **completed sale refunds, product returns, equipment issuing and physical stock adjustments are deferred** to a separately audited workflow. Never manufacture incoming-stock receipts to represent returned goods.

## Database objects (`007_store_sales.sql`)

- `store_items`: SKU, name, variant, current selling price, editable stock benchmark, active state.
- `store_inventory`: item-level available quantity (nonnegative).
- `stock_receipts`: quantity, source reference, responsible clerk, unique actor-key hash, unique item/source reference.
- `store_sales`: optional buyer member FK and lifecycle `draft | pending_mobile | completed | cancelled` with subtotal/discount/total snapshots.
- `store_sale_lines`: immutable item/price/quantity snapshots.
- `store_sale_tenders`: cash or mobile payments with independent verification evidence for mobile; references unique across sales.
- `store_stock_movements`: append-only receipt and sale movements, linked to source documents.
- Existing `idempotency_requests` and `audit_logs` are reused; no previous migration is changed.

### API endpoints

All under `/api/v1`. The same-origin and CSRF protections apply to every write, and staff session cookies are required for every endpoint.

| Method | Endpoint | Roles / behavior |
|---|---|---|
| GET | `/store/items` | ADM/STO/FIN/MGT: product catalogue, current quantity and alerts |
| GET | `/store/reorder-alerts` | ADM/STO/MGT: SKUs at or below 20% of benchmark |
| GET | `/store/stock-movements` | ADM/STO/FIN/MGT: latest 80 ledger entries |
| POST | `/store/items` | ADM/MGT: create new SKU/price/variant |
| PATCH | `/store/items/:id` | ADM/MGT: change price, alert benchmark and/or active status |
| POST | `/store/stock-receipts` | ADM/STO: receive positive stock with `Idempotency-Key` |
| GET | `/sales` | ADM/STO/FIN/MGT: latest 80 sales |
| GET | `/sales/:id` | ADM/STO/FIN/MGT: detail/sale receipt snapshot |
| POST | `/sales` | ADM/STO: create a draft, `Idempotency-Key` required |
| POST | `/sales/:id/checkout` | ADM/STO: record cash checkout or pending mobile, `Idempotency-Key` required |
| POST | `/sales/:id/verify-mobile` | ADM/FIN/MGT: verify with evidence by **different person**, complete when stock available |
| POST | `/sales/:id/cancel` | ADM/STO: cancel **draft** only; no receipt or stock mutation |

### Examples

For a store clerk with session cookie and CSRF token:

`POST /api/v1/sales` with `Idempotency-Key: <new UUID>` and body:

```json
{"buyerMemberNumber":"MSC-00000001","lines":[{"itemId":"3","quantity":5},{"itemId":"1","quantity":1}]}
```

The server reads current prices, returns an immutable draft quote with KSh decimal strings, and does not yet reduce stock.

`POST /api/v1/sales/123/checkout`, `Idempotency-Key: <new UUID>`:

```json
{"method":"mobile_money","reference":"MOBILE1234"}
```

Returns `pending_mobile`. A **different** authorized reviewer later uses `POST /api/v1/sales/123/verify-mobile`:

```json
{"evidenceReference":"RECON-2026-0004"}
```

This must reflect verified settlement using trusted evidence; it is not an automated provider callback.

## Run locally and validate

1. `npm install` — Node.js 22.12 or higher, PostgreSQL running.
2. Copy `server/.env.example` to `server/.env` and fill credentials. Never push `.env` or real member information.
3. `npm run db:check` then `npm run db:migrate`. The migration runner checksum-checks applied migrations and should apply only `007_store_sales.sql` to an up-to-date Part 6 database.
4. `npm test` and `npm run build`.
5. Start separate terminals with `npm run dev:server` and `npm run dev:client`; sign in with authorized STO and ADM/FIN/MGT staff users.
6. Confirm SKU catalogue and seed price list; create a shoe variant, receive a delivery, and check low-stock warning exactly at and just above the 20% boundary.
7. Sell items with subtotal KSh 10,000: no discount. Sell KSh 10,001: 5% discount. Check saved sale-line price snapshots.
8. Verify cash sale posts stock movement and receipt. For mobile sale, confirm *pending* does not alter stock; then verify with a distinct reviewer.
9. Try the same stock receipt UUID twice and concurrent checkout for final available stock; no double posting or negative balance must occur.
10. Confirm earlier member, payment, sports and events screens remain functional.

## Limits, policies and manual QA still required

- The environment used for drafting lacked installed npm/React dependencies and a live PostgreSQL connection. **69 Node policy/mock service tests passed**, and syntax checks passed; real database migrations, concurrency with PostgreSQL, end-to-end authenticated API requests, and browser production build **need local/CI verification**.
- No actual M-Pesa integration. A verified flag is a **manual attestation** backed by the reviewer's evidence, not proof from the payment provider.
- Cash control: determine who may record a physical cash receipt and what receipt/cash reconciliation procedure is acceptable. Club sign-off is needed before production use.
- Mobile money settlement received but product out of stock: manual intervention/refund must be defined before a live financial workflow; current implementation leaves the payment pending with conflict and does not post a successful sale.
- No cash refunds, customer returns or exchange processes yet; stock receipt records must not be used as counterfeit returns.
- Historical sale prices remain fixed. Store item and alert maximum benchmarks can change for **future** sales and alerts, not old receipts.
- No high-privilege product deletion and no hard-deletion of completed financial/stock records.
- Store sale payment records are **separate from member/event `payments`** to avoid double counting; reporting must combine verified sources with clear deduplication rules in a later module.
- Data handling follows AI Safari privacy, minimum access, verification and constraint-aware design principles. Never use actual children's information in demonstration data.

**Suggested commit:** `feat: add store inventory sales checkout and stock alerts`

**Next:** Part 8 — Equipment issue/return workflow, damage/loss incident recording, and **manual** surcharge approval. Surcharge allocation among captain/team members remains unresolved and must not be automated.
