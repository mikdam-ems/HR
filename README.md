# EMS People & Culture

One internal place for EMS employees to log time, request leave and see the org chart.
Each person's days off, work week and overtime follow the client they're assigned to, and the system works that out for them.

- **Plan (product):** [EMS People & Culture — Plan v0.1](https://claude.ai/code/artifact/2644cbbc-032f-4bd5-9c32-532e915d4536)
- **Wireframes:** [People & Culture Wireframes](https://claude.ai/artifact/5aTvRyU8yfekwc93seUufT)
- **Technical design:** [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md)

## Status

**Phase 1 features are complete:** sign-in, people, org chart, clients, calendars, assignments, schedules, Excel import,
Arabic/English, the rules engine, timesheets with manager approval, time off, **month-end reports with the Finance
Excel export and month closing**, and **departments** (Software & Development, UX/UI, QA, Application Support, plus
Finance and People & Culture), each with a head. The UI uses the EMS brand palette in a soft, rounded style with top navigation. **Next:** stage 6, the pilot — a few people run it alongside Excel for one month.

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

## Demo site (Vercel + Neon, free)

1. Sign in at [vercel.com](https://vercel.com) with GitHub → **Add New → Project** → import `mikdam-ems/HR`.
2. Before deploying, add two **Environment Variables**: `DEMO_MODE` = `true`, and `AUTH_SECRET` = any long random text.
   Click **Deploy** (the first deploy fails without a database; that's expected).
3. In the project: **Storage → Create Database → Neon** (free) → connect it to the project. This sets `DATABASE_URL`.
4. **Deployments → ⋯ → Redeploy.** Open the `…vercel.app` link.

The first visit creates the tables and loads the sample people automatically. Unlike Render, the demo data persists.

## Demo site (Render, free)

The repo includes `render.yaml`, which deploys a **demo** with sample people and pick-a-person sign-in:

1. Sign in at [render.com](https://render.com) with GitHub (allow access to `mikdam-ems/HR`).
2. **New → Blueprint**, pick this repo, branch `claude/practical-volta-vfybbj`, then **Apply**.
3. After the build (about 5 minutes) open the `…onrender.com` link.

Demo data resets whenever the site restarts. The free plan sleeps after 15 minutes idle, so the first visit takes about a minute.
`DEMO_MODE=true` lets anyone with the link sign in as anyone — never use it with real data.

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
| Request day changes, submit own timesheet; request time off; see own balances | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit own photo and bio; set a daily status (name and title are kept by HR) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Attach a document (e.g. a medical report) to a leave request | ✓ | ✓ | ✓ | ✓ | ✓ |
| Record that they told the client about their leave (the client is informed, not asked) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Clock in / out and take breaks, with a live timer — on the site or with `/ems in` in Slack ([setup](slack/README.md)) | ✓ | ✓ | ✓ | ✓ | ✓ |
| See who on their team is working or on a break right now | | ✓ | | | |
| See department and client pages, and the org chart (pyramid or outline) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Open leave attachments of their team | | ✓ | | | |
| See their team's status; approve day changes; approve or return their team's timesheets and leave | | ✓ | | | |
| View anyone's timesheet (read-only) | | | ✓ | ✓ | ✓ |
| Approve timesheets of people with no manager | | | | | ✓ |
| Add/edit people, departments, assignments, schedules; import Excel; adjust leave balances; open any leave attachment | | | ✓ | | ✓ |
| Clients, calendars, holidays | | | ✓ | | ✓ |
| Reports and the Finance Excel export | | | ✓ | ✓ | ✓ |
| Close a month once every timesheet is approved | | | ✓ | | ✓ |
| Roles, home calendar, overtime rates; reopen a closed month | | | | | ✓ |

"Manager" isn't a role you assign: anyone with direct reports is a manager.

**Changing a day is a request.** When someone changes a day (hours, leave on the day, a note) it goes to their manager;
the timesheet only changes once it's approved. At month end the person still submits the whole month for a final
sign-off, which waits until no day changes are pending. People with no manager (the General Manager) change days directly.
The demo loads EMS's real team (`EMS_ROSTER` in `src/server/seed.ts`): the General Manager (admin) manages the delivery
managers of QA, Software & Development and Application Support, and each delivery manager approves their own team's
timesheets and leave. Names come from the email addresses; correct them (and add Arabic names) on each person's page.
