# Maringo Sports Club Management System (MSCMS)
## Software Requirements Specification — v0.1

**Status:** Initial requirements baseline; open assumptions require stakeholder validation.  
**Method:** 1 Million Devs six-part system design: (1) requirements, (2) scale estimates, (3) API, (4) data model, (5) architecture, (6) bottlenecks/trade-offs. AI Safari adds problem decomposition, user-centred co-design, constraint-aware development, ethics, and verification.  
**Scope:** Membership, sports/teams/events, store and sales, equipment lending, fees/commissions, and reports.

## 1. Problem and desired outcome

Maringo County's sports club manages youth membership and multiple sports. It needs a reliable, secure, traceable system to replace or supplement fragmented transaction records, automate stated calculations, control stock and equipment, and provide meaningful financial and operational reports.

**Success criterion:** An authorized staff member can follow a complete transaction from initiation through payment/return to an auditable report, without re-entering the same information into separate registers.

## 2. Stakeholders and roles

| Stakeholder | Proposed responsibility |
| --- | --- |
| Club management | Supervision, reporting, review and approvals |
| System administrator | Staff accounts and role permissions |
| Registration officer | Register/update members and organizations |
| Store clerk | Stock receipt, sales, issues and returns |
| Patron | Assigned sport, team selection and event coordination |
| Captain | Confirm team equipment issues/returns |
| Finance officer | Reconcile payments, commissions and income |
| Member / guardian | Provide accurate registration details and, when applicable, guardian consent |

**Access rule:** Staff accounts and member profiles are distinct. Users see only the records needed for their role. A captain is a member of an assigned team. Roles may overlap only when explicitly authorized.

## 3. Functional requirements

| ID | Requirement | Minimum acceptance condition |
| --- | --- | --- |
| FR-01 | Register individual members | Valid age (12–35 inclusive); store unique member ID, personal/contact/education/sub-county, next-of-kin, and appropriate sensitive fields |
| FR-02 | Register groups | Capture school/college/religious organization and individual membership links; calculate KSh 500 per group member |
| FR-03 | Manage age bands | Calculate age based on full birth date: minor 12–17, middle 18–25, senior 26–35; reject invalid ages at initial enrolment |
| FR-04 | Record sports preferences | A member can choose multiple distinct sports, with unique priority positions; separate interest from actual team placement |
| FR-05 | Manage sports, patrons and captains | Add/update sports; assign patron; record patron-appointed captain and valid team members |
| FR-06 | Record membership charges/payments | Individual KSh 1,000; group KSh 500/person; show billed, received, balance, payment method and reference |
| FR-07 | Maintain product catalogue and inventory | Product name, SKU, price/price variant, maximum stock, available stock, and detailed stock movements |
| FR-08 | Process purchases | Multi-item sale, quantity and valid current unit prices, cash/mobile-money payment, receipt, and stock deduction in one reliable transaction |
| FR-09 | Calculate sale discount | Give exactly 5% discount when sale subtotal > KSh 10,000; no discount at KSh 10,000 |
| FR-10 | Trigger low-stock alert | Alert when on-hand stock <= 20% of configured maximum; no negative stock |
| FR-11 | Manage sporting events | Event ID, sport, date, type (internal/external), opponent, venue, patron, participating team and status |
| FR-12 | Assess facilitation fees | For external events charge each recorded participating member KSh 500; track paid/unpaid |
| FR-13 | Calculate patron commissions | 20% of the designated facilitation-fee base, tracked per event/patron; prevent duplicate disbursement |
| FR-14 | Issue and return equipment | Record item, quantity, condition, captain, event, issue time and return time; track available/issued/lost/damaged quantities |
| FR-15 | Assess damage/loss | For confirmed loss/damage calculate 110% of approved market value; record liable individuals and allocation policy once agreed |
| FR-16 | Generate operational/financial reports | Membership, sports, sales, low stock, stock movement, event collections, patron commissions, equipment incidents, surcharges and income, filterable by period |
| FR-17 | Audit critical changes | Log actor, timestamp, action and target for payment reversals, prices, stock adjustments, membership changes, commission approvals and surcharge changes |
| FR-18 | Search and validation | Search members/items/events; prevent duplicate payment references where applicable and incompatible state changes |

### Special modelling rules

- **Products sold** are not the same workflow as **equipment loaned**: sales permanently reduce inventory; loans reserve/issue equipment until inspected on return. A physical item type may be usable in both workflows, but all movements must be traceable.
- **Fee assessment** is separate from **payment received**. Report both billed and collected figures. Do not count the same payment twice.
- **Patron commission** is an expense/payment obligation, not a source of new revenue.
- **Historical prices** must be saved on sale lines and equipment incident assessments so later price updates do not change old transactions.
- **Source of truth:** server/database business rules must be authoritative; frontend calculations are previews only.

## 4. Non-functional requirements

| ID | Requirement | Validation approach |
| --- | --- | --- |
| NFR-01 | Security and least-privilege access | Verify authentication, server-side permissions, input validation and protected passwords |
| NFR-02 | Privacy and child safeguarding | Guardian/parental consent process for minors; access controls for contact and special-needs information; minimize sensitive collection |
| NFR-03 | Financial and inventory integrity | Use atomic database transactions for sales/payment/stock changes; reject duplicate processing; retain audit records |
| NFR-04 | Usability | Mobile-friendly, clear labels, helpful validation errors and accessible keyboard navigation |
| NFR-05 | Low-bandwidth awareness | Small initial page payloads, efficient APIs, graceful retry/error screens; investigate offline-first only where transactions can safely reconcile |
| NFR-06 | Reliability and recovery | Periodic backups, documented restore procedure and tested recovery |
| NFR-07 | Maintainability | Modular code, meaningful Git commits, environment configuration, tests and useful documentation |
| NFR-08 | Report integrity | Reconcile period totals to underlying payments, invoices/charges and refunds; distinguish revenue, collections and expenses |
| NFR-09 | Performance | Record baseline assumptions in estimates.md before fixing response-time/concurrency targets |

## 5. Business rules (authoritative from problem, unless identified as proposed)

| Rule | Definition |
| --- | --- |
| BR-01 | Valid age at registration: 12 to 35 inclusive |
| BR-02 | Age bands: 12–17 minor; 18–25 middle; 26–35 senior |
| BR-03 | Individual fee: KSh 1,000; group fee: KSh 500 per member |
| BR-04 | Purchase subtotal = SUM(line quantity × saved unit price) |
| BR-05 | Discount = subtotal × 0.05 if subtotal > 10,000; otherwise zero |
| BR-06 | Amount payable = subtotal − discount |
| BR-07 | Reorder alert if on-hand stock <= maximum stock × 0.20 *(interprets 'drops to 20%' as at or below)* |
| BR-08 | External-event facilitation fee = number of assessed participants × KSh 500 |
| BR-09 | Patron commission = 20% × designated facilitation fee base *(basis to confirm: collected vs billed)* |
| BR-10 | Lost/damaged surcharge = approved market value × 1.10 |
| BR-11 | Total income collected = membership collections + net sales receipts + event-fee collections + surcharge collections, minus reversals/refunds as applicable |

## 6. Acceptance test examples

| Case | Input | Expected outcome |
| --- | --- | --- |
| T-01 | Applicant aged 11 | Registration rejected |
| T-02 | Applicant exactly 12 | Eligible, category Minor |
| T-03 | Applicant exactly 18 | Eligible, category Middle |
| T-04 | Applicant exactly 26 | Eligible, category Senior |
| T-05 | Applicant aged 36 | New registration rejected |
| T-06 | 20 eligible members enrolled as a group | Total membership charges KSh 10,000 |
| T-07 | Sale subtotal KSh 10,000 | Discount KSh 0; payable KSh 10,000 |
| T-08 | Sale subtotal KSh 11,000 | Discount KSh 550; payable KSh 10,450 |
| T-09 | Max stock 100, on-hand falls from 21 to 20 | Low-stock alert triggered |
| T-10 | 10 assessed players in an external event | Facilitation charges KSh 5,000; commission at 20% is KSh 1,000 on an agreed KSh 5,000 base |
| T-11 | Confirmed equipment damage with market value KSh 2,000 | Total surcharge KSh 2,200, pending approved allocation |
| T-12 | Same sale request accidentally submitted twice | Exactly one sale/stock deduction is recorded |
| T-13 | Unprivileged member attempts payment or stock adjustment | Server denies request and logs relevant attempt where appropriate |
| T-14 | Sale total and detailed receipts for same period | Amounts reconcile after refunds/reversals |

## 7. Open questions and provisional design assumptions

These are **not settled facts**, and should be confirmed before final implementation:

1. **Sports count:** The brief says 16 sports but explicitly lists 15 (swimming, hockey, lawn tennis, table tennis, darts, badminton, volleyball, basketball, netball, football, baseball, rugby, pool, chess, draft). Add the missing sport when identified.
2. **Membership duration:** One-off vs annual renewal? Proposed first version records one enrolment charge and payment history without inventing renewal.
3. **Existing members aging beyond 35:** Eligibility applies at new registration; continued participation and historical category rules need clarification.
4. **Group validation:** Define how schools, colleges and religious bodies establish group eligibility and whether a member can move groups.
5. **Commission basis:** Should 20% be calculated from fees billed or confirmed collections? Proposed initial choice: confirmed collections, payable only after review.
6. **Surcharge sharing:** Define proportion owed by captain versus team members; never assign multiple full surcharges for a single incident by default.
7. **Shoe pricing:** Define specific catalog variants between KSh 1,000 and KSh 4,000, instead of applying a single arbitrary price.
8. **Maximum stock:** Define who sets per-item maximum stock levels and how they are changed.
9. **Equipment inventory:** Are issued equipment units separately tracked/serialized, or counted only by quantity?
10. **Cash/mobile money:** First release records payment method and reference; direct M-Pesa API integration is a later, separately authorized feature.
11. **Legal and privacy requirements:** Confirm a child-safeguarding procedure, retention periods, consent evidence and appropriate privacy notices before collecting live minors' data.

## 8. MVP boundary

Build in small vertical slices rather than implementing everything simultaneously:

1. **Foundation:** Auth/roles, members, organisations, sports/preferences, registration charges/payments.
2. **Events:** Patrons, teams, event participation, facilitation charges and commission records.
3. **Store:** Catalog, stock movements, sales/receipts, discounts, reorder alerts.
4. **Loans:** Equipment issue/return, incidents, surcharge assessments.
5. **Reports:** Financial and operational reports, reconciliation, export, tests, audit verification.

**Not part of MVP by default:** AI-based talent scoring, automated team selection, direct mobile-money integrations, public member social networking, sophisticated offline payment processing.

## 9. Recommended next design deliverables (1 Million Devs order)

- `docs/estimates.md`: Explicit assumptions for member counts, staff concurrency, transaction volumes, storage and peak event/registration demand.
- `docs/api-design.md`: Resource-based REST endpoints, methods, roles, example JSON, errors, idempotency and pagination.
- `docs/data-model.md`: Entities, foreign keys, unique constraints, payment/stock consistency rules and relationship diagram.
- `docs/architecture.md`: Client, API, database, integration boundaries, main request/data flows and deployment assumptions.
- `docs/tradeoffs.md`: Alternative design decisions, bottlenecks, costs and why extra components are or are not needed.

**Suggested commit after review:** `docs: define MSCMS functional and non-functional requirements`

**Change discipline:** Maintain and extend existing code; do not delete or rewrite unrelated files. Use feature branches/meaningful commits and run tests for each change.
