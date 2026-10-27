# Maringo Sports Club Management System (MSCMS)

A planned web-based system to manage youth registrations, sports and teams, store inventory, purchases, events, equipment issuing and returns, fees, commissions, and reporting for Maringo Sports Club.

## Latest milestone — Part 15

Added store merchandise returns and independent inspections, with exact discount-aware refund **estimates** and auditable stock movements. **Refunds have not been paid or booked**; the return amount is for future finance review, not evidence of a cash outflow. See `docs/implementation-step15.md`. The previous Parts 1–14 remain intact. The on-computer PostgreSQL connection must still be configured separately.

## Working method

We follow the 1 Million Devs system-design sequence: **requirements → scale estimates → API design → data model → high-level architecture → bottlenecks/trade-offs → incremental implementation**. We also apply AI Safari's decomposition, user-centred design, constraint-aware development, ethical data handling, and verification.

## Project status

**Implementation Part 15 — Atomic group registration and CSV intake.** Building on Parts 1–13, registration officers can preview and submit groups of 1–20 members from one registered organization. The backend validates all members, creates a linked batch and separate KSh 500 outstanding charges in one transaction, and prevents duplicate retries. The UAT worksheet now includes 40 scenarios. **Local PostgreSQL connection and real staff acceptance still need to be completed**; passing CI is not production certification.

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
- Implementation steps 1–14: `docs/implementation-step1.md`, `docs/implementation-step2.md`, `docs/implementation-step3.md`, `docs/implementation-step4.md`, `docs/implementation-step5.md` `docs/implementation-step6.md` and `docs/implementation-step7.md`, `docs/implementation-step8.md`, `docs/implementation-step9.md`, `docs/implementation-step10.md`, and `docs/implementation-step11.md`, `docs/implementation-step12.md`, and `docs/implementation-step13.md` and `docs/implementation-step14.md` and `docs/implementation-step15.md`.
- Architecture diagrams: `docs/architecture-overview.mmd`, `docs/sale-checkout-sequence.mmd`, and PNG preview.
- ER diagrams: `docs/erd-overview.mmd`, `docs/erd-members-and-events.mmd`, `docs/erd-store-and-equipment.mmd`.

**Key unresolved questions:** The source lists 15 sports but says 16; membership duration, guardian consent, commission accounting basis, equipment surcharge allocation, and payment verification/reversal procedures require approval.

## How to run

Start with **`docs/implementation-step12.md`** for local PostgreSQL onboarding and **`docs/implementation-step13.md`** for fictional-data acceptance checks. `docs/implementation-step11.md` explains release safeguards. In brief: install Node.js 22.12+ and PostgreSQL, run `npm install`, configure private `server/.env`, run `npm run db:check` and `npm run db:migrate`, and create an administrator using `npm run staff:create` when setting up for the first time. Start `npm run dev:server` and `npm run dev:client` in separate terminals. Run `npm test` and `npm run build`.

Do not commit real member records, guardians' contacts, secrets or `.env` files. Use dummy data for demos.

## Next milestone

**Finish local PostgreSQL setup, then run the acceptance worksheet with designated staff using fictional records. Keep release blocked until results and club policies are approved.** Equipment surcharge allocation and patron commission payouts remain blocked until management approves the respective policies.

## Rule for source changes

Preserve existing code. Prefer focused edits, commit meaningfully, add tests, and document decisions instead of replacing whole files.

## Part 14 — Group intake

See `docs/implementation-step14.md` and `docs/group-intake-template.csv`. Authorized registration staff can preview a CSV of up to 20 group members and submit it as one atomic PostgreSQL transaction with KSh 500 outstanding per member. No production or local database connection is implied.
