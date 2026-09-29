# Kadr in Slack

Everything you need to rebrand the Slack app from **EMS Clock** to **Kadr**. Nothing changes for people
who already use it: `/ems` keeps working, and `/kadr` is added next to it. Both go to the same place.

## What to paste where

In [api.slack.com/apps](https://api.slack.com/apps), open the app, then **Settings → Basic Information → Display Information**:

| Field | Value |
|---|---|
| App name | `Kadr` |
| Short description (82/140) | `Clock in, breaks and clock out from Slack, plus approvals and reminders from Kadr.` |
| Background color | `#1B3BD1` (Kadr cobalt) |
| App icon | Upload [`kadr-slack-app-icon-1024.png`](kadr-slack-app-icon-1024.png) (square, 1024 × 1024; Slack accepts 512 to 2000 px and rounds the corners itself) |
| Long description (599 characters) | The text below |

```
Kadr brings your workday into Slack. Clock in, take a break and clock out with /kadr in, /kadr break, /kadr back and /kadr out, and see how long you've worked with /kadr status. Everything lands in the same clock as the Kadr website, so your timesheet fills itself.

Kadr also sends you a direct message when something needs you: a time-off request or a day change to approve, a month to submit, or the decision on your own request. Birthdays and work anniversaries are shared each morning in one channel, never ages.

Replies to commands are only visible to you. Kadr is built and supported by EMS.
```

**Features → App Home → Your App's Presence in Slack** (bot user):

| Field | Value |
|---|---|
| Display name (bot name) | `Kadr` |
| Default username | `kadr` |

**Features → Slash Commands**: keep `/ems`, and add `/kadr` with exactly the same settings:

| Field | Value |
|---|---|
| Command | `/kadr` |
| Request URL | `https://hr-navy-zeta.vercel.app/api/slack/commands` (the same URL `/ems` uses) |
| Short description | `Clock in, break, back, out, status` |
| Usage hint | `in \| break \| back \| out \| status` |
| Escape channels, users and links | Off |

## Or do it all at once with the manifest

**Settings → App Manifest**, replace the contents with [`manifest.kadr.json`](manifest.kadr.json) (or
[`manifest.kadr.yml`](manifest.kadr.yml) on the YAML tab), **Save**, and accept the changes. It sets the name,
descriptions, colour, bot name and both commands. Check the `url` is still your live site before saving.
The **app icon can't be set by the manifest**: upload it by hand as above.

Scopes are unchanged (`commands`, `chat:write`, `users:read`, `users:read.email`), so no reinstall and no new
tokens are needed. If Slack asks you to reinstall anyway, the bot token stays the same.

## After the change

- Messages from the app now show **Kadr** with the Kadr icon, in DMs and in the celebrations channel.
- The `/kadr help` reply still lists the commands as `/ems …`; both work. The wording lives in
  `src/server/slack.ts` if you want it to say `/kadr` once everyone is used to it.
- Nothing needs to change in Vercel: `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN` and
  `SLACK_CELEBRATIONS_CHANNEL` stay as they are.
