# EMS People & Culture

One internal place for EMS employees to log time, request leave and see the org chart.
Each person's days off, work week and overtime follow the client they're assigned to, and the system works that out for them.

- **Plan (product):** [EMS People & Culture — Plan v0.1](https://claude.ai/code/artifact/2644cbbc-032f-4bd5-9c32-532e915d4536)
- **Wireframes:** [People & Culture Wireframes](https://claude.ai/artifact/5aTvRyU8yfekwc93seUufT)
- **Technical design:** [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md)

## Status

Phase 1, stages 1–2 done: sign-in, people, org chart, clients, calendars, assignments, schedules, Excel import,
Arabic/English, and the rules engine. **Next:** stage 3, timesheets.

## Run it locally

Needs Node 22+. No database server needed — local development uses an embedded PostgreSQL stored in `.data/`.

```bash
npm install
cp .env.example .env.local        # set AUTH_SECRET; set AUTH_DEV_LOGIN=true to skip Google locally
SEED_ADMIN_EMAIL=you@ems-itech.com npm run db:seed -- --demo   # calendars, clients, you as admin, sample people
npm run dev                       # http://localhost:3000
```

With `AUTH_DEV_LOGIN=true` the sign-in page lets you pick any person (development only; ignored in production).

```bash
npm test          # rules engine + database tests (in-memory PostgreSQL)
npm run typecheck
npm run build
```

## Going live

1. PostgreSQL database → set `DATABASE_URL=postgres://…`. Migrations run automatically on start.
2. Google OAuth client (Google Cloud Console → Credentials → OAuth client ID, type *Web application*).
   Redirect URI: `https://<host>/api/auth/callback/google`. Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.
3. `AUTH_SECRET` (`openssl rand -base64 32`) and `AUTH_ALLOWED_DOMAIN=ems-itech.com`.
4. `SEED_ADMIN_EMAIL=… npm run db:seed` once (without `--demo`), then sign in and import people from Excel.

Only people added by HR can sign in, and only with a Google account on the allowed domain.

## Who can do what

| | Employee | Manager | HR | Finance | Admin |
|---|---|---|---|---|---|
| See own day, next 7 days, directory, org chart | ✓ | ✓ | ✓ | ✓ | ✓ |
| See their team's status today | | ✓ | | | |
| Add/edit people, assignments, schedules; import Excel | | | ✓ | | ✓ |
| Clients, calendars, holidays | | | ✓ | | ✓ |
| Roles, home calendar, overtime rates | | | | | ✓ |

"Manager" isn't a role you assign: anyone with direct reports is a manager.
