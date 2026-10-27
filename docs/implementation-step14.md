# Part 14 — Group Member Intake (CSV) · Maringo Sports Club

**Status:** Implemented in code; PostgreSQL and full browser behavior require the GitHub CI and local user acceptance checks. Not production-approved.

## Why this module exists

The original case study allows youth aged 12–35 to register through schools, colleges and religious groups. Individual registrations worked in Part 3, and a single group member could be entered. Part 14 adds efficient **multi-member intake** without hiding the group-specific KSh 500/person fee or consent safeguards.

## What was added

- `POST /api/v1/group-registrations` available to authenticated **ADM/REG**, requiring same-origin request, session CSRF token and 16–128-character `Idempotency-Key`.
- Body: `{ "organizationId": "ID", "members": [ ... ] }`, where 1–20 members use existing member fields except `registrationType` and `organizationId`. The entire batch is group-affiliated.
- The service validates all rows, rejects repeated name+DOB in the batch, validates registered organization, sports and age rules, then uses **one PostgreSQL transaction** to create the group header, members, guardian consent records, ordered sports preferences, memberships and outstanding individual charges.
- Duplicate member candidate already in club triggers `409 POSSIBLE_DUPLICATE` and **rolls back the full batch** for human review rather than silently merging two people.
- **Every member is charged KSh 500; no payment is marked received by registration.** An eligible minor stays pending guardian consent; payment and consent must be verified separately as before.
- A retry with the **same key and body** returns the same result; same key with a different body returns 409. When the network times out, keep the batch unchanged and retry the same key. This is not a queued/offline write feature.
- CSV intake interface allows a registrar to paste data exported from a spreadsheet, preview names/DOB/number of sports/guardian fields, then explicitly confirm and submit. No CSV or applicant details are saved in browser storage, and no data leaves the browser until the authorized registration call.
- New tests for CSV quoting, age, duplicate rows, sport selection, validation, fee calculations, atomic rollback, and a real-PostgreSQL integration scenario that tests linked group records and safe retries.

## Prepare a group intake

1. Create the school/college/religious organization using **Add organization** in the single-member registration area.
2. Prepare a CSV in Excel or another CSV editor. Copy the exact header from `docs/group-intake-template.csv`. Each row is one applicant.
3. In `sports` use a vertical bar `|` to separate catalogue sport **names** by preference order, such as `Hockey|Chess`. Do not use commas inside this field unless it is CSV quoted.
4. Fill next-of-kin name/relationship/phone for every person; for minors aged 12–17 provide the 3 guardian contact fields. Adult rows should leave the guardian columns blank. The club must independently verify guardian consent; contact details alone do not mean consent.
5. Select one organization, paste CSV, select **Validate and preview group**, review each person and the calculated total, tick the review confirmation and submit.
6. Each successfully created applicant has an **outstanding KSh 500 membership charge**. Payments are recorded and verified using the existing Payments module, never inferred from CSV.

The CSV is capped at **50 KB and 20 applicants**, limiting accidental mass submission and shared-device exposure. This is intended for small school/group intakes; large imports, file uploads, CSV column-mapping, and bulk payment confirmation are **not** in this milestone.

## API examples (fictional people only)

`POST /api/v1/group-registrations`

```json
{
  "organizationId":"3",
  "members":[
    {
      "fullName":"Fictional Adult One",
      "dateOfBirth":"2002-03-20",
      "subCounty":"Example Sub-County",
      "sportIds":["1","2"],
      "nextOfKin":{"fullName":"Fictional Contact","relationship":"Sibling","phone":"0000000000"}
    },
    {
      "fullName":"Fictional Youngster",
      "dateOfBirth":"2012-03-20",
      "subCounty":"Example Sub-County",
      "sportIds":["2"],
      "nextOfKin":{"fullName":"Fictional Contact","relationship":"Parent","phone":"0000000000"},
      "guardian":{"fullName":"Fictional Guardian","relationship":"Parent","phone":"0000000000"}
    }
  ]
}
```

Headers: `Content-Type: application/json`, a valid `X-CSRF-Token`, and a unique `Idempotency-Key`. The example numeric IDs must match existing records in the actual *development* database.

Success returns HTTP **201** with `groupReference`, `groupId`, `count`, `totalBilled`, and member registration results. Invalid rows return **422**, possible duplication returns **409**, nonexistent organization returns **404**. An entire batch is either committed or rolled back; no silent partial successes.

## Privacy and safeguarding

- Use **fictional data** during testing; never paste actual children's phone numbers, guardians, or special-needs details into chat, GitHub, sample CSVs, issues or CI logs.
- Batch data isn't stored in browser localStorage/sessionStorage. Browser input remains on the device while the form is open; on a shared PC close the tab after finishing and follow club procedures.
- CSV preview deliberately does **not** display next-of-kin phone numbers.
- No optional special-needs/health notes collected in this bulk workflow until a clear safeguarding and access policy is agreed.
- The backend remains authoritative; the frontend preview is not final acceptance or validation of consent.

## Tests and local verification

From repo root, run `npm test` and `npm run build`. To check real DB behavior, use GitHub CI or `npm run test:integration` **only with the isolated test database** described in `docs/implementation-step10.md`. Your regular local DB uses `npm run db:check`, `npm run db:migrate`, `npm run staff:create` as in `docs/implementation-step12.md`.

User acceptance scenarios UAT-37–UAT-40 were added to `docs/uat-cases.csv`; leave them blank until tested with fake records and local PostgreSQL. No new migration was needed: `group_registrations` and `memberships.group_registration_id` were already created in migration `001_foundation.sql`.

**Known limitations:** No group-intake history listing yet; no file picker (paste exported CSV); no captain self-service screen; no real-money refund or commission payout; unresolved club policies still block production.

**Commit:** `feat: add atomic group registration and CSV intake preview`.
