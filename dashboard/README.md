# Sentinel Dashboard

The dashboard is a separate Express app. It does not replace or modify the Discord bot entry point.

## Run in GitHub Codespaces

From the repository root:

```bash
cd dashboard
npm install
npm start
```

Open the forwarded port **3000** in the Codespaces Ports panel.

## Enable Discord sign-in

1. In the Discord Developer Portal, open the application used by Sentinel.
2. Under OAuth2, add a redirect URL that exactly matches the public Codespaces URL plus `/auth/discord/callback`.
3. Copy `.env.example` to the repository root as `.env` (keep `.env` private and never commit it).
4. Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, and a long random `SESSION_SECRET`.
5. Restart the dashboard and use **Continue with Discord**.

The OAuth flow requests `identify` and `guilds`, and only lists servers where the signed-in user has Manage Server or Administrator permission. Access tokens remain server-side in the session.

## Current status

- Responsive Sentinel dark / silver / purple interface: implemented.
- Express server and health endpoint: implemented.
- Discord OAuth sign-in and manageable-server discovery: implemented, but requires your private OAuth credentials.
- Live bot status, SQLite data, moderation actions, role editor, tickets and giveaway controls: **not connected yet**. The UI intentionally does not pretend these are live or allow changes before server-side permission checks and database integration are complete.

Never put the Discord bot token, OAuth client secret, or session secret in frontend JavaScript or commit them to Git.
