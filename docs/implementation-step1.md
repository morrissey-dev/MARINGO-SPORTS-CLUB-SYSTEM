# Implementation — Part 1: Project Foundation

This document is a **hands-on continuation** of the six-part 1 Million Devs design.

## Goal and scope

Create a small, understandable React + Express workspace that can talk to itself through an API, configure PostgreSQL without exposing secrets, and run automated tests. **No member records, authentication, payments, or inventory APIs have been implemented yet.** UI module cards are non-clickable placeholders; the current health check proves only Express is reachable, **not** that PostgreSQL is connected.

## Setup on Windows in VS Code

1. Install Node.js **22.12+** (Vite 8 requires a modern Node release), npm, VS Code, and PostgreSQL. Git is needed for version control.
2. Extract the ZIP, open its `maringo-sports-club-starter` folder in VS Code.
3. In a VS Code terminal (PowerShell), run `node -v` and `npm -v`; check the Node version.
4. From the project root run `npm install`. This downloads packages from the npm registry and creates `package-lock.json`.
5. In the VS Code file explorer copy `server/.env.example` to `server/.env`. Edit `DATABASE_URL` to match a local PostgreSQL user/password/database. `.env` is ignored by Git.
6. In terminal **1** (at project root) run `npm run dev:server`. Visit `http://localhost:4000/api/v1/health` and check JSON status `ok`.
7. In terminal **2** run `npm run dev:client`. Open `http://localhost:5173`. It should show `Backend API reachable` if terminal 1 is running.
8. Run `npm test` in a terminal. Expected: **2 passing Node unit tests**. They verify the basic response shape and guard against misleading database status.
9. To actually verify PostgreSQL separately, create the user/database (commands below), then run `npm run db:check`. Expected: `PostgreSQL connection successful (SELECT 1).`
10. Commit the starter with Git commands below; **do not add your .env**.

## PostgreSQL database creation (local example)

Use `psql` or pgAdmin connected as a PostgreSQL admin account. Replace the example credentials with your own **development-only** password:

```sql
CREATE ROLE maringo_dev WITH LOGIN PASSWORD 'your_local_dev_password';
CREATE DATABASE maringo_club OWNER maringo_dev;
```

In `server/.env`, set:

```text
PORT=4000
DATABASE_URL=postgresql://maringo_dev:your_local_dev_password@localhost:5432/maringo_club
NODE_ENV=development
```

If the password contains special URL characters (`@`, `#`, `/`, `:`), percent-encode those characters in the connection URL. Keep `.env` secret. Running `npm run db:check` checks connectivity only: **there are no application tables yet**. For a real deployment we will replace these development practices with managed secrets, stronger DB permissions and secure network controls.

## How it works

- **React** (`client/src/App.jsx`) calls `/api/v1/health` with `fetch()`.
- **Vite** (`client/vite.config.js`) forwards `/api` requests to the Express dev server on port 4000, avoiding a separate local CORS policy.
- **Express** (`server/src/app.js`) handles the health route, sending JSON.
- **PostgreSQL** is configured in `server/src/db/pool.js`, but connections are only made when the database check script runs. Later modules will use this pooled connection for transactions.
- The `node:test` suite (`server/test/health.test.js`) verifies a small pure function (`server/src/health.js`).

## Dataflow

`React browser (localhost:5173) → Vite proxy (/api) → Express (localhost:4000) → JSON health response → React status display`.

The flow does **not** traverse PostgreSQL until we add database-backed endpoints. To test the database today, run `npm run db:check` separately.

## Test and review checkpoints

- [ ] `node -v` reports Node 22.12+ or a newer compatible version.
- [ ] `npm install` succeeds with internet access.
- [ ] Server starts and health endpoint returns JSON.
- [ ] React app loads and reports API status truthfully.
- [ ] `npm test` passes both unit tests.
- [ ] PostgreSQL is installed and `npm run db:check` succeeds (separate check).
- [ ] `git status` does **not** list `server/.env`.
- [ ] Six design documents remain in `docs/`.

## Git commands

Only run `git init` if this folder is **not already a Git repository**. Do not initialize inside another repository unintentionally.

```powershell
git init
git add .
git status
git commit -m "chore: scaffold Maringo React Express project foundation"
```

**Next part:** Set up the first verified database migration for membership tables and implement a safe, tested registration flow. Age eligibility, guardian permission, duplicate checks and membership charges must follow the requirements. Before building a public-facing registration page, add staff authentication and authorization; no production personal data until those safeguards are ready.

## Troubleshooting

- `npm` not recognized → install/update Node.js, reopen VS Code terminal.
- `npm install` fails because of network → internet connectivity or npm registry access is required.
- `vite: command not found` → run `npm install` at repository root first.
- Port 4000 already used → stop that app or consistently change server port and Vite proxy target.
- Browser shows "Backend not reachable" → start the backend in terminal 1. The frontend should still render.
- `db:check` fails → PostgreSQL may be stopped, `DATABASE_URL` missing or wrong, user/database absent, or credentials incorrect. API health may still work because it does not check DB.

## Environment note

This starter was assembled in an environment without access to the npm registry. JavaScript syntax, JSON manifests and the dependency-free tests can be checked here; `npm install`, Vite compilation and a real PostgreSQL connection must be performed on a computer with the needed dependencies and services. Do not claim them as already verified.
