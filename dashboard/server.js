require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env") });

const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
const path = require("node:path");

const app = express();
const PORT = Number(process.env.DASHBOARD_PORT || 3000);
const oauthConfigured = Boolean(
  process.env.DISCORD_CLIENT_ID &&
  process.env.DISCORD_CLIENT_SECRET &&
  process.env.DISCORD_REDIRECT_URI &&
  process.env.SESSION_SECRET
);

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(session({
  name: "sentinel.sid",
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.get("/api/health", (_req, res) => {
  res.json({
    name: "Sentinel Dashboard",
    status: "preview",
    oauthConfigured,
    authenticated: Boolean(_req.session.discordUser),
    connectedToBot: false,
    message: "Discord sign-in can be enabled by configuring the OAuth values in .env. Bot/database integration is not connected yet."
  });
});

app.get("/auth/discord", (req, res) => {
  if (!oauthConfigured) {
    return res.status(503).send("Discord login is not configured. Add DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI and SESSION_SECRET to .env.");
  }
  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds",
    state
  });
  res.redirect("https://discord.com/oauth2/authorize?" + params.toString());
});

app.get("/auth/discord/callback", async (req, res) => {
  if (!oauthConfigured) return res.status(503).send("Discord login is not configured.");
  const { code, state, error } = req.query;
  if (error) return res.status(400).send("Discord authorization was cancelled.");
  if (!code || !state || !req.session.oauthState || state !== req.session.oauthState) {
    return res.status(400).send("Invalid OAuth state. Please try signing in again.");
  }
  delete req.session.oauthState;
  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: process.env.DISCORD_REDIRECT_URI
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) {
      console.error("Discord OAuth token exchange failed:", tokens.error || tokenResponse.status);
      return res.status(502).send("Discord sign-in failed during token exchange.");
    }

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: "Bearer " + tokens.access_token }
    });
    const user = await userResponse.json();
    if (!userResponse.ok || !user.id) return res.status(502).send("Could not retrieve your Discord account.");

    const guildResponse = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: "Bearer " + tokens.access_token }
    });
    const guilds = await guildResponse.json();
    if (!guildResponse.ok || !Array.isArray(guilds)) return res.status(502).send("Could not retrieve your Discord servers.");

    req.session.discordUser = { id: user.id, username: user.username, global_name: user.global_name || user.username, avatar: user.avatar };
    req.session.discordGuilds = guilds.map(g => {
      let canManage = false;
      try {
        const permissions = BigInt(g.permissions || "0");
        canManage = (permissions & 0x8n) === 0x8n;
      } catch {}
      return {
        id: g.id,
        name: g.name,
        icon: g.icon,
        canManage
      };
    });
    req.session.discordAccessToken = tokens.access_token;
    res.redirect("/");
  } catch (err) {
    console.error("Discord OAuth callback error:", err.message);
    res.status(502).send("Discord sign-in could not be completed.");
  }
});

app.get("/api/me", (req, res) => {
  if (!req.session.discordUser) return res.status(401).json({ authenticated: false });
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  res.json({
    authenticated: true,
    user: req.session.discordUser,
    guilds: req.session.discordGuilds || [],
    selectedGuild: req.session.selectedGuild || null,
    csrfToken: req.session.csrfToken
  });
});

app.post("/api/select-server", (req, res) => {
  if (!req.session.discordUser) return res.status(401).json({ error: "Sign in with Discord first." });
  const suppliedToken = req.get("x-csrf-token");
  if (!suppliedToken || suppliedToken !== req.session.csrfToken) {
    return res.status(403).json({ error: "Your session could not be verified. Refresh and try again." });
  }

  const guildId = typeof req.body.guildId === "string" ? req.body.guildId : "";
  const guild = (req.session.discordGuilds || []).find(item => item.id === guildId && item.canManage === true);
  if (!guild) return res.status(403).json({ error: "You can only select servers where you have Administrator permission." });

  req.session.selectedGuild = { id: guild.id, name: guild.name, icon: guild.icon || null };
  res.json({ ok: true, selectedGuild: req.session.selectedGuild });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sentinel.sid");
    res.json({ ok: true });
  });
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`Sentinel dashboard listening on port ${PORT}`);
  if (!oauthConfigured) console.log("Discord OAuth is not configured; dashboard is running in preview mode.");
});
