# Implementation — Part 3: Member Registration

**Status:** Code prepared and **22 automated unit / mocked-service tests pass**. PostgreSQL migrations, complete API integration and Vite/React production build must still be verified on your computer. Do not enter real children's information during unverified development.

## 1. Incremental changes to Part 2

This is a copy of the **Part 2** project with focused additions. Part 2 login, staff sessions, password hashing, CSRF checks, the seeded sports catalogue and all six design documents are preserved. The already-applied migrations `001_foundation.sql` and `002_reference_data.sql` are UNCHANGED. The following are new or updated:

- **New** `database/migrations/003_member_registration.sql`: automatic `MSC-00000001` membership numbers; organization name/type uniqueness; query indexes; idempotent-request ledger.
- **New** `server/src/members/validation.js`: age 12–35 eligibility, exact birthdays, categories, registration fees, sports priority, guardian/next-of-kin validation.
- **New** `server/src/members/registration.js`: atomic registration, charge creation, duplicate review, staff audit record and replay protection.
- **New** `server/src/members/routes.js`: members list/detail, authenticated registration, manager-verified guardian consent.
- **New** `server/src/organizations/routes.js`: list/create school, college and religious organization records.
- **Updated** `server/src/app.js`: wires new routers.
- **Updated** `server/src/auth/routes.js`: exports existing CSRF middleware for new mutation routes; authentication behavior unchanged.
- **New** `client/src/RegistrationPanel.jsx`, `MemberDirectory.jsx`: staff registration form and recent-application list.
- **Updated** `client/src/App.jsx` and `styles.css`: connect registration to signed-in workspace.
- **New** `server/test/member-validation.test.js`, `member-service.test.js`.

**No payments are recorded by registration.** New membership charges are **outstanding**; individual fee is KSh 1,000, group-affiliated fee is KSh 500 per member. Member remains **draft** as an adult, or **pending_consent** as a minor. Membership itself stays **pending** until a later payment/activation workflow is implemented. A guardian verified-consent action moves a minor application from `pending_consent` to `draft` but **does not** mark it paid/active.

## 2. Setup in VS Code (PowerShell)

1. **Keep a backup or commit of Part 2 before updating.** Use the new ZIP as a fresh folder or selectively apply new/modified files. Do not overwrite your existing `server/.env`, credentials or Git history.
2. Make sure Node.js **22.12+**, npm, local PostgreSQL and the existing Part 2 setup are working.
3. Open the folder and run:

   ```powershell
   npm install
   npm run db:check
   npm run db:migrate
   npm test
   ```

   `db:migrate` checks migration hashes and applies `003_member_registration.sql` if not previously applied. Never change migrations after applying them.
4. If this is a fresh database, use `npm run staff:create` to create an administrator interactively, using a private password. If you already created an admin in Part 2, **do not create another one**.
5. Run `npm run dev:server` in one terminal and `npm run dev:client` in another. Open **http://localhost:5173** exactly, matching `APP_ORIGIN` in `server/.env`.
6. Sign in with an **ADM** or **REG** staff account. The registration form displays the 15 confirmed sports. For a group member, use **Add organization** first, then choose it from the group dropdown. For a minor, enter the guardian contact. Save a **fictional test member only**.
7. The confirmation should show a generated membership number, correct age category, fee and outstanding payment status. The new member also appears in the Recent Applications list. Refresh and verify it persists.

**Expected DB confirmation** (replace fake number with your result):

```sql
SELECT m.membership_number, m.full_name, m.status, ms.registration_type,
       mc.fee_rate_snapshot, c.status AS charge_status
FROM members m
JOIN memberships ms ON ms.member_id=m.id
JOIN membership_charges mc ON mc.membership_id=ms.id
JOIN charges c ON c.id=mc.charge_id
ORDER BY m.id DESC LIMIT 5;

SELECT m.membership_number, s.name, p.priority
FROM member_sport_preferences p
JOIN members m ON m.id=p.member_id
JOIN sports s ON s.id=p.sport_id
ORDER BY m.id DESC,p.priority LIMIT 20;
```

Never share screenshots containing real next-of-kin, minor, or login information.

## 3. API calls (role- and CSRF-protected)

Endpoints are relative to `/api/v1`:

| Method | Path | Roles | Current behavior |
|---|---|---|---|
| GET | `/organizations` | ADM, REG | Returns up to 200 organizations |
| POST | `/organizations` | ADM, REG | Create organization; rejects duplicate name/type |
| GET | `/members?search=&page=1` | ADM, REG | Returns 20 members per page (basic filtering) |
| GET | `/members/:id` | ADM, REG | Restricted member details, prioritized sports and fee status |
| POST | `/members` | ADM, REG | Atomically create member, contacts, consent placeholder if minor, membership, preferences, membership charge and audit record |
| POST | `/members/:id/guardian-consent/verify` | ADM, MGT | Record manually checked consent evidence; **does not collect payment or activate account** |

All POST routes require staff session cookie, exact `APP_ORIGIN`, and `X-CSRF-Token` from the login response or `/auth/me`. The member-create route **also** requires a unique `Idempotency-Key` string (16–128 ASCII letters/digits/hyphens/underscores). Use the same key to retry an uncertain network result; do not reuse a key with different form contents.

Example member request payload (fictional only):

```json
{
  "fullName": "Test Member",
  "dateOfBirth": "2011-04-20",
  "gender": "Male",
  "phone": "",
  "subCounty": "Sample Sub-County",
  "schoolOrCollege": "Demo School",
  "registrationType": "group",
  "organizationId": "1",
  "sportIds": ["10", "8"],
  "nextOfKin": {"fullName":"Test Contact","relationship":"Parent","phone":"0700000000"},
  "guardian": {"fullName":"Test Guardian","relationship":"Parent","phone":"0710000000"}
}
```

Sport IDs shown are sample IDs from the seed order; retrieve `GET /sports` first to confirm actual IDs. Sports order in `sportIds` is priority order (first = 1). Guardian is required only for ages 12–17.

Sample response:

```json
{
  "data": {
    "id": "1",
    "membershipNumber": "MSC-00000001",
    "fullName": "Test Member",
    "ageBand": "minor",
    "registrationType": "group",
    "guardianConsent": "pending",
    "memberStatus": "pending_consent",
    "membershipStatus": "pending",
    "membershipFee": "500.00",
    "paymentStatus": "outstanding",
    "sportIds": ["10", "8"]
  },
  "replayed": false
}
```

Guardian verification must use an **evidence reference**, not the actual form or photo of the child. For instance `{"evidenceReference":"GC-LOCAL-001"}`. Approval must be based on a real authorized human check; a database entry alone is not proof of consent. Verification permissions are `ADM`/`MGT` only and staff are responsible for a defensible process.

## 4. Tests you should run

1. Boundary ages: 11 rejected; 12, 17, 18, 25, 26 and 35 accepted; 36 rejected. Verify a day before the 12th birthday fails.
2. Without guardian details, a minor request fails; with guardian details, status is `pending_consent`.
3. Verify a guardian using an authorized account and approved evidence; status becomes `draft` but fee stays outstanding.
4. Select Football, Basketball and Rugby in priority order; confirm database priorities `1`, `2`, `3`.
5. Individual fee KSh 1,000 and group-affiliated fee KSh 500. Check assessed fee, **not collected revenue**.
6. Two attempts with the same idempotency key and same request return one member/one fee; using same key with different content returns 409.
7. Two concurrent attempts with same name and DOB but different keys must not silently create duplicates; staff review is required.
8. Reject inaccessible routes with HTTP 401 (no session), HTTP 403 (wrong role or CSRF/origin).
9. Stop DB service before a write; observe no successful API acknowledgment or partial created record.
10. Execute a **real database-backed smoke test locally**; the included Node mock tests do not prove migrations/API execute against PostgreSQL.

`npm test` runs 22 unit and mocked-service tests including part 2. We could not run PostgreSQL integrations or the frontend production build in the packaging environment because PostgreSQL and downloaded npm dependencies were unavailable there.

## 5. Data ethics and unresolved work

- **Minors:** registration stores a pending guardian-consent record and requires a separate verification step. Production use needs review of legal consent, retention, guardian identity and safeguarding procedures.
- **Sensitive details:** do not put guardian contact, next of kin, special-needs information or health data into logs, audit metadata, screenshots, fixtures or GitHub. Optional weight, height and special-needs capture is deliberately deferred until purpose and access controls have been approved.
- **Duplicate review:** matching names and birth dates trigger human review, not automatic merges. Two different people may legitimately share both fields; a controlled adjudication/override procedure will be designed later.
- **Group enrollment:** this version supports registering each member **under an existing group organization**; spreadsheet/CSV bulk group imports remain unimplemented.
- **Payments:** no payment capture, checkout or automatic M-Pesa confirmation yet. Do not represent billed income as money received.
- **Activation:** applications intentionally remain draft/pending and have no activation endpoint until payment and consent verification rules have been integrated.
- **Other original requirements:** inventory, events, equipment borrowing/surcharges, patron commission and final financial reporting are planned future phases.
- **Sports:** the case says 16 games but names 15; 15 are seeded until corrected by the club.

## 6. Commit and next increment

```powershell
# Run from your existing Git working tree after applying the changes.
git status
git add client server database docs README.md
git commit -m "feat: add authenticated member registration and fee assessment"
```

Suggested next increment: **Part 4 — Payment recording and membership activation**, with an approved policy for verifying cash and M-Pesa references, reconciled receipts, confirmation of guardian consent, and controlled status changes. Before enabling real money/child data, add database-backed integration/authorization tests and approved operational safeguards.
