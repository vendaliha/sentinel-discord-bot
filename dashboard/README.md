# Sentinel Dashboard Starter

This is a separate starter dashboard so it does not overwrite the existing Discord bot entry point.

## Run locally

1. Copy the repository's `.env.example` to `.env` and fill in values only when configuring OAuth.
2. Install dependencies from this directory: `npm install`.
3. Start the preview: `npm start`.
4. Open `http://localhost:3000` (or the configured `DASHBOARD_PORT`).

## Current status

- Black and silver responsive dashboard preview: included.
- Minimal Express static server and health endpoint: included.
- Discord OAuth2: not implemented.
- Login/session security: not implemented.
- Bot/SQLite integration: not implemented.
- Dashboard controls: visual placeholders only.

Do not expose bot tokens, OAuth client secrets, session secrets, or database files to the browser. Do not connect this starter to production until authentication, authorization, CSRF protection, validation, and audit logging have been implemented and tested.
