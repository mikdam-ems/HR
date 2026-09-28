# Slack commands

People clock in and out from Slack with `/ems`:

| Command | Does |
|---|---|
| `/ems in` | Clock in (during a break it means "I'm back") |
| `/ems break` | Start a break |
| `/ems back` | End the break |
| `/ems out` | Clock out |
| `/ems` or `/ems status` | How long you've worked today |
| `/ems help` | The list above |

Replies are only visible to the person who typed the command. Everything lands in the same clock as the
website, so the Home timer and the timesheet show it straight away.

## Setting it up (a Slack admin, about 10 minutes)

1. Go to **api.slack.com/apps → Create New App → From an app manifest**, choose the workspace, and on the
   **JSON** tab (the default) replace everything with [`manifest.json`](manifest.json). Check the `url` points at
   the live site. ([`manifest.yml`](manifest.yml) is the same thing for the YAML tab.)
2. **Install to Workspace** and allow it.
3. Copy two values into Vercel (**Settings → Environment Variables**), then redeploy:
   - `SLACK_SIGNING_SECRET` — from **Basic Information → App Credentials → Signing Secret**
   - `SLACK_BOT_TOKEN` — from **OAuth & Permissions → Bot User OAuth Token** (starts with `xoxb-`)
4. In any Slack channel or DM, type `/ems status`.

People are matched by email: their Slack email must be the same as their EMS account email. The first
`/ems` command links them; after that it's instant.

Want `/in` and `/out` as well? Add more entries under `slash_commands` in the manifest with the same `url`
(`/in`, `/out`, `/break`, `/back` are all understood).
