# Release notes

What changed in the app, in plain words, newest first. Every pull request that changes what people see or how
hours, leave or payroll are counted adds a line under **Unreleased**. When a batch ships, **Unreleased** becomes a
version, and merging that to the main branch publishes it on the repo's **Releases** page
(`.github/workflows/release.yml`). See [How we work](docs/HOW_WE_WORK.md#release-notes).

## Unreleased

## v0.1.0 — 30 September 2026

The pilot build: the first version meant to run alongside Excel for a month (#14).

### Payroll fixes (must-have before the pilot)

- **A forgotten clock-out counts nothing** instead of every hour since. The day shows "Clock-out missing — ask for a
  correction" until the person says when they left; it no longer turns into hundreds of hours of overtime.
  (#1, #2, #30)
- **Past months keep the hours they were worked under.** The 8h30 day starts on 1 October 2026; September and earlier
  keep the 8-hour day, so approved and closed months don't change. (#3, #30)
- **"Timesheet hours come from" is dated.** Switching between the clock and the schedule only changes days from the
  chosen date on, never a closed month. The clock takes over from 1 October 2026. (#4, #30)
- The attendance log, report and timesheet now group clock sessions the same way, so they always agree. (#5, #30)
- Only the person, their manager, HR, Finance and admins see an attendance log. (#6, #30)
- The top bar offers **Clock in** again after the day's first session; today's row says the time still to go
  instead of "Short by 8h 30m"; the progress bar is readable by screen readers. (#7, #8, #9, #30)
- Each timesheet day says whether its hours came from the clock or the schedule. (#10, #30)

### New for managers, HR and Finance

- **Today board** (`/today`): who is working, on a break, late, not in yet, absent, on leave or done, filtered by
  client, department or place. (#11, #22)
- **Where I'm working:** office, client site or remote at clock-in, on the web or with `/ems in remote` in Slack.
  (#12, #22)
- **Clock-out reminder** at 08:00 for anyone still clocked in from an earlier day. (#13, #22)
- **Attendance report:** Reports → Attendance, and an Attendance sheet in the Excel: days in, late, absent, forgotten
  clock-outs, place worked. The Finance export gets a "Where" column. (#15, #18, #22)
- **Ramadan and other special hours** per client or shift, for a date range. (#16, #22)
- **Hours for one client:** one Excel per client per month. (#17, #22)
- **Delivery leads** are told about leave on their assignments, without having to approve it. (#21, #22)
- **Stand-in approvals:** a manager hands approvals to a colleague for some dates; decisions say "by X for Y".
  (#19, #22)
- **Shift swaps:** ask a colleague, they accept, the manager approves; the roster shows ⇄. (#20, #22)

### Slack and brand

- Slack commands answer within Slack's three seconds, so `/ems` no longer fails with "the app did not respond".
  (#27)
- The Kadr brand kit (logos, icons, colours, fonts, Slack app details) is in `docs/brand/kadr/`. (#24)

### Behind the scenes

- Every pull request runs the tests, typecheck and build, and a browser walkthrough of a week at EMS. (#22, #26, #30)
- Release notes live in `CHANGELOG.md` and are published on the Releases page automatically. (#31)
- Work is grouped into epics and milestones; ideas start as research issues; lasting rules are written down in
  `docs/decisions/`. `/api/health` shows the running version, and every pull request must link its issue. (#33)
