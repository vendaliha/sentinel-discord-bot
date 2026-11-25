// ============================================================
// SENTINEL DASHBOARD API
//
// Bridges the bot's SQLite database to the web dashboard.
//
// Two ways to run it:
//   • mounted inside the bot process (recommended) — index.js calls
//     startDashboardApi({ db, client }), which adds live gateway
//     stats, member name lookups and mute/role actions.
//   • standalone — `npm run dashboard-api`, which reads the same
//     database file and serves everything except Discord actions.
//
// This file does not modify the bot's schema. It only reads and
// writes rows through the tables index.js already creates.
// ============================================================

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");
const Database = require("better-sqlite3");
const dotenv = require("dotenv");

const PREFIX_OPTIONS = ["!", ".", "?", "-", ">", ",", "+"];
const SECURITY_ACTIONS = new Set(["warn", "timeout", "kick"]);
const AUTO_ACTIONS = new Set(["warn", "timeout", "kick", "ban"]);

class ApiError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ------------------------------------------------------------
// Data mapping
// ------------------------------------------------------------

const SECURITY_RULES = [
  {
    id: "spam",
    name: "Spam burst",
    description: "Catches members repeating messages inside a short window.",
    enabledColumn: "antispam",
    thresholdColumn: "spam_limit",
    min: 2,
    max: 20,
    step: 1,
    unit: "msgs / 10s",
    binary: false,
    scope: "All channels · trusted roles exempt",
    match: /spam/i
  },
  {
    id: "mentions",
    name: "Mention flood",
    description: "Blocks messages that ping too many members or roles at once.",
    enabledColumn: "antimention",
    thresholdColumn: "mention_limit",
    min: 3,
    max: 20,
    step: 1,
    unit: "mentions",
    binary: false,
    scope: "All channels · trusted roles exempt",
    match: /mention/i
  },
  {
    id: "links",
    name: "Link filter",
    description: "Deletes unauthorized links and Discord invites.",
    enabledColumn: "antilink",
    thresholdColumn: null,
    min: 1,
    max: 1,
    step: 1,
    unit: "links",
    binary: true,
    scope: "All channels · trusted roles exempt",
    match: /link|invite/i
  },
  {
    id: "raid",
    name: "Raid protection",
    description: "Rejects accounts younger than the configured age on join.",
    enabledColumn: "antiraid",
    thresholdColumn: "account_age_days",
    min: 0,
    max: 90,
    step: 1,
    unit: "days min age",
    binary: false,
    scope: "Server-wide",
    match: /raid|join/i
  },
  {
    id: "bots",
    name: "Bot protection",
    description: "Blocks automated accounts from joining unannounced.",
    enabledColumn: "antibot",
    thresholdColumn: null,
    min: 1,
    max: 1,
    step: 1,
    unit: "bot joins",
    binary: true,
    scope: "Server-wide",
    match: /bot/i
  },
  {
    id: "raidmode",
    name: "Raid mode",
    description: "Locks every text channel down until raid mode is disabled.",
    enabledColumn: "raidmode",
    thresholdColumn: null,
    min: 1,
    max: 1,
    step: 1,
    unit: "lockdown",
    binary: true,
    scope: "All channels",
    match: /lockdown|raid mode/i
  }
];

const MODERATION_TYPES = {
  warn: "warn",
  kick: "kick",
  ban: "ban",
  mute: "mute",
  timeout: "mute",
  blacklist: "blacklist",
  security_alert: "automod"
};

const DAY_MS = 86_400_000;

function startOfDay(time = Date.now()) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatUptime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / 3_600_000);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

function hashHue(value) {
  let hash = 0;
  for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function classifyRule(details) {
  const rule = SECURITY_RULES.find(item => item.match.test(String(details || "")));
  return rule ? rule.id : "links";
}

function eventRuleId(details) {
  const text = String(details || "");
  if (/mention/i.test(text)) return "mentions";
  if (/link|invite/i.test(text)) return "links";
  if (/spam/i.test(text)) return "spam";
  return "links";
}

// ------------------------------------------------------------
// Discord sign-in helpers
// ------------------------------------------------------------

const PERMISSION_BITS = {
  administrator: 1n << 3n,
  manageGuild: 1n << 5n,
  moderateMembers: 1n << 40n
};

/** @returns {{administrator: boolean, manageGuild: boolean, moderateMembers: boolean}} */
function parsePermissions(value) {
  let bits = 0n;
  try {
    bits = BigInt(String(value ?? "0"));
  } catch {
    bits = 0n;
  }
  const administrator = (bits & PERMISSION_BITS.administrator) === PERMISSION_BITS.administrator;
  return {
    administrator,
    // Administrator implies every permission in Discord, so treat it that way here.
    manageGuild: administrator || (bits & PERMISSION_BITS.manageGuild) === PERMISSION_BITS.manageGuild,
    moderateMembers:
      administrator || (bits & PERMISSION_BITS.moderateMembers) === PERMISSION_BITS.moderateMembers
  };
}

function signSessionId(sessionId, secret) {
  const signature = crypto.createHmac("sha256", secret).update(sessionId).digest("base64url");
  return `${sessionId}.${signature}`;
}

function verifySessionId(cookieValue, secret) {
  const [sessionId, signature] = String(cookieValue || "").split(".");
  if (!sessionId || !signature || !secret) return null;
  const expected = crypto.createHmac("sha256", secret).update(sessionId).digest("base64url");
  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !crypto.timingSafeEqual(provided, wanted)) return null;
  return sessionId;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ------------------------------------------------------------
// API server
// ------------------------------------------------------------

function startDashboardApi(options = {}) {
  const db = options.db || null;
  const client = options.client || null;
  const dbPath = options.dbPath || process.env.DATABASE_PATH || "jjsbot.db";
  const guildIdOverride = options.guildId || process.env.GUILD_ID || null;
  const port = Number(options.port || process.env.DASHBOARD_API_PORT || 4100);
  const host = options.host || process.env.DASHBOARD_API_HOST || "127.0.0.1";
  const token = options.token || process.env.DISCORD_TOKEN || null;
  const botVersion = options.version || require("./package.json").version;
  const origins = (process.env.DASHBOARD_ORIGINS ||
    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  const oauth = {
    clientId: options.oauth?.clientId || process.env.DISCORD_CLIENT_ID || "",
    clientSecret: options.oauth?.clientSecret || process.env.DISCORD_CLIENT_SECRET || "",
    redirectUri:
      options.oauth?.redirectUri ||
      process.env.DASHBOARD_OAUTH_REDIRECT_URI ||
      `http://localhost:${process.env.DASHBOARD_WEB_PORT || 3000}/api/auth/callback`,
    sessionSecret: options.oauth?.sessionSecret || process.env.SESSION_SECRET || "",
    authorizeUrl: options.oauth?.authorizeUrl || process.env.DISCORD_OAUTH_AUTHORIZE_URL || "https://discord.com/oauth2/authorize",
    apiBase: options.oauth?.apiBase || process.env.DISCORD_API_BASE || "https://discord.com/api/v10"
  };
  const authConfigured = Boolean(oauth.clientId && oauth.clientSecret && oauth.sessionSecret);
  const sessionTtlMs = Math.max(60_000, Number(process.env.DASHBOARD_SESSION_TTL_MS || 8 * 60 * 60 * 1000));
  const webOrigin = origins[0] || "";
  const sessions = new Map();

  let database = db || null;
  const latencySamples = [];
  const userCache = new Map();
  const rest = client ? null : token ? new REST({ version: "10" }).setToken(token) : null;

  function getDb() {
    if (database) return database;
    if (!fs.existsSync(dbPath)) {
      throw new ApiError(
        503,
        `Bot database "${dbPath}" was not found. Run the bot once so it creates its SQLite file, or set DATABASE_PATH.`
      );
    }
    database = new Database(dbPath);
    database.pragma("journal_mode = WAL");
    return database;
  }

  function resolveGuildId(conn) {
    if (guildIdOverride) return guildIdOverride;
    const row =
      conn.prepare("SELECT guild_id FROM settings LIMIT 1").get() ||
      conn.prepare("SELECT guild_id FROM moderation LIMIT 1").get() ||
      conn.prepare("SELECT guild_id FROM warnings LIMIT 1").get() ||
      conn.prepare("SELECT guild_id FROM blacklist_records LIMIT 1").get();
    if (!row?.guild_id) {
      throw new ApiError(
        503,
        "No guild data found in the bot database yet. Run a moderation command in Discord, then refresh."
      );
    }
    return row.guild_id;
  }

  // --- Sessions -------------------------------------------------------

  function isSecureRequest(req) {
    const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    return forwarded === "https" || req.socket?.encrypted === true || process.env.NODE_ENV === "production";
  }

  function sessionCookie(req, sessionId) {
    const maxAge = Math.floor(sessionTtlMs / 1000);
    const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecureRequest(req) ? "; Secure" : ""}`;
    return `sentinel_sid=${encodeURIComponent(signSessionId(sessionId, oauth.sessionSecret))}; ${flags}`;
  }

  function expiredSessionCookie(req) {
    const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecureRequest(req) ? "; Secure" : ""}`;
    return `sentinel_sid=; ${flags}`;
  }

  function pruneSessions() {
    if (sessions.size < 64) return;
    const cutoff = Date.now() - sessionTtlMs;
    for (const [id, session] of sessions) {
      if (session.createdAt < cutoff) sessions.delete(id);
    }
  }

  function createSession() {
    pruneSessions();
    const id = crypto.randomBytes(32).toString("base64url");
    const session = {
      createdAt: Date.now(),
      csrf: crypto.randomBytes(32).toString("base64url"),
      state: null,
      user: null,
      guilds: [],
      guildId: null
    };
    sessions.set(id, session);
    return { id, session };
  }

  function readSession(req) {
    const header = String(req.headers.cookie || "");
    const match = header.match(/(?:^|;\s*)sentinel_sid=([^;]+)/);
    if (!match) return null;
    const sessionId = verifySessionId(decodeURIComponent(match[1]), oauth.sessionSecret);
    if (!sessionId) return null;
    const session = sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() - session.createdAt > sessionTtlMs) {
      sessions.delete(sessionId);
      return null;
    }
    return { id: sessionId, session };
  }

  function requireSession(req) {
    if (!authConfigured) return null;
    const found = readSession(req);
    if (!found?.session.user) {
      throw new ApiError(401, "Sign in with Discord to use the dashboard.", "unauthorized");
    }
    return found;
  }

  function requireCsrf(req, session) {
    if (!authConfigured) return;
    if (!session || !safeEqual(req.headers["x-csrf-token"], session.csrf)) {
      throw new ApiError(
        403,
        "Your dashboard session could not be verified. Refresh the page and try again.",
        "csrf"
      );
    }
  }

  function requireGuildPermission(guild, capability) {
    if (!authConfigured) return;
    if (!guild?.canManage) {
      throw new ApiError(
        403,
        "You need Administrator or Manage Server on this server to change it.",
        "forbidden"
      );
    }
    if (capability === "moderate" && !guild.canModerate) {
      throw new ApiError(
        403,
        "You need Moderate Members on this server to take member actions.",
        "forbidden"
      );
    }
  }

  /**
   * Without OAuth the API keeps working against the bot's single guild (localhost only).
   * With OAuth the signed-in user's selected server always wins over ?guildId=.
   */
  function requestGuild(req, conn, requestedGuildId) {
    if (!authConfigured) {
      return { guildId: requestedGuildId || resolveGuildId(conn), guild: null, session: null };
    }
    const found = requireSession(req);
    const guild = found.session.guilds.find(item => item.id === found.session.guildId);
    if (!guild) {
      found.session.guildId = null;
      throw new ApiError(409, "Choose a server to manage first.", "guild_required");
    }
    return { guildId: guild.id, guild, session: found.session };
  }

  // --- Discord OAuth --------------------------------------------------

  async function exchangeOAuthCode(code) {
    const response = await fetch(`${oauth.apiBase}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: oauth.redirectUri
      })
    });
    const tokens = await response.json().catch(() => null);
    if (!response.ok || !tokens?.access_token) {
      console.error("Dashboard OAuth token exchange failed:", tokens?.error || response.status);
      throw new ApiError(502, "Discord sign-in failed while exchanging the code.", "oauth_failed");
    }
    return tokens.access_token;
  }

  async function fetchOAuthIdentity(accessToken) {
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
    const [userResponse, guildResponse] = await Promise.all([
      fetch(`${oauth.apiBase}/users/@me`, { headers }),
      fetch(`${oauth.apiBase}/users/@me/guilds`, { headers })
    ]);
    const user = await userResponse.json().catch(() => null);
    const guilds = await guildResponse.json().catch(() => null);
    if (!userResponse.ok || !user?.id || !guildResponse.ok || !Array.isArray(guilds)) {
      throw new ApiError(502, "Discord did not return your account details.", "oauth_failed");
    }
    return {
      user: {
        id: user.id,
        username: user.username,
        name: user.global_name || user.username,
        avatar: user.avatar || null
      },
      guilds: guilds.map(guild => {
        const permissions = parsePermissions(guild.permissions);
        return {
          id: guild.id,
          name: guild.name,
          icon: guild.icon || null,
          canManage: permissions.administrator || permissions.manageGuild,
          canModerate: permissions.administrator || permissions.moderateMembers
        };
      })
    };
  }

  function authStatus(req) {
    const found = readSession(req);
    const session = found?.session || null;
    const user = session?.user || null;
    if (session && !session.csrf) session.csrf = crypto.randomBytes(32).toString("base64url");
    const manageable = (session?.guilds || []).filter(guild => guild.canManage);
    const selected = manageable.find(guild => guild.id === session?.guildId) || null;
    if (session && session.guildId && !selected) session.guildId = null;
    return {
      authConfigured,
      authenticated: Boolean(user),
      setupHint: authConfigured
        ? null
        : "Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DASHBOARD_OAUTH_REDIRECT_URI and SESSION_SECRET, then restart the API to require Discord sign-in.",
      user,
      guilds: manageable,
      selectedGuild: selected ? { id: selected.id, name: selected.name, icon: selected.icon } : null,
      canModerate: Boolean(selected?.canModerate),
      csrfToken: user ? session.csrf : null
    };
  }

  async function resolveUser(id) {
    if (!id) return null;
    if (userCache.has(id)) return userCache.get(id);
    try {
      const user = client
        ? await client.users.fetch(id).catch(() => null)
        : rest
          ? await rest.get(Routes.user(id))
          : null;
      const info = user
        ? {
            id,
            name: user.globalName || user.global_name || user.username,
            tag: String(user.username || id).slice(-4)
          }
        : null;
      userCache.set(id, info);
      return info;
    } catch {
      userCache.set(id, null);
      return null;
    }
  }

  function fallbackUser(id) {
    return { id, name: `User ${String(id).slice(-4)}`, tag: String(id).slice(-4) };
  }

  function channelLabel(channelId) {
    if (!channelId) return null;
    const cached = client?.channels?.cache?.get(channelId);
    return cached?.name ? `#${cached.name}` : `Channel ${String(channelId).slice(-4)}`;
  }

  function guildInfo(conn, guildId) {
    const cached = client?.guilds?.cache?.get(guildId);
    if (cached) {
      return {
        id: guildId,
        name: cached.name,
        owner: cached.ownerId ? `User ${String(cached.ownerId).slice(-4)}` : "Server owner",
        memberCount: cached.memberCount,
        memberCountKnown: true,
        onlineCount: cached.members?.cache?.filter(member => member.presence?.status !== "offline").size || 0,
        createdAt: new Date(cached.createdTimestamp).toISOString(),
        hue: hashHue(guildId)
      };
    }
    return {
      id: guildId,
      name: `Guild ${String(guildId).slice(-4)}`,
      owner: "Server owner",
      memberCount: 0,
      memberCountKnown: false,
      onlineCount: 0,
      createdAt: new Date(0).toISOString(),
      hue: hashHue(guildId)
    };
  }

  async function enrichGuild(conn, guildId, sessionGuild = null) {
    const base = guildInfo(conn, guildId);
    if (sessionGuild?.name) base.name = sessionGuild.name;
    if (base.memberCountKnown || !rest) return base;
    try {
      const guild = await rest.get(Routes.guild(guildId), {
        query: new URLSearchParams({ with_counts: "true" })
      });
      return {
        ...base,
        name: guild.name || base.name,
        memberCount: guild.approximate_member_count ?? 0,
        memberCountKnown: true,
        onlineCount: guild.approximate_presence_count ?? 0
      };
    } catch {
      return base;
    }
  }

  function botStatus() {
    const uptimeMs = client?.uptime || 0;
    const ping = client ? Math.round(client.ws.ping) : null;
    if (ping !== null && Number.isFinite(ping) && ping >= 0) {
      latencySamples.push(ping);
      while (latencySamples.length > 15) latencySamples.shift();
    }
    const shardCount = client?.shard?.count || (client ? 1 : 0);
    return {
      live: Boolean(client),
      uptime: formatUptime(uptimeMs),
      latencyMs: ping !== null && Number.isFinite(ping) && ping >= 0 ? ping : null,
      shardsOnline: client ? shardCount : 0,
      shardsTotal: shardCount,
      version: `v${botVersion}`,
      commandsToday: 0,
      lastRestart: uptimeMs > 0 ? new Date(Date.now() - uptimeMs).toISOString() : new Date().toISOString(),
      latencySamples: [...latencySamples]
    };
  }

  function buildRules(conn, guildId, todayStart) {
    const security = conn
      .prepare("SELECT * FROM security_settings WHERE guild_id = ?")
      .get(guildId);
    const events = conn
      .prepare("SELECT details FROM security_events WHERE guild_id = ? AND created_at >= ?")
      .all(guildId, todayStart);
    const hits = new Map();
    for (const event of events) {
      const ruleId = eventRuleId(event.details);
      hits.set(ruleId, (hits.get(ruleId) || 0) + 1);
    }
    return SECURITY_RULES.map(rule => {
      const enabled = security ? Boolean(security[rule.enabledColumn]) : false;
      const threshold = rule.thresholdColumn && security ? Number(security[rule.thresholdColumn]) : 1;
      return {
        id: rule.id,
        name: rule.name,
        description: rule.description,
        enabled,
        action: SECURITY_ACTIONS.has(security?.action) ? security.action : "warn",
        threshold: Number.isFinite(threshold) ? threshold : 1,
        min: rule.min,
        max: rule.max,
        step: rule.step,
        unit: rule.unit,
        binary: rule.binary,
        hitsToday: hits.get(rule.id) || 0,
        scope: rule.scope
      };
    });
  }

  async function buildCases(conn, guildId) {
    const blacklist = conn
      .prepare("SELECT * FROM blacklist_records WHERE guild_id = ? ORDER BY created_at DESC LIMIT 100")
      .all(guildId);
    const moderation = conn
      .prepare(
        `SELECT * FROM moderation
         WHERE guild_id = ? AND action IN ('warn','kick','ban','mute','blacklist','security_alert')
         ORDER BY created_at DESC LIMIT 100`
      )
      .all(guildId);

    const cases = [];
    for (const record of blacklist) {
      const user = (await resolveUser(record.user_id)) || fallbackUser(record.user_id);
      cases.push({
        id: `bl-${record.id}`,
        number: Number(record.case_number) || Number(record.id),
        type: "blacklist",
        status: record.active ? "open" : "resolved",
        user,
        moderator: (await resolveUser(record.moderator_id))?.name || `User ${String(record.moderator_id).slice(-4)}`,
        reason: record.reason || "No reason recorded",
        channel: "Server blacklist",
        createdAt: new Date(Number(record.created_at)).toISOString(),
        durationMinutes: null,
        notes: [
          `Category: ${record.category || "unspecified"}`,
          `${record.roles_count || 0} role(s) stored for restoration`
        ]
      });
    }
    for (const record of moderation) {
      const type = MODERATION_TYPES[record.action];
      if (!type) continue;
      const user = (await resolveUser(record.user_id)) || fallbackUser(record.user_id);
      cases.push({
        id: `mod-${record.id}`,
        number: Number(record.id),
        type,
        status: "resolved",
        user,
        moderator: (await resolveUser(record.moderator_id))?.name || `User ${String(record.moderator_id).slice(-4)}`,
        reason: record.reason || "No reason recorded",
        channel:
          channelLabel(record.channel_id) ||
          (record.action === "security_alert" ? "Automod" : "Moderation log"),
        createdAt: new Date(Number(record.created_at)).toISOString(),
        durationMinutes:
          Number(record.duration_ms) > 0 ? Math.round(Number(record.duration_ms) / 60_000) : null,
        notes: []
      });
    }
    return cases
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 150);
  }

  async function buildMembers(conn, guildId) {
    const warnings = conn
      .prepare(
        `SELECT user_id, COUNT(*) AS warnings, MIN(created_at) AS first_warning
         FROM warnings WHERE guild_id = ? GROUP BY user_id`
      )
      .all(guildId);
    const moderation = conn
      .prepare(
        `SELECT user_id, COUNT(*) AS actions, MIN(created_at) AS first_action
         FROM moderation WHERE guild_id = ? GROUP BY user_id`
      )
      .all(guildId);

    const byUser = new Map();
    for (const row of warnings) {
      byUser.set(row.user_id, {
        warnings: row.warnings,
        firstSeen: Number(row.first_warning)
      });
    }
    for (const row of moderation) {
      const existing = byUser.get(row.user_id) || { warnings: 0, firstSeen: Number(row.first_action) };
      existing.firstSeen = Math.min(existing.firstSeen, Number(row.first_action));
      byUser.set(row.user_id, existing);
    }

    const members = [];
    for (const [userId, stats] of byUser) {
      const user = (await resolveUser(userId)) || fallbackUser(userId);
      members.push({
        id: userId,
        name: user.name,
        tag: user.tag,
        hue: hashHue(userId),
        joinedAt: new Date(stats.firstSeen).toISOString(),
        roles: [],
        warnings: stats.warnings,
        mutedUntil: null,
        messages30d: 0
      });
    }
    return members.sort((a, b) => b.warnings - a.warnings || a.name.localeCompare(b.name));
  }

  function buildActivity(conn, guildId) {
    const since = startOfDay(Date.now() - 13 * DAY_MS);
    const moderation = conn
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, COUNT(*) AS count
         FROM moderation WHERE guild_id = ? AND created_at >= ? GROUP BY day`
      )
      .all(guildId, since);
    const security = conn
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, COUNT(*) AS count
         FROM security_events WHERE guild_id = ? AND created_at >= ? GROUP BY day`
      )
      .all(guildId, since);

    const casesByDay = new Map(moderation.map(row => [row.day, row.count]));
    const automodByDay = new Map(security.map(row => [row.day, row.count]));
    const points = [];
    for (let index = 13; index >= 0; index -= 1) {
      const date = new Date(Date.now() - index * DAY_MS);
      const key = date.toISOString().slice(0, 10);
      points.push({
        date: date.toISOString(),
        cases: casesByDay.get(key) || 0,
        automod: automodByDay.get(key) || 0
      });
    }
    return points;
  }

  async function buildLog(conn, guildId) {
    const rows = conn
      .prepare("SELECT * FROM security_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT 25")
      .all(guildId);
    const log = [];
    for (const row of rows) {
      const user = row.user_id
        ? ((await resolveUser(row.user_id))?.name || `User ${String(row.user_id).slice(-4)}`)
        : "Unknown member";
      log.push({
        id: `se-${row.id}`,
        ruleId: classifyRule(row.details),
        user,
        action: AUTO_ACTIONS.has(row.type) ? row.type : "warn",
        at: new Date(Number(row.created_at)).toISOString()
      });
    }
    return log;
  }

  async function buildDashboard(conn, guildId, sessionGuild = null) {
    const settingsRow =
      conn.prepare("SELECT * FROM settings WHERE guild_id = ?").get(guildId) || {};
    const prefixRow = conn.prepare("SELECT prefixes_json FROM prefixes WHERE guild_id = ?").get(guildId);
    let prefixes = [];
    try {
      prefixes = JSON.parse(prefixRow?.prefixes_json || "[]");
    } catch {
      prefixes = [];
    }

    const todayStart = startOfDay();
    const status = botStatus();
    status.commandsToday =
      conn.prepare("SELECT COUNT(*) AS count FROM moderation WHERE guild_id = ? AND created_at >= ?")
        .get(guildId, todayStart).count +
      conn.prepare("SELECT COUNT(*) AS count FROM security_events WHERE guild_id = ? AND created_at >= ?")
        .get(guildId, todayStart).count;

    return {
      source: "live",
      data: {
        version: 3,
        guild: await enrichGuild(conn, guildId, sessionGuild),
        bot: status,
        settings: {
          prefix: prefixes[0] || "!",
          timezone: "Etc/UTC",
          logChannel: settingsRow.log_channel_id || "",
          muteRole: "Timeout",
          defaultMuteMinutes: 60,
          dmOnAction: true,
          autoEscalate: false,
          deleteTriggerMessages: true,
          retentionDays: 90
        },
        cases: await buildCases(conn, guildId),
        members: await buildMembers(conn, guildId),
        rules: buildRules(conn, guildId, todayStart),
        activity: buildActivity(conn, guildId),
        log: await buildLog(conn, guildId)
      },
      capabilities: {
        settings: ["prefix", "logChannel"],
        caseStatus: true,
        memberActions: Boolean(client || rest)
      }
    };
  }

  // ----------------------------------------------------------
  // Mutations
  // ----------------------------------------------------------

  function updateSecurity(conn, guildId, body) {
    const rule = SECURITY_RULES.find(item => item.id === body.ruleId);
    if (!rule) throw new ApiError(400, `Unknown automod rule "${body.ruleId}".`);

    conn.prepare("INSERT INTO security_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING").run(guildId);
    if (typeof body.enabled === "boolean") {
      conn.prepare(`UPDATE security_settings SET ${rule.enabledColumn} = ? WHERE guild_id = ?`).run(
        body.enabled ? 1 : 0,
        guildId
      );
      if (rule.id === "raidmode") {
        conn.prepare("UPDATE security_settings SET lockdown = ? WHERE guild_id = ?").run(
          body.enabled ? 1 : 0,
          guildId
        );
      }
    }
    if (typeof body.threshold === "number" && rule.thresholdColumn) {
      const value = Math.min(rule.max, Math.max(rule.min, Math.round(body.threshold)));
      conn.prepare(`UPDATE security_settings SET ${rule.thresholdColumn} = ? WHERE guild_id = ?`).run(
        value,
        guildId
      );
    }
    if (typeof body.action === "string") {
      if (!SECURITY_ACTIONS.has(body.action)) {
        throw new ApiError(400, "Automod action must be warn, timeout or kick.");
      }
      conn.prepare("UPDATE security_settings SET action = ? WHERE guild_id = ?").run(body.action, guildId);
    }
    return { ok: true };
  }

  function updateSettings(conn, guildId, body) {
    const applied = [];
    if (typeof body.prefix === "string") {
      if (!PREFIX_OPTIONS.includes(body.prefix)) {
        throw new ApiError(400, `Prefix must be one of ${PREFIX_OPTIONS.join(" ")}`);
      }
      conn
        .prepare("INSERT INTO prefixes (guild_id, prefixes_json) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET prefixes_json = excluded.prefixes_json")
        .run(guildId, JSON.stringify([body.prefix]));
      applied.push("prefix");
    }
    if (typeof body.logChannel === "string") {
      const value = body.logChannel.trim();
      if (value && !/^\d{5,25}$/.test(value)) {
        throw new ApiError(400, "Log channel must be a numeric channel ID (or empty to disable logging).");
      }
      conn.prepare("INSERT INTO settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING").run(guildId);
      conn.prepare("UPDATE settings SET log_channel_id = ? WHERE guild_id = ?").run(value || null, guildId);
      applied.push("logChannel");
    }
    return { ok: true, applied };
  }

  async function setCaseStatus(conn, guildId, caseKey, status) {
    if (!["open", "resolved"].includes(status)) {
      throw new ApiError(400, 'Status must be "open" or "resolved".');
    }
    const [kind, rawId] = String(caseKey).split("-");
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid case id.");
    if (kind !== "bl") {
      throw new ApiError(
        400,
        "Only blacklist cases track a resolved/reopened state; bot moderation actions are permanent records."
      );
    }
    const record = conn.prepare("SELECT * FROM blacklist_records WHERE id = ? AND guild_id = ?").get(id, guildId);
    if (!record) throw new ApiError(404, "Case not found.");

    conn.prepare("UPDATE blacklist_records SET active = ? WHERE id = ?").run(status === "open" ? 1 : 0, id);

    if (client) {
      const settingsRow = conn.prepare("SELECT blacklist_role_id FROM settings WHERE guild_id = ?").get(guildId) || {};
      const roleId = settingsRow.blacklist_role_id;
      const guild = client.guilds.cache.get(guildId);
      if (roleId && guild) {
        const member = await guild.members.fetch(record.user_id).catch(() => null);
        if (member) {
          if (status === "open") await member.roles.add(roleId).catch(() => {});
          else await member.roles.remove(roleId).catch(() => {});
        }
      }
    }
    return { ok: true };
  }

  async function memberAction(conn, guildId, userId, action, body) {
    if (!/^\d{5,25}$/.test(userId)) throw new ApiError(400, "Invalid member id.");
    if (!client && !rest) {
      throw new ApiError(
        503,
        "Member actions need the Discord bot. Mount the API inside the bot process (or set DISCORD_TOKEN) and try again."
      );
    }
    const moderator = body.moderatorId || client?.user?.id || "dashboard";

    if (action === "warn") {
      const reason = String(body.reason || "Warned from the Sentinel dashboard").slice(0, 500);
      conn
        .prepare("INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(guildId, userId, moderator, reason, Date.now());
      conn
        .prepare("INSERT INTO moderation (guild_id, action, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(guildId, "warn", userId, moderator, reason, Date.now());
      return { ok: true, action: "warn" };
    }

    const minutes = Math.min(40320, Math.max(1, Math.round(Number(body.minutes) || 60)));
    const until = action === "mute" ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
    const reason = String(body.reason || `${action === "mute" ? "Muted" : "Unmuted"} from the Sentinel dashboard`).slice(0, 500);

    if (client) {
      const guild = client.guilds.cache.get(guildId);
      const member = await guild?.members.fetch(userId).catch(() => null);
      if (!member) throw new ApiError(404, "That member is not in the server.");
      await member.timeout(until ? new Date(until) : null, reason).catch(error => {
        throw new ApiError(400, `Discord rejected the timeout: ${error.message}`);
      });
    } else {
      await rest
        .patch(Routes.guildMember(guildId, userId), {
          body: { communication_disabled_until: until },
          reason
        })
        .catch(error => {
          throw new ApiError(400, `Discord rejected the timeout: ${error.message || error}`);
        });
    }

    conn
      .prepare("INSERT INTO moderation (guild_id, action, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(guildId, action, userId, moderator, reason, Date.now());
    return { ok: true, action, minutes: action === "mute" ? minutes : null };
  }

  // ----------------------------------------------------------
  // HTTP plumbing
  // ----------------------------------------------------------

  function isSameOrigin(req) {
    const origin = req.headers.origin;
    const host = String(req.headers.host || "").toLowerCase();
    if (!origin || !host) return false;
    try {
      return new URL(origin).host.toLowerCase() === host;
    } catch {
      return false;
    }
  }

  function isAllowedOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    return origins.includes(origin) || isSameOrigin(req);
  }

  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(req)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
    res.setHeader("Cache-Control", "no-store");
  }

  function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload)
    });
    res.end(payload);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", chunk => {
        size += chunk.length;
        if (size > 64 * 1024) {
          reject(new ApiError(413, "Request body too large."));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (!chunks.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new ApiError(400, "Request body must be valid JSON."));
        }
      });
      req.on("error", reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (!isAllowedOrigin(req)) {
        throw new ApiError(403, "This origin is not allowed to call the dashboard API.", "forbidden_origin");
      }

      if (pathname === "/api/health") {
        return sendJson(res, 200, {
          ok: true,
          database: Boolean(database) || fs.existsSync(dbPath),
          databasePath: dbPath,
          botConnected: Boolean(client),
          guildId: guildIdOverride,
          authConfigured
        });
      }

      // --- Sign-in -----------------------------------------------------

      if (pathname === "/api/auth/status" && req.method === "GET") {
        return sendJson(res, 200, authStatus(req));
      }

      if (pathname === "/api/auth/login" && req.method === "GET") {
        if (!authConfigured) {
          throw new ApiError(503, "Discord sign-in is not configured on this host.", "auth_unconfigured");
        }
        const { id, session } = createSession();
        session.state = crypto.randomBytes(24).toString("base64url");
        const params = new URLSearchParams({
          client_id: oauth.clientId,
          redirect_uri: oauth.redirectUri,
          response_type: "code",
          scope: "identify guilds",
          state: session.state,
          prompt: "consent"
        });
        res.writeHead(302, {
          Location: `${oauth.authorizeUrl}?${params.toString()}`,
          "Set-Cookie": sessionCookie(req, id),
          "Cache-Control": "no-store"
        });
        return res.end();
      }

      if (pathname === "/api/auth/callback" && req.method === "GET") {
        if (!authConfigured) {
          throw new ApiError(503, "Discord sign-in is not configured on this host.", "auth_unconfigured");
        }
        if (url.searchParams.get("error")) {
          res.writeHead(302, { Location: `${webOrigin}/?auth=cancelled`, "Cache-Control": "no-store" });
          return res.end();
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const found = readSession(req);
        if (!code || !state || !found?.session.state || !safeEqual(state, found.session.state)) {
          throw new ApiError(
            400,
            "This sign-in link is invalid or expired. Start again from the dashboard.",
            "oauth_state"
          );
        }
        found.session.state = null;
        const accessToken = await exchangeOAuthCode(code);
        const identity = await fetchOAuthIdentity(accessToken);
        found.session.user = identity.user;
        found.session.guilds = identity.guilds;
        found.session.guildId = null;
        res.writeHead(302, {
          Location: `${webOrigin}/?auth=signed-in`,
          "Set-Cookie": sessionCookie(req, found.id),
          "Cache-Control": "no-store"
        });
        return res.end();
      }

      if (pathname === "/api/auth/guild" && req.method === "POST") {
        const found = readSession(req);
        if (!found?.session.user) {
          throw new ApiError(401, "Sign in with Discord to use the dashboard.", "unauthorized");
        }
        requireCsrf(req, found.session);
        const body = await readBody(req);
        const guildId = typeof body.guildId === "string" ? body.guildId : "";
        const guild = found.session.guilds.find(item => item.id === guildId && item.canManage);
        if (!guild) {
          throw new ApiError(
            403,
            "You can only select servers where you have Administrator or Manage Server.",
            "forbidden"
          );
        }
        found.session.guildId = guild.id;
        return sendJson(res, 200, {
          ok: true,
          selectedGuild: { id: guild.id, name: guild.name, icon: guild.icon },
          canModerate: guild.canModerate
        });
      }

      if (pathname === "/api/auth/logout" && req.method === "POST") {
        const found = readSession(req);
        if (found) sessions.delete(found.id);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": expiredSessionCookie(req),
          "Cache-Control": "no-store"
        });
        return res.end(JSON.stringify({ ok: true }));
      }

      // --- Dashboard data ----------------------------------------------

      if (pathname === "/api/dashboard" && req.method === "GET") {
        const conn = getDb();
        const target = requestGuild(req, conn, url.searchParams.get("guildId"));
        return sendJson(res, 200, await buildDashboard(conn, target.guildId, target.guild));
      }

      if (pathname === "/api/security" && req.method === "PATCH") {
        const conn = getDb();
        const target = requestGuild(req, conn, url.searchParams.get("guildId"));
        requireCsrf(req, target.session);
        requireGuildPermission(target.guild, "manage");
        const body = await readBody(req);
        return sendJson(res, 200, updateSecurity(conn, target.guildId, body));
      }

      if (pathname === "/api/settings" && req.method === "PATCH") {
        const conn = getDb();
        const target = requestGuild(req, conn, url.searchParams.get("guildId"));
        requireCsrf(req, target.session);
        requireGuildPermission(target.guild, "manage");
        const body = await readBody(req);
        return sendJson(res, 200, updateSettings(conn, target.guildId, body));
      }

      const caseMatch = pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]+)$/);
      if (caseMatch && req.method === "PATCH") {
        const conn = getDb();
        const target = requestGuild(req, conn, url.searchParams.get("guildId"));
        requireCsrf(req, target.session);
        requireGuildPermission(target.guild, "manage");
        const body = await readBody(req);
        return sendJson(res, 200, await setCaseStatus(conn, target.guildId, caseMatch[1], body.status));
      }

      const actionMatch = pathname.match(/^\/api\/members\/(\d+)\/(warn|mute|unmute)$/);
      if (actionMatch && req.method === "POST") {
        const conn = getDb();
        const target = requestGuild(req, conn, url.searchParams.get("guildId"));
        requireCsrf(req, target.session);
        requireGuildPermission(target.guild, "moderate");
        const body = await readBody(req);
        return sendJson(
          res,
          200,
          await memberAction(conn, target.guildId, actionMatch[1], actionMatch[2], body)
        );
      }

      throw new ApiError(404, `No route for ${req.method} ${pathname}`);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      if (status >= 500) console.error("Dashboard API error:", error);
      return sendJson(res, status, {
        error: error instanceof ApiError ? error.message : "Internal dashboard API error.",
        code: error instanceof ApiError ? error.code : null
      });
    }
  });

  server.listen(port, host, () => {
    console.log(`📊 Sentinel dashboard API on http://${host}:${port}`);
    if (!client) {
      console.log("   Standalone mode: gateway stats and Discord actions are unavailable.");
    }
  });
  return server;
}

module.exports = {
  startDashboardApi,
  // Exposed for tests and for other tooling that needs the same permission math.
  _internals: { parsePermissions, signSessionId, verifySessionId, safeEqual }
};

if (require.main === module) {
  dotenv.config({ path: process.env.BOT_ENV_FILE || ".env" });
  startDashboardApi();
}
