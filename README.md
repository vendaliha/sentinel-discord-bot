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

| Route       | What it shows                                                                  |
| ----------- | ------------------------------------------------------------------------------ |
| `/`         | Guild stats, 14-day activity chart, bot health, recent cases                    |
| `/cases`    | Cases from `blacklist_records` + `moderation`, filters and a case drawer        |
| `/automod`  | A view over `security_settings` — toggles, thresholds, action, execution log    |
| `/members`  | Members seen in `warnings`/`moderation`, with warn and mute/unmute actions       |
| `/settings` | Prefix and log channel (written to the DB) plus browser-only preferences        |

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

- `moderation` rows do not store durations or channels, so those fields show `—`
  in the case drawer.
- Member names come from Discord; without a token the dashboard shows the user ID
  suffix and member counts as `—`.
