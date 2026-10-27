# Maringo Sports Club Management System (MSCMS)

A planned web-based system to manage youth registrations, sports and teams, store inventory, purchases, events, equipment issuing and returns, fees, commissions, and reporting for Maringo Sports Club.

## Working method

We follow the 1 Million Devs system-design sequence: **requirements → scale estimates → API design → data model → high-level architecture → bottlenecks/trade-offs → incremental implementation**. We also apply AI Safari's decomposition, user-centred design, constraint-aware development, ethical data handling, and verification.

## Project status

**Implementation — Part 5 prepared.** Parts 1–4 remain intact. Added sport-patron history, teams, team members, captain assignments, scoped staff APIs and a sports/teams interface. **41 Node unit/mock-service tests pass; actual PostgreSQL/API integration and frontend build still require local verification.**

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
- Implementation steps 1–5: `docs/implementation-step1.md` through `docs/implementation-step5.md`.
- Architecture diagrams: `docs/architecture-overview.mmd`, `docs/sale-checkout-sequence.mmd`, and PNG preview.
- ER diagrams: `docs/erd-overview.mmd`, `docs/erd-members-and-events.mmd`, `docs/erd-store-and-equipment.mmd`.

**Key unresolved questions:** The source lists 15 sports but says 16; membership duration, guardian consent, commission accounting basis, equipment surcharge allocation, and payment verification/reversal procedures require approval.

## How to run the starter

Read **`docs/implementation-step5.md`** for current instructions. In brief: `npm install`, configure `server/.env` (including random `CSRF_SECRET` and `APP_ORIGIN`), `npm run db:check`, `npm run db:migrate`, and `npm run staff:create` (interactive). Then run `npm run dev:server` and `npm run dev:client` in separate terminals. Run `npm test`.

## Next task

Implement sports events, rosters and facilitation fees as the next increment, after agreeing on fee/commission policy. Bulk group uploads, payment gateway integration, sales, equipment and reports remain future milestones; see `docs/implementation-step5.md` for constraints and local test checklist.

## Rule for source changes

Preserve existing code. Prefer focused edits, commit meaningfully, add tests, and document decisions instead of replacing whole files.
