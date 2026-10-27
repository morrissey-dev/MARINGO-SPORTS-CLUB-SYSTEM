# Implementation Part 5 — Sports, Teams and Patron Management

**Status:** Code drafted and Node unit checks available. Live PostgreSQL migration, authenticated endpoint integration and React build require verification on a development machine. This is an additive development milestone, not a deployed application.

## Existing source retained

Part 5 starts with the complete Part 4 folder. No older migrations have been modified. Part 5 adds migration `005_sports_teams.sql`, the `teams` module and tests, expands the sport endpoints, and adds the Sports/Teams staff UI. Payment, guardian consent and member registration logic remain in the codebase.

## Workflow and authorization

1. Administrator creates staff users with the `PAT` role using `npm run staff:create-role`, following the terminal prompts.
2. Administrator or management (`ADM`, `MGT`) assigns an active patron to a sport. Reassignment closes the previous record without deleting history.
3. Current sport patron (`PAT`) or administrator (`ADM`) creates a team within an active sport.
4. Current patron or administrator adds a club member **only when both their member profile and membership status are active**.
5. Current patron or administrator appoints a captain **from the active team roster**. A new captain closes the previous assignment without deleting it.
6. An ordinary team member can be removed with a soft-departure record; an active captain must first be replaced. Staff seeing teams (`GET /teams`) are restricted to their currently assigned sports unless they have admin or management permission.

Captains are **club members**, not automatically staff login users. Team membership and sport *preferences* are independent: being interested in football does not automatically enroll someone in the football team.

## New PostgreSQL schema

- `sport_patron_assignments`: one current patron per sport (partial unique index), appointment dates, responsible manager.
- `teams`: named sport teams with active/inactive status and creator.
- `team_members`: historical team membership with joined/left timestamps, unique current membership per team.
- `team_captain_assignments`: one current captain per team (partial unique index), historical assignments and appointing staff user.

The original brief says 16 sports while listing 15. The existing 15 seed entries are unchanged. Confirm the missing sport with club management before adding it.

## API endpoints added or expanded

| Method | Endpoint | Roles | Behavior |
|---|---|---|---|
| GET | `/api/v1/sports` | ADM/REG/STO/PAT/FIN/MGT | Sports and current patron summary |
| GET | `/api/v1/sports/patron-candidates` | ADM/MGT | Active staff with PAT role |
| POST | `/api/v1/sports/:id/patron-assignments` | ADM/MGT | Assign/reassign current patron |
| GET | `/api/v1/teams` | ADM/MGT/PAT | List permitted teams with roster count/captain summary; optional `sportId` filter |
| POST | `/api/v1/teams` | ADM/PAT | Create team in permitted sport |
| GET | `/api/v1/teams/:id/members` | ADM/MGT/assigned PAT | List limited roster view |
| POST | `/api/v1/teams/:id/members` | ADM/assigned PAT | Add currently active club member |
| POST | `/api/v1/teams/:id/captain-assignments` | ADM/assigned PAT | Appoint eligible captain |
| DELETE | `/api/v1/teams/:id/members/:memberId` | ADM/assigned PAT | Mark ordinary roster membership as ended (retain history) |

Authenticated write endpoints require configured `APP_ORIGIN`, session cookies and `X-CSRF-Token` from `/api/v1/auth/me`.

### Example body

```json
{"sportId":"10","name":"Maringo Football Juniors"}
```

For patron assignment: `{"patronUserId":"3"}`. For enrolling a member or assigning a captain: `{"memberId":"42"}`. These are dummy IDs, not actual club records.

## VS Code setup and testing

1. Make a backup or commit before merging this update if you already edited your local files. Never overwrite a real `server/.env`.
2. Install Node.js 22.12+ and PostgreSQL as needed. In the project root run `npm install`.
3. Configure `server/.env` based on `.env.example` with actual local values; **never commit it**.
4. Run `npm run db:check` and `npm run db:migrate`. The migration script checks previously applied file checksums and applies `005_sports_teams.sql` once.
5. Run `npm test`, then run `npm run dev:server` and `npm run dev:client` in separate terminals.
6. Sign in to `http://localhost:5173` as an ADM/MGT user to assign the patron, then as that patron or admin to create a team and add an active (fully paid) demo member.
7. Test a forbidden cross-sport team change with an unrelated PAT account; expect `403`. Test appointment of a non-roster member as captain; expect `422`.

## Acceptance checklist

- [ ] Historical migrations 001–004 run and remain unchanged.
- [ ] Migration 005 runs successfully on PostgreSQL and is idempotent on rerun.
- [ ] Management can only assign users with active `PAT` role.
- [ ] Only one current patron per sport and one captain per team; older assignments stay queryable in SQL.
- [ ] Patron cannot create/edit teams belonging to a different sport.
- [ ] Unpaid/inactive members cannot be added to teams.
- [ ] Captain can only be appointed from active, paid roster members.
- [ ] Reassigning a patron does not remove existing team/roster history.
- [ ] Existing registration and payment workflows still function.
- [ ] Mobile and desktop staff pages remain usable on slow connections.

**Open question:** How and when a team member becomes ineligible after a later payment reversal or membership expiry. For now, newly added team members and captain candidates must be active at the time of action; retrospective eligibility review is a future policy/workflow.

**Proposed Git commit:** `feat: manage sports patrons teams and captains`.

**Next:** Part 6 will develop sporting events, participants, external facilitation-fee assessments and patron commission rules after policy approval. No commission payout is implemented in Part 5.
