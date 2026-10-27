# Maringo Sports Club Management System (MSCMS)

A planned web-based system to manage youth registrations, sports and teams, store inventory, purchases, events, equipment issuing and returns, fees, commissions, and reporting for Maringo Sports Club.

## Working method

We follow the 1 Million Devs system-design sequence: **requirements → scale estimates → API design → data model → high-level architecture → bottlenecks/trade-offs → incremental implementation**. We also apply AI Safari's decomposition, user-centred design, constraint-aware development, ethical data handling, and verification.

## Project status

**Implementation Part 11 — Deployment readiness and verification gates.** All Part 1–10 files retained. Added database readiness endpoint, safe startup environment validation, graceful shutdown, stronger response headers, keyboard navigation improvements, GitHub Actions CI (unit tests + React build + isolated PostgreSQL integration) and a release go/no-go checklist. **CI, live PostgreSQL integration and React build have not yet been confirmed successful**; see `docs/implementation-step11.md`. Not production-certified. Historical fees and provisional commissions are not counted as collected income.

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
- Implementation steps 1–11: `docs/implementation-step1.md`, `docs/implementation-step2.md`, `docs/implementation-step3.md`, `docs/implementation-step4.md`, `docs/implementation-step5.md` `docs/implementation-step6.md` and `docs/implementation-step7.md`, `docs/implementation-step8.md`, `docs/implementation-step9.md`, `docs/implementation-step10.md`, and `docs/implementation-step11.md`.
- Architecture diagrams: `docs/architecture-overview.mmd`, `docs/sale-checkout-sequence.mmd`, and PNG preview.
- ER diagrams: `docs/erd-overview.mmd`, `docs/erd-members-and-events.mmd`, `docs/erd-store-and-equipment.mmd`.

**Key unresolved questions:** The source lists 15 sports but says 16; membership duration, guardian consent, commission accounting basis, equipment surcharge allocation, and payment verification/reversal procedures require approval.

## How to run

Read **`docs/implementation-step11.md`** for current instructions, deployment safeguards, and the dedicated integration database procedure. In brief: install Node.js 22.12+ and PostgreSQL, run `npm install`, configure private `server/.env`, run `npm run db:check` and `npm run db:migrate`, and create an administrator using `npm run staff:create` when setting up for the first time. Start `npm run dev:server` and `npm run dev:client` in separate terminals. Run `npm test` and `npm run build`.

Do not commit real member records, guardians' contacts, secrets or `.env` files. Use dummy data for demos.

## Next milestone

**Inspect GitHub Actions CI outcomes, fix any discovered PostgreSQL/API/frontend issues, obtain real user-acceptance evidence, and complete the go/no-go checklist before deployment.** Equipment surcharge allocation and patron commission payouts remain blocked until management approves the respective policies.

## Rule for source changes

Preserve existing code. Prefer focused edits, commit meaningfully, add tests, and document decisions instead of replacing whole files.
