# Maringo Sports Club Management System (MSCMS)

A planned web-based system to manage youth registrations, sports and teams, store inventory, purchases, events, equipment issuing and returns, fees, commissions, and reporting for Maringo Sports Club.

## Working method

We follow the 1 Million Devs system-design sequence: **requirements → scale estimates → API design → data model → high-level architecture → bottlenecks/trade-offs → incremental implementation**. We also apply AI Safari's decomposition, user-centred design, constraint-aware development, ethical data handling, and verification.

## Project status

**Implementation Part 7 — Store and inventory with cash and verified mobile-money checkout.** All Parts 1–6 remain intact. Additive migration `007_store_sales.sql`, `/store` and `/sales` API modules, responsive store screen, stock movements, and tests. **69 Node policy/mock-service tests pass; PostgreSQL integration and frontend production build remain to be verified locally.**

## Recommended repository layout

```text
maringo-sports-club/
├── README.md
├── docs/
│   ├── requirements.md
│   ├── estimates.md
│   ├── api-design.md
│   ├── data-model.md
│   ├── erd-overview.mmd
│   ├── erd-members-and-events.mmd
│   ├── erd-store-and-equipment.mmd
│   ├── architecture.md
│   ├── architecture-overview.mmd
│   ├── sale-checkout-sequence.mmd
│   └── tradeoffs.md
├── database/     # SQL migration files and seed reference data
├── client/       # Vite + React frontend and staff sign-in
├── server/       # Express API, PostgreSQL config, Node tests
└── package.json  # npm workspace scripts
```

## Design documents completed

- Step 1: `docs/requirements.md` — functional and non-functional requirements.
- Step 2: `docs/estimates.md` — hypothetical traffic, concurrency and storage planning.
- Step 3: `docs/api-design.md` — planned REST endpoints, roles, examples and test cases.
- Step 4: `docs/data-model.md` — proposed normalized tables, primary/foreign keys, transactional boundaries, constraints and test cases.
- Step 5: `docs/architecture.md` — modular monolith, browser/API/DB trust boundaries, business flows, security, backups, and failure handling.
- Step 6: `docs/tradeoffs.md` — prioritized bottlenecks, architecture alternatives, test thresholds and implementation entry plan.
- Implementation steps 1–7: `docs/implementation-step1.md`, `docs/implementation-step2.md`, `docs/implementation-step3.md`, `docs/implementation-step4.md`, `docs/implementation-step5.md` `docs/implementation-step6.md` and `docs/implementation-step7.md`.
- Architecture diagrams: `docs/architecture-overview.mmd`, `docs/sale-checkout-sequence.mmd`, and PNG preview.
- ER diagrams: `docs/erd-overview.mmd`, `docs/erd-members-and-events.mmd`, `docs/erd-store-and-equipment.mmd`.

**Key unresolved questions:** The source lists 15 sports but says 16; membership duration, guardian consent, commission accounting basis, equipment surcharge allocation, and payment verification/reversal procedures require approval.

## How to run

Read **`docs/implementation-step7.md`** for current instructions. In brief: install Node.js 22.12+ and PostgreSQL, run `npm install`, configure private `server/.env`, run `npm run db:check` and `npm run db:migrate`, and create an administrator using `npm run staff:create` when setting up for the first time. Start `npm run dev:server` and `npm run dev:client` in separate terminals. Run `npm test` and `npm run build`.

Do not commit real member records, guardians' contacts, secrets or `.env` files. Use dummy data for demos.

## Next milestone

Part 8 — Equipment loans, returns, damage/loss inspection and approved surcharge assessment. Patron commission payout and surcharge sharing remain blocked until management approves the respective policies.

## Rule for source changes

Preserve existing code. Prefer focused edits, commit meaningfully, add tests, and document decisions instead of replacing whole files.
