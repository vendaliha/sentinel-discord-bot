# sentinel-discord-bot

All-in-one Discord moderation bot and web dashboard.

```
.
├── index.js            discord.js v14 bot (moderation, security, giveaways, tickets…)
├── dashboard-api.js    HTTP bridge between the bot's SQLite DB and the dashboard
├── dashboard/          Vite + React + TypeScript dashboard
└── package.json        bot dependencies and scripts
```

## Bot

```bash
npm install
cp .env.example .env   # fill in DISCORD_TOKEN and CLIENT_ID
npm start
```

State lives in `jjsbot.db` (SQLite, override with `DATABASE_PATH`). `.env` is
git-ignored — never commit it; the values in it stay on the host running the bot.

`giveaway-winners.js` is part of the bot (secure weighted winner draws and the
`giveaway_winner_history` backfill), so it has to stay next to `index.js`.

## Dashboard

```bash
npm install --prefix dashboard
npm run dashboard-api           # http://127.0.0.1:4100, reads jjsbot.db
npm run dev --prefix dashboard  # http://localhost:3000
```

The dashboard proxies `/api` to the bot API (`dashboard/vite.config.ts`), so
`npm run dashboard-api` must be running. Without it the UI falls back to clearly
labelled demo data instead of failing.

### Sign in

Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET` and
`DASHBOARD_OAUTH_REDIRECT_URI` (default `http://localhost:3000/api/auth/callback`)
to require Discord sign-in. The flow asks for `identify` and `guilds`, keeps the
session on the server behind a signed `sentinel_sid` cookie (8h by default), and
only exposes servers where your account has **Administrator** or **Manage Server**.
Writes need the session's CSRF token, and member actions need **Moderate Members**.

Without those variables the API stays in local mode: it serves the single guild
found in the database and is only reachable on `127.0.0.1`. Set them before
exposing the dashboard to anyone else.

| Route                | What it shows                                                                       |
| -------------------- | ----------------------------------------------------------------------------------- |
| `/`                  | Guild info, real counters, 14-day activity chart, bot health, recent cases/events    |
| `/moderation`        | Searchable `moderation` + `blacklist_records` cases; resolve/reopen blacklist cases  |
| `/blacklist`         | Blacklist history with category, moderator, stored role count, active/resolved       |
| `/members`           | Members from warnings/moderation; warnings, strikes, history, warn/mute/kick/ban     |
| `/security`          | Six automod modules, thresholds, actions, trusted roles/channels, recent events       |
| `/logs`              | Log channel plus per-event toggles and the merged moderation/audit feed              |
| `/leaderboards`      | Boards, players, spots, scores, score channel (positions need the running bot)         |
| `/grades`            | Grade/SUB1/SUB2 role pickers and assignment through the live client                  |
| `/tickets`           | Ticket settings, panel editor with Discord-style preview, *Publish to Discord*        |
| `/giveaways`         | Active/history, edit prize and winner count, end, reroll, delete                      |
| `/community`         | Welcome/goodbye editors, autorole, suggestion channel, polls, reminders              |
| `/roles`             | Autorole, blacklist role, grade channel, reaction-role panels and mappings           |
| `/permissions`       | Per-command role restrictions and the permission audit trail                         |
| `/command-settings`  | Command switches (needs the bot for its registry)                                    |
| `/config`            | Prefix, channels, appeal link, honeypot, anti-nuke and blacklist allowlists           |
| `/backups`           | SQLite snapshots created with the online backup API (restore stays in Discord)        |
| `/bot`               | Live identity, servers, latency, uptime and capability diagnostics                    |

### How the wiring works

`dashboard-api.js` exports `startDashboardApi({ db, client })`. `index.js` calls it
once the gateway is ready, so the API shares the bot's open database connection and
Discord client. Running `npm run dashboard-api` starts the same API standalone —
reads work, but gateway stats and member actions need the bot process.

Endpoints (all JSON, bound to `127.0.0.1:4100` by default):

| Method | Path                                | Purpose                                       |
| ------ | ----------------------------------- | --------------------------------------------- |
| GET    | `/api/health`                       | Database/API status                           |
| GET    | `/api/auth/status`                  | Sign-in state, manageable servers, CSRF token |
| GET    | `/api/auth/login`                   | Redirect to Discord OAuth                     |
| GET    | `/api/auth/callback`                | OAuth callback — creates the session          |
| POST   | `/api/auth/guild`                   | `{guildId}` — select the server to manage     |
| POST   | `/api/auth/logout`                  | Destroy the session                           |
| GET    | `/api/dashboard`                    | Everything the UI needs, in one payload       |
| PATCH  | `/api/security`                     | `{ruleId, enabled?, threshold?, action?}`     |
| PATCH  | `/api/settings`                     | `{prefix?, logChannel?}`                      |
| PATCH  | `/api/cases/:id`                    | `{status}` — blacklist cases only             |
| POST   | `/api/members/:id/warn`             | Insert a warning (requires the bot)           |
| POST   | `/api/members/:id/mute`             | Discord timeout, `{minutes}` (requires bot)   |
| POST   | `/api/members/:id/unmute`           | Clear a timeout (requires the bot)            |
| GET    | `/api/overview`                     | Counters, 14-day activity, bot and guild info |
| GET    | `/api/blacklist`                    | Blacklist records + active/total counts       |
| GET    | `/api/members`, `/api/members?id=`  | Member list / full member history             |
| POST   | `/api/members/:id/(kick\|ban\|unban)` | Discord sanctions (requires the bot)        |
| GET    | `/api/security`                     | Modules, thresholds, trusted IDs, events      |
| PATCH  | `/api/security/trusted`             | `{trustedRoleIds?, trustedChannelIds?, accountAgeDays?}` |
| GET/PATCH | `/api/logs`                      | Log channel and recorded event categories     |
| GET    | `/api/leaderboards[/:id]`           | Boards, players, score channel                |
| POST   | `/api/leaderboards/:id/players`     | Add a player `{userId, spot, robloxUsername, country, stage}` |
| PATCH/DELETE | `/api/leaderboards/:id/players/:uid` | Edit, switch spot (`swapWith`) or remove |
| POST   | `/api/leaderboards/:id/score`       | `{userId, score}`                             |
| PATCH  | `/api/scores/channel`               | `{channelId}` — webhook target (requires bot) |
| GET    | `/api/grades`                       | Grade/SUB role names and the grade channel    |
| POST   | `/api/grades/assign`                | `{userId, grade, sub1, sub2}` (requires bot)  |
| GET/PATCH | `/api/tickets`                   | Ticket settings and ticket rows               |
| POST   | `/api/tickets/panel`                | Publish/update the panel (requires the bot)   |
| GET/PATCH | `/api/giveaways[/:id]`           | Giveaway list, edit prize/winner count        |
| POST   | `/api/giveaways/:id/(end\|reroll\|delete)` | Giveaway lifecycle (requires the bot) |
| GET/PATCH | `/api/community`                 | Welcome/goodbye, autorole, suggestions channel |
| GET    | `/api/roles`                        | Autorole, blacklist role, reaction-role panels |
| GET/PATCH | `/api/permissions`               | Command roles/switches + audit trail          |
| GET/PATCH | `/api/config`                    | Prefix, channels, allowlists                   |
| GET/POST | `/api/backups`                    | List snapshots / create one                   |
| GET    | `/api/bot`                          | Live bot identity, uptime, latency            |

Discord actions use the bot's live client, so `/mute` from the dashboard needs the
bot in the guild with **Timeout Members**. Bot-recorded `moderation` rows are
immutable: only blacklist cases can be resolved/reopened from the dashboard.

### Environment

| Variable               | Default                 | Used by                        |
| ---------------------- | ----------------------- | ------------------------------ |
| `DISCORD_TOKEN`        | —                       | bot, standalone API user lookup |
| `CLIENT_ID`            | —                       | bot                            |
| `GUILD_ID`             | first guild in the DB   | API guild resolution           |
| `DATABASE_PATH`        | `jjsbot.db`             | bot, API                       |
| `DASHBOARD_API_PORT`   | `4100`                  | API                            |
| `DASHBOARD_API_HOST`   | `127.0.0.1`             | API                            |
| `DASHBOARD_ORIGINS`    | localhost:3000/5173     | API CORS allowlist             |
| `DASHBOARD_API_ENABLED`| `1`                     | set `0` to not mount the API    |
| `DISCORD_CLIENT_ID`    | —                       | API sign-in (OAuth application) |
| `DISCORD_CLIENT_SECRET`| —                       | API sign-in (OAuth application) |
| `DASHBOARD_OAUTH_REDIRECT_URI` | `http://localhost:3000/api/auth/callback` | API sign-in |
| `SESSION_SECRET`       | —                       | API signs session cookies       |
| `DASHBOARD_SESSION_TTL_MS` | `28800000` (8h)     | Session lifetime               |

Even with sign-in enabled the API binds to `127.0.0.1`, so run it behind the same
host as the dashboard (or a reverse proxy) and never publish `jjsbot.db`.

## Known gaps

- Mute durations and the channel are stored for new cases (`moderation.duration_ms`
  and `moderation.channel_id`); rows recorded before that change still show `—`.
  Member actions through the API have no channel yet.
- Member names come from Discord; without a token the dashboard shows the user ID
  suffix and member counts as `—`.
