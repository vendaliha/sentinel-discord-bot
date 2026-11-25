// ============================================================
// SENTINEL DASHBOARD — SECTION LOGIC
//
// Reads and writes for every dashboard section, kept separate
// from the HTTP plumbing in dashboard-api.js. Everything here
// uses the bot's existing SQLite tables; the only table this
// module creates is its own ticket panel design cache, so a
// panel can be re-published without touching bot tables.
// ============================================================

const fs = require("node:fs");
const path = require("node:path");

const DAY_MS = 86_400_000;
const ID_PATTERN = /^\d{5,25}$/;

// Mirrors the bot's grade constants so the API can report them even when it runs
// standalone; the mounted bot passes its own lists and those always win.
const DEFAULT_GRADE_ROLES = [
  "Grade 5",
  "Grade 4",
  "Grade 3",
  "Grade 2",
  "Semi Grade 1",
  "Grade 1",
  "Special Grade 1",
  "Special Grade"
];
const DEFAULT_SUB1_ROLES = ["Low", "Mid", "High"];
const DEFAULT_SUB2_ROLES = ["Weak", "Stable", "Strong"];
const DEFAULT_LOG_EVENTS = [
  { label: "Moderation actions", value: "moderation" },
  { label: "Member joins and leaves", value: "members" },
  { label: "Role changes", value: "roles" },
  { label: "Nickname changes", value: "member_updates" },
  { label: "Ban and unban events", value: "bans" }
];

class SectionError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function startOfDay(time = Date.now()) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function idList(value, { max = 100 } = {}) {
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.filter(item => typeof item === "string" && ID_PATTERN.test(item)))];
  return ids.slice(0, max);
}

function text(value, max = 2000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function ensureDashboardTables(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_ticket_panel (
      guild_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      colour INTEGER NOT NULL,
      footer TEXT,
      updated_by TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
}

function createSections(context = {}) {
  const client = context.client || null;
  const actions = context.actions || {};
  const resolveUser = context.resolveUser || (async () => null);
  const fallbackUser = context.fallbackUser || (id => ({ id, name: `User ${String(id).slice(-4)}`, tag: String(id).slice(-4) }));
  const ApiError = context.ApiError || SectionError;

  const fail = (status, message, code = null) => {
    throw new ApiError(status, message, code);
  };

  const guildOf = guildId => client?.guilds?.cache?.get(guildId) || null;
  const roleName = (guildId, id) => guildOf(guildId)?.roles?.cache?.get(id)?.name || null;
  const channelName = (guildId, id) => guildOf(guildId)?.channels?.cache?.get(id)?.name || null;

  function requireBot() {
    if (!client) {
      fail(503, "This action needs the running bot (Discord client). Start the bot with the API mounted.", "bot_offline");
    }
    return client;
  }

  async function user(id) {
    if (!id) return null;
    return (await resolveUser(id)) || fallbackUser(id);
  }

  const num = (conn, sql, guildId) => Number(conn.prepare(sql).get(guildId)?.n || 0);

  // ----------------------------------------------------------
  // Overview
  // ----------------------------------------------------------

  function overviewStats(conn, guildId) {
    const guild = guildOf(guildId);
    const since7d = Date.now() - 7 * DAY_MS;
    return {
      members: guild?.memberCount ?? null,
      onlineMembers: guild?.members?.cache
        ? guild.members.cache.filter(member => member.presence?.status !== "offline").size
        : null,
      warnings: num(conn, "SELECT COUNT(*) AS n FROM warnings WHERE guild_id = ?", guildId),
      strikes: num(conn, "SELECT COUNT(*) AS n FROM staff_strikes WHERE guild_id = ?", guildId),
      blacklistActive: num(conn, "SELECT COUNT(*) AS n FROM blacklist_records WHERE guild_id = ? AND active = 1", guildId),
      blacklistTotal: num(conn, "SELECT COUNT(*) AS n FROM blacklist_records WHERE guild_id = ?", guildId),
      moderationActions: num(conn, "SELECT COUNT(*) AS n FROM moderation WHERE guild_id = ?", guildId),
      activeGiveaways: num(
        conn,
        "SELECT COUNT(*) AS n FROM giveaways WHERE guild_id = ? AND status IN ('active','ending')",
        guildId
      ),
      openTickets: num(conn, "SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND status = 'open'", guildId),
      securityEvents7d: Number(
        conn.prepare("SELECT COUNT(*) AS n FROM security_events WHERE guild_id = ? AND created_at >= ?").get(guildId, since7d)?.n || 0
      ),
      pendingSuggestions: num(conn, "SELECT COUNT(*) AS n FROM suggestions WHERE guild_id = ? AND status = 'pending'", guildId),
      leaderboards: num(conn, "SELECT COUNT(*) AS n FROM leaderboards WHERE guild_id = ?", guildId),
      recent: {
        moderation: conn
          .prepare("SELECT action, created_at FROM moderation WHERE guild_id = ? ORDER BY created_at DESC LIMIT 5")
          .all(guildId),
        security: conn
          .prepare("SELECT type, details, created_at FROM security_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT 5")
          .all(guildId)
      }
    };
  }

  function activity(conn, guildId) {
    const since = startOfDay(Date.now() - 13 * DAY_MS);
    const moderation = conn
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n
         FROM moderation WHERE guild_id = ? AND created_at >= ? GROUP BY day`
      )
      .all(guildId, since);
    const members = conn
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n
         FROM warnings WHERE guild_id = ? AND created_at >= ? GROUP BY day`
      )
      .all(guildId, since);
    const byDay = new Map(moderation.map(row => [row.day, row.n]));
    const warnsByDay = new Map(members.map(row => [row.day, row.n]));
    const points = [];
    for (let index = 13; index >= 0; index -= 1) {
      const date = new Date(Date.now() - index * DAY_MS);
      const key = date.toISOString().slice(0, 10);
      points.push({
        date: date.toISOString(),
        cases: byDay.get(key) || 0,
        warnings: warnsByDay.get(key) || 0
      });
    }
    return points;
  }

  // ----------------------------------------------------------
  // Moderation, blacklist, members
  // ----------------------------------------------------------

  async function blacklist(conn, guildId, options = {}) {
    const filter = options.status === "active" ? "AND active = 1" : options.status === "resolved" ? "AND active = 0" : "";
    const rows = conn
      .prepare(`SELECT * FROM blacklist_records WHERE guild_id = ? ${filter} ORDER BY created_at DESC LIMIT 500`)
      .all(guildId);
    const records = [];
    for (const row of rows) {
      records.push({
        id: row.id,
        caseNumber: Number(row.case_number) || Number(row.id),
        user: await user(row.user_id),
        moderator: (await user(row.moderator_id))?.name || "Unknown",
        category: row.category || "unspecified",
        reason: row.reason || "No reason recorded",
        rolesCount: Number(row.roles_count) || 0,
        rolesJson: row.roles_json || null,
        active: Boolean(row.active),
        createdAt: new Date(Number(row.created_at)).toISOString()
      });
    }
    return {
      records,
      counts: {
        total: num(conn, "SELECT COUNT(*) AS n FROM blacklist_records WHERE guild_id = ?", guildId),
        active: num(conn, "SELECT COUNT(*) AS n FROM blacklist_records WHERE guild_id = ? AND active = 1", guildId)
      }
    };
  }

  async function memberDetail(conn, guildId, userId) {
    if (!ID_PATTERN.test(String(userId))) fail(400, "Invalid member id.");
    const member = guildOf(guildId)?.members?.cache?.get(userId) || null;
    const warnings = conn
      .prepare("SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC")
      .all(guildId, userId);
    const strikes = conn
      .prepare("SELECT * FROM staff_strikes WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC")
      .all(guildId, userId);
    const moderation = conn
      .prepare("SELECT * FROM moderation WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 100")
      .all(guildId, userId);
    const blacklistRows = conn
      .prepare("SELECT * FROM blacklist_records WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC")
      .all(guildId, userId);
    return {
      user: await user(userId),
      inServer: Boolean(member),
      joinedAt: member?.joinedTimestamp ? new Date(member.joinedTimestamp).toISOString() : null,
      roles: member ? [...member.roles.cache.values()].filter(role => role.id !== guildId).map(role => role.name) : [],
      counts: {
        warnings: warnings.length,
        strikes: strikes.length,
        moderation: moderation.length,
        blacklists: blacklistRows.length
      },
      warnings: warnings.map(row => ({
        id: row.id,
        reason: row.reason,
        moderator: row.moderator_id,
        createdAt: new Date(Number(row.created_at)).toISOString()
      })),
      strikes: strikes.map(row => ({
        id: row.id,
        reason: row.reason,
        moderator: row.moderator_id,
        createdAt: new Date(Number(row.created_at)).toISOString()
      })),
      moderation: moderation.map(row => ({
        id: row.id,
        action: row.action,
        reason: row.reason,
        moderator: row.moderator_id,
        createdAt: new Date(Number(row.created_at)).toISOString(),
        durationMs: row.duration_ms ?? null,
        channel: channelName(guildId, row.channel_id) ? `#${channelName(guildId, row.channel_id)}` : null
      })),
      blacklist: blacklistRows.map(row => ({
        id: row.id,
        caseNumber: Number(row.case_number) || Number(row.id),
        category: row.category,
        reason: row.reason,
        active: Boolean(row.active),
        createdAt: new Date(Number(row.created_at)).toISOString()
      }))
    };
  }

  async function members(conn, guildId, query = "") {
    const rows = conn
      .prepare(
        `SELECT user_id,
                (SELECT COUNT(*) FROM warnings w WHERE w.guild_id = m.guild_id AND w.user_id = m.user_id) AS warnings,
                (SELECT COUNT(*) FROM staff_strikes s WHERE s.guild_id = m.guild_id AND s.user_id = m.user_id) AS strikes,
                (SELECT COUNT(*) FROM moderation md WHERE md.guild_id = m.guild_id AND md.user_id = m.user_id) AS actions,
                (SELECT COUNT(*) FROM blacklist_records b WHERE b.guild_id = m.guild_id AND b.user_id = m.user_id AND b.active = 1) AS blacklisted,
                MIN(created_at) AS first_seen
         FROM (
           SELECT guild_id, user_id, created_at FROM warnings WHERE guild_id = ?
           UNION ALL SELECT guild_id, user_id, created_at FROM moderation WHERE guild_id = ?
           UNION ALL SELECT guild_id, user_id, created_at FROM staff_strikes WHERE guild_id = ?
           UNION ALL SELECT guild_id, user_id, created_at FROM blacklist_records WHERE guild_id = ?
         ) m
         GROUP BY user_id`
      )
      .all(guildId, guildId, guildId, guildId);

    const needle = query.trim().toLowerCase();
    const list = [];
    for (const row of rows) {
      const info = await user(row.user_id);
      if (needle && !`${info?.name || ""} ${row.user_id}`.toLowerCase().includes(needle)) continue;
      list.push({
        id: row.user_id,
        name: info?.name || `User ${String(row.user_id).slice(-4)}`,
        tag: info?.tag || String(row.user_id).slice(-4),
        warnings: Number(row.warnings) || 0,
        strikes: Number(row.strikes) || 0,
        actions: Number(row.actions) || 0,
        blacklisted: Number(row.blacklisted) > 0,
        firstSeen: row.first_seen ? new Date(Number(row.first_seen)).toISOString() : null
      });
    }
    return list.sort((a, b) => b.warnings - a.warnings || a.name.localeCompare(b.name)).slice(0, 300);
  }

  // ----------------------------------------------------------
  // Security and logs
  // ----------------------------------------------------------

  function security(conn, guildId) {
    const row = conn.prepare("SELECT * FROM security_settings WHERE guild_id = ?").get(guildId) || {};
    const parseIds = value => {
      try {
        const parsed = JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : [];
      } catch {
        return [];
      }
    };
    const events = conn
      .prepare("SELECT * FROM security_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT 50")
      .all(guildId)
      .map(event => ({
        id: event.id,
        type: event.type,
        details: event.details,
        userId: event.user_id,
        createdAt: new Date(Number(event.created_at)).toISOString()
      }));
    const trustedRoles = parseIds(row.trusted_role_ids_json).map(id => ({ id, name: roleName(guildId, id) }));
    const trustedChannels = parseIds(row.trusted_channel_ids_json).map(id => ({ id, name: channelName(guildId, id) }));
    return {
      action: row.action || "warn",
      lockdown: Boolean(row.lockdown),
      accountAgeDays: Number(row.account_age_days) || 0,
      spamLimit: Number(row.spam_limit) || 5,
      mentionLimit: Number(row.mention_limit) || 5,
      trustedRoles,
      trustedChannels,
      events,
      whitelist: conn
        .prepare("SELECT user_id FROM anti_nuke_whitelist WHERE guild_id = ?")
        .all(guildId)
        .map(entry => entry.user_id),
      honeypotChannelId: conn.prepare("SELECT channel_id FROM honeypot_settings WHERE guild_id = ?").get(guildId)?.channel_id || null
    };
  }

  function logOptions() {
    return Array.isArray(actions.logEvents) && actions.logEvents.length ? actions.logEvents : DEFAULT_LOG_EVENTS;
  }

  function enabledLogEvents(row) {
    const all = logOptions().map(option => option.value);
    if (!row?.log_events_json) return all;
    try {
      const saved = JSON.parse(row.log_events_json);
      return all.filter(value => saved.includes(value));
    } catch {
      return all;
    }
  }

  function logs(conn, guildId) {
    const row = conn.prepare("SELECT * FROM settings WHERE guild_id = ?").get(guildId) || {};
    const events = [];
    for (const entry of conn
      .prepare("SELECT action, user_id, moderator_id, reason, created_at FROM moderation WHERE guild_id = ? ORDER BY created_at DESC LIMIT 40")
      .all(guildId)) {
      events.push({
        id: `mod-${entry.created_at}-${entry.user_id}`,
        kind: "moderation",
        label: entry.action,
        userId: entry.user_id,
        moderatorId: entry.moderator_id,
        detail: entry.reason,
        createdAt: new Date(Number(entry.created_at)).toISOString()
      });
    }
    for (const entry of conn
      .prepare("SELECT type, details, user_id, created_at FROM security_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT 40")
      .all(guildId)) {
      events.push({
        id: `sec-${entry.created_at}-${entry.user_id || "x"}`,
        kind: "security",
        label: entry.type,
        userId: entry.user_id,
        detail: entry.details,
        createdAt: new Date(Number(entry.created_at)).toISOString()
      });
    }
    events.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return {
      channelId: row.log_channel_id || null,
      channelName: channelName(guildId, row.log_channel_id),
      serverLogChannelId: row.server_log_channel_id || null,
      serverLogsEnabled: Boolean(row.server_logs_enabled),
      options: logOptions(),
      enabled: enabledLogEvents(row),
      events: events.slice(0, 60),
      note: "Discord's own audit log is not copied into SQLite; this feed shows bot-recorded moderation and security events."
    };
  }

  // ----------------------------------------------------------
  // Leaderboards and grades
  // ----------------------------------------------------------

  async function leaderboards(conn, guildId) {
    const boards = conn.prepare("SELECT * FROM leaderboards WHERE guild_id = ? ORDER BY id").all(guildId);
    const result = [];
    for (const board of boards) {
      const players = conn
        .prepare("SELECT * FROM leaderboard_scores WHERE leaderboard_id = ? ORDER BY spot ASC, score DESC")
        .all(board.id);
      const decorated = [];
      for (const player of players) {
        const info = await user(player.user_id);
        decorated.push({
          userId: player.user_id,
          name: info?.name || `User ${String(player.user_id).slice(-4)}`,
          spot: Number(player.spot),
          score: Number(player.score),
          robloxUsername: player.roblox_username || "",
          country: player.country || "",
          stage: player.stage || "",
          avatarUrl: player.avatar_url || null,
          updatedAt: new Date(Number(player.updated_at)).toISOString()
        });
      }
      result.push({
        id: board.id,
        name: board.name,
        channelId: board.channel_id,
        channelName: channelName(guildId, board.channel_id),
        messageId: board.message_id,
        createdBy: board.created_by,
        createdAt: new Date(Number(board.created_at)).toISOString(),
        players: decorated
      });
    }
    const scoreChannel = conn.prepare("SELECT channel_id FROM score_channels WHERE guild_id = ?").get(guildId);
    return { boards: result, scoreChannelId: scoreChannel?.channel_id || null };
  }

  function grades(conn, guildId) {
    const guild = guildOf(guildId);
    const settingsRow = conn.prepare("SELECT grade_channel_id FROM settings WHERE guild_id = ?").get(guildId) || {};
    const gradeRoles = (actions.gradeRoles || DEFAULT_GRADE_ROLES).map(name => ({
      name,
      role: guild ? guild.roles.cache.find(role => role.name.toLowerCase() === name.toLowerCase()) || null : null
    }));
    const sub1 = (actions.sub1Roles || DEFAULT_SUB1_ROLES).map(name => ({
      name,
      role: guild ? guild.roles.cache.find(role => role.name.toLowerCase() === name.toLowerCase()) || null : null
    }));
    const sub2 = (actions.sub2Roles || DEFAULT_SUB2_ROLES).map(name => ({
      name,
      role: guild ? guild.roles.cache.find(role => role.name.toLowerCase() === name.toLowerCase()) || null : null
    }));
    return {
      gradeRoles: gradeRoles.map(entry => ({ name: entry.name, roleId: entry.role?.id || null })),
      sub1Roles: sub1.map(entry => ({ name: entry.name, roleId: entry.role?.id || null })),
      sub2Roles: sub2.map(entry => ({ name: entry.name, roleId: entry.role?.id || null })),
      missing: [...gradeRoles, ...sub1, ...sub2].filter(entry => !entry.role).map(entry => entry.name),
      guildLoaded: Boolean(guild),
      channelId: settingsRow.grade_channel_id || null,
      channelName: channelName(guildId, settingsRow.grade_channel_id)
    };
  }

  // ----------------------------------------------------------
  // Giveaways, tickets, community, roles
  // ----------------------------------------------------------

  async function giveaways(conn, guildId) {
    const rows = conn.prepare("SELECT * FROM giveaways WHERE guild_id = ? ORDER BY created_at DESC LIMIT 200").all(guildId);
    const result = [];
    for (const row of rows) {
      let winners = [];
      try {
        const parsed = JSON.parse(row.winner_ids_json || "null");
        winners = Array.isArray(parsed) ? parsed : [];
      } catch {
        winners = [];
      }
      const entries = conn
        .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(entry_weight), 0) AS weight FROM giveaway_entries WHERE giveaway_id = ?")
        .get(row.id);
      result.push({
        id: row.id,
        prize: row.prize,
        description: row.description,
        hostId: row.host_id,
        host: (await user(row.host_id))?.name || row.host_id,
        winnerCount: Number(row.winner_count),
        entries: Number(entries?.n || 0),
        totalWeight: Number(entries?.weight || 0),
        winners,
        status: row.status,
        channelId: row.channel_id,
        channelName: channelName(guildId, row.channel_id),
        endsAt: new Date(Number(row.ends_at)).toISOString(),
        createdAt: new Date(Number(row.created_at)).toISOString(),
        endedAt: row.ended_at ? new Date(Number(row.ended_at)).toISOString() : null,
        requiredRoleId: row.required_role_id || null,
        bonusRoleId: row.bonus_role_id || null,
        bonusEntries: row.bonus_entries ?? null,
        allowBots: Boolean(row.allow_bots)
      });
    }
    return { giveaways: result };
  }

  async function tickets(conn, guildId) {
    const settingsRow = conn.prepare("SELECT * FROM ticket_settings WHERE guild_id = ?").get(guildId) || null;
    let design = null;
    try {
      ensureDashboardTables(conn);
      design = conn.prepare("SELECT * FROM dashboard_ticket_panel WHERE guild_id = ?").get(guildId) || null;
    } catch {
      design = null;
    }
    const rows = conn.prepare("SELECT * FROM tickets WHERE guild_id = ? ORDER BY ticket_number DESC LIMIT 300").all(guildId);
    const list = [];
    for (const row of rows) {
      list.push({
        id: row.id,
        number: row.ticket_number,
        status: row.status,
        userId: row.user_id,
        user: (await user(row.user_id))?.name || row.user_id,
        claimedBy: row.claimed_by,
        channelId: row.channel_id,
        channelName: channelName(guildId, row.channel_id),
        createdAt: new Date(Number(row.created_at)).toISOString(),
        closedAt: row.closed_at ? new Date(Number(row.closed_at)).toISOString() : null
      });
    }
    return {
      settings: settingsRow
        ? {
            panelChannelId: settingsRow.panel_channel_id,
            panelChannelName: channelName(guildId, settingsRow.panel_channel_id),
            panelMessageId: settingsRow.panel_message_id,
            categoryId: settingsRow.category_id,
            categoryName: channelName(guildId, settingsRow.category_id),
            supportRoleId: settingsRow.support_role_id,
            supportRoleName: roleName(guildId, settingsRow.support_role_id),
            openLimit: Number(settingsRow.open_limit) || 1
          }
        : null,
      design: design
        ? {
            title: design.title,
            description: design.description,
            colour: Number(design.colour),
            footer: design.footer || "",
            updatedAt: new Date(Number(design.updated_at)).toISOString()
          }
        : {
            title: "🎫 Support Tickets",
            description: "Select the button below to create a private support ticket.",
            colour: 0x5865f2,
            footer: "",
            updatedAt: null
          },
      tickets: list,
      counts: {
        open: num(conn, "SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND status = 'open'", guildId),
        closed: num(conn, "SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND status = 'closed'", guildId)
      },
      limitations: [
        "The bot's ticket panel is a single “Create Ticket” button; dropdown categories and per-category forms are not part of the bot yet."
      ]
    };
  }

  async function community(conn, guildId) {
    const row = conn.prepare("SELECT * FROM community_settings WHERE guild_id = ?").get(guildId) || {};
    const settingsRow = conn.prepare("SELECT * FROM settings WHERE guild_id = ?").get(guildId) || {};
    const suggestions = conn
      .prepare("SELECT * FROM suggestions WHERE guild_id = ? ORDER BY created_at DESC LIMIT 50")
      .all(guildId)
      .map(entry => ({
        id: entry.id,
        content: entry.content,
        status: entry.status,
        userId: entry.user_id,
        createdAt: new Date(Number(entry.created_at)).toISOString()
      }));
    const polls = conn
      .prepare("SELECT * FROM polls WHERE guild_id = ? ORDER BY created_at DESC LIMIT 30")
      .all(guildId)
      .map(entry => {
        let options = [];
        try {
          options = JSON.parse(entry.options_json || "[]");
        } catch {
          options = [];
        }
        return {
          id: entry.id,
          question: entry.question,
          options,
          channelName: channelName(guildId, entry.channel_id),
          createdBy: entry.created_by,
          createdAt: new Date(Number(entry.created_at)).toISOString()
        };
      });
    const reminders = conn
      .prepare("SELECT * FROM reminders WHERE guild_id = ? AND delivered = 0 ORDER BY remind_at ASC LIMIT 50")
      .all(guildId)
      .map(entry => ({
        id: entry.id,
        message: entry.message,
        userId: entry.user_id,
        channelName: channelName(guildId, entry.channel_id),
        remindAt: new Date(Number(entry.remind_at)).toISOString()
      }));
    return {
      welcome: {
        channelId: row.welcome_channel_id || null,
        channelName: channelName(guildId, row.welcome_channel_id),
        message: row.welcome_message || ""
      },
      goodbye: {
        channelId: row.goodbye_channel_id || null,
        channelName: channelName(guildId, row.goodbye_channel_id),
        message: row.goodbye_message || ""
      },
      autoroleId: row.autorole_id || null,
      autoroleName: roleName(guildId, row.autorole_id),
      suggestionChannelId: row.suggestion_channel_id || null,
      suggestionChannelName: channelName(guildId, row.suggestion_channel_id),
      autoPing: {
        channelId: settingsRow.auto_ping_channel_id || null,
        channelName: channelName(guildId, settingsRow.auto_ping_channel_id),
        enabled: Boolean(settingsRow.auto_ping_enabled)
      },
      suggestions,
      polls,
      reminders
    };
  }

  async function roles(conn, guildId) {
    const row = conn.prepare("SELECT * FROM community_settings WHERE guild_id = ?").get(guildId) || {};
    const settingsRow = conn.prepare("SELECT * FROM settings WHERE guild_id = ?").get(guildId) || {};
    const panels = conn.prepare("SELECT * FROM reaction_role_panels WHERE guild_id = ? ORDER BY id DESC").all(guildId);
    const panelList = [];
    for (const panel of panels) {
      const panelRoles = conn
        .prepare("SELECT * FROM reaction_role_panel_roles WHERE panel_id = ? ORDER BY position")
        .all(panel.id)
        .map(entry => ({
          roleId: entry.role_id,
          roleName: roleName(guildId, entry.role_id),
          emoji: entry.emoji || null
        }));
      panelList.push({
        id: panel.id,
        title: panel.title,
        description: panel.description,
        channelName: channelName(guildId, panel.channel_id),
        messageId: panel.message_id,
        roles: panelRoles
      });
    }
    const reactionRoles = conn
      .prepare("SELECT * FROM reaction_roles WHERE guild_id = ? ORDER BY id DESC LIMIT 100")
      .all(guildId)
      .map(entry => ({
        id: entry.id,
        emoji: entry.emoji,
        roleId: entry.role_id,
        roleName: roleName(guildId, entry.role_id),
        messageId: entry.message_id,
        channelName: channelName(guildId, entry.channel_id)
      }));
    return {
      autoroleId: row.autorole_id || null,
      autoroleName: roleName(guildId, row.autorole_id),
      blacklistRoleId: settingsRow.blacklist_role_id || null,
      blacklistRoleName: roleName(guildId, settingsRow.blacklist_role_id),
      gradeChannelId: settingsRow.grade_channel_id || null,
      gradeChannelName: channelName(guildId, settingsRow.grade_channel_id),
      panels: panelList,
      reactionRoles
    };
  }

  // ----------------------------------------------------------
  // Permissions, configuration, backups, bot
  // ----------------------------------------------------------

  function permissions(conn, guildId) {
    const commandRoles = conn.prepare("SELECT * FROM command_roles WHERE guild_id = ?").all(guildId);
    const commandSettings = conn.prepare("SELECT * FROM command_settings WHERE guild_id = ?").all(guildId);
    const byCommand = new Map();
    for (const row of commandRoles) {
      if (!byCommand.has(row.command_name)) byCommand.set(row.command_name, []);
      byCommand.get(row.command_name).push({ id: row.role_id, name: roleName(guildId, row.role_id) });
    }
    const disabled = new Set(commandSettings.filter(row => !row.enabled).map(row => row.command_name));
    const commands = (actions.commands || []).map(name => ({
      name,
      enabled: !disabled.has(name),
      roles: byCommand.get(name) || []
    }));
    const audit = conn
      .prepare("SELECT * FROM permission_audit WHERE guild_id = ? ORDER BY created_at DESC LIMIT 40")
      .all(guildId)
      .map(row => ({
        id: row.id,
        command: row.command_name,
        roleId: row.role_id,
        roleName: roleName(guildId, row.role_id),
        actorId: row.actor_id,
        action: row.action,
        createdAt: new Date(Number(row.created_at)).toISOString()
      }));
    return { commands, audit };
  }

  function configuration(conn, guildId) {
    const row = conn.prepare("SELECT * FROM settings WHERE guild_id = ?").get(guildId) || {};
    const prefixRow = conn.prepare("SELECT prefixes_json FROM prefixes WHERE guild_id = ?").get(guildId);
    let prefixes = [];
    try {
      prefixes = JSON.parse(prefixRow?.prefixes_json || "[]");
    } catch {
      prefixes = [];
    }
    const honeypot = conn.prepare("SELECT channel_id FROM honeypot_settings WHERE guild_id = ?").get(guildId);
    return {
      prefix: prefixes[0] || "!",
      prefixOptions: ["!", ".", "?", "-", ">", ",", "+"],
      logChannelId: row.log_channel_id || null,
      logChannelName: channelName(guildId, row.log_channel_id),
      blacklistChannelId: row.blacklist_channel_id || null,
      blacklistRoleId: row.blacklist_role_id || null,
      appealLink: row.appeal_link || "",
      setupComplete: Boolean(row.setup_complete),
      honeypotChannelId: honeypot?.channel_id || null,
      blacklistAllowedChannels: conn
        .prepare("SELECT channel_id FROM blacklist_allowed_channels WHERE guild_id = ?")
        .all(guildId)
        .map(entry => entry.channel_id),
      antiNukeWhitelist: conn
        .prepare("SELECT user_id FROM anti_nuke_whitelist WHERE guild_id = ?")
        .all(guildId)
        .map(entry => entry.user_id)
    };
  }

  function backups(directory) {
    const dir = directory || path.join(process.cwd(), "backups");
    let files = [];
    try {
      files = fs
        .readdirSync(dir)
        .filter(name => name.endsWith(".db"))
        .map(name => {
          const stat = fs.statSync(path.join(dir, name));
          return { name, bytes: stat.size, createdAt: stat.mtime.toISOString() };
        })
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
        .slice(0, 50);
    } catch {
      files = [];
    }
    return { directory: dir, files };
  }

  function botInfo() {
    const identity = client?.user;
    return {
      online: Boolean(client),
      name: identity?.username || null,
      id: identity?.id || null,
      avatar: identity?.displayAvatarURL?.({ size: 128 }) || null,
      version: actions.version || null,
      uptimeMs: client?.uptime || 0,
      latencyMs: client && Number.isFinite(client.ws?.ping) ? Math.round(client.ws.ping) : null,
      guilds: client?.guilds?.cache?.size || 0,
      commands: (actions.commands || []).length,
      invite: identity
        ? `https://discord.com/oauth2/authorize?client_id=${identity.id}&scope=bot%20applications.commands&permissions=1100317060246`
        : null
    };
  }

  // ----------------------------------------------------------
  // Writes
  // ----------------------------------------------------------

  function updateSecurity(conn, guildId, body) {
    conn.prepare("INSERT INTO security_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING").run(guildId);
    if (Array.isArray(body.trustedRoleIds)) {
      const ids = idList(body.trustedRoleIds, { max: 50 }) || [];
      conn.prepare("UPDATE security_settings SET trusted_role_ids_json = ? WHERE guild_id = ?").run(JSON.stringify(ids), guildId);
    }
    if (Array.isArray(body.trustedChannelIds)) {
      const ids = idList(body.trustedChannelIds, { max: 50 }) || [];
      conn.prepare("UPDATE security_settings SET trusted_channel_ids_json = ? WHERE guild_id = ?").run(JSON.stringify(ids), guildId);
    }
    if (typeof body.accountAgeDays === "number") {
      const value = Math.min(90, Math.max(0, Math.round(body.accountAgeDays)));
      conn.prepare("UPDATE security_settings SET account_age_days = ? WHERE guild_id = ?").run(value, guildId);
    }
    return { ok: true };
  }

  function updateLogs(conn, guildId, body) {
    conn.prepare("INSERT INTO settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING").run(guildId);
    if (typeof body.channelId === "string") {
      const value = body.channelId.trim();
      if (value && !ID_PATTERN.test(value)) fail(400, "Log channel must be a numeric channel ID (or empty).");
      conn.prepare("UPDATE settings SET log_channel_id = ? WHERE guild_id = ?").run(value || null, guildId);
    }
    if (Array.isArray(body.events)) {
      const allowed = new Set(logOptions().map(option => option.value));
      const selected = [...new Set(body.events.filter(value => allowed.has(value)))];
      conn.prepare("UPDATE settings SET log_events_json = ? WHERE guild_id = ?").run(JSON.stringify(selected), guildId);
    }
    return { ok: true };
  }

  function updateCommunity(conn, guildId, body) {
    const fields = [
      ["welcomeChannelId", "welcome_channel_id"],
      ["welcomeMessage", "welcome_message"],
      ["goodbyeChannelId", "goodbye_channel_id"],
      ["goodbyeMessage", "goodbye_message"],
      ["autoroleId", "autorole_id"],
      ["suggestionChannelId", "suggestion_channel_id"]
    ];
    conn.prepare("INSERT INTO community_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING").run(guildId);
    for (const [key, column] of fields) {
      if (!(key in body)) continue;
      const raw = body[key];
      const value = typeof raw === "string" ? raw.trim() : "";
      if (key.endsWith("Id") || key.endsWith("ChannelId")) {
        if (value && !ID_PATTERN.test(value)) fail(400, `${key} must be a numeric Discord ID (or empty).`);
      }
      conn.prepare(`UPDATE community_settings SET ${column} = ? WHERE guild_id = ?`).run(value || null, guildId);
    }
    return { ok: true };
  }

  function updateConfiguration(conn, guildId, body) {
    conn.prepare("INSERT INTO settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING").run(guildId);
    if (typeof body.prefix === "string") {
      const allowed = ["!", ".", "?", "-", ">", ",", "+"];
      if (!allowed.includes(body.prefix)) fail(400, `Prefix must be one of ${allowed.join(" ")}`);
      conn
        .prepare("INSERT INTO prefixes (guild_id, prefixes_json) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET prefixes_json = excluded.prefixes_json")
        .run(guildId, JSON.stringify([body.prefix]));
    }
    if (typeof body.logChannelId === "string") {
      const value = body.logChannelId.trim();
      if (value && !ID_PATTERN.test(value)) fail(400, "Log channel must be a numeric channel ID (or empty).");
      conn.prepare("UPDATE settings SET log_channel_id = ? WHERE guild_id = ?").run(value || null, guildId);
    }
    if (typeof body.appealLink === "string") {
      const value = body.appealLink.trim();
      if (value && !/^https?:\/\//i.test(value)) fail(400, "Appeal link must start with http:// or https://");
      conn.prepare("UPDATE settings SET appeal_link = ? WHERE guild_id = ?").run(value || null, guildId);
    }
    if (typeof body.blacklistChannelId === "string") {
      const value = body.blacklistChannelId.trim();
      if (value && !ID_PATTERN.test(value)) fail(400, "Blacklist channel must be a numeric channel ID (or empty).");
      conn.prepare("UPDATE settings SET blacklist_channel_id = ? WHERE guild_id = ?").run(value || null, guildId);
    }
    if (typeof body.honeypotChannelId === "string") {
      const value = body.honeypotChannelId.trim();
      if (value && !ID_PATTERN.test(value)) fail(400, "Honeypot channel must be a numeric channel ID (or empty).");
      if (value) {
        conn
          .prepare("INSERT INTO honeypot_settings (guild_id, channel_id) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id")
          .run(guildId, value);
      } else {
        conn.prepare("DELETE FROM honeypot_settings WHERE guild_id = ?").run(guildId);
      }
    }
    if (Array.isArray(body.antiNukeWhitelist)) {
      const ids = idList(body.antiNukeWhitelist, { max: 100 }) || [];
      conn.prepare("DELETE FROM anti_nuke_whitelist WHERE guild_id = ?").run(guildId);
      const insert = conn.prepare("INSERT OR IGNORE INTO anti_nuke_whitelist (guild_id, user_id) VALUES (?, ?)");
      for (const id of ids) insert.run(guildId, id);
    }
    if (Array.isArray(body.blacklistAllowedChannels)) {
      const ids = idList(body.blacklistAllowedChannels, { max: 100 }) || [];
      conn.prepare("DELETE FROM blacklist_allowed_channels WHERE guild_id = ?").run(guildId);
      const insert = conn.prepare("INSERT OR IGNORE INTO blacklist_allowed_channels (guild_id, channel_id) VALUES (?, ?)");
      for (const id of ids) insert.run(guildId, id);
    }
    return { ok: true };
  }

  function updateCommandPermission(conn, guildId, body, actorId) {
    const command = text(body.command, 64).trim();
    if (!command || !/^[a-z0-9-]+$/.test(command)) fail(400, "Invalid command name.");
    if (Array.isArray(actions.commands) && !actions.commands.includes(command)) {
      fail(400, `Unknown command "${command}".`);
    }
    const timestamp = Date.now();
    if (typeof body.enabled === "boolean") {
      conn
        .prepare(
          "INSERT INTO command_settings (guild_id, command_name, enabled) VALUES (?, ?, ?) ON CONFLICT(guild_id, command_name) DO UPDATE SET enabled = excluded.enabled"
        )
        .run(guildId, command, body.enabled ? 1 : 0);
    }
    if (Array.isArray(body.roleIds)) {
      const ids = idList(body.roleIds, { max: 25 }) || [];
      conn.prepare("DELETE FROM command_roles WHERE guild_id = ? AND command_name = ?").run(guildId, command);
      const insert = conn.prepare("INSERT OR IGNORE INTO command_roles (guild_id, command_name, role_id) VALUES (?, ?, ?)");
      for (const roleId of ids) insert.run(guildId, command, roleId);
      conn
        .prepare(
          "INSERT INTO permission_audit (guild_id, command_name, role_id, actor_id, action, created_at) VALUES (?, ?, ?, ?, 'replace', ?)"
        )
        .run(guildId, command, ids[0] || null, actorId || "dashboard", timestamp);
    }
    return { ok: true };
  }

  async function publishTicketPanel(conn, guildId, body, actorId) {
    const discord = require("discord.js");
    const bot = requireBot();
    const guild = guildOf(guildId);
    if (!guild) fail(503, "The bot is not in this server right now.");
    const title = text(body.title, 256).trim();
    const description = text(body.description, 4000).trim();
    if (!title || !description) fail(400, "Panel title and description are required.");
    const colour = Number.isInteger(body.colour) ? body.colour : 0x5865f2;
    const footer = text(body.footer, 2048).trim();

    conn.prepare("INSERT INTO settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING").run(guildId);
    const current = conn.prepare("SELECT * FROM ticket_settings WHERE guild_id = ?").get(guildId);
    const channelId = text(body.panelChannelId, 32).trim() || current?.panel_channel_id;
    if (!channelId || !ID_PATTERN.test(channelId)) fail(400, "Choose a panel channel first.");
    const categoryId = text(body.categoryId, 32).trim() || current?.category_id || null;
    const supportRoleId = text(body.supportRoleId, 32).trim() || current?.support_role_id || null;
    const openLimit = Math.min(10, Math.max(1, Math.round(Number(body.openLimit) || current?.open_limit || 1)));

    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel?.isTextBased()) fail(400, "That panel channel is not a text channel the bot can post in.");

    const embed = new discord.EmbedBuilder().setTitle(title).setDescription(description).setColor(colour);
    if (footer) embed.setFooter({ text: footer });
    const row = new discord.ActionRowBuilder().addComponents(
      new discord.ButtonBuilder().setCustomId("ticket_create").setLabel("Create Ticket").setStyle(discord.ButtonStyle.Primary)
    );

    let message = null;
    if (current?.panel_message_id) {
      const existing = await channel.messages.fetch(current.panel_message_id).catch(() => null);
      if (existing) message = await existing.edit({ embeds: [embed], components: [row] }).catch(() => null);
    }
    if (!message) {
      message = await channel.send({ embeds: [embed], components: [row] }).catch(error => {
        throw new ApiError(400, `Discord rejected the panel: ${error.message}`);
      });
    }

    conn
      .prepare(
        `INSERT INTO ticket_settings (guild_id, panel_channel_id, panel_message_id, category_id, support_role_id, open_limit)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           panel_channel_id = excluded.panel_channel_id,
           panel_message_id = excluded.panel_message_id,
           category_id = excluded.category_id,
           support_role_id = excluded.support_role_id,
           open_limit = excluded.open_limit`
      )
      .run(guildId, channelId, message.id, categoryId, supportRoleId, openLimit);

    ensureDashboardTables(conn);
    conn
      .prepare(
        `INSERT INTO dashboard_ticket_panel (guild_id, title, description, colour, footer, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           title = excluded.title, description = excluded.description, colour = excluded.colour,
           footer = excluded.footer, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      )
      .run(guildId, title, description, colour, footer || null, actorId || "dashboard", Date.now());

    return { ok: true, messageId: message.id, channelId };
  }

  function updateTicketSettings(conn, guildId, body) {
    conn.prepare("INSERT INTO ticket_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING").run(guildId);
    if (typeof body.categoryId === "string") {
      const value = body.categoryId.trim();
      if (value && !ID_PATTERN.test(value)) fail(400, "Category must be a numeric channel/category ID.");
      conn.prepare("UPDATE ticket_settings SET category_id = ? WHERE guild_id = ?").run(value || null, guildId);
    }
    if (typeof body.supportRoleId === "string") {
      const value = body.supportRoleId.trim();
      if (value && !ID_PATTERN.test(value)) fail(400, "Support role must be a numeric role ID.");
      conn.prepare("UPDATE ticket_settings SET support_role_id = ? WHERE guild_id = ?").run(value || null, guildId);
    }
    if (body.openLimit !== undefined) {
      const value = Math.min(10, Math.max(1, Math.round(Number(body.openLimit) || 1)));
      conn.prepare("UPDATE ticket_settings SET open_limit = ? WHERE guild_id = ?").run(value, guildId);
    }
    return { ok: true };
  }

  // --- Leaderboards ---------------------------------------------------

  async function createLeaderboard(conn, guildId, body, actorId) {
    requireBot();
    const guild = guildOf(guildId);
    if (!guild) fail(503, "The bot is not in this server right now.");
    const name = text(body.name, 60).trim();
    if (!name) fail(400, "Leaderboard name is required.");
    const channelId = text(body.channelId, 32).trim();
    if (!ID_PATTERN.test(channelId)) fail(400, "Choose the channel that should hold the leaderboard.");
    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel?.isTextBased()) fail(400, "That leaderboard channel is not a text channel.");
    const existing = conn.prepare("SELECT id FROM leaderboards WHERE guild_id = ? AND name = ? COLLATE NOCASE").get(guildId, name);
    if (existing) fail(400, `A leaderboard named "${name}" already exists.`);
    const webhook = await channel
      .createWebhook({ name: `${name} Leaderboard Bot`, reason: "Sentinel dashboard" })
      .catch(error => {
        throw new ApiError(400, `Discord rejected the webhook: ${error.message}`);
      });
    const inserted = conn
      .prepare(
        "INSERT INTO leaderboards (guild_id, name, channel_id, webhook_id, webhook_token, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(guildId, name, channelId, webhook.id, webhook.token, actorId || "dashboard", Date.now());
    const board = conn.prepare("SELECT * FROM leaderboards WHERE id = ?").get(inserted.lastInsertRowid);
    if (board && actions.publishLeaderboard) await actions.publishLeaderboard(board, guild).catch(() => null);
    return { ok: true, id: Number(inserted.lastInsertRowid) };
  }

  async function updateLeaderboard(conn, guildId, boardId, body) {
    const connRef = conn;
    const board = conn.prepare("SELECT * FROM leaderboards WHERE id = ? AND guild_id = ?").get(boardId, guildId);
    if (!board) fail(404, "Leaderboard not found.");
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) fail(400, "Leaderboard name cannot be empty.");
      connRef.prepare("UPDATE leaderboards SET name = ? WHERE id = ?").run(name, boardId);
    }
    const guild = guildOf(guildId);
    if (body.publish !== false && actions.publishLeaderboard && guild) {
      const updated = connRef.prepare("SELECT * FROM leaderboards WHERE id = ?").get(boardId);
      await actions.publishLeaderboard(updated, guild).catch(() => null);
    }
    return { ok: true };
  }

  async function deleteLeaderboard(conn, guildId, boardId) {
    const board = conn.prepare("SELECT * FROM leaderboards WHERE id = ? AND guild_id = ?").get(boardId, guildId);
    if (!board) fail(404, "Leaderboard not found.");
    if (client && board.webhook_id && board.webhook_token) {
      try {
        const { WebhookClient } = require("discord.js");
        const webhook = new WebhookClient({ id: board.webhook_id, token: board.webhook_token });
        if (board.message_id) await webhook.deleteMessage(board.message_id).catch(() => null);
        await webhook.delete().catch(() => null);
      } catch {
        /* webhook already gone */
      }
    }
    conn.prepare("DELETE FROM leaderboard_scores WHERE leaderboard_id = ?").run(boardId);
    conn.prepare("DELETE FROM leaderboards WHERE id = ?").run(boardId);
    return { ok: true };
  }

  function assertPlayerInput(body) {
    return {
      robloxUsername: text(body.robloxUsername, 64).trim(),
      country: text(body.country, 64).trim(),
      stage: text(body.stage, 64).trim(),
      avatarUrl: text(body.avatarUrl, 512).trim()
    };
  }

  async function addPlayer(conn, guildId, boardId, body) {
    const board = conn.prepare("SELECT * FROM leaderboards WHERE id = ? AND guild_id = ?").get(boardId, guildId);
    if (!board) fail(404, "Leaderboard not found.");
    const userId = text(body.userId, 32).trim();
    if (!ID_PATTERN.test(userId)) fail(400, "Enter a valid Discord user ID.");
    const spot = Math.min(10, Math.max(1, Math.round(Number(body.spot) || 1)));
    const fields = assertPlayerInput(body);
    if (fields.avatarUrl && !/^https?:\/\//i.test(fields.avatarUrl)) fail(400, "Avatar URL must start with http(s)://");
    const existing = conn.prepare("SELECT 1 FROM leaderboard_scores WHERE leaderboard_id = ? AND user_id = ?").get(boardId, userId);
    if (existing) fail(400, "That member is already on this leaderboard.");
    const occupant = conn.prepare("SELECT user_id FROM leaderboard_scores WHERE leaderboard_id = ? AND spot = ?").get(boardId, spot);
    if (occupant) fail(409, `Spot ${spot} is already taken. Use “switch spots” after adding, or pick another spot.`);
    conn
      .prepare(
        `INSERT INTO leaderboard_scores (leaderboard_id, user_id, score, spot, roblox_username, country, stage, avatar_url, updated_at)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)`
      )
      .run(boardId, userId, spot, fields.robloxUsername, fields.country, fields.stage, fields.avatarUrl || null, Date.now());
    await republish(guildId, boardId);
    return { ok: true };
  }

  async function updatePlayer(conn, guildId, boardId, userId, body) {
    const board = conn.prepare("SELECT * FROM leaderboards WHERE id = ? AND guild_id = ?").get(boardId, guildId);
    if (!board) fail(404, "Leaderboard not found.");
    const player = conn.prepare("SELECT * FROM leaderboard_scores WHERE leaderboard_id = ? AND user_id = ?").get(boardId, userId);
    if (!player) fail(404, "That member is not on this leaderboard.");
    if (body.swapWith && typeof body.swapWith === "string" && ID_PATTERN.test(body.swapWith)) {
      if (!actions.swapLeaderboardSpots) fail(503, "Spot switching needs the bot's leaderboard handler.", "bot_offline");
      actions.swapLeaderboardSpots(boardId, userId, body.swapWith);
    } else if (body.spot !== undefined) {
      const spot = Math.min(10, Math.max(1, Math.round(Number(body.spot) || player.spot)));
      if (!actions.assignLeaderboardSpot) fail(503, "Spot changes need the bot's leaderboard handler.", "bot_offline");
      actions.assignLeaderboardSpot(boardId, userId, spot);
    }
    const fields = assertPlayerInput({
      robloxUsername: body.robloxUsername ?? player.roblox_username,
      country: body.country ?? player.country,
      stage: body.stage ?? player.stage,
      avatarUrl: body.avatarUrl ?? player.avatar_url
    });
    if (fields.avatarUrl && !/^https?:\/\//i.test(fields.avatarUrl)) fail(400, "Avatar URL must start with http(s)://");
    // eslint-disable-next-line no-unused-expressions
    conn
      .prepare(
        "UPDATE leaderboard_scores SET roblox_username = ?, country = ?, stage = ?, avatar_url = ?, updated_at = ? WHERE leaderboard_id = ? AND user_id = ?"
      )
      .run(fields.robloxUsername, fields.country, fields.stage, fields.avatarUrl || null, Date.now(), boardId, userId);
    await republish(guildId, boardId);
    return { ok: true };
  }

  async function removePlayer(conn, guildId, boardId, userId) {
    const board = conn.prepare("SELECT * FROM leaderboards WHERE id = ? AND guild_id = ?").get(boardId, guildId);
    if (!board) fail(404, "Leaderboard not found.");
    const result = conn
      .prepare("DELETE FROM leaderboard_scores WHERE leaderboard_id = ? AND user_id = ?")
      .run(boardId, userId);
    if (!result.changes) fail(404, "That member is not on this leaderboard.");
    await republish(guildId, boardId);
    return { ok: true };
  }

  async function setPlayerScore(conn, guildId, boardId, body) {
    const board = conn.prepare("SELECT * FROM leaderboards WHERE id = ? AND guild_id = ?").get(boardId, guildId);
    if (!board) fail(404, "Leaderboard not found.");
    const userId = text(body.userId, 32).trim();
    if (!ID_PATTERN.test(userId)) fail(400, "Enter a valid Discord user ID.");
    const score = Math.max(0, Math.round(Number(body.score)));
    if (!Number.isFinite(score)) fail(400, "Score must be a number.");
    const existing = conn.prepare("SELECT 1 FROM leaderboard_scores WHERE leaderboard_id = ? AND user_id = ?").get(boardId, userId);
    if (!existing) fail(404, "Add that member to the leaderboard first.");
    conn.prepare("UPDATE leaderboard_scores SET score = ?, updated_at = ? WHERE leaderboard_id = ? AND user_id = ?").run(score, Date.now(), boardId, userId);
    await republish(guildId, boardId);
    return { ok: true, score };
  }

  async function setScoreChannel(conn, guildId, body) {
    requireBot();
    const guild = guildOf(guildId);
    if (!guild) fail(503, "The bot is not in this server right now.");
    const channelId = text(body.channelId, 32).trim();
    if (!ID_PATTERN.test(channelId)) fail(400, "Choose the score announcement channel.");
    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel?.isTextBased()) fail(400, "That channel is not a text channel.");
    const existing = conn.prepare("SELECT * FROM score_channels WHERE guild_id = ?").get(guildId);
    let webhookId = existing?.webhook_id;
    let webhookToken = existing?.webhook_token;
    if (!webhookId || !webhookToken) {
      const webhook = await channel.createWebhook({ name: "Sentinel Scores", reason: "Sentinel dashboard" }).catch(error => {
        throw new ApiError(400, `Discord rejected the webhook: ${error.message}`);
      });
      webhookId = webhook.id;
      webhookToken = webhook.token;
    }
    conn
      .prepare(
        `INSERT INTO score_channels (guild_id, channel_id, webhook_id, webhook_token) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id,
           webhook_id = excluded.webhook_id, webhook_token = excluded.webhook_token`
      )
      .run(guildId, channelId, webhookId, webhookToken);
    return { ok: true };
  }

  async function republish(guildId, boardId) {
    if (!actions.publishLeaderboard) return;
    const guild = guildOf(guildId);
    if (!guild) return;
    const board = context.getDb ? context.getDb().prepare("SELECT * FROM leaderboards WHERE id = ?").get(boardId) : null;
    if (!board) return;
    await actions.publishLeaderboard(board, guild).catch(() => null);
  }

  // --- Grades ---------------------------------------------------------

  async function assignGrade(guildId, body, actorId) {
    requireBot();
    const guild = guildOf(guildId);
    if (!guild) fail(503, "The bot is not in this server right now.");
    const userId = text(body.userId, 32).trim();
    if (!ID_PATTERN.test(userId)) fail(400, "Enter a valid Discord user ID.");
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) fail(404, "That member is not in the server.");
    const moderator = await guild.members.fetch(actorId).catch(() => null);
    if (!moderator) fail(403, "Only members of this server can assign grades from the dashboard.");
    const resolve = (name, list) => {
      if (!name) return null;
      if (actions.findGradeRole) return actions.findGradeRole(guild, name, list);
      return guild.roles.cache.find(role => role.name.toLowerCase() === String(name).toLowerCase()) || null;
    };
    const gradeRole = resolve(text(body.grade, 40), actions.gradeRoles || DEFAULT_GRADE_ROLES);
    const sub1Role = resolve(text(body.sub1, 40), actions.sub1Roles || DEFAULT_SUB1_ROLES);
    const sub2Role = resolve(text(body.sub2, 40), actions.sub2Roles || DEFAULT_SUB2_ROLES);
    if (!gradeRole || !sub1Role || !sub2Role) {
      fail(400, "That grade combination does not match roles in this server. Check the grade setup list.");
    }
    if (!actions.doGradeUpdate) fail(503, "Grade assignment needs the bot's grade handler.", "bot_offline");
    const result = await actions.doGradeUpdate(guild, moderator, member, gradeRole, sub1Role, sub2Role);
    if (result?.error) fail(400, result.error);
    return { ok: true };
  }

  // --- Giveaways ------------------------------------------------------

  async function giveawayAction(conn, guildId, giveawayId, action) {
    requireBot();
    const guild = guildOf(guildId);
    if (!guild) fail(503, "The bot is not in this server right now.");
    const row = conn.prepare("SELECT * FROM giveaways WHERE id = ? AND guild_id = ?").get(giveawayId, guildId);
    if (!row) fail(404, "Giveaway not found.");
    const handler =
      action === "end" ? actions.endGiveaway : action === "reroll" ? actions.rerollGiveaway : actions.cancelGiveaway;
    if (!handler) fail(503, `Giveaway ${action} needs the bot's giveaway handler.`, "bot_offline");
    const result = action === "end" ? await handler(guildId, giveawayId, { manual: true }) : await handler(guildId, giveawayId);
    if (result?.error) fail(400, result.error);
    return { ok: true, winnerIds: result?.winnerIds || null, warning: result?.warning || null };
  }

  function updateGiveaway(conn, guildId, giveawayId, body) {
    const row = conn.prepare("SELECT * FROM giveaways WHERE id = ? AND guild_id = ?").get(giveawayId, guildId);
    if (!row) fail(404, "Giveaway not found.");
    if (row.status !== "active") fail(400, "Only an active giveaway can be edited here.");
    if (typeof body.prize === "string") {
      const prize = body.prize.trim();
      if (!prize) fail(400, "Prize cannot be empty.");
      conn.prepare("UPDATE giveaways SET prize = ? WHERE id = ?").run(prize.slice(0, 200), giveawayId);
    }
    if (body.winnerCount !== undefined) {
      const count = Math.min(20, Math.max(1, Math.round(Number(body.winnerCount) || 1)));
      conn.prepare("UPDATE giveaways SET winner_count = ? WHERE id = ?").run(count, giveawayId);
    }
    return { ok: true };
  }

  // --- Member actions -------------------------------------------------

  async function memberModeration(guildId, userId, action, body, actorId) {
    requireBot();
    const guild = guildOf(guildId);
    if (!guild) fail(503, "The bot is not in this server right now.");
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) fail(404, "That member is not in the server.");
    const moderator = await guild.members.fetch(actorId).catch(() => null);
    if (!moderator) fail(403, "Only members of this server can moderate from the dashboard.");
    const reason = text(body.reason, 500).trim() || `No reason provided (dashboard by ${actorId})`;
    if (action === "kick") {
      await member.kick(reason).catch(error => fail(400, `Discord rejected the kick: ${error.message}`));
      actions.addModLog?.(guildId, "kick", userId, actorId, reason, null, { channelId: null });
    } else if (action === "ban") {
      await guild.members.ban(userId, { reason }).catch(error => fail(400, `Discord rejected the ban: ${error.message}`));
      actions.addModLog?.(guildId, "ban", userId, actorId, reason, null, { channelId: null });
    } else if (action === "unban") {
      await guild.members.unban(userId, reason).catch(error => fail(400, `Discord rejected the unban: ${error.message}`));
      actions.addModLog?.(guildId, "unban", userId, actorId, reason, null, { channelId: null });
    } else {
      fail(400, "Unknown member action.");
    }
    return { ok: true };
  }

  // --- Backups --------------------------------------------------------

  async function createBackup(conn, directory) {
    const dir = directory || path.join(process.cwd(), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(dir, `sentinel-${stamp}.db`);
    await conn.backup(target);
    const stat = fs.statSync(target);
    return { ok: true, file: path.basename(target), bytes: stat.size, createdAt: stat.mtime.toISOString() };
  }

  return {
    overviewStats,
    activity,
    blacklist,
    memberDetail,
    members,
    security,
    logs,
    leaderboards,
    grades,
    giveaways,
    tickets,
    community,
    roles,
    permissions,
    configuration,
    backups,
    botInfo,
    updateSecurity,
    updateLogs,
    updateCommunity,
    updateConfiguration,
    updateCommandPermission,
    publishTicketPanel,
    updateTicketSettings,
    createLeaderboard,
    updateLeaderboard,
    deleteLeaderboard,
    addPlayer,
    updatePlayer,
    removePlayer,
    setPlayerScore,
    setScoreChannel,
    assignGrade,
    giveawayAction,
    updateGiveaway,
    memberModeration,
    createBackup
  };
}

module.exports = { createSections, SectionError };
