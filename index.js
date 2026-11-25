// ============================================================
// JJS MODERATION / TRYOUT BOT
// discord.js v14 + better-sqlite3
// ============================================================

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  WebhookClient,
  SlashCommandBuilder,
  PermissionFlagsBits,
  AuditLogEvent,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const { randomUUID } = require("node:crypto");
const Database = require("better-sqlite3");
const BOT_VERSION = require("./package.json").version;
const { drawAndRecordGiveawayWinners, migrateGiveawayWinnerHistory } = require("./giveaway-winners");
const { startDashboardApi } = require("./dashboard-api");
const envFile = process.env.BOT_ENV_FILE || process.argv[2] || ".env";
require("dotenv").config({ path: envFile });

// ============================================================
// ENV
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DUPLICATE_COMMAND_CLEANUP_GUILD_ID =
  process.env.GUILD_COMMAND_REGISTRATION_ID ||
  process.env.GUILD_ID ||
  "1513982022400344244";
const COMMAND_REGISTRATION_MODE = String(process.env.COMMAND_REGISTRATION_MODE || "global").toLowerCase();

if (!TOKEN || TOKEN.includes("your_")) {
  console.error("❌ DISCORD_TOKEN is missing or still using a placeholder value.");
  process.exit(1);
}

if (!CLIENT_ID || CLIENT_ID === "your_discord_application_client_id_here") {
  console.error("❌ CLIENT_ID is missing. Add your Discord application/client ID to .env.");
  process.exit(1);
}

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ],
  partials: [
    Partials.GuildMember,
    Partials.User,
    Partials.Message
  ]
});

const reactionRoleSetupSessions = new Map();

function getBotIdentity() {
  if (!client.isReady() || !client.user) {
    return { username: "the bot", id: null, avatarURL: null, version: BOT_VERSION };
  }
  return {
    username: client.user.username,
    id: client.user.id,
    avatarURL: client.user.displayAvatarURL(),
    version: BOT_VERSION
  };
}

function brandEmbed(embed) {
  const identity = getBotIdentity();
  const author = { name: identity.username };
  if (identity.avatarURL) author.iconURL = identity.avatarURL;
  embed.setAuthor(author);
  embed.setFooter({ text: `${identity.username} • v${identity.version}` });
  return embed;
}

client.on("error", error => {
  if (error && (error.code === 10062 || error.message === "Unknown interaction")) {
    console.warn("⚠️ Ignored stale Discord interaction.");
    return;
  }

  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  if (error && (error.code === 10062 || error.message === "Unknown interaction")) {
    console.warn("⚠️ Ignored stale Discord interaction rejection.");
    return;
  }

  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

// ============================================================
// DATABASE
// ============================================================

const liveDbPath = process.env.DATABASE_PATH || "jjsbot.db";
const pendingRestorePath = `${liveDbPath}.restore.pending`;
const pendingRestoreBackupPath = `${liveDbPath}.pre-restore-${Date.now()}.bak`;
if (require("node:fs").existsSync(pendingRestorePath)) {
  require("node:fs").copyFileSync(liveDbPath, pendingRestoreBackupPath);
  require("node:fs").renameSync(pendingRestorePath, liveDbPath);
  console.log(`✅ Restored SQLite database after restart; previous database saved as ${pendingRestoreBackupPath}`);
}
const db = new Database(liveDbPath);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT PRIMARY KEY,
  blacklist_channel_id TEXT,
  unblacklist_channel_id TEXT,
  blacklist_role_id TEXT,
  log_channel_id TEXT,
  log_events_json TEXT,
  server_log_channel_id TEXT,
  server_logs_enabled INTEGER DEFAULT 0,
  nuke_alert_channel_id TEXT,
  raid_alert_channel_id TEXT,
  auto_ping_channel_id TEXT,
  auto_ping_enabled INTEGER DEFAULT 0,
  grade_channel_id TEXT,
  appeal_link TEXT,
  setup_complete INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS blacklist_allowed_channels (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, channel_id)
);

CREATE TABLE IF NOT EXISTS prefixes (
  guild_id TEXT PRIMARY KEY,
  prefixes_json TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS command_roles (
  guild_id TEXT NOT NULL,
  command_name TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, command_name, role_id)
);

CREATE TABLE IF NOT EXISTS warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_strikes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blacklist_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_number INTEGER,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  category TEXT NOT NULL,
  reason TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  roles_count INTEGER NOT NULL,
  active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  action TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS anti_nuke_whitelist (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS honeypot_settings (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leaderboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  channel_id TEXT NOT NULL,
  webhook_id TEXT NOT NULL,
  webhook_token TEXT NOT NULL,
  message_id TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (guild_id, name)
);

CREATE TABLE IF NOT EXISTS leaderboard_scores (
  leaderboard_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0),
  spot INTEGER NOT NULL DEFAULT 0,
  roblox_username TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (leaderboard_id, user_id),
  FOREIGN KEY (leaderboard_id) REFERENCES leaderboards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS score_channels (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  webhook_id TEXT NOT NULL,
  webhook_token TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  host_id TEXT NOT NULL,
  prize TEXT NOT NULL,
  description TEXT,
  winner_count INTEGER NOT NULL CHECK (winner_count > 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ending', 'ended', 'cancelled')),
  ending_token TEXT,
  ending_started_at INTEGER,
  bonus_role_id TEXT,
  bonus_entries INTEGER,
  required_role_id TEXT,
  allow_bots INTEGER NOT NULL DEFAULT 0 CHECK (allow_bots IN (0, 1)),
  winner_ids_json TEXT NOT NULL DEFAULT 'null',
  announcement_message_id TEXT,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_giveaways_active
  ON giveaways (guild_id, status, ends_at);

CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  entry_weight INTEGER NOT NULL DEFAULT 1 CHECK (entry_weight >= 1),
  entered_at INTEGER NOT NULL,
  PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS giveaway_winner_history (
  giveaway_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  won_at INTEGER NOT NULL,
  PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS ticket_settings (
  guild_id TEXT PRIMARY KEY,
  panel_channel_id TEXT,
  panel_message_id TEXT,
  category_id TEXT,
  support_role_id TEXT,
  open_limit INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  claimed_by TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  ticket_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  UNIQUE (guild_id, ticket_number)
);

CREATE TABLE IF NOT EXISTS security_settings (
  guild_id TEXT PRIMARY KEY,
  antispam INTEGER NOT NULL DEFAULT 0,
  antiraid INTEGER NOT NULL DEFAULT 0,
  antilink INTEGER NOT NULL DEFAULT 0,
  antimention INTEGER NOT NULL DEFAULT 0,
  antibot INTEGER NOT NULL DEFAULT 0,
  raidmode INTEGER NOT NULL DEFAULT 0,
  account_age_days INTEGER NOT NULL DEFAULT 0,
  spam_limit INTEGER NOT NULL DEFAULT 5,
  mention_limit INTEGER NOT NULL DEFAULT 5,
  trusted_role_ids_json TEXT NOT NULL DEFAULT '[]',
  trusted_channel_ids_json TEXT NOT NULL DEFAULT '[]',
  action TEXT NOT NULL DEFAULT 'warn',
  lockdown INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT,
  type TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS community_settings (
  guild_id TEXT PRIMARY KEY,
  welcome_channel_id TEXT,
  welcome_message TEXT,
  goodbye_channel_id TEXT,
  goodbye_message TEXT,
  autorole_id TEXT,
  suggestion_channel_id TEXT
);

CREATE TABLE IF NOT EXISTS reaction_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  role_id TEXT NOT NULL,
  UNIQUE (guild_id, message_id, emoji)
);

CREATE TABLE IF NOT EXISTS reaction_role_panels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reaction_role_panel_roles (
  panel_id INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  emoji TEXT,
  position INTEGER NOT NULL,
  PRIMARY KEY (panel_id, role_id)
);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_id TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  user_id TEXT NOT NULL,
  channel_id TEXT,
  message TEXT NOT NULL,
  remind_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS command_settings (
  guild_id TEXT NOT NULL,
  command_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (guild_id, command_name)
);

CREATE TABLE IF NOT EXISTS permission_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  command_name TEXT NOT NULL,
  role_id TEXT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('replace','clear','add','remove')),
  created_at INTEGER NOT NULL
);
`);

migrateGiveawayWinnerHistory(db);

const giveawayColumns = new Set(db.prepare("PRAGMA table_info(giveaways)").all().map(column => column.name));
if (!giveawayColumns.has("required_role_id")) {
  db.exec("ALTER TABLE giveaways ADD COLUMN required_role_id TEXT");
}

const leaderboardScoreColumns = new Set(
  db.prepare("PRAGMA table_info(leaderboard_scores)").all().map(column => column.name)
);
if (!leaderboardScoreColumns.has("spot")) {
  db.exec("ALTER TABLE leaderboard_scores ADD COLUMN spot INTEGER");
}
const invalidLeaderboardSpot = db.prepare(`
  SELECT 1
  FROM leaderboard_scores
  WHERE spot IS NULL OR spot < 1
  LIMIT 1
`).get();
if (invalidLeaderboardSpot) {
  db.exec(`
    WITH ranked AS (
      SELECT
        leaderboard_id,
        user_id,
        ROW_NUMBER() OVER (
          PARTITION BY leaderboard_id
          ORDER BY score DESC, user_id ASC
        ) AS position
      FROM leaderboard_scores
    )
    UPDATE leaderboard_scores
    SET spot = (
      SELECT position
      FROM ranked
      WHERE ranked.leaderboard_id = leaderboard_scores.leaderboard_id
        AND ranked.user_id = leaderboard_scores.user_id
    )
  `);
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_scores_spot ON leaderboard_scores (leaderboard_id, spot)");
if (!leaderboardScoreColumns.has("roblox_username")) {
  db.exec("ALTER TABLE leaderboard_scores ADD COLUMN roblox_username TEXT NOT NULL DEFAULT ''");
}
if (!leaderboardScoreColumns.has("country")) {
  db.exec("ALTER TABLE leaderboard_scores ADD COLUMN country TEXT NOT NULL DEFAULT ''");
}
if (!leaderboardScoreColumns.has("stage")) {
  db.exec("ALTER TABLE leaderboard_scores ADD COLUMN stage TEXT NOT NULL DEFAULT ''");
}
if (!leaderboardScoreColumns.has("avatar_url")) {
  db.exec("ALTER TABLE leaderboard_scores ADD COLUMN avatar_url TEXT");
}

db.exec(`
INSERT OR IGNORE INTO command_roles (guild_id, command_name, role_id)
SELECT guild_id, 'warns', role_id
FROM command_roles
WHERE command_name = 'checkwarns';
DELETE FROM command_roles WHERE command_name = 'checkwarns';
INSERT OR IGNORE INTO command_roles (guild_id, command_name, role_id)
SELECT guild_id, 'raid', role_id
FROM command_roles
WHERE command_name = 'raidmode';
DELETE FROM command_roles WHERE command_name = 'raidmode';
INSERT OR IGNORE INTO command_roles (guild_id, command_name, role_id)
SELECT guild_id, 'reactionrole', role_id
FROM command_roles
WHERE command_name = 'reactionroles';
INSERT OR IGNORE INTO command_settings (guild_id, command_name, enabled)
SELECT guild_id, 'reactionrole', enabled
FROM command_settings
WHERE command_name = 'reactionroles';
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_warnings_guild_user
  ON warnings (guild_id, user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_guild_target
  ON moderation (guild_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_guild_moderator
  ON moderation (guild_id, moderator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_guild_status
  ON tickets (guild_id, status, ticket_number DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_guild_user_status
  ON tickets (guild_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_security_events_guild_time
  ON security_events (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_permission_audit_guild_command
  ON permission_audit (guild_id, command_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reaction_role_panels_guild
  ON reaction_role_panels (guild_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_reaction_role_panels_message
  ON reaction_role_panels (guild_id, message_id);
CREATE INDEX IF NOT EXISTS idx_reaction_role_panel_roles_panel
  ON reaction_role_panel_roles (panel_id, position);
`);

const blacklistColumns = new Set(db.prepare("PRAGMA table_info(blacklist_records)").all().map(column => column.name));
if (!blacklistColumns.has("case_number")) {
  db.exec("ALTER TABLE blacklist_records ADD COLUMN case_number INTEGER");
}

const unnumberedBlacklistRecords = db.prepare(`
  SELECT id, guild_id
  FROM blacklist_records
  WHERE case_number IS NULL
  ORDER BY guild_id, created_at, id
`).all();
const nextCaseByGuild = new Map();
const getLastCaseNumber = db.prepare(`
  SELECT COALESCE(MAX(case_number), 0) AS case_number
  FROM blacklist_records
  WHERE guild_id = ?
`);
const setCaseNumber = db.prepare(`UPDATE blacklist_records SET case_number = ? WHERE id = ?`);
for (const record of unnumberedBlacklistRecords) {
  if (!nextCaseByGuild.has(record.guild_id)) {
    nextCaseByGuild.set(record.guild_id, getLastCaseNumber.get(record.guild_id).case_number);
  }
  const caseNumber = nextCaseByGuild.get(record.guild_id) + 1;
  nextCaseByGuild.set(record.guild_id, caseNumber);
  setCaseNumber.run(caseNumber, record.id);
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_blacklist_case_number ON blacklist_records (guild_id, case_number)");

const settingsColumns = new Set(db.prepare("PRAGMA table_info(settings)").all().map(column => column.name));
if (!settingsColumns.has("blacklist_role_id")) {
  db.exec("ALTER TABLE settings ADD COLUMN blacklist_role_id TEXT");
}
if (!settingsColumns.has("log_channel_id")) {
  db.exec("ALTER TABLE settings ADD COLUMN log_channel_id TEXT");
}
if (!settingsColumns.has("log_events_json")) {
  db.exec("ALTER TABLE settings ADD COLUMN log_events_json TEXT");
}
if (!settingsColumns.has("server_log_channel_id")) {
  db.exec("ALTER TABLE settings ADD COLUMN server_log_channel_id TEXT");
}
if (!settingsColumns.has("server_logs_enabled")) {
  db.exec("ALTER TABLE settings ADD COLUMN server_logs_enabled INTEGER DEFAULT 0");
}
if (!settingsColumns.has("nuke_alert_channel_id")) {
  db.exec("ALTER TABLE settings ADD COLUMN nuke_alert_channel_id TEXT");
}
if (!settingsColumns.has("raid_alert_channel_id")) {
  db.exec("ALTER TABLE settings ADD COLUMN raid_alert_channel_id TEXT");
}
if (!settingsColumns.has("auto_ping_channel_id")) {
  db.exec("ALTER TABLE settings ADD COLUMN auto_ping_channel_id TEXT");
}
if (!settingsColumns.has("auto_ping_enabled")) {
  db.exec("ALTER TABLE settings ADD COLUMN auto_ping_enabled INTEGER DEFAULT 0");
}
if (!settingsColumns.has("grade_channel_id")) {
  db.exec("ALTER TABLE settings ADD COLUMN grade_channel_id TEXT");
}
if (!settingsColumns.has("appeal_link")) {
  db.exec("ALTER TABLE settings ADD COLUMN appeal_link TEXT");
}

// ============================================================
// CONSTANTS
// ============================================================

const COMMANDS = [
  "help",
  "changelogs",
  "serverinfo",
  "userinfo",
  "autoping",
  "lb-make",
  "lb-edit",
  "lb-delete",
  "lbremove",
  "lb-switch",
  "score",
  "scoreschannel",
  "grade",
  "warn",
  "warns",
  "warnings",
  "clearwarnings",
  "strike",
  "strikecheck",
  "strikelist",
  "deletewarns",
  "kick",
  "ban",
  "unban",
  "timeout",
  "untimeout",
  "nick",
  "cases",
  "role",
  "case",
  "editcase",
  "raid",
  "logs",
  "blacklist",
  "blacklistlist",
  "blacklistcheck",
  "unblacklist",
  "mute",
  "unmute",
  "modlogs",
  "purge",
  "slowmode",
  "lock",
  "unlock",
  "addrole",
  "removerole",
  "temprole",
  "giveaway",
  "giveawayreroll",
  "giveawayend",
  "giveawaylist",
  "giveawayedit",
  "giveawayentries",
  "giveawaydelete",
  "ticket-setup",
  "ticket-add",
  "ticket-remove",
  "ticket-close",
  "ticket-reopen",
  "ticket-transcript",
  "ticket-claim",
  "antispam",
  "antiraid",
  "antilink",
  "antimention",
  "antibot",
  "raidmode",
  "security",
  "welcome-setup",
  "goodbye-setup",
  "autorole",
  "reactionrole",
  "suggest",
  "suggestion-setup",
  "poll",
  "embed",
  "remind",
  "roleinfo",
  "channelinfo",
  "avatar",
  "membercount",
  "serverstats",
  "botinfo",
  "ping",
  "invite",
  "config",
  "permissions",
  "commandtoggle",
  "setlogs",
  "resetconfig",
  "backup",
  "restore"
];

const SLASH_ONLY_PREFIX_COMMANDS = new Set([
  "warnings",
  "clearwarnings",
  "unban",
  "timeout",
  "untimeout",
  "nick",
  "cases",
  "role",
  "autoping",
  "lb-make",
  "lb-edit",
  "lb-delete",
  "lbremove",
  "lb-switch",
  "score",
  "scoreschannel",
  "deletewarns",
  "logs",
  "addrole",
  "removerole",
  "temprole",
  "giveaway",
  "giveawayreroll",
  "giveawayend",
  "giveawaylist",
  "giveawayedit",
  "giveawayentries",
  "giveawaydelete",
  "ticket-setup",
  "ticket-add",
  "ticket-remove",
  "ticket-close",
  "ticket-reopen",
  "ticket-transcript",
  "ticket-claim",
  "antispam",
  "antiraid",
  "antilink",
  "antimention",
  "antibot",
  "raidmode",
  "security",
  "welcome-setup",
  "goodbye-setup",
  "autorole",
  "reactionrole",
  "suggest",
  "suggestion-setup",
  "poll",
  "embed",
  "remind",
  "roleinfo",
  "channelinfo",
  "avatar",
  "membercount",
  "serverstats",
  "botinfo",
  "ping",
  "invite",
  "config",
  "permissions",
  "commandtoggle",
  "setlogs",
  "resetconfig",
  "backup",
  "restore"
]);

const LOG_EVENT_OPTIONS = [
  { label: "Moderation actions", value: "moderation", description: "Warnings, mutes, bans, kicks, blacklists, and role commands" },
  { label: "Member joins and leaves", value: "members", description: "Members joining or leaving the server" },
  { label: "Role changes", value: "roles", description: "Roles added to or removed from members" },
  { label: "Nickname changes", value: "member_updates", description: "Member nicknames changed in the server" },
  { label: "Ban and unban events", value: "bans", description: "Ban or unban events detected by Discord" }
];

const SERVER_AUDIT_ACTIONS = new Set([
  AuditLogEvent.GuildUpdate,
  AuditLogEvent.ChannelCreate,
  AuditLogEvent.ChannelUpdate,
  AuditLogEvent.ChannelDelete,
  AuditLogEvent.ChannelOverwriteCreate,
  AuditLogEvent.ChannelOverwriteUpdate,
  AuditLogEvent.ChannelOverwriteDelete,
  AuditLogEvent.MemberKick,
  AuditLogEvent.MemberPrune,
  AuditLogEvent.MemberBanAdd,
  AuditLogEvent.MemberBanRemove,
  AuditLogEvent.MemberUpdate,
  AuditLogEvent.MemberMove,
  AuditLogEvent.MemberDisconnect,
  AuditLogEvent.BotAdd,
  AuditLogEvent.RoleCreate,
  AuditLogEvent.RoleUpdate,
  AuditLogEvent.RoleDelete,
  AuditLogEvent.InviteCreate,
  AuditLogEvent.InviteUpdate,
  AuditLogEvent.InviteDelete,
  AuditLogEvent.WebhookCreate,
  AuditLogEvent.WebhookUpdate,
  AuditLogEvent.WebhookDelete,
  AuditLogEvent.EmojiCreate,
  AuditLogEvent.EmojiUpdate,
  AuditLogEvent.EmojiDelete,
  AuditLogEvent.MessageDelete,
  AuditLogEvent.MessageBulkDelete,
  AuditLogEvent.MessagePin,
  AuditLogEvent.MessageUnpin,
  AuditLogEvent.ApplicationCommandPermissionUpdate,
  AuditLogEvent.IntegrationCreate,
  AuditLogEvent.IntegrationUpdate,
  AuditLogEvent.IntegrationDelete,
  AuditLogEvent.StageInstanceCreate,
  AuditLogEvent.StageInstanceUpdate,
  AuditLogEvent.StageInstanceDelete,
  AuditLogEvent.StickerCreate,
  AuditLogEvent.StickerUpdate,
  AuditLogEvent.StickerDelete,
  AuditLogEvent.GuildScheduledEventCreate,
  AuditLogEvent.GuildScheduledEventUpdate,
  AuditLogEvent.GuildScheduledEventDelete,
  AuditLogEvent.ThreadCreate,
  AuditLogEvent.ThreadUpdate,
  AuditLogEvent.ThreadDelete,
  AuditLogEvent.SoundboardSoundCreate,
  AuditLogEvent.SoundboardSoundUpdate,
  AuditLogEvent.SoundboardSoundDelete,
  AuditLogEvent.AutoModerationRuleCreate,
  AuditLogEvent.AutoModerationRuleUpdate,
  AuditLogEvent.AutoModerationRuleDelete,
  AuditLogEvent.AutoModerationBlockMessage,
  AuditLogEvent.AutoModerationFlagToChannel,
  AuditLogEvent.AutoModerationUserCommunicationDisabled,
  AuditLogEvent.AutoModerationQuarantineUser,
  AuditLogEvent.CreatorMonetizationRequestCreated,
  AuditLogEvent.CreatorMonetizationTermsAccepted,
  AuditLogEvent.OnboardingPromptCreate,
  AuditLogEvent.OnboardingPromptUpdate,
  AuditLogEvent.OnboardingPromptDelete,
  AuditLogEvent.OnboardingCreate,
  AuditLogEvent.OnboardingUpdate,
  AuditLogEvent.HomeSettingsCreate,
  AuditLogEvent.HomeSettingsUpdate,
  AuditLogEvent.VoiceChannelStatusCreate,
  AuditLogEvent.VoiceChannelStatusDelete
].filter(action => action !== undefined));

const USER_AUDIT_ACTIONS = new Set([
  AuditLogEvent.MemberKick,
  AuditLogEvent.MemberBanAdd,
  AuditLogEvent.MemberBanRemove,
  AuditLogEvent.MemberUpdate,
  AuditLogEvent.MemberRoleUpdate,
  AuditLogEvent.MemberMove,
  AuditLogEvent.MemberDisconnect,
  AuditLogEvent.BotAdd,
  AuditLogEvent.MessageDelete
].filter(action => action !== undefined));

const PREFIX_OPTIONS = [
  "!",
  ".",
  "?",
  "-",
  ">",
  ",",
  "+"
];

const GRADE_ROLES = [
  "Grade 5",
  "Grade 4",
  "Grade 3",
  "Grade 2",
  "Semi Grade 1",
  "Grade 1",
  "Special Grade 1",
  "Special Grade"
];

const GRADE_ROLE_ALIASES = {
  "Semi Grade 1": ["Semi G1"],
  "Special Grade": ["SPG"]
};

const SUB1_ROLES = [
  "Low",
  "Mid",
  "High"
];

const SUB2_ROLES = [
  "Weak",
  "Stable",
  "Strong"
];

// Used to tell a failed grade attempt ("@user semi g1 lwo strong") apart from ordinary chat.
const GRADE_ATTEMPT_PATTERN = /\b(grade|g[1-5]|spg|semi|special|low|mid|high|weak|stable|strong)\b/i;

const BLACKLIST_ROLE_NAME = "blacklisted";
const GHOST_PING_DELAY_MS = 2000;

const SECURITY_LIMITS = {
  raidJoinCount: 8,
  raidWindowMs: 10000,
  raidTimeoutMs: 24 * 60 * 60 * 1000,
  nukeActionCount: 3,
  nukeWindowMs: 10000,
  channelDeleteCount: 5,
  channelDeleteWindowMs: 10000
};

const HIGH_RISK_ROLE_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageWebhooks
];

const CRITICAL_AUDIT_ACTIONS = new Set([
  AuditLogEvent.ChannelCreate,
  AuditLogEvent.ChannelDelete,
  AuditLogEvent.ChannelOverwriteCreate,
  AuditLogEvent.ChannelOverwriteUpdate,
  AuditLogEvent.ChannelOverwriteDelete,
  AuditLogEvent.RoleCreate,
  AuditLogEvent.RoleDelete,
  AuditLogEvent.MemberBanAdd,
  AuditLogEvent.MemberKick,
  AuditLogEvent.WebhookCreate,
  AuditLogEvent.WebhookDelete,
  AuditLogEvent.WebhookUpdate
]);

const recentJoinWindows = new Map();
const raidProtectionUntil = new Map();
const nukeActionWindows = new Map();
const channelDeleteWindows = new Map();
const honeypotAlertCooldowns = new Map();

const CATEGORY_CHOICES = [
  { name: "⚖️ Appealable", value: "⚖️ Appealable" },
  { name: "❌ Unappealable", value: "❌ Unappealable" },
  { name: "💸 Bail", value: "💸 Bail" }
];

function now() {
  return Date.now();
}

function safeText(text) {
  if (!text) return "None";

  return String(text)
    .replace(/@everyone/gi, "@\u200beveryone")
    .replace(/@here/gi, "@\u200bhere")
    .slice(0, 1024);
}

function userMention(id) {
  return `<@${id}>`;
}

function parseUserId(value) {
  const match = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/.exec(String(value || "").trim());
  return match?.[1] || match?.[2] || null;
}

function roleMention(id) {
  return `<@&${id}>`;
}

function channelMention(id) {
  return id ? `<#${id}>` : "Not set";
}

function timestamp(ms) {
  return `<t:${Math.floor(ms / 1000)}:F>`;
}

function publicEmbed(title, description, color = 0x5865F2) {
  return brandEmbed(new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp());
}

function errorEmbed(description) {
  return brandEmbed(new EmbedBuilder()
    .setTitle("❌ Error")
    .setDescription(description)
    .setColor(0xED4245)
    .setTimestamp());
}

const PUBLIC_COMMAND_NAMES = new Set([
  "help",
  "changelogs",
  "userinfo",
  "serverinfo",
  "about"
]);
const PUBLIC_COMMAND_COOLDOWN_MS = 6000;
const publicCommandCooldowns = new Map();
const STAFF_PERMISSION_BYPASSES = [
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles
];

function isPublicCommand(interaction) {
  if (PUBLIC_COMMAND_NAMES.has(interaction.commandName)) return true;
  return interaction.commandName === "giveaway" &&
    interaction.options.getSubcommand(false) === "list";
}

function isAuthorizedPublicCommandStaff(interaction) {
  const member = interaction.member;
  const guild = interaction.guild;
  if (!member || !guild) return false;
  if (member.id === guild.ownerId ||
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      member.permissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
  if (STAFF_PERMISSION_BYPASSES.some(permission => member.permissions?.has(permission))) {
    return true;
  }
  if (canActivateSecurityCommand(guild, member)) return true;

  const configuredRoleIds = db.prepare(`
    SELECT role_id
    FROM command_roles
    WHERE guild_id = ?
  `).all(guild.id);
  return configuredRoleIds.some(({ role_id }) => member.roles?.cache?.has(role_id));
}

function takePublicCommandCooldown(interaction) {
  if (!isPublicCommand(interaction) || isAuthorizedPublicCommandStaff(interaction)) return 0;

  const currentTime = now();
  for (const [userId, lastUsedAt] of publicCommandCooldowns) {
    if (currentTime - lastUsedAt < PUBLIC_COMMAND_COOLDOWN_MS) break;
    publicCommandCooldowns.delete(userId);
  }

  const previousTime = publicCommandCooldowns.get(interaction.user.id);
  if (previousTime !== undefined) {
    const remainingMs = PUBLIC_COMMAND_COOLDOWN_MS - (currentTime - previousTime);
    if (remainingMs > 0) return remainingMs;
  }
  publicCommandCooldowns.set(interaction.user.id, currentTime);
  return 0;
}

function aboutEmbed() {
  const identity = getBotIdentity();
  const serverCount = client.guilds.cache.size;
  const userCount = client.guilds.cache.reduce((total, guild) => total + guild.memberCount, 0);
  const uptimeSeconds = Math.floor(process.uptime());
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  const uptime = [days ? `${days}d` : null, hours ? `${hours}h` : null, minutes ? `${minutes}m` : null, `${seconds}s`]
    .filter(Boolean)
    .join(" ");

  return publicEmbed(
    `🛡️ About ${identity.username}`,
    `${identity.username} is a Discord management bot providing moderation, security, tickets, giveaways and server automation.`,
    0x5865F2
  ).addFields(
    { name: "Version", value: `v${identity.version}`, inline: true },
    { name: "Uptime", value: uptime, inline: true },
    { name: "Servers", value: String(serverCount), inline: true },
    { name: "Users", value: String(userCount), inline: true },
    { name: "Bot ID", value: identity.id || "Unavailable", inline: true }
  );
}

function getLeaderboard(guildId, name) {
  return db.prepare(`
    SELECT *
    FROM leaderboards
    WHERE guild_id = ? AND name = ? COLLATE NOCASE
  `).get(guildId, name);
}

function assignLeaderboardSpot(leaderboardId, userId, spot) {
  db.transaction(() => {
    const player = db.prepare(`
      SELECT spot
      FROM leaderboard_scores
      WHERE leaderboard_id = ? AND user_id = ?
    `).get(leaderboardId, userId);
    if (!player) throw new Error("The selected player is not on this leaderboard.");

    const occupant = db.prepare(`
      SELECT user_id
      FROM leaderboard_scores
      WHERE leaderboard_id = ? AND spot = ?
    `).get(leaderboardId, spot);
    if (occupant?.user_id !== userId) {
      db.prepare("UPDATE leaderboard_scores SET spot = -1 WHERE leaderboard_id = ? AND user_id = ?")
        .run(leaderboardId, userId);
      if (occupant) {
        db.prepare("UPDATE leaderboard_scores SET spot = ? WHERE leaderboard_id = ? AND user_id = ?")
          .run(player.spot, leaderboardId, occupant.user_id);
      }
      db.prepare("UPDATE leaderboard_scores SET spot = ? WHERE leaderboard_id = ? AND user_id = ?")
        .run(spot, leaderboardId, userId);
    }
  })();
}

function swapLeaderboardSpots(leaderboardId, firstUserId, secondUserId) {
  db.transaction(() => {
    const first = db.prepare(`
      SELECT spot
      FROM leaderboard_scores
      WHERE leaderboard_id = ? AND user_id = ?
    `).get(leaderboardId, firstUserId);
    const second = db.prepare(`
      SELECT spot
      FROM leaderboard_scores
      WHERE leaderboard_id = ? AND user_id = ?
    `).get(leaderboardId, secondUserId);
    if (!first || !second) throw new Error("Both players must be on the leaderboard to switch spots.");

    db.prepare("UPDATE leaderboard_scores SET spot = -1 WHERE leaderboard_id = ? AND user_id = ?")
      .run(leaderboardId, firstUserId);
    db.prepare("UPDATE leaderboard_scores SET spot = ? WHERE leaderboard_id = ? AND user_id = ?")
      .run(first.spot, leaderboardId, secondUserId);
    db.prepare("UPDATE leaderboard_scores SET spot = ? WHERE leaderboard_id = ? AND user_id = ?")
      .run(second.spot, leaderboardId, firstUserId);
  })();
}

async function leaderboardEmbeds(board, guild) {
  const rankedPlayers = db.prepare(`
    SELECT user_id, spot, roblox_username, country, stage, avatar_url
    FROM leaderboard_scores
    WHERE leaderboard_id = ?
    ORDER BY spot ASC
  `).all(board.id);
  const playersBySpot = new Map(rankedPlayers.map(player => [player.spot, player]));
  const scores = Array.from({ length: 10 }, (_, index) => playersBySpot.get(index + 1) || null);
  const members = await Promise.all(scores.map(entry =>
    entry ? guild.members.fetch(entry.user_id).catch(() => null) : null
  ));
  return Array.from({ length: 10 }, (_, index) => {
    const entry = scores[index];
    if (!entry) {
      return new EmbedBuilder()
        .setTitle(`Top ${index + 1} Vacant`)
        .setDescription([
          "vacant",
          "≪ ・ Information ・ ≫",
          "╰・Country: unknown",
          "╰・grade: unranked"
        ].join("\n"))
        .setColor(0x232428);
    }

    const member = members[index];
    const displayName = entry.roblox_username || member?.displayName || "Unknown member";
    const embed = new EmbedBuilder()
      .setTitle(`Top ${index + 1} ${safeText(displayName)}`)
      .setDescription([
        `<@${entry.user_id}>`,
        "≪ ・ Information ・ ≫",
        `╰・Country: ${safeText(entry.country || "Not set")}`,
        `╰・grade: ${safeText(entry.stage || "Not set")}`
      ].join("\n"))
      .setColor(0x232428);
    const avatarUrl = entry.avatar_url || member?.displayAvatarURL({ extension: "png", size: 128 });
    if (avatarUrl) embed.setThumbnail(avatarUrl);
    return embed;
  });
}

async function publishLeaderboard(board, guild) {
  const webhook = new WebhookClient({ id: board.webhook_id, token: board.webhook_token });
  const options = {
    embeds: await leaderboardEmbeds(board, guild),
    allowedMentions: { parse: [] }
  };

  if (board.message_id) {
    await webhook.editMessage(board.message_id, options);
    return board.message_id;
  }

  const message = await webhook.send({
    ...options,
    username: `${board.name} Leaderboard Bot`,
    avatarURL: getBotIdentity().avatarURL
  });
  db.prepare("UPDATE leaderboards SET message_id = ? WHERE id = ?").run(message.id, board.id);
  return message.id;
}

function leaderboardEditPanel(board, userId) {
  return {
    embeds: [publicEmbed(
      `🏆 Edit ${board.name}`,
      "Choose a member, then set their spot (1-10), country, grade, and optional image. If the spot is taken, the players switch spots.",
      0x5865F2
    )],
    components: [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`leaderboard_member:${board.id}:${userId}`)
          .setPlaceholder("Choose a member")
          .setMinValues(1)
          .setMaxValues(1)
      )
    ]
  };
}

function leaderboardPickerPanel(guildId, userId, page = 1) {
  const total = db.prepare("SELECT COUNT(*) AS count FROM leaderboards WHERE guild_id = ?").get(guildId).count;
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.max(1, Math.min(pageCount, page));
  const boards = db.prepare(`
    SELECT id, name
    FROM leaderboards
    WHERE guild_id = ?
    ORDER BY name COLLATE NOCASE, id
    LIMIT ? OFFSET ?
  `).all(guildId, pageSize, (currentPage - 1) * pageSize);

  const components = [];
  if (boards.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`leaderboard_pick:${userId}:${currentPage}`)
        .setPlaceholder("Choose a leaderboard to edit")
        .addOptions(boards.map(board => ({
          label: board.name.slice(0, 100),
          value: String(board.id)
        })))
    ));
  }
  if (pageCount > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`leaderboard_picker_page:${userId}:${currentPage - 1}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage <= 1),
      new ButtonBuilder()
        .setCustomId(`leaderboard_picker_page:${userId}:${currentPage + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= pageCount)
    ));
  }

  return {
    embeds: [publicEmbed(
      "🏆 Choose a Leaderboard",
      total
        ? `Select the leaderboard you want to edit. Page **${currentPage}/${pageCount}**.`
        : "There are no leaderboards to edit yet. Create one with `/lb-make`.",
      0x5865F2
    )],
    components
  };
}

function ensureSettings(guildId) {
  db.prepare(`
    INSERT OR IGNORE INTO settings (guild_id)
    VALUES (?)
  `).run(guildId);
}

function getSettings(guildId) {
  ensureSettings(guildId);
  return db.prepare(`
    SELECT *
    FROM settings
    WHERE guild_id = ?
  `).get(guildId);
}

const GIVEAWAY_MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 2147483647;
const giveawayTimers = new Map();
const giveawaysEnding = new Set();
const GIVEAWAY_PROCESS_TOKEN = randomUUID();
const GIVEAWAY_ENDING_LEASE_MS = 60_000;
const securityMessageWindows = new Map();
const reminderTimers = new Map();

function parseGiveawayDuration(value) {
  const match = /^([1-9]\d{0,6})(m|h|d)$/i.exec(String(value || "").trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase()];
  const durationMs = amount * unitMs;
  return Number.isSafeInteger(durationMs) && durationMs <= GIVEAWAY_MAX_DURATION_MS
    ? durationMs
    : null;
}

function getGiveaway(guildId, giveawayId) {
  return db.prepare("SELECT * FROM giveaways WHERE guild_id = ? AND id = ?").get(guildId, giveawayId);
}

function getGiveawayEntryTotals(giveawayId) {
  return db.prepare(`
    SELECT COUNT(*) AS participants, COALESCE(SUM(entry_weight), 0) AS entries
    FROM giveaway_entries
    WHERE giveaway_id = ?
  `).get(giveawayId);
}

function giveawayEmbed(giveaway, { ended = false, cancelled = false, winnerIds = null } = {}) {
  const totals = getGiveawayEntryTotals(giveaway.id);
  const embed = publicEmbed(
    cancelled ? "🚫 Giveaway Cancelled" : ended ? "🎉 Giveaway Ended" : "🎉 Giveaway",
    `## 🎁 ${safeText(giveaway.prize)}`,
    cancelled ? 0xED4245 : ended ? 0x99AAB5 : 0x5865F2
  ).addFields(
    { name: "📝 Description", value: safeText(giveaway.description || "No additional details."), inline: false },
    { name: "🏆 Winners", value: String(giveaway.winner_count), inline: true },
    { name: "👤 Hosted by", value: userMention(giveaway.host_id), inline: true },
    { name: "🎟️ Entries / Participants", value: `${totals.entries} entries from ${totals.participants} participant(s)`, inline: true },
    { name: "🤖 Bot entries", value: giveaway.allow_bots ? "Allowed" : "Not allowed", inline: true },
    { name: "⏰ Time remaining", value: ended || cancelled ? "Ended" : `<t:${Math.floor(giveaway.ends_at / 1000)}:R>`, inline: true },
    { name: "📅 End date and time", value: timestamp(giveaway.ends_at), inline: true }
  );
  if (giveaway.bonus_role_id && giveaway.bonus_entries) {
    embed.addFields({
      name: "✨ Bonus entries",
      value: `${roleMention(giveaway.bonus_role_id)} members receive **${giveaway.bonus_entries} entries** each. Eligibility is checked again when winners are drawn.`,
      inline: false
    });
  }
  if (giveaway.required_role_id) {
    embed.addFields({
      name: "🔐 Required role",
      value: `${roleMention(giveaway.required_role_id)} is required to enter.`,
      inline: false
    });
  }
  if (ended) {
    const winners = winnerIds || [];
    embed.addFields({
      name: "🥇 Winner(s)",
      value: winners.length ? winners.map(userMention).join("\n") : "No eligible participants entered.",
      inline: false
    });
  }
  return embed;
}

function giveawayEntryButton(giveawayId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway_enter:${giveawayId}`)
      .setLabel("🎉 Enter Giveaway")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

function hasGiveawayManageAccess(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const roles = interaction.member?.roles?.cache;
  return getCommandRoles(interaction.guildId, "giveaway")
    .some(roleId => roles?.has(roleId));
}

async function getEligibleGiveawayEntries(guild, giveaway) {
  const entries = db.prepare(`
    SELECT user_id
    FROM giveaway_entries
    WHERE giveaway_id = ?
  `).all(giveaway.id);
  const eligible = [];
  const validIds = new Set();
  for (const entry of entries) {
    let member = guild.members.cache.get(entry.user_id);
    if (!member) {
      try {
        member = await guild.members.fetch(entry.user_id);
      } catch (error) {
        if (error.code === 10007 || error.code === 10013) continue;
        console.error(`Could not verify giveaway participant ${entry.user_id} for giveaway #${giveaway.id}:`, error);
        throw new Error("Could not verify all giveaway participants. Try ending the giveaway again.");
      }
    }
    if (giveaway.required_role_id && !member.roles.cache.has(giveaway.required_role_id)) continue;
    const weight = giveaway.bonus_role_id && member.roles.cache.has(giveaway.bonus_role_id)
      ? giveaway.bonus_entries
      : 1;
    validIds.add(entry.user_id);
    eligible.push({ user_id: entry.user_id, weight, bot: member.user.bot });
  }
  const refreshEntries = db.transaction(() => {
    const updateWeight = db.prepare(`
      UPDATE giveaway_entries
      SET entry_weight = ?
      WHERE giveaway_id = ? AND user_id = ?
    `);
    for (const entry of eligible) {
      updateWeight.run(entry.weight, giveaway.id, entry.user_id);
    }
    const removeEntry = db.prepare("DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?");
    for (const entry of entries) {
      if (!validIds.has(entry.user_id)) removeEntry.run(giveaway.id, entry.user_id);
    }
  });
  refreshEntries();
  return eligible;
}

async function getGiveawayChannel(giveaway) {
  const guild = client.guilds.cache.get(giveaway.guild_id);
  if (!guild) return null;
  const channel = guild.channels.cache.get(giveaway.channel_id) ||
    await guild.channels.fetch(giveaway.channel_id).catch(error => {
      console.warn(`Giveaway #${giveaway.id} channel is unavailable:`, error.message);
      return null;
    });
  return channel?.isTextBased() && "messages" in channel ? channel : null;
}

async function updateGiveawayPost(giveaway, options = {}) {
  const channel = await getGiveawayChannel(giveaway);
  if (!channel || !giveaway.message_id) return null;
  const message = await channel.messages.fetch(giveaway.message_id).catch(error => {
    console.warn(`Giveaway #${giveaway.id} message is unavailable:`, error.message);
    return null;
  });
  if (!message) return { channel, message: null };
  await message.edit({
    embeds: [giveawayEmbed(giveaway, options)],
    components: [giveawayEntryButton(giveaway.id, options.ended || options.cancelled)]
  });
  return { channel, message };
}

async function endGiveaway(guildId, giveawayId, { manual = false } = {}) {
  if (giveawaysEnding.has(giveawayId)) return { error: "This giveaway is already being ended." };
  let giveaway = getGiveaway(guildId, giveawayId);
  if (!giveaway || !["active", "ending"].includes(giveaway.status)) {
    return { error: "That giveaway is not active." };
  }
  if (!manual && giveaway.status === "active" && giveaway.ends_at > now()) {
    scheduleGiveaway(giveaway.id);
    return { error: "That giveaway has not ended yet." };
  }
  if (giveaway.status === "active") {
    const claimed = db.prepare(`
      UPDATE giveaways
      SET status = 'ending', ending_token = ?, ending_started_at = ?
      WHERE id = ? AND guild_id = ? AND status = 'active'
    `).run(GIVEAWAY_PROCESS_TOKEN, now(), giveaway.id, guildId);
    if (!claimed.changes) return { error: "This giveaway is already being ended." };
    giveaway = getGiveaway(guildId, giveaway.id);
  } else if (giveaway.ending_token !== GIVEAWAY_PROCESS_TOKEN) {
    if (!giveaway.ending_started_at || now() - giveaway.ending_started_at < GIVEAWAY_ENDING_LEASE_MS) {
      return { error: "This giveaway is already being ended." };
    }
    const claimed = db.prepare(`
      UPDATE giveaways
      SET ending_token = ?, ending_started_at = ?
      WHERE id = ? AND guild_id = ? AND status = 'ending' AND ending_token = ?
    `).run(GIVEAWAY_PROCESS_TOKEN, now(), giveaway.id, guildId, giveaway.ending_token);
    if (!claimed.changes) return { error: "This giveaway is already being ended." };
    giveaway = getGiveaway(guildId, giveaway.id);
  }

  giveawaysEnding.add(giveawayId);
  const timer = giveawayTimers.get(giveawayId);
  if (timer) clearTimeout(timer);
  giveawayTimers.delete(giveawayId);
  try {
    let winnerIds = JSON.parse(giveaway.winner_ids_json || "null");
    if (!Array.isArray(winnerIds)) {
      const guild = client.guilds.cache.get(giveaway.guild_id);
      if (!guild) {
        throw new Error("The giveaway server is unavailable; the end operation will resume after restart.");
      }
      const eligible = await getEligibleGiveawayEntries(guild, giveaway);
      const draw = drawAndRecordGiveawayWinners(db, giveaway.id, eligible, giveaway.winner_count, {
        allowBots: Boolean(giveaway.allow_bots),
        allowPartial: true,
        expectedStatus: "ending"
      });
      if (draw.error) throw new Error(draw.error);
      winnerIds = draw.winnerIds;
    }

    giveaway = getGiveaway(guildId, giveaway.id);
    const post = await updateGiveawayPost(giveaway, { ended: true, winnerIds });
    let announcementMessageId = giveaway.announcement_message_id;
    let warning = null;
    if (post?.channel && winnerIds.length && !announcementMessageId) {
      const announcement = await post.channel.send({
        content: `🎉 Giveaway #${giveaway.id} has ended! Winner(s): ${winnerIds.map(userMention).join(", ")}`,
        allowedMentions: { users: winnerIds }
      }).catch(error => {
        console.error(`Could not announce winners for giveaway #${giveaway.id}:`, error);
        warning = "The giveaway ended, but I couldn't send the winner announcement.";
        return null;
      });
      if (announcement) announcementMessageId = announcement.id;
    } else if (!post?.channel) {
      warning = "The giveaway ended, but its channel or original post was deleted.";
    } else if (!winnerIds.length) {
      warning = "The giveaway ended with no eligible participants.";
    }
    db.prepare(`
      UPDATE giveaways
      SET announcement_message_id = ?, status = 'ended', ended_at = COALESCE(ended_at, ?),
          ending_token = NULL, ending_started_at = NULL
      WHERE id = ? AND guild_id = ? AND status = 'ending' AND ending_token = ?
    `).run(announcementMessageId, now(), giveaway.id, guildId, GIVEAWAY_PROCESS_TOKEN);
    giveaway = getGiveaway(guildId, giveaway.id);
    if (giveaway.status !== "ended") {
      throw new Error("Giveaway ending ownership changed before finalization.");
    }
    return { giveaway, winnerIds, warning };
  } catch (error) {
    scheduleGiveaway(giveaway.id);
    throw error;
  } finally {
    giveawaysEnding.delete(giveawayId);
  }
}

function scheduleGiveaway(giveawayId) {
  const existingTimer = giveawayTimers.get(giveawayId);
  if (existingTimer) clearTimeout(existingTimer);
  const giveaway = db.prepare("SELECT id, guild_id, ends_at, status, ending_token, ending_started_at FROM giveaways WHERE id = ?").get(giveawayId);
  if (!giveaway || !["active", "ending"].includes(giveaway.status)) {
    giveawayTimers.delete(giveawayId);
    return;
  }

  const delay = giveaway.status === "ending"
    ? giveaway.ending_token === GIVEAWAY_PROCESS_TOKEN
      ? 10_000
      : Math.max(1000, GIVEAWAY_ENDING_LEASE_MS - (now() - (giveaway.ending_started_at || 0)))
    : Math.min(Math.max(0, giveaway.ends_at - now()), MAX_TIMEOUT_MS);
  const timer = setTimeout(async () => {
    giveawayTimers.delete(giveawayId);
    const current = db.prepare("SELECT guild_id, ends_at, status FROM giveaways WHERE id = ?").get(giveawayId);
    if (!current || !["active", "ending"].includes(current.status)) return;
    if (current.status === "active" && current.ends_at > now()) {
      scheduleGiveaway(giveawayId);
      return;
    }
    try {
      const result = await endGiveaway(current.guild_id, giveawayId);
      if (result.error && result.error !== "This giveaway is already being ended.") {
        console.warn(`Automatic giveaway ending skipped for #${giveawayId}: ${result.error}`);
      }
      const latest = db.prepare("SELECT status, ending_token FROM giveaways WHERE id = ?").get(giveawayId);
      if (latest?.status === "ending" && latest.ending_token !== GIVEAWAY_PROCESS_TOKEN) {
        scheduleGiveaway(giveawayId);
      }
    } catch (error) {
      console.error(`Automatic giveaway ending failed for #${giveawayId}:`, error);
      scheduleGiveaway(giveawayId);
    }
  }, delay);
  giveawayTimers.set(giveawayId, timer);
}

function scheduleReminder(reminderId) {
  const existing = reminderTimers.get(reminderId);
  if (existing) clearTimeout(existing);
  const reminder = db.prepare("SELECT * FROM reminders WHERE id = ? AND delivered = 0").get(reminderId);
  if (!reminder) return;
  const delay = Math.min(Math.max(0, reminder.remind_at - now()), 2147483647);
  const timer = setTimeout(async () => {
    reminderTimers.delete(reminderId);
    const latest = db.prepare("SELECT * FROM reminders WHERE id = ? AND delivered = 0").get(reminderId);
    if (!latest) return;
    if (latest.remind_at > now()) {
      scheduleReminder(reminderId);
      return;
    }
    try {
      const user = await client.users.fetch(latest.user_id);
      await user.send({ embeds: [publicEmbed("⏰ Reminder", safeText(latest.message), 0x5865F2)] }).catch(async () => {
        if (latest.channel_id) {
          const channel = await client.channels.fetch(latest.channel_id).catch(() => null);
          if (channel?.isTextBased()) await channel.send({ content: `${userMention(latest.user_id)} Reminder: ${safeText(latest.message)}` }).catch(() => {});
        }
      });
      db.prepare("UPDATE reminders SET delivered = 1 WHERE id = ?").run(reminderId);
    } catch (error) {
      console.error(`Could not deliver reminder #${reminderId}:`, error);
      scheduleReminder(reminderId);
    }
  }, delay);
  reminderTimers.set(reminderId, timer);
}

function resumeReminders() {
  const reminders = db.prepare("SELECT id FROM reminders WHERE delivered = 0").all();
  for (const reminder of reminders) scheduleReminder(reminder.id);
}

function resumeGiveaways() {
  const activeGiveaways = db.prepare(`
    SELECT id
    FROM giveaways
    WHERE status IN ('active', 'ending')
  `).all();
  for (const giveaway of activeGiveaways) {
    scheduleGiveaway(giveaway.id);
  }
}

async function cancelGiveaway(guildId, giveawayId) {
  const result = db.prepare(`
    UPDATE giveaways
    SET status = 'cancelled', ended_at = ?
    WHERE guild_id = ? AND id = ? AND status = 'active'
  `).run(now(), guildId, giveawayId);
  if (!result.changes) return { error: "That giveaway is not active." };
  const timer = giveawayTimers.get(giveawayId);
  if (timer) clearTimeout(timer);
  giveawayTimers.delete(giveawayId);
  const giveaway = getGiveaway(guildId, giveawayId);
  let post = null;
  let warning = null;
  try {
    post = await updateGiveawayPost(giveaway, { cancelled: true });
  } catch (error) {
    console.error(`Could not update cancelled giveaway #${giveawayId}:`, error);
    warning = "The giveaway was cancelled, but I couldn't update its original post.";
  }
  if (!post?.message && !warning) {
    warning = "The giveaway was cancelled, but its original channel or post is unavailable.";
  }
  return {
    giveaway,
    warning
  };
}

async function rerollGiveaway(guildId, giveawayId) {
  const giveaway = getGiveaway(guildId, giveawayId);
  if (!giveaway || giveaway.status !== "ended") {
    return { error: "Only an ended giveaway can be rerolled." };
  }
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { error: "The giveaway server is unavailable." };
  const eligible = await getEligibleGiveawayEntries(guild, giveaway);
  const draw = drawAndRecordGiveawayWinners(db, giveaway.id, eligible, giveaway.winner_count, {
    allowBots: Boolean(giveaway.allow_bots),
    expectedStatus: "ended"
  });
  if (draw.error) return draw;
  const { winnerIds } = draw;
  const updatedGiveaway = getGiveaway(guildId, giveawayId);
  let post = null;
  let warning = null;
  try {
    post = await updateGiveawayPost(updatedGiveaway, { ended: true, winnerIds });
  } catch (error) {
    console.error(`Could not update rerolled giveaway #${giveawayId}:`, error);
    warning = "New winners were selected, but I couldn't update the original giveaway post.";
  }
  let announcementMessageId = null;
  if (post?.channel && winnerIds.length) {
    const announcement = await post.channel.send({
      content: `🔄 Giveaway #${giveaway.id} was rerolled! New winner(s): ${winnerIds.map(userMention).join(", ")}`,
      allowedMentions: { users: winnerIds }
    }).catch(error => {
      console.error(`Could not announce rerolled winners for giveaway #${giveaway.id}:`, error);
      warning = "New winners were selected, but I couldn't send the announcement.";
      return null;
    });
    announcementMessageId = announcement?.id || null;
  } else if (!post?.channel && !warning) {
    warning = "New winners were selected, but the giveaway channel or original post is unavailable.";
  } else if (!winnerIds.length && !warning) {
    warning = "There are no eligible participants to reroll.";
  }
  db.prepare("UPDATE giveaways SET announcement_message_id = ? WHERE id = ?")
    .run(announcementMessageId, giveaway.id);
  return { giveaway: updatedGiveaway, winnerIds, warning };
}

const defaultBlacklistRoleTasks = new Map();

async function ensureDefaultBlacklistRole(guild) {
  let role = guild.roles.cache.find(candidate => candidate.name.toLowerCase() === BLACKLIST_ROLE_NAME);
  if (role) return role;
  if (defaultBlacklistRoleTasks.has(guild.id)) return defaultBlacklistRoleTasks.get(guild.id);

  const task = guild.roles.create({
    name: BLACKLIST_ROLE_NAME,
    color: 0,
    permissions: [],
    reason: "Default role for blacklisted members"
  });
  defaultBlacklistRoleTasks.set(guild.id, task);
  try {
    role = await task;
    return role;
  } finally {
    defaultBlacklistRoleTasks.delete(guild.id);
  }
}

async function ensureBlacklistRole(guild) {
  const settings = getSettings(guild.id);
  const configuredRole = settings.blacklist_role_id
    ? guild.roles.cache.get(settings.blacklist_role_id)
    : null;
  const role = configuredRole || await ensureDefaultBlacklistRole(guild);

  if (settings.blacklist_role_id !== role.id) {
    db.prepare("UPDATE settings SET blacklist_role_id = ? WHERE guild_id = ?").run(role.id, guild.id);
  }
  return role;
}

function getBlacklistAllowedChannelIds(guildId) {
  return new Set(db.prepare(`
    SELECT channel_id
    FROM blacklist_allowed_channels
    WHERE guild_id = ?
  `).all(guildId).map(row => row.channel_id));
}

function isBlacklistChannelAllowed(channel, allowedChannelIds) {
  return allowedChannelIds.has(channel.id) ||
    (channel.parentId ? allowedChannelIds.has(channel.parentId) : false);
}

async function applyBlacklistChannelPermissions(guild, channel, role, allowedChannelIds) {
  if (!channel) return;
  if (!channel.permissionOverwrites || channel.isThread?.()) return;

  const allowed = isBlacklistChannelAllowed(channel, allowedChannelIds);
  const permissionStates = [
    [PermissionFlagsBits.ViewChannel, allowed],
    [PermissionFlagsBits.SendMessages, allowed],
    [PermissionFlagsBits.SendMessagesInThreads, allowed],
    [PermissionFlagsBits.CreatePublicThreads, allowed],
    [PermissionFlagsBits.CreatePrivateThreads, allowed]
  ];
  const existing = channel.permissionOverwrites.cache.get(role.id);
  const needsUpdate = permissionStates.some(([permission, shouldAllow]) =>
    shouldAllow
      ? !existing?.allow.has(permission) || existing.deny.has(permission)
      : !existing?.deny.has(permission) || existing.allow.has(permission)
  );
  if (!needsUpdate) return;

  await channel.permissionOverwrites.edit(role, {
    ViewChannel: allowed,
    SendMessages: allowed,
    SendMessagesInThreads: allowed,
    CreatePublicThreads: allowed,
    CreatePrivateThreads: allowed
  }, {
    reason: allowed
      ? "Apply configured channel access for blacklisted members"
      : "Restrict channel access for blacklisted members"
  });
}

async function clearBlacklistRoleChannelPermissions(guild, roleId) {
  if (!roleId) return [];

  const managedPermissions = [
    "ViewChannel",
    "SendMessages",
    "SendMessagesInThreads",
    "CreatePublicThreads",
    "CreatePrivateThreads"
  ];
  const channels = await guild.channels.fetch();
  const failures = [];

  for (const channel of channels.values()) {
    const overwrite = channel.permissionOverwrites?.cache.get(roleId);
    if (!overwrite || !managedPermissions.some(permission =>
      overwrite.allow.has(PermissionFlagsBits[permission]) || overwrite.deny.has(PermissionFlagsBits[permission])
    )) continue;

    try {
      const neutralized = Object.fromEntries(managedPermissions.map(permission => [permission, null]));
      const updated = await channel.permissionOverwrites.edit(roleId, neutralized, {
        reason: "Remove previous Blacklisted role channel access settings"
      });
      if (updated.allow.bitfield === 0n && updated.deny.bitfield === 0n) {
        await channel.permissionOverwrites.delete(roleId, "Remove empty previous Blacklisted role overwrite");
      }
    } catch (error) {
      failures.push({ channel, error });
      console.error(`Could not clear previous Blacklisted role permissions in #${channel.name} (${guild.name}):`, error);
    }
  }

  return failures;
}

async function syncBlacklistChannelPermissions(guild) {
  const role = await ensureBlacklistRole(guild);
  const allowedChannelIds = getBlacklistAllowedChannelIds(guild.id);
  const channels = await guild.channels.fetch();
  const failures = [];

  for (const channel of channels.values()) {
    try {
      await applyBlacklistChannelPermissions(guild, channel, role, allowedChannelIds);
    } catch (error) {
      failures.push({ channel, error });
      const channelName = channel?.name || channel?.id || "unknown channel";
      console.error(`Could not apply Blacklisted role permissions in #${channelName} (${guild.name}):`, error);
    }
  }

  return { role, failures };
}

async function moveActiveBlacklistedMembers(guild, previousRoleId, nextRole) {
  if (!previousRoleId || previousRoleId === nextRole.id) return [];
  const previousRole = guild.roles.cache.get(previousRoleId);
  const activeUsers = db.prepare(`
    SELECT DISTINCT user_id
    FROM blacklist_records
    WHERE guild_id = ? AND active = 1
  `).all(guild.id);
  const failures = [];

  for (const { user_id: userId } of activeUsers) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    try {
      await member.roles.add(nextRole, "Update configured Blacklisted role");
      if (previousRole?.editable && member.roles.cache.has(previousRole.id)) {
        await member.roles.remove(previousRole, "Remove previous configured Blacklisted role");
      }
    } catch (error) {
      failures.push({ member, error });
      console.error(`Could not move active blacklisted member ${member.user.tag} to role ${nextRole.name}:`, error);
    }
  }

  return failures;
}

function getEnabledLogEvents(settings) {
  if (!settings.log_events_json) return LOG_EVENT_OPTIONS.map(option => option.value);

  try {
    const saved = JSON.parse(settings.log_events_json);
    return LOG_EVENT_OPTIONS.map(option => option.value).filter(value => saved.includes(value));
  } catch {
    return LOG_EVENT_OPTIONS.map(option => option.value);
  }
}

function saveEnabledLogEvents(guildId, values) {
  const allowed = new Set(LOG_EVENT_OPTIONS.map(option => option.value));
  const selected = [...new Set(values)].filter(value => allowed.has(value));
  db.prepare(`UPDATE settings SET log_events_json = ? WHERE guild_id = ?`).run(JSON.stringify(selected), guildId);
}

function setAutoPingChannel(guildId, channelId, enabled = true) {
  db.prepare(`
    UPDATE settings
    SET auto_ping_channel_id = ?, auto_ping_enabled = ?
    WHERE guild_id = ?
  `).run(channelId, enabled ? 1 : 0, guildId);
}

function disableAutoPing(guildId) {
  db.prepare(`
    UPDATE settings
    SET auto_ping_channel_id = NULL, auto_ping_enabled = 0
    WHERE guild_id = ?
  `).run(guildId);
}

function getPrefixes(guildId) {
  const row = db.prepare(`
    SELECT prefixes_json
    FROM prefixes
    WHERE guild_id = ?
  `).get(guildId);

  if (!row) return [];

  try {
    return JSON.parse(row.prefixes_json).filter(prefix => PREFIX_OPTIONS.includes(prefix));
  } catch {
    return [];
  }
}

function savePrefixes(guildId, values) {
  const clean = [...new Set(values)].filter(prefix => PREFIX_OPTIONS.includes(prefix));

  db.prepare(`
    INSERT INTO prefixes (guild_id, prefixes_json)
    VALUES (?, ?)
    ON CONFLICT(guild_id)
    DO UPDATE SET prefixes_json = excluded.prefixes_json
  `).run(guildId, JSON.stringify(clean));
}

function getCommandRoles(guildId, commandName) {
  return db.prepare(`
    SELECT role_id
    FROM command_roles
    WHERE guild_id = ?
    AND command_name = ?
  `).all(guildId, commandName).map(row => row.role_id);
}

function setCommandRoles(guildId, commandName, roleIds) {
  const transaction = db.transaction(() => {
    db.prepare(`
      DELETE FROM command_roles
      WHERE guild_id = ?
      AND command_name = ?
    `).run(guildId, commandName);

    const insert = db.prepare(`
      INSERT OR IGNORE INTO command_roles (guild_id, command_name, role_id)
      VALUES (?, ?, ?)
    `);

    for (const roleId of [...new Set(roleIds)]) {
      insert.run(guildId, commandName, roleId);
    }
  });

  transaction();
}

const COMMAND_PERMISSION_REQUIREMENTS = {
  warn: PermissionFlagsBits.ModerateMembers,
  warns: PermissionFlagsBits.ModerateMembers,
  warnings: PermissionFlagsBits.ModerateMembers,
  clearwarnings: PermissionFlagsBits.ModerateMembers,
  deletewarns: PermissionFlagsBits.ModerateMembers,
  mute: PermissionFlagsBits.ModerateMembers,
  unmute: PermissionFlagsBits.ModerateMembers,
  timeout: PermissionFlagsBits.ModerateMembers,
  untimeout: PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
  unban: PermissionFlagsBits.BanMembers,
  nick: PermissionFlagsBits.ManageNicknames,
  role: PermissionFlagsBits.ManageRoles,
  strike: PermissionFlagsBits.ModerateMembers,
  strikecheck: PermissionFlagsBits.ModerateMembers,
  strikelist: PermissionFlagsBits.ModerateMembers,
  blacklist: PermissionFlagsBits.BanMembers,
  unblacklist: PermissionFlagsBits.BanMembers,
  purge: PermissionFlagsBits.ManageMessages,
  blacklistlist: PermissionFlagsBits.ModerateMembers,
  lock: PermissionFlagsBits.ManageChannels,
  unlock: PermissionFlagsBits.ManageChannels,
  slowmode: PermissionFlagsBits.ManageChannels,
  addrole: PermissionFlagsBits.ManageRoles,
  removerole: PermissionFlagsBits.ManageRoles,
  temprole: PermissionFlagsBits.ManageRoles,
  grade: PermissionFlagsBits.ManageRoles,
  reactionrole: PermissionFlagsBits.ManageRoles
};

function getCommandPermissionRequirement(commandName) {
  return COMMAND_PERMISSION_REQUIREMENTS[commandName] || null;
}

function auditCommandPermissionChange(guildId, commandName, roleId, actorId, action) {
  db.prepare(`
    INSERT INTO permission_audit (guild_id, command_name, role_id, actor_id, action, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, commandName, roleId || null, actorId, action, now());
  addModLog(
    guildId,
    "permission_config",
    roleId || guildId,
    actorId,
    `${action === "replace" ? "Replaced" : action === "clear" ? "Cleared" : action} role permissions for /${commandName}${roleId ? ` (${roleId})` : ""}`
  );
}

function hasCommandAccess(interactionOrMessage, commandName) {
  const member = interactionOrMessage.member;

  if (!member) return false;
  if (interactionOrMessage.guild) {
    const commandSetting = db.prepare(`
      SELECT enabled
      FROM command_settings
      WHERE guild_id = ? AND command_name = ?
    `).get(interactionOrMessage.guild.id, commandName);
    if (commandSetting && !commandSetting.enabled) return false;
  }

  if (member.permissions && member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const requiredPermission = getCommandPermissionRequirement(commandName);
  if (requiredPermission && member.permissions?.has(requiredPermission)) return true;

  const allowed = getCommandRoles(interactionOrMessage.guild.id, commandName);
  if (!allowed.length && commandName === "strikecheck") {
    const strikeRoles = getCommandRoles(interactionOrMessage.guild.id, "strike");
    if (strikeRoles.length) return strikeRoles.some(roleId => member.roles.cache.has(roleId));
  }
  if (!allowed.length && ["strike", "strikecheck", "strikelist"].includes(commandName)) {
    return canActivateSecurityCommand(interactionOrMessage.guild, member);
  }
  return allowed.some(roleId => member.roles.cache.has(roleId));
}

function canBypassHoneypot(member) {
  if (!member || !member.guild) return false;

  return member.id === member.guild.ownerId ||
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    member.permissions?.has(PermissionFlagsBits.ManageGuild);
}

async function setChannelLock(guild, channel, shouldLock) {
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel?.type)) {
    return { error: "This command can only be used in a text or announcement channel." };
  }

  const botPermissions = channel.permissionsFor(guild.members.me);
  if (!botPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    return { error: "I need the Manage Channels permission to change channel access." };
  }

  try {
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: shouldLock ? false : null });
    return { channel, locked: shouldLock };
  } catch (error) {
    console.error(`${shouldLock ? "lock" : "unlock"} failed:`, error);
    return { error: "I couldn't update this channel's permissions. Check my role and channel permissions." };
  }
}

async function sendGuildLogEmbed(guildId, action, userId, moderatorId, reason, extraDescription = null) {
  const settings = getSettings(guildId);
  if (!settings.log_channel_id) return;
  if (!getEnabledLogEvents(settings).includes("moderation")) return;

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    }
    const channel = guild.channels.cache.get(settings.log_channel_id);
    if (!channel || !channel.isTextBased()) return;

    const safeReason = safeText(reason || "No reason provided");
    const actionLabel = String(action || "event").toUpperCase();
    const description = extraDescription || `${userMention(userId)} • by ${userMention(moderatorId)}`;
    const embed = publicEmbed(`📝 Log Event: ${actionLabel}`, description, 0x5865F2).addFields(
      { name: "Action", value: actionLabel, inline: true },
      { name: "User", value: userMention(userId), inline: true },
      { name: "Moderator", value: userMention(moderatorId), inline: true },
      { name: "Reason", value: safeReason }
    );

    await channel.send({ embeds: [embed] }).catch(() => {});
  } catch {
    // no-op
  }
}

function addModLog(guildId, action, userId, moderatorId, reason, extraDescription = null) {
  const createdAt = now();
  db.prepare(`
    INSERT INTO moderation (guild_id, action, user_id, moderator_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, action, userId, moderatorId, reason || null, createdAt);

  sendGuildLogEmbed(guildId, action, userId, moderatorId, reason, extraDescription);
}

function banLogEmbed(targetId, targetUser, moderatorId, reason) {
  const username = targetUser?.tag || targetUser?.username || `User ID: ${targetId}`;
  return publicEmbed("🔨 Server Ban", "A member was banned from the server.", 0xED4245).addFields(
    { name: "Moderator", value: userMention(moderatorId) },
    { name: "Offender", value: `${userMention(targetId)} (${safeText(username)})` },
    { name: "Reason", value: safeText(reason) }
  );
}

async function sendBanLog(guild, targetId, targetUser, moderatorId, reason) {
  const channelId = getSettings(guild.id).blacklist_channel_id;
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (!channel?.isTextBased()) {
    const error = channelId
      ? `Configured blacklist channel ${channelId} is unavailable in ${guild.name}.`
      : `No blacklist log channel is configured in ${guild.name}.`;
    console.warn(error);
    return { sent: false, error };
  }

  try {
    await channel.send({
      embeds: [banLogEmbed(targetId, targetUser, moderatorId, reason)],
      allowedMentions: { parse: [] }
    });
    return { sent: true };
  } catch (error) {
    console.error(`Could not post a ban log in ${guild.name}'s blacklist channel:`, error);
    return { sent: false, error: "I couldn't send the ban log to the configured blacklist channel." };
  }
}

async function logGuildEvent(guild, title, description, color = 0x5865F2, eventType = "moderation") {
  if (!guild || !guild.id) return;

  const settings = getSettings(guild.id);
  if (!settings.log_channel_id) return;
  if (!getEnabledLogEvents(settings).includes(eventType)) return;

  try {
    const channel = guild.channels.cache.get(settings.log_channel_id);
    if (!channel || !channel.isTextBased()) return;

    await channel.send({ embeds: [publicEmbed(title, description, color)] }).catch(() => {});
  } catch {
    // no-op
  }
}

async function findRecentAuditEntry(guild, action, targetId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const auditLogs = await guild.fetchAuditLogs({ type: action, limit: 6 });
      const entry = auditLogs.entries.find(candidate => {
        const entryTargetId = candidate.targetId || candidate.target?.id;
        const age = Date.now() - candidate.createdTimestamp;
        return entryTargetId === targetId && age >= 0 && age <= 15000;
      });
      if (entry) return entry;
    } catch (error) {
      console.warn(`Could not fetch audit logs for ${guild.name}:`, error.message);
      return null;
    }

    if (attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return null;
}

async function sendServerAuditLog(guild, embed) {
  const settings = getSettings(guild.id);
  if (!settings.server_logs_enabled || !settings.server_log_channel_id) return;

  const channel = guild.channels.cache.get(settings.server_log_channel_id);
  if (!channel || !channel.isTextBased()) {
    console.warn(`Server audit log channel is unavailable in ${guild.name}.`);
    return;
  }

  try {
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.warn(`Could not post a server audit log in ${guild.name}:`, error.message);
  }
}

function auditChangeValue(value) {
  if (value === null || value === undefined) return "None";
  if (Array.isArray(value)) return value.map(auditChangeValue).join(", ").slice(0, 500) || "None";
  if (typeof value === "object") {
    const label = value.name || value.username || value.id;
    if (label) return String(label).slice(0, 500);
    try {
      return JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item).slice(0, 500);
    } catch (error) {
      console.warn("Could not format an audit log change:", error.message);
      return "[Unserializable change]";
    }
  }
  return safeText(String(value)).slice(0, 500);
}

function auditActionLabel(action) {
  const labels = {
    [AuditLogEvent.GuildUpdate]: "Server Updated",
    [AuditLogEvent.ChannelCreate]: "Channel Created",
    [AuditLogEvent.ChannelUpdate]: "Channel Updated",
    [AuditLogEvent.ChannelDelete]: "Channel Deleted",
    [AuditLogEvent.ChannelOverwriteCreate]: "Channel Permission Overwrite Created",
    [AuditLogEvent.ChannelOverwriteUpdate]: "Channel Permissions Updated",
    [AuditLogEvent.ChannelOverwriteDelete]: "Channel Permission Overwrite Deleted",
    [AuditLogEvent.MemberKick]: "Member Kicked",
    [AuditLogEvent.MemberPrune]: "Members Pruned",
    [AuditLogEvent.MemberBanAdd]: "Member Banned",
    [AuditLogEvent.MemberBanRemove]: "Member Unbanned",
    [AuditLogEvent.MemberMove]: "Members Moved in Voice",
    [AuditLogEvent.MemberDisconnect]: "Member Disconnected from Voice",
    [AuditLogEvent.BotAdd]: "Bot Added",
    [AuditLogEvent.RoleCreate]: "Role Created",
    [AuditLogEvent.RoleUpdate]: "Role Updated",
    [AuditLogEvent.RoleDelete]: "Role Deleted",
    [AuditLogEvent.InviteCreate]: "Invite Created",
    [AuditLogEvent.InviteUpdate]: "Invite Updated",
    [AuditLogEvent.InviteDelete]: "Invite Deleted",
    [AuditLogEvent.WebhookCreate]: "Webhook Created",
    [AuditLogEvent.WebhookUpdate]: "Webhook Updated",
    [AuditLogEvent.WebhookDelete]: "Webhook Deleted",
    [AuditLogEvent.EmojiCreate]: "Emoji Created",
    [AuditLogEvent.EmojiUpdate]: "Emoji Updated",
    [AuditLogEvent.EmojiDelete]: "Emoji Deleted",
    [AuditLogEvent.MessageDelete]: "Message Deleted",
    [AuditLogEvent.MessageBulkDelete]: "Messages Bulk Deleted",
    [AuditLogEvent.MessagePin]: "Message Pinned",
    [AuditLogEvent.MessageUnpin]: "Message Unpinned",
    [AuditLogEvent.ApplicationCommandPermissionUpdate]: "Application Command Permissions Updated",
    [AuditLogEvent.IntegrationCreate]: "Integration Created",
    [AuditLogEvent.IntegrationUpdate]: "Integration Updated",
    [AuditLogEvent.IntegrationDelete]: "Integration Deleted",
    [AuditLogEvent.StageInstanceCreate]: "Stage Created",
    [AuditLogEvent.StageInstanceUpdate]: "Stage Updated",
    [AuditLogEvent.StageInstanceDelete]: "Stage Deleted",
    [AuditLogEvent.StickerCreate]: "Sticker Created",
    [AuditLogEvent.StickerUpdate]: "Sticker Updated",
    [AuditLogEvent.StickerDelete]: "Sticker Deleted",
    [AuditLogEvent.GuildScheduledEventCreate]: "Scheduled Event Created",
    [AuditLogEvent.GuildScheduledEventUpdate]: "Scheduled Event Updated",
    [AuditLogEvent.GuildScheduledEventDelete]: "Scheduled Event Deleted",
    [AuditLogEvent.ThreadCreate]: "Thread Created",
    [AuditLogEvent.ThreadUpdate]: "Thread Updated",
    [AuditLogEvent.ThreadDelete]: "Thread Deleted",
    [AuditLogEvent.SoundboardSoundCreate]: "Soundboard Sound Created",
    [AuditLogEvent.SoundboardSoundUpdate]: "Soundboard Sound Updated",
    [AuditLogEvent.SoundboardSoundDelete]: "Soundboard Sound Deleted",
    [AuditLogEvent.AutoModerationRuleCreate]: "AutoMod Rule Created",
    [AuditLogEvent.AutoModerationRuleUpdate]: "AutoMod Rule Updated",
    [AuditLogEvent.AutoModerationRuleDelete]: "AutoMod Rule Deleted",
    [AuditLogEvent.AutoModerationBlockMessage]: "AutoMod Blocked a Message",
    [AuditLogEvent.AutoModerationFlagToChannel]: "AutoMod Flagged a Message",
    [AuditLogEvent.AutoModerationUserCommunicationDisabled]: "AutoMod Timed Out a Member",
    [AuditLogEvent.AutoModerationQuarantineUser]: "AutoMod Quarantined a Member",
    [AuditLogEvent.CreatorMonetizationRequestCreated]: "Creator Monetization Request Created",
    [AuditLogEvent.CreatorMonetizationTermsAccepted]: "Creator Monetization Terms Accepted",
    [AuditLogEvent.OnboardingPromptCreate]: "Onboarding Prompt Created",
    [AuditLogEvent.OnboardingPromptUpdate]: "Onboarding Prompt Updated",
    [AuditLogEvent.OnboardingPromptDelete]: "Onboarding Prompt Deleted",
    [AuditLogEvent.OnboardingCreate]: "Onboarding Created",
    [AuditLogEvent.OnboardingUpdate]: "Onboarding Updated",
    [AuditLogEvent.HomeSettingsCreate]: "Server Home Settings Created",
    [AuditLogEvent.HomeSettingsUpdate]: "Server Home Settings Updated",
    [AuditLogEvent.VoiceChannelStatusCreate]: "Voice Channel Status Created",
    [AuditLogEvent.VoiceChannelStatusDelete]: "Voice Channel Status Deleted"
  };
  const name = AuditLogEvent[action];
  const fallback = name ? name.replace(/([a-z])([A-Z])/g, "$1 $2") : `Server Action ${action}`;
  return labels[action] || fallback;
}

function serverAuditEntryEmbed(entry) {
  const action = entry.action;
  const label = auditActionLabel(action);
  const targetId = entry.targetId || entry.target?.id;
  const targetName = entry.target?.name || entry.target?.username || entry.target?.tag;
  let target = targetName ? `**${safeText(targetName)}**` : "Unknown";
  if (targetId && USER_AUDIT_ACTIONS.has(action)) target = `${userMention(targetId)}${targetName ? ` (${safeText(targetName)})` : ""}`;
  else if (targetId && [AuditLogEvent.RoleCreate, AuditLogEvent.RoleUpdate, AuditLogEvent.RoleDelete].includes(action)) target = `${roleMention(targetId)}${targetName ? ` (${safeText(targetName)})` : ""}`;
  else if (targetId && [
    AuditLogEvent.ChannelCreate,
    AuditLogEvent.ChannelUpdate,
    AuditLogEvent.ChannelDelete,
    AuditLogEvent.ChannelOverwriteCreate,
    AuditLogEvent.ChannelOverwriteUpdate,
    AuditLogEvent.ChannelOverwriteDelete
  ].includes(action)) target = `${channelMention(targetId)}${targetName ? ` (${safeText(targetName)})` : ""}`;
  else if (targetId) target += ` (ID: ${targetId})`;

  const details = [
    { name: "Target", value: target, inline: false }
  ];
  if (entry.extra?.channel?.id) {
    details.push({ name: "Channel", value: channelMention(entry.extra.channel.id), inline: true });
  }
  if (Number.isFinite(entry.extra?.count)) {
    details.push({ name: "Count", value: String(entry.extra.count), inline: true });
  }
  for (const change of (entry.changes || []).slice(0, 4)) {
    const key = safeText(String(change.key).replace(/[_$]/g, " ").trim()).slice(0, 256);
    details.push({
      name: key || "Change",
      value: `Before: ${auditChangeValue(change.old).slice(0, 400)}\nAfter: ${auditChangeValue(change.new).slice(0, 400)}`,
      inline: false
    });
  }
  if (entry.reason) details.push({ name: "Reason", value: safeText(entry.reason), inline: false });
  details.push(
    { name: "Moderator", value: entry.executorId ? userMention(entry.executorId) : "Unknown", inline: true },
    { name: "Audit Entry", value: `ID: ${entry.id} • ${timestamp(entry.createdTimestamp)}`, inline: true }
  );

  let color = 0x3498DB;
  if (/Deleted|Kicked|Banned|Blocked|Timed Out|Quarantined|Disconnected|Pruned/.test(label)) color = 0xED4245;
  else if (/Created|Unbanned|Unpinned/.test(label)) color = 0x57F287;
  return publicEmbed(`📋 ${label}`, "A server audit-log action was recorded.", color).addFields(details);
}

// ---------------------------------------------------------------------------
// Deleted-message logging.
// Discord's audit log says THAT a message was deleted, never WHAT it said, so the bot keeps
// the last few thousand messages in memory (only in servers with server logs switched on)
// and looks the text up when the delete event arrives. Nothing is written to disk.
// ---------------------------------------------------------------------------
const MESSAGE_CACHE_LIMIT = 5000;
const messageCache = new Map();
const ignoredDeletes = new Set();
const serverLogStatus = db.prepare("SELECT server_logs_enabled AS enabled, server_log_channel_id AS channel FROM settings WHERE guild_id = ?");

function serverLogsActive(guildId) {
  const row = serverLogStatus.get(guildId);
  return Boolean(row && row.enabled && row.channel);
}

function attachmentsOf(message) {
  const list = message.attachments ? [...message.attachments.values()] : [];
  return list.map(attachment => ({ name: attachment.name || "file", url: attachment.url }));
}

function rememberMessage(message) {
  if (!message.guild || !message.id || !serverLogsActive(message.guild.id)) return;

  messageCache.set(message.id, {
    content: message.content || "",
    authorId: message.author?.id || null,
    authorTag: message.author?.tag || message.author?.username || null,
    attachments: attachmentsOf(message)
  });
  if (messageCache.size > MESSAGE_CACHE_LIMIT) {
    messageCache.delete(messageCache.keys().next().value);
  }
}

// Messages the bot deletes on purpose (join ghost-pings) shouldn't show up as "deleted messages".
function ignoreDeleteOf(messageId) {
  ignoredDeletes.add(messageId);
  if (ignoredDeletes.size > 200) ignoredDeletes.delete(ignoredDeletes.values().next().value);
}

async function logServerAuditEntry(entry, guild) {
  if (!SERVER_AUDIT_ACTIONS.has(entry.action)) return;
  // Single message deletes are logged by the messageDelete handler, which can show the text too.
  if (entry.action === AuditLogEvent.MessageDelete) return;
  const settings = getSettings(guild.id);
  if (!settings.server_logs_enabled || !settings.server_log_channel_id) return;

  await sendServerAuditLog(guild, serverAuditEntryEmbed(entry));
}

function canActivateSecurityCommand(guild, member) {
  if (!guild || !member) return false;
  if (member.id === guild.ownerId) return true;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;

  const botMember = guild.members.me;
  if (!botMember?.roles?.highest) return false;
  if (!member.roles?.highest) return false;

  return member.roles.highest.comparePositionTo(botMember.roles.highest) > 0;
}

function canModerateMember(guild, moderator, target) {
  if (!guild || !moderator || !target) return false;
  if (target.id === guild.members.me?.id) return false;
  if (target.id === moderator.id) return false;
  if (moderator.id === guild.ownerId) return true;
  if (!moderator.roles?.highest || !target.roles?.highest) return false;

  return target.roles.highest.comparePositionTo(moderator.roles.highest) < 0;
}

const HIGH_RISK_PERMISSION_MASK = HIGH_RISK_ROLE_PERMISSIONS.reduce((mask, permission) => mask | permission, 0n);

function roleHasHighRiskPermissions(role) {
  return (role.permissions.bitfield & HIGH_RISK_PERMISSION_MASK) !== 0n;
}

function isCriticalAuditEntry(guild, entry) {
  if (CRITICAL_AUDIT_ACTIONS.has(entry.action)) return true;

  const changes = entry.changes || [];
  if (entry.action === AuditLogEvent.RoleUpdate) {
    const permissionChange = changes.find(change => change.key === "permissions");
    if (!permissionChange) return false;

    try {
      const oldPermissions = BigInt(permissionChange.old || "0");
      const newPermissions = BigInt(permissionChange.new || "0");
      return ((newPermissions & HIGH_RISK_PERMISSION_MASK) & ~(oldPermissions & HIGH_RISK_PERMISSION_MASK)) !== 0n;
    } catch {
      return false;
    }
  }

  if (entry.action === AuditLogEvent.MemberRoleUpdate) {
    const addedRoles = changes.find(change => change.key === "$add")?.new;
    return Array.isArray(addedRoles) && addedRoles.some(roleInfo => {
      const role = guild.roles.cache.get(roleInfo.id);
      return role && roleHasHighRiskPermissions(role);
    });
  }

  return false;
}

function isAntiNukeWhitelisted(guildId, userId) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM anti_nuke_whitelist
    WHERE guild_id = ? AND user_id = ?
  `).get(guildId, userId));
}

function getRemovedHighRiskRoleCount(guild, entry) {
  if (entry.action !== AuditLogEvent.MemberRoleUpdate) return 0;

  const removedRoles = entry.changes?.find(change => change.key === "$remove")?.new;
  if (!Array.isArray(removedRoles)) return 0;

  return new Set(removedRoles
    .map(roleInfo => roleInfo?.id)
    .filter(Boolean)
    .filter(roleId => {
      const role = guild.roles.cache.get(roleId);
      return role && roleHasHighRiskPermissions(role);
    })).size;
}

async function sendSecurityAlert(guild, description, alertType = "nuke") {
  const embed = publicEmbed("🛡️ Security Protection Triggered", description, 0xED4245);
  const settings = getSettings(guild.id);
  const alertChannelId = alertType === "raid"
    ? settings.raid_alert_channel_id
    : settings.nuke_alert_channel_id;

  if (alertChannelId) {
    const alertChannel = guild.channels.cache.get(alertChannelId);
    if (alertChannel?.isTextBased()) {
      try {
        await alertChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
        return;
      } catch (error) {
        console.warn(`Could not post a security alert in ${guild.name}'s configured alert channel:`, error.message);
      }
    } else {
      console.warn(`Configured security alert channel ${alertChannelId} is unavailable in ${guild.name}.`);
    }
  }

  if (guild.systemChannel?.isTextBased()) {
    try {
      await guild.systemChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    } catch (error) {
      console.warn(`Could not post a security alert in ${guild.name}'s system channel:`, error.message);
    }
  }

  try {
    const owner = await guild.fetchOwner();
    await owner.send({ embeds: [embed] });
  } catch (error) {
    console.warn(`Could not DM ${guild.name}'s owner about a security event:`, error.message);
  }
}

async function notifyGuildAdministrators(guild, description) {
  let members;
  try {
    members = await guild.members.fetch();
  } catch (error) {
    console.warn(`Could not fetch all members to send an anti-nuke alert in ${guild.name}:`, error.message);
    members = guild.members.cache;
  }

  const administrators = members.filter(member =>
    member.id !== getBotIdentity().id && member.permissions.has(PermissionFlagsBits.Administrator)
  );
  const embed = publicEmbed("🚨 Anti-Nuke Alert", description, 0xED4245);
  const results = await Promise.allSettled(
    administrators.map(member => member.send({ embeds: [embed] }))
  );

  return {
    adminCount: administrators.size,
    dmCount: results.filter(result => result.status === "fulfilled").length
  };
}

async function applyRaidTimeout(member) {
  if (member.user.bot || member.permissions.has(PermissionFlagsBits.Administrator) || !member.moderatable) return false;

  try {
    await member.timeout(SECURITY_LIMITS.raidTimeoutMs, "Automatic anti-raid protection");
    return true;
  } catch (error) {
    console.warn(`Could not apply anti-raid timeout to ${member.user.tag}:`, error.message);
    return false;
  }
}

async function handleRaidJoin(member) {
  const guildId = member.guild.id;
  const currentTime = Date.now();
  const recentJoins = (recentJoinWindows.get(guildId) || [])
    .filter(join => currentTime - join.joinedAt <= SECURITY_LIMITS.raidWindowMs);
  recentJoins.push({ member, joinedAt: currentTime });
  recentJoinWindows.set(guildId, recentJoins);

  const raidIsActive = (raidProtectionUntil.get(guildId) || 0) > currentTime;
  if (!raidIsActive && recentJoins.length < SECURITY_LIMITS.raidJoinCount) return;

  raidProtectionUntil.set(guildId, currentTime + SECURITY_LIMITS.raidTimeoutMs);
  const membersToTimeout = raidIsActive ? [member] : recentJoins.map(join => join.member);
  let timedOutCount = 0;

  for (const joiningMember of membersToTimeout) {
    if (await applyRaidTimeout(joiningMember)) timedOutCount += 1;
  }

  if (!raidIsActive) {
    await sendSecurityAlert(member.guild, `A join burst triggered raid protection. ${timedOutCount} recent member(s) were timed out for 24 hours.`, "raid");
  }
}

async function handleAntiNukeAuditEntry(entry, guild) {
  const executorId = entry.executorId;
  if (!executorId || executorId === getBotIdentity().id || executorId === guild.ownerId) return;
  if (isAntiNukeWhitelisted(guild.id, executorId)) return;

  const removedHighRiskRoleCount = getRemovedHighRiskRoleCount(guild, entry);
  if (removedHighRiskRoleCount >= 10) {
    const target = entry.targetId ? userMention(entry.targetId) : "a member";
    await sendSecurityAlert(
      guild,
      `${userMention(executorId)} removed ${removedHighRiskRoleCount} high-risk roles from ${target}.`,
      "nuke"
    );
    return;
  }

  const currentTime = Date.now();
  const windowKey = `${guild.id}:${executorId}`;

  if (entry.action === AuditLogEvent.ChannelDelete) {
    const state = channelDeleteWindows.get(windowKey) || { timestamps: [], triggered: false };
    state.timestamps = state.timestamps.filter(time => currentTime - time <= SECURITY_LIMITS.channelDeleteWindowMs);
    if (!state.timestamps.length) state.triggered = false;
    state.timestamps.push(currentTime);
    channelDeleteWindows.set(windowKey, state);

    if (state.triggered || state.timestamps.length < SECURITY_LIMITS.channelDeleteCount) return;
    state.triggered = true;

    const executor = await guild.members.fetch(executorId).catch(() => null);
    let alert;
    if (!executor) {
      alert = `A member deleted at least ${SECURITY_LIMITS.channelDeleteCount} channels within 10 seconds, but I could not find them in the server to blacklist.`;
    } else {
      const result = await doBlacklist(
        guild,
        guild.members.me,
        executor,
        "❌ Unappealable",
        `Automatic anti-nuke protection: deleted at least ${SECURITY_LIMITS.channelDeleteCount} channels within 10 seconds.`,
        { allowAdministrator: true }
      );

      const outcome = result.error ? `I could not blacklist them: ${result.error}` : "They were automatically blacklisted.";
      alert = `${userMention(executorId)} deleted at least ${SECURITY_LIMITS.channelDeleteCount} channels within 10 seconds. ${outcome}`;

      if (!result.error) {
        const settings = getSettings(guild.id);
        const logChannel = guild.channels.cache.get(settings.blacklist_channel_id);
        if (logChannel?.isTextBased()) await logChannel.send({ embeds: [result.embed] }).catch(() => {});
      }
    }

    const delivery = await notifyGuildAdministrators(guild, `${guild.name}: ${alert}`);
    await sendSecurityAlert(guild, `${alert} Admin DMs delivered: ${delivery.dmCount}/${delivery.adminCount}.`, "nuke");

    return;
  }

  if (!isCriticalAuditEntry(guild, entry)) return;

  const state = nukeActionWindows.get(windowKey) || { timestamps: [], triggered: false };
  state.timestamps = state.timestamps.filter(time => currentTime - time <= SECURITY_LIMITS.nukeWindowMs);
  if (!state.timestamps.length) state.triggered = false;
  state.timestamps.push(currentTime);
  nukeActionWindows.set(windowKey, state);

  if (state.triggered || state.timestamps.length < SECURITY_LIMITS.nukeActionCount) return;
  state.triggered = true;

  const executor = await guild.members.fetch(executorId).catch(() => null);
  const botMember = guild.members.me;
  let removedRoles = 0;

  if (executor?.manageable && botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    const dangerousRoles = executor.roles.cache.filter(role =>
      role.id !== guild.id && role.editable && roleHasHighRiskPermissions(role)
    );

    if (dangerousRoles.size) {
      try {
        await executor.roles.remove(dangerousRoles, "Automatic anti-nuke protection");
        removedRoles = dangerousRoles.size;
      } catch (error) {
        console.warn(`Could not remove high-risk roles from ${executor.user.tag}:`, error.message);
      }
    }
  }

  const mitigation = removedRoles ? `Removed ${removedRoles} high-risk role(s).` : "I could not remove any high-risk roles; check my Manage Roles permission and role hierarchy.";
  await sendSecurityAlert(guild, `${userMention(executorId)} performed ${state.timestamps.length} critical server actions within 10 seconds. ${mitigation}`, "nuke");
}

// The role handed out when someone is blacklisted: the one picked in /setup,
// otherwise the role literally named "Blacklisted" (the old behaviour).
function getBlacklistRole(guild, settings = getSettings(guild.id)) {
  return (settings.blacklist_role_id && guild.roles.cache.get(settings.blacklist_role_id))
    || guild.roles.cache.find(role => role.name.toLowerCase() === BLACKLIST_ROLE_NAME)
    || null;
}

// Turns the saved appeal setting into a safe, clickable link, or null if it isn't a usable URL.
// Accepts "https://discord.gg/abc", "discord.gg/abc", "discord.com/invite/abc" or any http(s) page.
// A bare server ID can't be turned into a join link, so it returns null (no broken link is shown).
function getValidAppealUrl(value) {
  if (!value) return null;

  let text = String(value).trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) {
    if (!/^[\w-]+(\.[\w-]+)+(\/|$)/.test(text)) return null;
    text = `https://${text}`;
  }

  try {
    const url = new URL(text);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    // Parentheses would end the markdown link early.
    return url.href.replace(/\(/g, "%28").replace(/\)/g, "%29");
  } catch {
    return null;
  }
}

async function doBlacklist(guild, moderator, target, category, reason, options = {}) {
  const targetMember = target?.user ? target : null;
  const targetUser = targetMember?.user || target;
  if (!targetUser?.id) return { error: "Enter a valid Discord user ID or mention." };
  if (targetUser.id === moderator.id) return { error: "You cannot blacklist yourself." };
  if (!options.allowAdministrator && targetMember?.permissions.has(PermissionFlagsBits.Administrator)) {
    return { error: "This person has administrator permission." };
  }

  const botMember = guild.members.me;
  if (!botMember) return { error: "I could not determine my role position in this server." };
  if (targetMember) {
    if (!targetMember.roles?.highest || !botMember.roles?.highest) {
      return { error: "I could not determine the role hierarchy for this user." };
    }

    if (targetMember.roles.highest.comparePositionTo(botMember.roles.highest) >= 0) {
      return { error: "This person is at or above the bot in the hierarchy, so I cannot blacklist them." };
    }

    if (!moderator.roles?.highest) {
      return { error: "I could not determine your role hierarchy." };
    }

    if (targetMember.roles.highest.comparePositionTo(moderator.roles.highest) >= 0) {
      return { error: "This person is at or above you in the hierarchy." };
    }
    if (!targetMember.manageable) return { error: "I cannot manage this user. Move my bot role above their highest role." };
  }

  const settings = getSettings(guild.id);
  const blacklistRole = getBlacklistRole(guild, settings);

  if (!blacklistRole) return { error: `No blacklist role is set. An administrator can pick one in \`/setup\` > Set Blacklist Role, or create a role named \`${BLACKLIST_ROLE_NAME}\`.` };
  if (!blacklistRole.editable) return { error: "I cannot manage the Blacklisted role. Move my bot role above it." };

  const savedRoles = targetMember
    ? targetMember.roles.cache
      .filter(role => role.id !== guild.id && role.id !== blacklistRole.id && !role.managed)
      .map(role => role.id)
    : [];
  if (targetMember) {
    const removableRoles = savedRoles
      .map(roleId => guild.roles.cache.get(roleId))
      .filter(role => role && role.editable);

    try {
      if (removableRoles.length) {
        await targetMember.roles.remove(removableRoles);
      }

      await targetMember.roles.add(blacklistRole);
    } catch (error) {
      console.error("Blacklist role assignment failed:", error);
      return { error: "I couldn't change that user's roles. Check that I have Manage Roles permission and my bot role is above the user's roles." };
    }
  }

  const createdAt = now();

  const insertBlacklistRecord = db.transaction(() => {
    const caseNumber = db.prepare(`
      SELECT COALESCE(MAX(case_number), 0) + 1 AS case_number
      FROM blacklist_records
      WHERE guild_id = ?
    `).get(guild.id).case_number;
    db.prepare(`
      INSERT INTO blacklist_records (case_number, guild_id, user_id, moderator_id, category, reason, roles_json, roles_count, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(caseNumber, guild.id, targetUser.id, moderator.id, category, reason, JSON.stringify(savedRoles), savedRoles.length, createdAt);
    return caseNumber;
  });
  const caseNumber = insertBlacklistRecord();

  addModLog(guild.id, "blacklist", targetUser.id, moderator.id, reason);

  const appealUrl = getValidAppealUrl(settings.appeal_link);
  const appealText = appealUrl ? `\n\n[Click here to appeal](${appealUrl})` : "";

  const embed = publicEmbed("⛔ User Blacklisted", `${userMention(targetUser.id)} has been blacklisted.`, 0xED4245).addFields(
    { name: "👤 User", value: userMention(targetUser.id), inline: true },
    { name: "👮 Responsible Moderator", value: userMention(moderator.id), inline: true },
    { name: "📂 Category", value: category, inline: true },
    { name: "📘 Case", value: `#${caseNumber}`, inline: true },
    { name: "📝 Reason", value: safeText(reason), inline: false },
    { name: "🎭 Roles Stored", value: String(savedRoles.length), inline: true },
    { name: "📅 Date", value: timestamp(createdAt), inline: true }
  );

  let dmStatus = "❌ Failed";

  try {
    await targetUser.send({
      embeds: [publicEmbed("⛔ You Have Been Blacklisted", `You have been blacklisted in **${guild.name}**.\n\n**Category:** ${category}\n**Reason:** ${safeText(reason)}${appealText}`, 0xED4245)]
    });
    dmStatus = "✅ Sent";
  } catch {
    dmStatus = "❌ Failed";
  }

  embed.addFields({ name: "📩 DM Status", value: dmStatus, inline: true });

  return { embed };
}

function blacklistCaseEmbed(record, title = `📘 Blacklist Case #${record.case_number}`, description = "Blacklist case details") {
  return publicEmbed(title, description, 0x5865F2).addFields(
    { name: "Action", value: "BLACKLIST", inline: true },
    { name: "Status", value: record.active ? "Active" : "Inactive", inline: true },
    { name: "User", value: userMention(record.user_id), inline: true },
    { name: "Moderator", value: userMention(record.moderator_id), inline: true },
    { name: "Category", value: safeText(record.category).slice(0, 1024), inline: true },
    { name: "Reason", value: safeText(record.reason || "No reason provided").slice(0, 1024) },
    { name: "Date", value: timestamp(record.created_at), inline: true }
  );
}

async function doUnblacklist(guild, moderator, target, reason) {
  const record = db.prepare(`
    SELECT *
    FROM blacklist_records
    WHERE guild_id = ?
    AND user_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(guild.id, target.id);

  const namedRole = guild.roles.cache.find(role => role.name === BLACKLIST_ROLE_NAME);
  const blacklistRoles = [...new Set([getBlacklistRole(guild), namedRole].filter(Boolean))]
    .filter(role => target.roles.cache.has(role.id));
  const hasBlacklistedRole = blacklistRoles.length > 0;

  if (!record || (!record.active && !hasBlacklistedRole)) {
    return { error: `${userMention(target.id)} is not currently blacklisted.` };
  }

  let savedRoles = [];
  try {
    savedRoles = JSON.parse(record.roles_json || "[]");
  } catch {
    savedRoles = [];
  }

  const blockedRoles = [];

  for (const roleId of savedRoles) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;
    if (!role.editable) blockedRoles.push(role.name);
  }

  if (blockedRoles.length) {
    return {
      error: "❌ I cannot restore these roles because they are above my bot role:\n\n" + blockedRoles.map(name => `• ${name}`).join("\n")
    };
  }

  if (blacklistRoles.length) {
    await target.roles.remove(blacklistRoles).catch(() => {});
  }

  const restoredRoles = [];
  const missingRoles = [];

  for (const roleId of savedRoles) {
    const role = guild.roles.cache.get(roleId);
    if (!role) {
      missingRoles.push(roleId);
      continue;
    }

    try {
      await target.roles.add(role);
      restoredRoles.push(role.name);
    } catch {
      return { error: `❌ I could not restore the role **${role.name}**. The blacklist was NOT marked inactive.` };
    }
  }

  db.prepare(`
    UPDATE blacklist_records
    SET active = 0
    WHERE id = ?
  `).run(record.id);

  addModLog(guild.id, "unblacklist", target.id, moderator.id, reason);

  const embed = publicEmbed("✅ User Unblacklisted", `${userMention(target.id)} has been unblacklisted successfully.`, 0x57F287).addFields(
    { name: "👤 User", value: userMention(target.id), inline: true },
    { name: "👮 Moderator", value: userMention(moderator.id), inline: true },
    { name: "🎭 Roles Restored", value: String(restoredRoles.length), inline: true },
    { name: "📂 Original Category", value: record.category, inline: true },
    { name: "📝 Original Reason", value: safeText(record.reason), inline: false },
    { name: "📝 Unblacklist Reason", value: safeText(reason), inline: false },
    { name: "📅 Original Date", value: timestamp(record.created_at), inline: true }
  );

  if (missingRoles.length) {
    embed.addFields({ name: "⚠️ Roles No Longer In Server", value: `${missingRoles.length} saved role(s) no longer exist.` });
  }

  return { embed };
}

function blacklistListEmbed(guildId, page = 1) {
  const records = db.prepare(`
    SELECT id, user_id, moderator_id, category, reason, created_at
    FROM blacklist_records
    WHERE guild_id = ? AND active = 1
    ORDER BY id DESC
  `).all(guildId);

  const uniqueRecords = [...new Map(records.map(record => [record.user_id, record])).values()];
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(uniqueRecords.length / pageSize));

  if (!Number.isInteger(page) || page < 1 || page > pageCount) {
    return { error: `There are ${pageCount} page(s) of active blacklists.` };
  }

  const pageRecords = uniqueRecords.slice((page - 1) * pageSize, page * pageSize);
  const embed = publicEmbed(
    "⛔ Current Blacklist",
    `**${uniqueRecords.length}** currently blacklisted member(s)`,
    0xED4245
  );

  const controls = createBlacklistListControls(page, pageCount);
  const moderatorIds = [...new Set(pageRecords.map(record => record.moderator_id))];
  const mentionContent = moderatorIds.length
    ? `Moderator ping: ${moderatorIds.map(userMention).join(" ")}`
    : null;

  if (!pageRecords.length) {
    embed.setDescription("No members are currently blacklisted.");
    return { embed, components: [controls], moderatorIds, mentionContent };
  }

  for (const [index, record] of pageRecords.entries()) {
    const reason = safeText(record.reason).slice(0, 300);
    embed.addFields({
      name: `${(page - 1) * pageSize + index + 1}. ${userMention(record.user_id)} · ${safeText(record.category)}`,
      value: `${reason}\nModerator: ${userMention(record.moderator_id)} · ${timestamp(record.created_at)}`,
      inline: true
    });
  }

  return { embed, components: [controls], moderatorIds, mentionContent };
}

function createBlacklistListControls(page, pageCount) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("blacklistlist_page:first:1")
      .setLabel("⏮ First")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`blacklistlist_page:prev:${Math.max(1, page - 1)}`)
      .setLabel("◀ Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`blacklistlist_page:current:${page}`)
      .setLabel(`Page ${page}/${pageCount}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`blacklistlist_page:next:${Math.min(pageCount, page + 1)}`)
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pageCount),
    new ButtonBuilder()
      .setCustomId(`blacklistlist_page:last:${pageCount}`)
      .setLabel("Last ⏭")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pageCount)
  );
}

function parseDuration(duration) {
  const match = /^(\d+)(s|m|h|d)$/i.exec(duration);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };

  return amount * multipliers[unit];
}

async function doMute(guild, moderator, target, duration, reason) {
  if (!target) return { error: "User not found." };
  if (!canModerateMember(guild, moderator, target)) return { error: "This person is higher than you in the hierarchy." };

  const ms = parseDuration(duration);
  const finalReason = reason || "No reason provided";

  if (!ms) return { error: "Invalid duration. Use `10m`, `1h`, `1d`, etc." };
  if (ms > 28 * 86400000) return { error: "Discord only allows timeouts up to 28 days." };
  if (!target.moderatable) return { error: "I cannot timeout this user. Check my role hierarchy." };

  try {
    await target.timeout(ms, finalReason);
  } catch (error) {
    console.error("Mute failed:", error);
    return { error: "I couldn't mute that user. Check my Timeout Members permission and role hierarchy." };
  }

  addModLog(guild.id, "mute", target.id, moderator.id, finalReason);

  return {
    embed: publicEmbed("🔇 User Muted", `${userMention(target.id)} has been muted.`, 0x5865F2).addFields(
      { name: "👤 User", value: userMention(target.id), inline: true },
      { name: "⏱️ Duration", value: duration, inline: true },
      { name: "👮 Moderator", value: userMention(moderator.id), inline: true },
      { name: "📝 Reason", value: safeText(finalReason) }
    )
  };
}

async function doUnmute(guild, moderator, target, reason) {
  if (!target) return { error: "User not found." };
  if (!canModerateMember(guild, moderator, target)) return { error: "This person is higher than you in the hierarchy." };
  if (!target.communicationDisabledUntilTimestamp) return { error: `${userMention(target.id)} is not currently muted.` };

  try {
    await target.timeout(null, reason);
  } catch (error) {
    console.error("Unmute failed:", error);
    return { error: "I couldn't unmute that user. Check my Timeout Members permission and role hierarchy." };
  }

  addModLog(guild.id, "unmute", target.id, moderator.id, reason);

  return {
    embed: publicEmbed("🔊 User Unmuted", `${userMention(target.id)} has been unmuted.`, 0x57F287).addFields(
      { name: "👤 User", value: userMention(target.id), inline: true },
      { name: "👮 Moderator", value: userMention(moderator.id), inline: true },
      { name: "📝 Reason", value: safeText(reason), inline: false }
    )
  };
}

async function doAddRole(guild, moderator, target, role, reason) {
  if (!target) return { error: "User not found." };
  if (!role) return { error: "Role not found." };
  const botMember = guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) return { error: "I need the Manage Roles permission." };
  if (!role.editable || role.comparePositionTo(botMember.roles.highest) >= 0) return { error: "I can't manage that role because it's above or equal to my top role." };
  if (!canModerateMember(guild, moderator, target)) return { error: "This person is higher than you in the hierarchy." };

  if (target.roles.cache.has(role.id)) {
    return { embed: publicEmbed("🎭 Role Already Present", `${userMention(target.id)} already has ${role}.`, 0x57F287) };
  }

  try {
    await target.roles.add(role, reason || "Role added by moderator");
  } catch (error) {
    console.error("AddRole failed:", error);
    return { error: "I couldn't add that role. Check my role hierarchy and Manage Roles permission." };
  }

  addModLog(guild.id, "addrole", target.id, moderator.id, `${role.name} | ${reason || "No reason provided"}`);

  return {
    embed: publicEmbed("🎭 Role Added", `${userMention(target.id)} was given ${role}.`, 0x57F287).addFields(
      { name: "👤 User", value: userMention(target.id), inline: true },
      { name: "🎭 Role", value: role.name, inline: true },
      { name: "👮 Moderator", value: userMention(moderator.id), inline: true },
      { name: "📝 Reason", value: safeText(reason || "No reason provided") }
    )
  };
}

async function doRemoveRole(guild, moderator, target, role, reason) {
  if (!target) return { error: "User not found." };
  if (!role) return { error: "Role not found." };
  const botMember = guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) return { error: "I need the Manage Roles permission." };
  if (!role.editable || role.comparePositionTo(botMember.roles.highest) >= 0) return { error: "I can't manage that role because it's above or equal to my top role." };
  if (!canModerateMember(guild, moderator, target)) return { error: "This person is higher than you in the hierarchy." };

  if (!target.roles.cache.has(role.id)) {
    return { embed: publicEmbed("🎭 Role Not Present", `${userMention(target.id)} does not have ${role}.`, 0x57F287) };
  }

  try {
    await target.roles.remove(role, reason || "Role removed by moderator");
  } catch (error) {
    console.error("RemoveRole failed:", error);
    return { error: "I couldn't remove that role. Check my role hierarchy and Manage Roles permission." };
  }

  addModLog(guild.id, "removerole", target.id, moderator.id, `${role.name} | ${reason || "No reason provided"}`);

  return {
    embed: publicEmbed("🎭 Role Removed", `${userMention(target.id)} lost ${role}.`, 0xED4245).addFields(
      { name: "👤 User", value: userMention(target.id), inline: true },
      { name: "🎭 Role", value: role.name, inline: true },
      { name: "👮 Moderator", value: userMention(moderator.id), inline: true },
      { name: "📝 Reason", value: safeText(reason || "No reason provided") }
    )
  };
}

function normalizeGradeRoleName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function getGradeRoleNames(name) {
  const normalizedName = normalizeGradeRoleName(name);
  const canonicalName = GRADE_ROLES.find(gradeName =>
    normalizeGradeRoleName(gradeName) === normalizedName ||
    (GRADE_ROLE_ALIASES[gradeName] || []).some(alias => normalizeGradeRoleName(alias) === normalizedName)
  );
  if (!canonicalName) return [];
  return [canonicalName, ...(GRADE_ROLE_ALIASES[canonicalName] || [])]
    .map(normalizeGradeRoleName);
}

function isGradeRole(roleName) {
  return GRADE_ROLES.some(gradeName =>
    getGradeRoleNames(gradeName).includes(normalizeGradeRoleName(roleName))
  );
}

function findGradeRole(guild, roleName, allowedNames) {
  const normalizedName = normalizeGradeRoleName(roleName);
  if (allowedNames === GRADE_ROLES) {
    const matchingNames = getGradeRoleNames(roleName);
    if (!matchingNames.length) return null;
    return guild.roles.cache.find(role => matchingNames.includes(normalizeGradeRoleName(role.name))) || null;
  }
  if (!allowedNames.some(name => normalizeGradeRoleName(name) === normalizedName)) return null;
  return guild.roles.cache.find(role => normalizeGradeRoleName(role.name) === normalizedName) || null;
}

function parseGradeRoleMessage(guild, roleText) {
  const normalizedText = normalizeGradeRoleName(roleText);
  const gradeInputs = [...GRADE_ROLES, ...Object.values(GRADE_ROLE_ALIASES).flat()];
  const gradesByLength = [...new Set(gradeInputs)].sort((left, right) => right.length - left.length);

  for (const gradeName of gradesByLength) {
    const normalizedGrade = normalizeGradeRoleName(gradeName);
    if (!normalizedText.startsWith(`${normalizedGrade} `)) continue;

    const subRoles = normalizedText.slice(normalizedGrade.length).trim().split(/\s+/);
    if (subRoles.length < 2) continue;

    const gradeRole = findGradeRole(guild, gradeName, GRADE_ROLES);
    const sub1Role = findGradeRole(guild, subRoles[0], SUB1_ROLES);
    const sub2Role = findGradeRole(guild, subRoles[1], SUB2_ROLES);
    if (gradeRole && sub1Role && sub2Role) return { gradeRole, sub1Role, sub2Role };
  }

  return null;
}

function gradeSetupProblems(guild) {
  const problems = [];
  const botMember = guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    problems.push("• I need the Manage Roles permission.");
  }

  const missing = [];
  const aboveBot = [];
  const checkRole = (label, role) => {
    if (!role) {
      missing.push(label);
    } else if (botMember?.roles?.highest && (!role.editable || role.comparePositionTo(botMember.roles.highest) >= 0)) {
      aboveBot.push(role.name);
    }
  };

  for (const name of GRADE_ROLES) checkRole(name, findGradeRole(guild, name, GRADE_ROLES));
  for (const name of SUB1_ROLES) checkRole(name, findGradeRole(guild, name, SUB1_ROLES));
  for (const name of SUB2_ROLES) checkRole(name, findGradeRole(guild, name, SUB2_ROLES));

  if (missing.length) problems.push(`• These roles don't exist in this server: ${missing.join(", ")}.`);
  if (aboveBot.length) problems.push(`• Move my bot role above: ${aboveBot.join(", ")}.`);
  return problems;
}

function gradeFormatHint(guild) {
  const lines = [
    "I couldn't read that grade. Use `@member <grade> <sub1> <sub2>`, for example `@member semi g1 low strong`.",
    `**Grades:** ${GRADE_ROLES.join(", ")} (shortcuts: Semi G1, SPG)`,
    `**Sub1:** ${SUB1_ROLES.join(", ")}  •  **Sub2:** ${SUB2_ROLES.join(", ")}`
  ];
  const problems = gradeSetupProblems(guild);
  if (problems.length) lines.push(`**Server setup problems:**\n${problems.join("\n")}`);
  return lines.join("\n");
}

async function doGradeUpdate(guild, moderator, target, gradeRole, sub1Role, sub2Role) {
  if (!target) return { error: "User not found." };
  if (!gradeRole || !sub1Role || !sub2Role) return { error: "Choose a valid grade, Sub1, and Sub2 role." };
  const botMember = guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) return { error: "I need the Manage Roles permission." };

  const isAllowedRole = (role, names) => names.some(name =>
    normalizeGradeRoleName(name) === normalizeGradeRoleName(role.name)
  );
  if (!isGradeRole(gradeRole.name) ||
      !isAllowedRole(sub1Role, SUB1_ROLES) ||
      !isAllowedRole(sub2Role, SUB2_ROLES)) {
    return { error: "The selected roles must be one valid Grade, Sub1, and Sub2 role." };
  }

  const selectedRoleIds = new Set([gradeRole.id, sub1Role.id, sub2Role.id]);
  const selectedRoles = [gradeRole, sub1Role, sub2Role];
  const unmanageableRole = selectedRoles.find(role =>
    !role.editable || role.comparePositionTo(botMember.roles.highest) >= 0
  );
  if (unmanageableRole) {
    return { error: `I can't manage ${unmanageableRole.name} because it's above or equal to my top role.` };
  }

  const oldRoles = target.roles.cache.filter(role =>
    isGradeRole(role.name) ||
    SUB1_ROLES.some(name => normalizeGradeRoleName(name) === normalizeGradeRoleName(role.name)) ||
    SUB2_ROLES.some(name => normalizeGradeRoleName(name) === normalizeGradeRoleName(role.name))
  );
  const rolesToRemove = oldRoles.filter(role =>
    !selectedRoleIds.has(role.id) &&
    role.editable &&
    role.id !== guild.roles.everyone.id
  );

  try {
    await target.roles.add(selectedRoles, `Grade roles updated by ${moderator.user.tag}`);
    if (rolesToRemove.size > 0) {
      await target.roles.remove(rolesToRemove, `Replaced by grade roles selected by ${moderator.user.tag}`);
    }
  } catch (error) {
    console.error("Grade role update failed:", error);
    return { error: "I couldn't fully update the grade roles. Check my Manage Roles permission and role hierarchy." };
  }

  const removedNames = [...rolesToRemove.values()].map(role => role.name);
  const selectedNames = selectedRoles.map(role => role.name);
  addModLog(guild.id, "grade", target.id, moderator.id, `Assigned: ${selectedNames.join(", ")}; removed: ${removedNames.join(", ") || "none"}`);

  return {
    embed: publicEmbed("🎓 Grade Roles Updated", `${userMention(target.id)}'s grade roles were updated.`, 0x57F287).addFields(
      { name: "Grade", value: gradeRole.name, inline: true },
      { name: "Sub1", value: sub1Role.name, inline: true },
      { name: "Sub2", value: sub2Role.name, inline: true },
      { name: "Removed old roles", value: removedNames.length ? removedNames.join(", ") : "None", inline: false },
      { name: "Updated By", value: userMention(moderator.id), inline: true }
    )
  };
}

async function doTempRole(guild, moderator, target, role, duration, reason) {
  if (!target) return { error: "User not found." };
  if (!role) return { error: "Role not found." };
  const botMember = guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) return { error: "I need the Manage Roles permission." };
  if (!role.editable || role.comparePositionTo(botMember.roles.highest) >= 0) return { error: "I can't manage that role because it's above or equal to my top role." };
  if (!canModerateMember(guild, moderator, target)) return { error: "This person is higher than you in the hierarchy." };

  const ms = parseDuration(duration);
  if (!ms) return { error: "Invalid duration. Use `10m`, `1h`, `1d`, etc." };
  if (ms > 28 * 86400000) return { error: "Discord only allows timeouts up to 28 days." };

  try {
    await target.roles.add(role, reason || "Temporary role granted by moderator");
  } catch (error) {
    console.error("TempRole add failed:", error);
    return { error: "I couldn't grant the temporary role. Check my role hierarchy and Manage Roles permission." };
  }

  setTimeout(async () => {
    try {
      const member = await guild.members.fetch(target.id).catch(() => null);
      if (member && member.roles.cache.has(role.id)) {
        await member.roles.remove(role, "Temporary role expired");
      }
    } catch (error) {
      console.warn(`Temp role removal failed for ${target.id}:`, error.message);
    }
  }, ms);

  addModLog(guild.id, "temprole", target.id, moderator.id, `${role.name} | ${duration} | ${reason || "No reason provided"}`);

  return {
    embed: publicEmbed("🕒 Temporary Role Added", `${userMention(target.id)} was granted ${role} for ${duration}.`, 0x5865F2).addFields(
      { name: "👤 User", value: userMention(target.id), inline: true },
      { name: "🎭 Role", value: role.name, inline: true },
      { name: "⏱️ Duration", value: duration, inline: true },
      { name: "👮 Moderator", value: userMention(moderator.id), inline: true },
      { name: "📝 Reason", value: safeText(reason || "No reason provided") }
    )
  };
}

function getActionCounts(guildId, moderatorId, since = null) {
  const query = `
    SELECT action, COUNT(*) AS count
    FROM moderation
    WHERE guild_id = ?
    AND moderator_id = ?
    ${since ? "AND created_at >= ?" : ""}
    AND action IN ('blacklist', 'warn', 'mute')
    GROUP BY action
  `;

  const params = since ? [guildId, moderatorId, since] : [guildId, moderatorId];
  const rows = db.prepare(query).all(...params);
  const counts = { blacklist: 0, warn: 0, mute: 0 };

  for (const row of rows) {
    if (row.action === "blacklist") counts.blacklist = Number(row.count || 0);
    if (row.action === "warn") counts.warn = Number(row.count || 0);
    if (row.action === "mute") counts.mute = Number(row.count || 0);
  }

  return counts;
}

function formatActionCounts(counts) {
  return [
    `Blacklist: ${counts.blacklist}`,
    `Warns: ${counts.warn}`,
    `Mute: ${counts.mute}`
  ].join("\n");
}

function modlogsEmbed(guildId, moderatorId) {
  const current = now();
  const last7Ms = current - 7 * 86400000;
  const last30Ms = current - 30 * 86400000;

  const last7 = getActionCounts(guildId, moderatorId, last7Ms);
  const last30 = getActionCounts(guildId, moderatorId, last30Ms);
  const allTime = getActionCounts(guildId, moderatorId);

  const embed = publicEmbed("📊 Moderator Logs", `Moderation activity for ${userMention(moderatorId)}.`, 0x5865F2).addFields(
    { name: "📅 Last 7 Days", value: formatActionCounts(last7), inline: false },
    { name: "📆 Last 30 Days", value: formatActionCounts(last30), inline: false },
    { name: "📚 All Time", value: formatActionCounts(allTime), inline: false }
  );

  return embed;
}

function getWarningId(guildId, userId, moderatorId, createdAt) {
  const warning = db.prepare(`
    SELECT id
    FROM warnings
    WHERE guild_id = ?
    AND user_id = ?
    AND moderator_id = ?
    AND ABS(created_at - ?) <= 5000
    ORDER BY ABS(created_at - ?) ASC
    LIMIT 1
  `).get(guildId, userId, moderatorId, createdAt, createdAt);

  return warning ? warning.id : null;
}

function serverInfoEmbed(guild) {
  if (!guild) return publicEmbed("📡 Server Info", "This command can only be used in a server.", 0xED4245);

  const memberCount = guild.memberCount || guild.members.cache.size || 0;
  const humanCount = guild.members.cache.filter(member => !member.user.bot).size;
  const botCount = guild.members.cache.filter(member => member.user.bot).size;
  const roleCount = guild.roles.cache.size;
  const channelCount = guild.channels.cache.size;
  const iconUrl = guild.iconURL({ dynamic: true, size: 256 }) || null;

  const embed = publicEmbed(
    `📡 ${guild.name}`,
    "Server overview and details.",
    0x5865F2
  );

  if (iconUrl) {
    embed.setThumbnail(iconUrl);
  }

  embed.addFields(
    { name: "🆔 Server ID", value: String(guild.id), inline: true },
    { name: "👑 Owner", value: guild.ownerId ? userMention(guild.ownerId) : "Unknown", inline: true },
    { name: "📅 Created", value: timestamp(guild.createdAt.getTime()), inline: true },
    { name: "👥 Members", value: String(memberCount), inline: true },
    { name: "🧑 Humans", value: String(humanCount), inline: true },
    { name: "🤖 Bots", value: String(botCount), inline: true },
    { name: "🎭 Roles", value: String(roleCount), inline: true },
    { name: "#️⃣ Channels", value: String(channelCount), inline: true }
  );

  return embed;
}

function userInfoEmbed(member) {
  const user = member.user;
  const roles = member.roles.cache
    .filter(role => role.id !== member.guild.id)
    .sort((first, second) => second.position - first.position)
    .map(role => role.name);
  let roleList = roles.length ? roles.map(role => safeText(role)).join(", ") : "No roles";
  if (roleList.length > 1000) roleList = `${roleList.slice(0, 997)}...`;

  const embed = publicEmbed(`👤 User Info: ${safeText(user.username)}`, userMention(user.id), 0x5865F2)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "User ID", value: user.id, inline: true },
      { name: "Username", value: safeText(user.tag || user.username), inline: true },
      { name: "Nickname", value: member.nickname ? safeText(member.nickname) : "None", inline: true },
      { name: "Account Created", value: timestamp(user.createdAt.getTime()), inline: true },
      { name: "Joined Server", value: member.joinedAt ? timestamp(member.joinedAt.getTime()) : "Unknown", inline: true },
      { name: "Roles", value: roleList, inline: false }
    );

  if (member.communicationDisabledUntilTimestamp > Date.now()) {
    embed.addFields({ name: "Timeout Until", value: timestamp(member.communicationDisabledUntilTimestamp), inline: true });
  }

  return embed;
}

function staffStrikeEmbed(member, strikes) {
  const embed = publicEmbed(
    "⚠️ Staff Strike Record",
    `${userMention(member.id)} has **${strikes.length}/3** staff strikes.`,
    strikes.length >= 3 ? 0xED4245 : 0xFEE75C
  );

  if (!strikes.length) {
    embed.setDescription(`${userMention(member.id)} has **0/3** staff strikes.`);
    return embed;
  }

  for (const strike of strikes) {
    embed.addFields({
      name: `Strike #${strike.strike_number}`,
      value: `**Reason:** ${safeText(strike.reason)}\n**Given by:** ${userMention(strike.moderator_id)}\n**Date:** ${timestamp(strike.created_at)}`
    });
  }

  return embed;
}

function strikeDeleteSelection(guildId, userId) {
  const strikes = db.prepare(`
    SELECT id, moderator_id, reason, created_at
    FROM staff_strikes
    WHERE guild_id = ? AND user_id = ?
    ORDER BY id DESC
  `).all(guildId, userId);

  if (!strikes.length) {
    return {
      embed: publicEmbed("🗑️ Delete Staff Strike", `${userMention(userId)} has no staff strikes.`, 0x57F287),
      components: []
    };
  }

  const buttons = strikes.map(strike =>
    new ButtonBuilder()
      .setCustomId(`delete_strike:${strike.id}`)
      .setLabel(`Delete #${strike.id}`)
      .setStyle(ButtonStyle.Danger)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }

  const embed = publicEmbed(
    "🗑️ Delete Staff Strike",
    `Choose a strike to delete for ${userMention(userId)}.`,
    0xED4245
  ).addFields({ name: "⚠️ Strike Count", value: String(strikes.length), inline: true });

  for (const strike of strikes) {
    embed.addFields({
      name: `Strike #${strike.id}`,
      value: `**Reason:** ${safeText(strike.reason)}\n**Given by:** ${userMention(strike.moderator_id)}\n**Date:** ${timestamp(strike.created_at)}`
    });
  }

  return { embed, components: rows };
}

function staffStrikeListEmbed(guildId, page = 1) {
  const records = db.prepare(`
    SELECT user_id, COUNT(*) AS strike_count, MAX(created_at) AS latest_strike
    FROM staff_strikes
    WHERE guild_id = ?
    GROUP BY user_id
    ORDER BY strike_count DESC, latest_strike DESC, user_id ASC
  `).all(guildId);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
  if (!Number.isInteger(page) || page < 1 || page > pageCount) {
    return { error: `There are ${pageCount} page(s) of staff strike records.` };
  }

  const pageRecords = records.slice((page - 1) * pageSize, page * pageSize);
  const embed = publicEmbed("⚠️ Staff Strike List", "Loading strike list...", 0xFEE75C);
  if (!pageRecords.length) {
    embed.setDescription("No staff strikes have been recorded.");
  } else {
    embed.setDescription(pageRecords.map(record =>
      `${userMention(record.user_id)} — **${Math.min(record.strike_count, 3)}/3**`
    ).join("\n"));
  }

  embed.setFooter({ text: `Page ${page}/${pageCount}` });
  return { embed, components: [createStaffStrikeListControls(page, pageCount)] };
}

function createStaffStrikeListControls(page, pageCount) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("strikelist_page:first:1").setLabel("⏮ First").setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`strikelist_page:prev:${Math.max(1, page - 1)}`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`strikelist_page:current:${page}`).setLabel(`Page ${page}/${pageCount}`).setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId(`strikelist_page:next:${Math.min(pageCount, page + 1)}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(page >= pageCount),
    new ButtonBuilder().setCustomId(`strikelist_page:last:${pageCount}`).setLabel("Last ⏭").setStyle(ButtonStyle.Secondary).setDisabled(page >= pageCount)
  );
}

function helpEmbed() {
  const identity = getBotIdentity();
  return publicEmbed(
    `🛡️ ${identity.username} Help`,
    `Welcome to **${identity.username}** — an all-in-one Discord server management bot.\n\nChoose a category below to view commands, usage notes and configuration guidance.`,
    0x5865F2
  ).setFooter({ text: `${identity.username} v${identity.version} • Use /changelogs for recent updates` })
    .addFields(
      { name: "📚 Command Categories", value: "**Moderation** • **Security** • **Giveaways** • **Tickets** • **Community** • **Utilities** • **Administration**", inline: false },
      { name: "🚀 Quick Start", value: "Administrators can open `/setup` to configure channels, roles, logging and command permissions.", inline: false },
      { name: "🔐 Permissions", value: "Discord permissions always apply. Administrators can add trusted roles to commands through `/setup` or `/permissions`.", inline: false }
    );
}

function helpCategoryEmbed(category) {
  const identity = getBotIdentity();
  const categories = {
    moderation: ["**Moderation**", "/warn, /warnings, /clearwarnings, /kick, /ban, /unban", "/timeout, /untimeout, /mute, /unmute", "/purge, /slowmode, /lock, /unlock", "/nick, /role, /modlogs, /cases"],
    security: ["**Security**", "/antispam, /antiraid, /antilink, /antimention, /antibot", "/raidmode, /security", "/raid, /whitelist, /honeypot"],
    giveaways: ["**Giveaways**", "/giveaway create/end/reroll/cancel/list", "/giveawayreroll, /giveawayend, /giveawaylist", "/giveawayedit, /giveawayentries, /giveawaydelete"],
    tickets: ["**Tickets**", "/ticket-setup, /ticket-add, /ticket-remove", "/ticket-close, /ticket-reopen, /ticket-claim", "/ticket-transcript"],
    community: ["**Community**", "/welcome-setup, /goodbye-setup, /autorole", "/reactionrole create/edit/delete/list, /suggest, /suggestion-setup", "/poll, /embed, /remind"],
    utilities: ["**Utilities**", "/userinfo, /serverinfo, /roleinfo, /channelinfo", "/avatar, /membercount, /serverstats", "/botinfo, /ping, /invite, /help"],
    administration: ["**Administration**", "/setup, /config, /permissions, /commandtoggle", "/setlogs, /resetconfig, /backup, /restore"]
  };
  const values = categories[category] || categories.administration;
  return publicEmbed(`📘 ${identity.username} ${values[0].replaceAll("**", "")}`, values.slice(1).join("\n\n"), 0x5865F2)
    .setFooter({ text: `${identity.username} v${identity.version} • Use a category below to continue` });
}

function helpComponents(selectedCategory = null) {
  return [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("help_category")
      .setPlaceholder("Choose a help category")
      .addOptions(
        { label: "Moderation", value: "moderation", default: selectedCategory === "moderation" },
        { label: "Security", value: "security", default: selectedCategory === "security" },
        { label: "Giveaways", value: "giveaways", default: selectedCategory === "giveaways" },
        { label: "Tickets", value: "tickets", default: selectedCategory === "tickets" },
        { label: "Community", value: "community", default: selectedCategory === "community" },
        { label: "Utilities", value: "utilities", default: selectedCategory === "utilities" },
        { label: "Administration", value: "administration", default: selectedCategory === "administration" }
      )
  )];
}

function reactionRoleManagerError(interaction) {
  if (!hasCommandAccess(interaction, "reactionrole")) {
    return "You don't have permission to use `/reactionrole`.";
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    return "You need Manage Roles to manage reaction-role panels.";
  }
  const allowedRoles = getCommandRoles(interaction.guildId, "reactionrole");
  if (allowedRoles.length &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
      !allowedRoles.some(roleId => interaction.member?.roles?.cache?.has(roleId))) {
    return "You need one of the configured reaction-role manager roles to manage panels.";
  }
  return null;
}

function reactionRolePanelEmbed(panel, roles) {
  const identity = getBotIdentity();
  const embed = new EmbedBuilder()
    .setTitle(panel.title)
    .setDescription(`${safeText(panel.description)}\n\nClick a button to add or remove that role.`)
    .setTimestamp();
  if (!roles.length) {
    embed.setDescription(`${safeText(panel.description)}\n\nNo assignable roles are currently configured.`);
  }
  const author = { name: identity.username };
  if (identity.avatarURL) {
    author.iconURL = identity.avatarURL;
    embed.setThumbnail(identity.avatarURL);
  }
  return embed.setAuthor(author).setFooter({ text: `${identity.username} • v${identity.version}` });
}

function reactionRolePanelComponents(panelId, roles, disabled = false) {
  const components = [];
  for (let offset = 0; offset < roles.length; offset += 5) {
    const row = new ActionRowBuilder();
    for (const role of roles.slice(offset, offset + 5)) {
      const button = new ButtonBuilder()
        .setCustomId(`rr:t:${panelId}:${role.id}`)
        .setLabel(role.name.replace(/\s+/gu, " ").slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled);
      if (role.buttonEmoji) button.setEmoji(role.buttonEmoji);
      row.addComponents(button);
    }
    components.push(row);
  }
  return components;
}

function parseReactionRoleButtonEmoji(value, guild) {
  const emoji = String(value || "").trim();
  if (!emoji) return { value: null, buttonEmoji: null };
  const customMatch = emoji.match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/);
  if (customMatch) {
    const customEmoji = guild.emojis.cache.get(customMatch[3]);
    if (!customEmoji) return { error: `Custom emoji ${emoji} is unavailable in this server.` };
    return {
      value: customEmoji.toString(),
      buttonEmoji: { id: customEmoji.id, name: customEmoji.name, animated: customEmoji.animated }
    };
  }
  if (/\s/u.test(emoji) || Array.from(emoji).length > 16 ||
      !/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u20E3]/u.test(emoji)) {
    return { error: `\`${safeText(emoji)}\` is not a valid single Unicode or server emoji.` };
  }
  return { value: emoji, buttonEmoji: emoji };
}

function parseReactionRoleEmojiMappings(value, roles, guild) {
  const emojiByRoleId = new Map();
  for (const line of String(value || "").split("\n").map(item => item.trim()).filter(Boolean)) {
    const separator = line.indexOf("=");
    if (separator <= 0 || separator === line.length - 1) {
      return { error: `Use one mapping per line in the format \`role name or ID = emoji\`.` };
    }
    const roleKey = line.slice(0, separator).trim();
    const emojiText = line.slice(separator + 1).trim();
    const matches = roles.filter(role => role.id === roleKey || role.name.toLowerCase() === roleKey.toLowerCase());
    if (matches.length !== 1) {
      return { error: `I couldn't uniquely match \`${safeText(roleKey)}\` to one of the selected roles. Use its role ID if names are duplicated.` };
    }
    if (emojiText.toLowerCase() === "none") {
      emojiByRoleId.set(matches[0].id, null);
      continue;
    }
    const parsedEmoji = parseReactionRoleButtonEmoji(emojiText, guild);
    if (parsedEmoji.error) return parsedEmoji;
    emojiByRoleId.set(matches[0].id, parsedEmoji.value);
  }
  return { emojiByRoleId };
}

function validateReactionRoleSelection(interaction, roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length < 1 || roleIds.length > 10) {
    return { error: "Select between 1 and 10 roles for a panel." };
  }
  const guild = interaction.guild;
  const botMember = guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { error: "I need the Manage Roles permission to publish and operate role panels." };
  }
  const isAdministrator = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  const memberHighestRole = interaction.member?.roles?.highest;
  const roles = [];
  for (const roleId of new Set(roleIds)) {
    const role = guild.roles.cache.get(roleId);
    if (!role || role.id === guild.id || role.managed) {
      return { error: "A selected role was deleted or cannot be assigned." };
    }
    if (!role.editable) {
      return { error: `I can't manage ${role}. Move my highest role above it before using this panel.` };
    }
    if (!isAdministrator && (!memberHighestRole || memberHighestRole.comparePositionTo(role) <= 0)) {
      return { error: `I can't verify that ${role} is below your highest role. Only administrators can configure roles they outrank.` };
    }
    roles.push(role);
  }
  return { roles };
}

function getReactionRolePanelRoleData(guild, panelId) {
  return db.prepare(`
    SELECT role_id, emoji, position
    FROM reaction_role_panel_roles
    WHERE panel_id = ?
    ORDER BY position
  `).all(panelId).map(entry => {
    const role = guild.roles.cache.get(entry.role_id);
    const parsedEmoji = parseReactionRoleButtonEmoji(entry.emoji, guild);
    return role ? {
      id: role.id,
      name: role.name,
      emoji: parsedEmoji.error ? null : entry.emoji,
      buttonEmoji: parsedEmoji.error ? null : parsedEmoji.buttonEmoji
    } : null;
  }).filter(Boolean);
}

async function upgradeReactionRolePanels(guild) {
  const panels = db.prepare(`
    SELECT id, channel_id, message_id, title, description
    FROM reaction_role_panels
    WHERE guild_id = ? AND message_id IS NOT NULL
    ORDER BY id
  `).all(guild.id);

  for (const panel of panels) {
    try {
      const channel = guild.channels.cache.get(panel.channel_id) ||
        await guild.channels.fetch(panel.channel_id);
      if (!channel?.isTextBased() || !("messages" in channel)) {
        console.warn(`Could not upgrade reaction-role panel #${panel.id}: its channel is unavailable.`);
        continue;
      }
      const message = await channel.messages.fetch(panel.message_id);
      const needsUpgrade = message.embeds.some(embed => embed.fields?.length) ||
        message.components.some(row =>
          row.components.some(component => !component.customId?.startsWith("rr:t:"))
        );
      if (!needsUpgrade) continue;
      const roles = getReactionRolePanelRoleData(guild, panel.id);
      await message.edit(publishReactionRolePanel(panel, roles));
    } catch (error) {
      console.warn(`Could not upgrade reaction-role panel #${panel.id} in guild ${guild.id}:`, error.message);
    }
  }
}

function publishReactionRolePanel(panel, roles) {
  return {
    embeds: [reactionRolePanelEmbed(panel, roles)],
    components: reactionRolePanelComponents(panel.id, roles),
    allowedMentions: { parse: [] }
  };
}

function startReactionRoleSetup(interaction, state) {
  const token = randomUUID().replaceAll("-", "").slice(0, 20);
  state.userId = interaction.user.id;
  state.guildId = interaction.guildId;
  state.selectedRoleIds = [...(state.initialRoleIds || [])];
  state.completed = false;
  reactionRoleSetupSessions.set(token, state);
  const timeout = setTimeout(() => reactionRoleSetupSessions.delete(token), 15 * 60 * 1000);
  timeout.unref?.();

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`rr_roles:${token}`)
    .setPlaceholder(state.mode === "edit" ? "Select the panel's complete role list" : "Select roles for this panel")
    .setMinValues(1)
    .setMaxValues(10);
  if (state.mode === "edit" && state.selectedRoleIds.length) {
    roleSelect.setDefaultRoles(...state.selectedRoleIds);
  }
  const row = new ActionRowBuilder().addComponents(roleSelect);
  return interaction.reply({
    content: state.mode === "edit"
      ? `Editing panel **#${state.panelId}**. Select the complete role list to replace its current roles.`
      : "Choose between 1 and 10 roles. You can optionally assign an emoji to each role before publishing.",
    components: [row],
    ephemeral: true
  });
}

function reactionRoleSetupPreview(state, guild) {
  const roles = state.selectedRoleIds.map(roleId => {
    const role = guild.roles.cache.get(roleId);
    const emoji = state.emojiByRoleId?.get(roleId) || state.existingEmojiByRoleId?.get(roleId) || null;
    const parsed = parseReactionRoleButtonEmoji(emoji, guild);
    return role ? {
      id: role.id,
      name: role.name,
      emoji: parsed.error ? null : emoji,
      buttonEmoji: parsed.error ? null : parsed.buttonEmoji
    } : null;
  }).filter(Boolean);
  return { roles, embed: reactionRolePanelEmbed(state, roles) };
}

async function saveReactionRoleSetup(state, interaction, emojiByRoleId = new Map()) {
  const selection = validateReactionRoleSelection(interaction, state.selectedRoleIds);
  if (selection.error) return { error: selection.error };
  const selectedRoles = selection.roles;
  const roles = [];
  for (const [position, role] of selectedRoles.entries()) {
    const emoji = emojiByRoleId.has(role.id)
      ? emojiByRoleId.get(role.id)
      : state.existingEmojiByRoleId?.get(role.id) || null;
    const parsed = parseReactionRoleButtonEmoji(emoji, interaction.guild);
    if (parsed.error) return { error: parsed.error };
    roles.push({ id: role.id, name: role.name, emoji: parsed.value, buttonEmoji: parsed.buttonEmoji, position });
  }
  const botMember = interaction.guild.members.me;
  let channel;
  try {
    channel = await interaction.guild.channels.fetch(state.channelId);
  } catch (error) {
    console.warn(`Could not fetch reaction-role channel ${state.channelId}:`, error.message);
    return { error: "The selected panel channel is unavailable or I can't access it." };
  }
  if (!channel?.isTextBased() || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    return { error: "The selected panel channel is unavailable or is not a text channel." };
  }
  const channelPermissions = channel.permissionsFor(botMember);
  if (!channelPermissions?.has(PermissionFlagsBits.ViewChannel) ||
      !channelPermissions.has(PermissionFlagsBits.SendMessages) ||
      !channelPermissions.has(PermissionFlagsBits.EmbedLinks)) {
    return { error: "I need View Channel, Send Messages, and Embed Links permissions in the panel channel." };
  }

  const timestamp = now();
  let panelId = state.panelId;
  let previousPanel = null;
  let previousRoles = [];
  let existingMessage = null;
  if (state.mode === "edit") {
    previousPanel = db.prepare(`
      SELECT * FROM reaction_role_panels WHERE id = ? AND guild_id = ?
    `).get(panelId, interaction.guildId);
    if (!previousPanel) return { error: "That panel no longer exists." };
    previousRoles = getReactionRolePanelRoleData(interaction.guild, panelId);
    if (previousPanel.message_id) {
      try {
        existingMessage = await channel.messages.fetch(previousPanel.message_id);
      } catch (error) {
        if (error.code !== 10008) throw error;
      }
    }
  } else {
    const createPanel = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO reaction_role_panels
          (guild_id, channel_id, title, description, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(interaction.guildId, channel.id, state.title, state.description, interaction.user.id, timestamp, timestamp);
      panelId = Number(result.lastInsertRowid);
    });
    createPanel();
  }

  const panel = { id: panelId, title: state.title, description: state.description };
  let publishedMessage = existingMessage;
  try {
    const payload = publishReactionRolePanel(panel, roles);
    if (publishedMessage) {
      await publishedMessage.edit(payload);
    } else {
      publishedMessage = await channel.send(payload);
    }
    const persist = db.transaction(() => {
      if (state.mode === "edit") {
        db.prepare(`
          UPDATE reaction_role_panels
          SET channel_id = ?, message_id = ?, title = ?, description = ?, updated_at = ?
          WHERE id = ? AND guild_id = ?
        `).run(channel.id, publishedMessage.id, state.title, state.description, timestamp, panelId, interaction.guildId);
        db.prepare("DELETE FROM reaction_role_panel_roles WHERE panel_id = ?").run(panelId);
      } else {
        db.prepare("UPDATE reaction_role_panels SET message_id = ? WHERE id = ?").run(publishedMessage.id, panelId);
      }
      const insertRole = db.prepare(`
        INSERT INTO reaction_role_panel_roles (panel_id, role_id, emoji, position)
        VALUES (?, ?, ?, ?)
      `);
      for (const role of roles) insertRole.run(panelId, role.id, role.emoji, role.position);
    });
    persist();
  } catch (error) {
    if (state.mode === "create") {
      db.transaction(() => {
        db.prepare("DELETE FROM reaction_role_panel_roles WHERE panel_id = ?").run(panelId);
        db.prepare("DELETE FROM reaction_role_panels WHERE id = ?").run(panelId);
      })();
      if (publishedMessage) await publishedMessage.delete().catch(() => {});
    } else if (existingMessage && previousPanel) {
      const previousPayload = publishReactionRolePanel(
        { id: panelId, title: previousPanel.title, description: previousPanel.description },
        previousRoles
      );
      await existingMessage.edit(previousPayload).catch(restoreError => {
        console.error(`Could not restore reaction-role panel #${panelId} after a save failure:`, restoreError);
      });
    } else if (publishedMessage) {
      await publishedMessage.delete().catch(() => {});
    }
    throw error;
  }

  const action = state.mode === "edit" ? "edited" : "created";
  addModLog(interaction.guildId, "reaction_role_panel", interaction.guildId, interaction.user.id,
    `Reaction-role panel ${action}`, `Panel #${panelId} in channel ${channel.id}`);
  return { panelId, channel, message: publishedMessage, roles };
}

function findRoleByName(guild, name) {
  if (!guild || !name) return null;

  const normalized = String(name).trim();
  if (!normalized) return null;

  const matches = guild.roles.cache.filter(role => role.name.toLowerCase() === normalized.toLowerCase());
  return matches.find(role => role.editable) || matches.first() || null;
}

function setupSummary(guildId) {
  const settings = getSettings(guildId);
  const prefixes = getPrefixes(guildId);
  const guild = client.guilds.cache.get(guildId);
  const allowedBlacklistChannels = [...getBlacklistAllowedChannelIds(guildId)]
    .filter(channelId => guild?.channels.cache.has(channelId))
    .map(channelMention)
    .join(", ");
  const embed = publicEmbed(`⚙️ ${getBotIdentity().username} Setup`, settings.setup_complete ? "Setup is complete." : "Configure the bot using the buttons below.", 0x5865F2);

  embed.addFields({ name: "📢 Blacklist Channel", value: channelMention(settings.blacklist_channel_id), inline: true });
  embed.addFields({ name: "📢 Unblacklist Channel", value: channelMention(settings.unblacklist_channel_id), inline: true });
  embed.addFields({ name: "🚫 Blacklist Role", value: settings.blacklist_role_id ? roleMention(settings.blacklist_role_id) : `Default: the role named \`${BLACKLIST_ROLE_NAME}\``, inline: true });
  embed.addFields({
    name: "👁️ Blacklisted Channel Access",
    value: allowedBlacklistChannels ? allowedBlacklistChannels.slice(0, 1024) : "None — blacklisted members can't see any channels.",
    inline: false
  });
  embed.addFields({ name: "📜 Log Channel", value: channelMention(settings.log_channel_id), inline: true });
  const enabledLogLabels = LOG_EVENT_OPTIONS.filter(option => getEnabledLogEvents(settings).includes(option.value)).map(option => option.label);
  embed.addFields({ name: "Log Events", value: enabledLogLabels.length ? enabledLogLabels.join(", ") : "None", inline: false });
  embed.addFields({
    name: "🧾 Server Audit Logs",
    value: `${settings.server_logs_enabled ? "Enabled" : "Disabled"}\nChannel: ${channelMention(settings.server_log_channel_id)}`,
    inline: true
  });
  embed.addFields({ name: "🛡️ Nuke Alert Channel", value: channelMention(settings.nuke_alert_channel_id), inline: true });
  embed.addFields({ name: "🚨 Raid Alert Channel", value: channelMention(settings.raid_alert_channel_id), inline: true });
  embed.addFields({ name: "📣 Auto Ping Channel", value: channelMention(settings.auto_ping_channel_id), inline: true });
  embed.addFields({ name: "📎 Appeal Link", value: settings.appeal_link ? String(settings.appeal_link).slice(0, 200) : "Not set", inline: false });
  embed.addFields({ name: "🔤 Enabled Prefixes", value: prefixes.length ? prefixes.map(p => `\`${p}\``).join(" ") : "None", inline: false });

  const commandGroups = [];
  for (let index = 0; index < COMMANDS.length; index += 8) {
    const lines = COMMANDS.slice(index, index + 8).map(command => {
      const roles = getCommandRoles(guildId, command);
      const roleList = roles.length
        ? `${roles.slice(0, 3).map(roleMention).join(" ")}${roles.length > 3 ? ` +${roles.length - 3}` : ""}`
        : "Normal Discord permission";
      return `/${command}: ${roleList}${roles.length ? " + normal permission" : ""}`;
    });
    commandGroups.push(lines.join("\n"));
  }
  commandGroups.forEach((value, index) => {
    embed.addFields({ name: `Command Roles ${index + 1}`, value, inline: false });
  });

  return embed;
}

function setupControls() {
  const splitIndex = Math.ceil(COMMANDS.length / 2);
  const commandMenus = [COMMANDS.slice(0, splitIndex), COMMANDS.slice(splitIndex)].map((commands, index) =>
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`setup_command_select:${index + 1}`)
        .setPlaceholder(`🎮 Choose a command (${index + 1}/2)`)
        .addOptions(commands.map(command => ({ label: `/${command}`, value: command })))
    )
  );

  const channelsButton = new ButtonBuilder().setCustomId("setup_channels").setLabel("📢 Set Channels").setStyle(ButtonStyle.Primary);
  const prefixesButton = new ButtonBuilder().setCustomId("setup_prefixes").setLabel("🔤 Set Prefixes").setStyle(ButtonStyle.Primary);
  const autoPingButton = new ButtonBuilder().setCustomId("setup_auto_ping").setLabel("📣 Set Join Ping").setStyle(ButtonStyle.Primary);
  const logButton = new ButtonBuilder().setCustomId("setup_log_channel").setLabel("📜 Set Log Channel").setStyle(ButtonStyle.Primary);
  const securityAlertsButton = new ButtonBuilder().setCustomId("setup_security_alerts").setLabel("🛡️ Set Security Alerts").setStyle(ButtonStyle.Primary);
  const appealButton = new ButtonBuilder().setCustomId("setup_appeal_link").setLabel("📎 Set Appeal Link").setStyle(ButtonStyle.Primary);
  const blacklistRoleButton = new ButtonBuilder().setCustomId("setup_blacklist_role").setLabel("🚫 Set Blacklist Role").setStyle(ButtonStyle.Primary);
  const blacklistAccessButton = new ButtonBuilder().setCustomId("setup_blacklist_access").setLabel("👁️ Set Blacklist Channels").setStyle(ButtonStyle.Primary);
  const finishButton = new ButtonBuilder().setCustomId("setup_finish").setLabel("✅ Finish Setup").setStyle(ButtonStyle.Success);
  const resetButton = new ButtonBuilder().setCustomId("setup_reset").setLabel("🔴 Reset Setup").setStyle(ButtonStyle.Danger);

  return [
    ...commandMenus,
    new ActionRowBuilder().addComponents(channelsButton, prefixesButton, autoPingButton, logButton, securityAlertsButton),
    new ActionRowBuilder().addComponents(appealButton, blacklistRoleButton, blacklistAccessButton, finishButton, resetButton)
  ];
}

function blacklistAccessPanel(guildId) {
  const guild = client.guilds.cache.get(guildId);
  const allowedChannelIds = [...getBlacklistAllowedChannelIds(guildId)]
    .filter(channelId => guild?.channels.cache.has(channelId));
  const channels = new ChannelSelectMenuBuilder()
    .setCustomId("setup_blacklist_access_select")
    .setPlaceholder("Choose channels blacklisted members can see")
    .setMinValues(1)
    .setMaxValues(25)
    .addChannelTypes(
      ChannelType.GuildCategory,
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.GuildVoice,
      ChannelType.GuildStageVoice,
      ChannelType.GuildForum
    );
  if (allowedChannelIds.length) channels.addDefaultChannels(...allowedChannelIds.slice(0, 25));

  return {
    embed: publicEmbed(
      "👁️ Blacklisted Channel Access",
      "Select channels where the Blacklisted role can view and send messages. All other existing and newly created channels will be hidden and read-only for that role. Use the clear button to allow no channels.",
      0x5865F2
    ),
    components: [
      new ActionRowBuilder().addComponents(channels),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("setup_blacklist_access_clear").setLabel("Clear Allowed Channels").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("setup_channels_done").setLabel("✅ Done").setStyle(ButtonStyle.Success)
      )
    ]
  };
}

function logSetupPanel(guildId) {
  const settings = getSettings(guildId);
  const enabled = getEnabledLogEvents(settings);
  const channel = settings.log_channel_id ? channelMention(settings.log_channel_id) : "Not set";
  const eventNames = LOG_EVENT_OPTIONS.filter(option => enabled.includes(option.value)).map(option => option.label);
  const embed = publicEmbed("📜 Log Setup", `Log destination: ${channel}\nEnabled events: ${eventNames.length ? eventNames.join(", ") : "None"}`, 0x5865F2);
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId("setup_log_channel_select")
    .setPlaceholder("Choose where logs are posted")
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  const eventSelect = new StringSelectMenuBuilder()
    .setCustomId("setup_log_events_select")
    .setPlaceholder("Choose which events to log")
    .setMinValues(1)
    .setMaxValues(LOG_EVENT_OPTIONS.length + 1)
    .addOptions([
      ...LOG_EVENT_OPTIONS.map(option => ({ ...option, default: enabled.includes(option.value) })),
      { label: "Disable all event logs", value: "none", description: "Stop sending event logs", default: enabled.length === 0 }
    ]);

  return {
    embed,
    components: [
      new ActionRowBuilder().addComponents(channelSelect),
      new ActionRowBuilder().addComponents(eventSelect),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("setup_log_done").setLabel("✅ Done").setStyle(ButtonStyle.Success))
    ]
  };
}

function blacklistAppealModal() {
  const input = new TextInputBuilder()
    .setCustomId("setup_appeal_link_input")
    .setLabel("Appeal invite link or server ID")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("https://discord.gg/abcd1234 or 123456789012345678")
    .setRequired(false)
    .setMaxLength(300);

  return new ModalBuilder()
    .setCustomId("setup_appeal_modal")
    .setTitle("Blacklist Appeal Link")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function securityAlertSetupPanel(guildId) {
  const settings = getSettings(guildId);
  const embed = publicEmbed(
    "🛡️ Security Alert Channels",
    `Choose where anti-nuke and raid-protection alerts should be posted.\n\nNuke: ${channelMention(settings.nuke_alert_channel_id)}\nRaid: ${channelMention(settings.raid_alert_channel_id)}`,
    0x5865F2
  );
  const nukeChannel = new ChannelSelectMenuBuilder()
    .setCustomId("setup_nuke_alert_channel")
    .setPlaceholder("Choose the nuke alert channel")
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  const raidChannel = new ChannelSelectMenuBuilder()
    .setCustomId("setup_raid_alert_channel")
    .setPlaceholder("Choose the raid alert channel")
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

  return {
    embed,
    components: [
      new ActionRowBuilder().addComponents(nukeChannel),
      new ActionRowBuilder().addComponents(raidChannel),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("setup_channels_done").setLabel("✅ Done").setStyle(ButtonStyle.Success)
      )
    ]
  };
}


function channelSelects() {
  const blacklist = new ChannelSelectMenuBuilder().setCustomId("setup_blacklist_channel").setPlaceholder("📢 Choose Blacklist Log Channel").addChannelTypes(ChannelType.GuildText);
  const unblacklist = new ChannelSelectMenuBuilder().setCustomId("setup_unblacklist_channel").setPlaceholder("📢 Choose Unblacklist Log Channel").addChannelTypes(ChannelType.GuildText);
  const autoPing = new ChannelSelectMenuBuilder().setCustomId("setup_auto_ping_channel").setPlaceholder("📣 Choose Join Ping Channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  const done = new ButtonBuilder().setCustomId("setup_channels_done").setLabel("✅ Done").setStyle(ButtonStyle.Success);

  return [
    new ActionRowBuilder().addComponents(blacklist),
    new ActionRowBuilder().addComponents(unblacklist),
    new ActionRowBuilder().addComponents(autoPing),
    new ActionRowBuilder().addComponents(done)
  ];
}

function prefixSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("setup_prefix_select")
      .setPlaceholder("🔤 Select your prefixes")
      .setMinValues(1)
      .setMaxValues(PREFIX_OPTIONS.length)
      .addOptions(PREFIX_OPTIONS.map(prefix => ({ label: prefix, value: prefix })))
  );
}

function roleSelectFor(command) {
  const menu = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(`setup_role_select:${command}`)
      .setPlaceholder(`Select roles for /${command}`)
      .setMinValues(0)
      .setMaxValues(25)
  );
  const clear = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup_role_clear:${command}`)
      .setLabel("Clear Custom Roles")
      .setStyle(ButtonStyle.Danger)
  );
  return [menu, clear];
}

function resetConfirmRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("setup_reset_yes").setLabel("Yes, Reset Setup").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("setup_reset_no").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("help").setDescription("Show bot commands and help information"),
    new SlashCommandBuilder().setName("changelogs").setDescription("View the bot's recent changelog"),
    new SlashCommandBuilder().setName("serverinfo").setDescription("Show information about this server"),
    new SlashCommandBuilder().setName("about").setDescription("View information about the bot"),
    new SlashCommandBuilder().setName("lb-make").setDescription("Create a named player leaderboard with a channel webhook")
      .addStringOption(option => option.setName("name").setDescription("Name for this leaderboard").setMinLength(1).setMaxLength(50).setRequired(true))
      .addChannelOption(option => option.setName("channel").setDescription("Channel where the webhook leaderboard will be posted").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),
    new SlashCommandBuilder().setName("lb-edit").setDescription("Choose a leaderboard and open its score editor"),
    new SlashCommandBuilder().setName("lb-delete").setDescription("Delete a leaderboard, its scores, and its webhook post")
      .addStringOption(option => option.setName("name").setDescription("Name of the leaderboard to delete").setMinLength(1).setMaxLength(50).setRequired(true)),
    new SlashCommandBuilder().setName("lbremove").setDescription("Remove a player from a leaderboard")
      .addStringOption(option => option.setName("name").setDescription("Name of the leaderboard").setMinLength(1).setMaxLength(50).setRequired(true))
      .addUserOption(option => option.setName("player").setDescription("Player to remove from the leaderboard").setRequired(true)),
    new SlashCommandBuilder().setName("lb-switch").setDescription("Swap the players at two leaderboard ranks")
      .addStringOption(option => option.setName("name").setDescription("Name of the leaderboard").setMinLength(1).setMaxLength(50).setRequired(true))
      .addIntegerOption(option => option.setName("first_rank").setDescription("First rank to switch, for example 2").setMinValue(1).setMaxValue(10).setRequired(true))
      .addIntegerOption(option => option.setName("second_rank").setDescription("Second rank to switch, for example 5").setMinValue(1).setMaxValue(10).setRequired(true)),
    new SlashCommandBuilder().setName("scoreschannel").setDescription("Set the webhook channel for score challenge results")
      .addChannelOption(option => option.setName("channel").setDescription("Channel for challenge results").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),
    new SlashCommandBuilder().setName("score").setDescription("Log a challenge result between leaderboard players")
      .addStringOption(option => option.setName("leaderboard").setDescription("Leaderboard the challenge is for").setMinLength(1).setMaxLength(50).setRequired(true))
      .addUserOption(option => option.setName("player1").setDescription("First player in the challenge").setRequired(true))
      .addUserOption(option => option.setName("player2").setDescription("Second player in the challenge").setRequired(true))
      .addStringOption(option => option.setName("result").setDescription("Winner's points first, such as 5-2").setMinLength(3).setMaxLength(13).setRequired(true))
      .addUserOption(option => option.setName("winner").setDescription("Player who earned the most points").setRequired(true))
      .addStringOption(option => option.setName("lb_update").setDescription("Choose whether to update the leaderboard")
        .addChoices(
          { name: "✅ Swap if the winner is lower-ranked", value: "yes" },
          { name: "❌ Keep the spots as they are", value: "no" }
        )
        .setRequired(false)),
    new SlashCommandBuilder().setName("serverlogs").setDescription("Configure server audit logs for moderation and server changes").addChannelOption(option => option.setName("channel").setDescription("Channel for audit log entries").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false)).addBooleanOption(option => option.setName("enabled").setDescription("Enable or disable audit logging").setRequired(false)),
    new SlashCommandBuilder().setName("gradechannel").setDescription("Set or view the only channel where grade assignments work").addChannelOption(option => option.setName("channel").setDescription("Channel where grade role assignments are allowed").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false)),
    new SlashCommandBuilder().setName("userinfo").setDescription("Show information about a server member").addUserOption(option => option.setName("user").setDescription("Member to inspect; defaults to you").setRequired(false)),
    new SlashCommandBuilder().setName("autoping").setDescription("Enable or disable auto-pinging new members in a channel").addChannelOption(option => option.setName("channel").setDescription("Channel to ghost ping when a member joins").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false)).addBooleanOption(option => option.setName("enabled").setDescription("Turn the join ping on or off").setRequired(false)),
    new SlashCommandBuilder().setName("setup").setDescription("Configure the bot"),
    new SlashCommandBuilder().setName("warn").setDescription("Warn a user").addUserOption(option => option.setName("user").setDescription("User").setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason").setRequired(true)),
    new SlashCommandBuilder().setName("warns").setDescription("Check a user's warnings").addUserOption(option => option.setName("user").setDescription("User").setRequired(true)),
    new SlashCommandBuilder().setName("warnings").setDescription("Check a user's warning history").addUserOption(option => option.setName("user").setDescription("User").setRequired(true)),
    new SlashCommandBuilder().setName("clearwarnings").setDescription("Clear every warning for a user").addUserOption(option => option.setName("user").setDescription("User").setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason for clearing the warnings").setRequired(true)),
    new SlashCommandBuilder().setName("strike").setDescription("Manage staff strikes")
      .addSubcommand(subcommand => subcommand.setName("add").setDescription("Give a staff member a strike")
        .addUserOption(option => option.setName("user").setDescription("Staff member to strike").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason for the strike").setMaxLength(500).setRequired(true)))
      .addSubcommand(subcommand => subcommand.setName("delete").setDescription("Delete one selected strike from a staff member")
        .addUserOption(option => option.setName("user").setDescription("Staff member whose strike to delete").setRequired(true))),
    new SlashCommandBuilder().setName("strikecheck").setDescription("Check a staff member's strike history").addUserOption(option => option.setName("user").setDescription("Staff member whose strikes to check").setRequired(true)),
    new SlashCommandBuilder().setName("strikelist").setDescription("List staff with strikes and their count out of 3"),
    new SlashCommandBuilder().setName("deletewarns").setDescription("Delete a warning").addUserOption(option => option.setName("user").setDescription("User").setRequired(true)),
    new SlashCommandBuilder().setName("kick").setDescription("Kick a user").addUserOption(option => option.setName("user").setDescription("User").setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason").setRequired(true)),
    new SlashCommandBuilder().setName("ban").setDescription("Ban a user from the server").addStringOption(option => option.setName("user").setDescription("User ID or mention, even if they are not in the server").setMaxLength(25).setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason for the ban").setMaxLength(1000).setRequired(true)),
    new SlashCommandBuilder().setName("unban").setDescription("Unban a previously banned user").addStringOption(option => option.setName("user").setDescription("User ID or mention").setMaxLength(25).setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason for the unban").setMaxLength(1000).setRequired(true)),
    new SlashCommandBuilder().setName("timeout").setDescription("Temporarily timeout a user").addUserOption(option => option.setName("user").setDescription("User").setRequired(true)).addStringOption(option => option.setName("duration").setDescription("Duration, for example 10m, 1h, or 1d").setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason for the timeout").setRequired(true)),
    new SlashCommandBuilder().setName("untimeout").setDescription("Remove a user's timeout").addUserOption(option => option.setName("user").setDescription("User").setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason for removing the timeout").setRequired(true)),
    new SlashCommandBuilder().setName("nick").setDescription("Change or clear a member nickname").addUserOption(option => option.setName("user").setDescription("Member").setRequired(true)).addStringOption(option => option.setName("nickname").setDescription("New nickname; leave blank to clear").setMaxLength(32).setRequired(false)).addStringOption(option => option.setName("reason").setDescription("Reason for changing the nickname").setRequired(false)),
    new SlashCommandBuilder().setName("cases").setDescription("View moderation cases for a member").addUserOption(option => option.setName("user").setDescription("Member").setRequired(true)),
    new SlashCommandBuilder().setName("role").setDescription("Add or remove a role")
      .addSubcommand(subcommand => subcommand.setName("add").setDescription("Add a role to a member")
        .addUserOption(option => option.setName("user").setDescription("Member").setRequired(true))
        .addRoleOption(option => option.setName("role").setDescription("Role to add").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason").setRequired(false)))
      .addSubcommand(subcommand => subcommand.setName("remove").setDescription("Remove a role from a member")
        .addUserOption(option => option.setName("user").setDescription("Member").setRequired(true))
        .addRoleOption(option => option.setName("role").setDescription("Role to remove").setRequired(true))
        .addStringOption(option => option.setName("reason").setDescription("Reason").setRequired(false))),
    new SlashCommandBuilder().setName("case").setDescription("View a blacklist case by its sequential number").addIntegerOption(option => option.setName("case").setDescription("Blacklist case number").setMinValue(1).setRequired(true)),
    new SlashCommandBuilder().setName("editcase").setDescription("Edit the reason on a blacklist case").addIntegerOption(option => option.setName("case").setDescription("Blacklist case number").setMinValue(1).setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Updated reason").setMaxLength(1000).setRequired(true)),
    new SlashCommandBuilder().setName("raid").setDescription("Toggle raid protection").addBooleanOption(option => option.setName("enabled").setDescription("Turn raid protection on or off").setRequired(true)),
    new SlashCommandBuilder().setName("logs").setDescription("Show recent moderation and security events"),
    new SlashCommandBuilder().setName("blacklist").setDescription("Blacklist a user by ID or mention, even if they are not in the server").addStringOption(option => option.setName("user").setDescription("User ID or mention").setMaxLength(25).setRequired(true)).addStringOption(option => option.setName("category").setDescription("Blacklist category").setRequired(true).addChoices(...CATEGORY_CHOICES)).addStringOption(option => option.setName("reason").setDescription("Reason").setMaxLength(1000).setRequired(true)),
    new SlashCommandBuilder().setName("blacklistlist").setDescription("List currently blacklisted members"),
    new SlashCommandBuilder().setName("blacklistcheck").setDescription("Check blacklist status").addUserOption(option => option.setName("user").setDescription("User").setRequired(true)),
    new SlashCommandBuilder().setName("unblacklist").setDescription("Unblacklist a user").addUserOption(option => option.setName("user").setDescription("User").setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason for removing the blacklist").setRequired(true)),
    new SlashCommandBuilder().setName("mute").setDescription("Timeout a user").addUserOption(option => option.setName("user").setDescription("User").setRequired(true)).addStringOption(option => option.setName("duration").setDescription("Example: 10m, 1h, 1d").setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason").setRequired(false)),
    new SlashCommandBuilder().setName("unmute").setDescription("Remove a timeout from a user").addUserOption(option => option.setName("user").setDescription("User").setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason for removing the timeout").setRequired(true)),
    new SlashCommandBuilder().setName("modlogs").setDescription("View moderator logs").addUserOption(option => option.setName("moderator").setDescription("Moderator").setRequired(true)),
    new SlashCommandBuilder().setName("purge").setDescription("Delete recent messages from this channel").addIntegerOption(option => option.setName("amount").setDescription("Number of messages to delete (1-100)").setMinValue(1).setMaxValue(100).setRequired(true)),
    new SlashCommandBuilder().setName("slowmode").setDescription("Set or clear this channel's slowmode delay").addIntegerOption(option => option.setName("seconds").setDescription("Delay between messages (0 to disable, max 21600)").setMinValue(0).setMaxValue(21600).setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason for changing slowmode").setRequired(false)),
    new SlashCommandBuilder().setName("lock").setDescription("Lock this channel for @everyone"),
    new SlashCommandBuilder().setName("unlock").setDescription("Unlock this channel for @everyone"),
    new SlashCommandBuilder().setName("addrole").setDescription("Add a role to a user").addUserOption(option => option.setName("user").setDescription("User to receive the role").setRequired(true)).addRoleOption(option => option.setName("role").setDescription("Role to add").setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason for adding the role").setRequired(false)),
    new SlashCommandBuilder().setName("removerole").setDescription("Remove a role from a user").addUserOption(option => option.setName("user").setDescription("User to remove the role from").setRequired(true)).addRoleOption(option => option.setName("role").setDescription("Role to remove").setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason for removing the role").setRequired(false)),
    new SlashCommandBuilder().setName("temprole").setDescription("Give a user a temporary role").addUserOption(option => option.setName("user").setDescription("User to receive the temporary role").setRequired(true)).addRoleOption(option => option.setName("role").setDescription("Temporary role to give").setRequired(true)).addStringOption(option => option.setName("duration").setDescription("Example: 10m, 1h, 1d").setRequired(true)).addStringOption(option => option.setName("reason").setDescription("Reason for the temporary role").setRequired(false)),
    new SlashCommandBuilder().setName("whitelist").setDescription("Manage anti-nuke exemptions")
      .addSubcommand(subcommand => subcommand.setName("add").setDescription("Exempt a member from automatic anti-nuke blacklisting").addUserOption(option => option.setName("user").setDescription("Member to exempt").setRequired(true)))
      .addSubcommand(subcommand => subcommand.setName("remove").setDescription("Remove a member's anti-nuke exemption").addUserOption(option => option.setName("user").setDescription("Member to remove").setRequired(true))),
    new SlashCommandBuilder().setName("honeypot").setDescription("Configure a monitored honeypot channel")
      .addSubcommand(subcommand => subcommand.setName("setup").setDescription("Set the channel to monitor").addChannelOption(option => option.setName("channel").setDescription("Channel to monitor").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
      .addSubcommand(subcommand => subcommand.setName("status").setDescription("Show the current honeypot channel"))
      .addSubcommand(subcommand => subcommand.setName("disable").setDescription("Disable honeypot monitoring")),
    new SlashCommandBuilder().setName("giveaway").setDescription("Create and manage persistent giveaways")
      .addSubcommand(subcommand => subcommand.setName("create").setDescription("Create a giveaway")
        .addStringOption(option => option.setName("prize").setDescription("What users can win").setMaxLength(256).setRequired(true))
        .addIntegerOption(option => option.setName("winners").setDescription("Number of different winners").setMinValue(1).setMaxValue(25).setRequired(true))
        .addStringOption(option => option.setName("duration").setDescription("Duration such as 10m, 1h, or 2d (maximum 30d)").setMaxLength(10).setRequired(true))
        .addChannelOption(option => option.setName("channel").setDescription("Channel where the giveaway is posted").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption(option => option.setName("description").setDescription("Optional additional information").setMaxLength(1000).setRequired(false))
        .addRoleOption(option => option.setName("bonus_role").setDescription("Optional role that receives bonus entries").setRequired(false))
        .addRoleOption(option => option.setName("required_role").setDescription("Optional role required to enter").setRequired(false))
        .addIntegerOption(option => option.setName("bonus_entries").setDescription("Entries for members with the selected bonus role")
            .addChoices({ name: "2 entries", value: 2 }).setRequired(false))
          .addBooleanOption(option => option.setName("allow_bots").setDescription("Allow bot accounts to enter and win").setRequired(false)))
      .addSubcommand(subcommand => subcommand.setName("end").setDescription("End an active giveaway early")
        .addIntegerOption(option => option.setName("giveaway_id").setDescription("Giveaway ID shown in /giveaway list").setMinValue(1).setRequired(true)))
      .addSubcommand(subcommand => subcommand.setName("reroll").setDescription("Select new winner(s) for an ended giveaway")
        .addIntegerOption(option => option.setName("giveaway_id").setDescription("Giveaway ID").setMinValue(1).setRequired(true)))
      .addSubcommand(subcommand => subcommand.setName("cancel").setDescription("Cancel an active giveaway without winners")
        .addIntegerOption(option => option.setName("giveaway_id").setDescription("Giveaway ID shown in /giveaway list").setMinValue(1).setRequired(true)))
      .addSubcommand(subcommand => subcommand.setName("list").setDescription("List active giveaways in this server")),
    new SlashCommandBuilder().setName("giveawayreroll").setDescription("Reroll an ended giveaway")
      .addIntegerOption(option => option.setName("giveaway_id").setDescription("Giveaway ID").setMinValue(1).setRequired(true)),
    new SlashCommandBuilder().setName("giveawayend").setDescription("End an active giveaway now")
      .addIntegerOption(option => option.setName("giveaway_id").setDescription("Giveaway ID").setMinValue(1).setRequired(true)),
    new SlashCommandBuilder().setName("giveawaylist").setDescription("List giveaways in this server"),
    new SlashCommandBuilder().setName("giveawayedit").setDescription("Edit an active giveaway")
      .addIntegerOption(option => option.setName("giveaway_id").setDescription("Giveaway ID").setMinValue(1).setRequired(true))
      .addStringOption(option => option.setName("prize").setDescription("New prize").setMaxLength(256).setRequired(false))
      .addStringOption(option => option.setName("description").setDescription("New description").setMaxLength(1000).setRequired(false))
      .addIntegerOption(option => option.setName("winners").setDescription("New winner count").setMinValue(1).setMaxValue(25).setRequired(false))
      .addStringOption(option => option.setName("duration").setDescription("New duration, for example 1h or 2d").setMaxLength(10).setRequired(false))
      .addRoleOption(option => option.setName("required_role").setDescription("New required role").setRequired(false)),
    new SlashCommandBuilder().setName("giveawayentries").setDescription("List entries for a giveaway")
      .addIntegerOption(option => option.setName("giveaway_id").setDescription("Giveaway ID").setMinValue(1).setRequired(true)),
    new SlashCommandBuilder().setName("giveawaydelete").setDescription("Delete a giveaway and its entries")
      .addIntegerOption(option => option.setName("giveaway_id").setDescription("Giveaway ID").setMinValue(1).setRequired(true)),
    new SlashCommandBuilder().setName("ticket-setup").setDescription("Configure the ticket creation panel")
      .addChannelOption(option => option.setName("panel_channel").setDescription("Channel for the ticket panel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addChannelOption(option => option.setName("category").setDescription("Category for ticket channels").addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addRoleOption(option => option.setName("support_role").setDescription("Role with access to tickets").setRequired(true))
      .addIntegerOption(option => option.setName("open_limit").setDescription("Maximum open tickets per user").setMinValue(1).setMaxValue(10).setRequired(false)),
    new SlashCommandBuilder().setName("ticket-add").setDescription("Add a member to this ticket").addUserOption(option => option.setName("user").setDescription("Member to add").setRequired(true)),
    new SlashCommandBuilder().setName("ticket-remove").setDescription("Remove a member from this ticket").addUserOption(option => option.setName("user").setDescription("Member to remove").setRequired(true)),
    new SlashCommandBuilder().setName("ticket-close").setDescription("Close this ticket").addStringOption(option => option.setName("reason").setDescription("Reason for closing").setMaxLength(500).setRequired(false)),
    new SlashCommandBuilder().setName("ticket-reopen").setDescription("Reopen this ticket").addStringOption(option => option.setName("reason").setDescription("Reason for reopening").setMaxLength(500).setRequired(false)),
    new SlashCommandBuilder().setName("ticket-transcript").setDescription("Generate a transcript for this ticket"),
    new SlashCommandBuilder().setName("ticket-claim").setDescription("Claim this ticket"),
    new SlashCommandBuilder().setName("antispam").setDescription("Enable or configure automatic spam detection").addBooleanOption(option => option.setName("enabled").setDescription("Enable spam detection").setRequired(true)).addIntegerOption(option => option.setName("limit").setDescription("Messages within a short window").setMinValue(3).setMaxValue(20).setRequired(false)),
    new SlashCommandBuilder().setName("antiraid").setDescription("Enable or configure join raid detection").addBooleanOption(option => option.setName("enabled").setDescription("Enable raid detection").setRequired(true)).addIntegerOption(option => option.setName("account_age_days").setDescription("Minimum account age in days").setMinValue(0).setMaxValue(365).setRequired(false)),
    new SlashCommandBuilder().setName("antilink").setDescription("Enable or disable link filtering").addBooleanOption(option => option.setName("enabled").setDescription("Enable link filtering").setRequired(true)),
    new SlashCommandBuilder().setName("antimention").setDescription("Configure mass mention protection").addBooleanOption(option => option.setName("enabled").setDescription("Enable mention protection").setRequired(true)).addIntegerOption(option => option.setName("limit").setDescription("Maximum mentions per message").setMinValue(3).setMaxValue(30).setRequired(false)),
    new SlashCommandBuilder().setName("antibot").setDescription("Enable or disable bot-account joining protection").addBooleanOption(option => option.setName("enabled").setDescription("Enable bot-account protection").setRequired(true)),
    new SlashCommandBuilder().setName("raidmode").setDescription("Enable emergency raid mode and channel lockdown").addBooleanOption(option => option.setName("enabled").setDescription("Enable raid mode").setRequired(true)),
    new SlashCommandBuilder().setName("security").setDescription("Show current server security settings"),
    new SlashCommandBuilder().setName("welcome-setup").setDescription("Configure welcome messages").addChannelOption(option => option.setName("channel").setDescription("Welcome channel").addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption(option => option.setName("message").setDescription("Use {user}, {server}, and {membercount}").setMaxLength(1000).setRequired(true)),
    new SlashCommandBuilder().setName("goodbye-setup").setDescription("Configure goodbye messages").addChannelOption(option => option.setName("channel").setDescription("Goodbye channel").addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption(option => option.setName("message").setDescription("Use {user}, {server}, and {membercount}").setMaxLength(1000).setRequired(true)),
    new SlashCommandBuilder().setName("autorole").setDescription("Configure automatic member roles").addRoleOption(option => option.setName("role").setDescription("Role to assign on join").setRequired(false)),
    new SlashCommandBuilder().setName("reactionrole").setDescription("Create and manage persistent reaction-role panels")
      .addSubcommand(subcommand => subcommand.setName("create").setDescription("Create a role panel")
        .addChannelOption(option => option.setName("channel").setDescription("Channel for the panel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption(option => option.setName("title").setDescription("Panel title").setMaxLength(256).setRequired(false))
        .addStringOption(option => option.setName("description").setDescription("Panel description").setMaxLength(1000).setRequired(false)))
      .addSubcommand(subcommand => subcommand.setName("edit").setDescription("Edit a panel's text and role list")
        .addIntegerOption(option => option.setName("panel_id").setDescription("Panel ID from /reactionrole list").setMinValue(1).setRequired(true))
        .addStringOption(option => option.setName("title").setDescription("New panel title").setMaxLength(256).setRequired(false))
        .addStringOption(option => option.setName("description").setDescription("New panel description").setMaxLength(1000).setRequired(false)))
      .addSubcommand(subcommand => subcommand.setName("delete").setDescription("Delete a panel and its published message")
        .addIntegerOption(option => option.setName("panel_id").setDescription("Panel ID from /reactionrole list").setMinValue(1).setRequired(true)))
      .addSubcommand(subcommand => subcommand.setName("list").setDescription("List this server's role panels")),
    new SlashCommandBuilder().setName("suggest").setDescription("Submit a server suggestion").addStringOption(option => option.setName("text").setDescription("Suggestion text").setMaxLength(1000).setRequired(true)),
    new SlashCommandBuilder().setName("suggestion-setup").setDescription("Set the suggestion channel").addChannelOption(option => option.setName("channel").setDescription("Suggestion channel").addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder().setName("poll").setDescription("Create a poll").addStringOption(option => option.setName("question").setDescription("Poll question").setMaxLength(256).setRequired(true)).addStringOption(option => option.setName("options").setDescription("Answers separated by | (2-10)").setMaxLength(1000).setRequired(true)),
    new SlashCommandBuilder().setName("embed").setDescription("Create a custom embed").addStringOption(option => option.setName("title").setDescription("Embed title").setMaxLength(256).setRequired(true)).addStringOption(option => option.setName("description").setDescription("Embed description").setMaxLength(4000).setRequired(true)).addStringOption(option => option.setName("color").setDescription("Hex color, for example 5865F2").setMaxLength(6).setRequired(false)),
    new SlashCommandBuilder().setName("remind").setDescription("Create a persistent reminder").addStringOption(option => option.setName("duration").setDescription("For example 10m, 2h, or 1d").setRequired(true)).addStringOption(option => option.setName("message").setDescription("Reminder text").setMaxLength(1000).setRequired(true)),
    new SlashCommandBuilder().setName("roleinfo").setDescription("Show information about a role").addRoleOption(option => option.setName("role").setDescription("Role to inspect").setRequired(true)),
    new SlashCommandBuilder().setName("channelinfo").setDescription("Show information about a channel").addChannelOption(option => option.setName("channel").setDescription("Channel to inspect").setRequired(false)),
    new SlashCommandBuilder().setName("avatar").setDescription("Show a user's avatar").addUserOption(option => option.setName("user").setDescription("User to inspect").setRequired(false)),
    new SlashCommandBuilder().setName("membercount").setDescription("Show the server member count"),
    new SlashCommandBuilder().setName("serverstats").setDescription("Show detailed server statistics"),
    new SlashCommandBuilder().setName("botinfo").setDescription("Show information about the bot"),
    new SlashCommandBuilder().setName("ping").setDescription("Show bot latency"),
    new SlashCommandBuilder().setName("invite").setDescription("Show an invite link for the bot"),
    new SlashCommandBuilder().setName("config").setDescription("Show this server's saved configuration"),
    new SlashCommandBuilder().setName("permissions").setDescription("Configure or show command role permissions")
      .addStringOption(option => option.setName("command").setDescription("Command name").setRequired(true))
      .addStringOption(option => option.setName("action").setDescription("Add, remove, replace, or clear custom roles")
        .addChoices(
          { name: "Add a role", value: "add" },
          { name: "Remove a role", value: "remove" },
          { name: "Replace all roles", value: "replace" },
          { name: "Clear all roles", value: "clear" }
        )
        .setRequired(false))
      .addRoleOption(option => option.setName("role").setDescription("Role allowed to use the command").setRequired(false)),
    new SlashCommandBuilder().setName("commandtoggle").setDescription("Enable or disable a slash command")
      .addStringOption(option => option.setName("command").setDescription("Command name").setRequired(true))
      .addBooleanOption(option => option.setName("enabled").setDescription("Enable or disable it").setRequired(true)),
    new SlashCommandBuilder().setName("setlogs").setDescription("Set or clear the moderation log channel").addChannelOption(option => option.setName("channel").setDescription("Log channel").addChannelTypes(ChannelType.GuildText).setRequired(false)),
    new SlashCommandBuilder().setName("resetconfig").setDescription("Reset the bot's configuration for this server"),
    new SlashCommandBuilder().setName("backup").setDescription("Create a safe downloadable SQLite backup"),
    new SlashCommandBuilder().setName("restore").setDescription("Restore the bot from a validated SQLite backup")
      .addAttachmentOption(option => option.setName("backup").setDescription("Previously downloaded bot SQLite backup").setRequired(true)),
    new SlashCommandBuilder().setName("testsecuritydm").setDescription("Send server administrators a QIRA anti-nuke test DM")
  ];

  const { REST } = require("@discordjs/rest");
  const { Routes } = require("discord-api-types/v10");

  const api = new REST({ version: "10" }).setToken(TOKEN);

  const commandNames = commands.map(command => command.name);
  if (new Set(commandNames).size !== commandNames.length) {
    const duplicates = commandNames.filter((name, index) => commandNames.indexOf(name) !== index);
    throw new Error(`Duplicate slash command names: ${[...new Set(duplicates)].join(", ")}`);
  }
  if (COMMAND_REGISTRATION_MODE === "guild") {
    await api.put(Routes.applicationGuildCommands(CLIENT_ID, DUPLICATE_COMMAND_CLEANUP_GUILD_ID), {
      body: commands.map(command => command.toJSON())
    });
    console.log(`✅ Guild slash commands registered for ${DUPLICATE_COMMAND_CLEANUP_GUILD_ID}!`);
  } else {
    await api.put(Routes.applicationCommands(CLIENT_ID), {
      body: commands.map(command => command.toJSON())
    });

    const globalCommandNames = new Set(commandNames);
    const guildCommands = await api.get(
      Routes.applicationGuildCommands(CLIENT_ID, DUPLICATE_COMMAND_CLEANUP_GUILD_ID)
    );
    const duplicateGuildCommands = guildCommands.filter(command =>
      command.type === 1 && globalCommandNames.has(command.name)
    );
    for (const command of duplicateGuildCommands) {
      await api.delete(
        Routes.applicationGuildCommand(CLIENT_ID, DUPLICATE_COMMAND_CLEANUP_GUILD_ID, command.id)
      );
    }
    if (duplicateGuildCommands.length) {
      console.log(`🧹 Removed ${duplicateGuildCommands.length} duplicate guild command(s).`);
    }

    console.log("✅ Global slash commands registered!");
  }
}

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = interaction.commandName;
      const guild = interaction.guild;

      if (!guild) return;

      const cooldownMs = takePublicCommandCooldown(interaction);
      if (cooldownMs) {
        return interaction.reply({
          content: `⏳ Please wait **${(cooldownMs / 1000).toFixed(1)} seconds** before using another public command.`,
          ephemeral: true
        });
      }

      if (command === "reactionrole") {
        const accessError = reactionRoleManagerError(interaction);
        if (accessError) {
          return interaction.reply({ embeds: [errorEmbed(accessError)], ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "list") {
          const panels = db.prepare(`
            SELECT id, channel_id, title, created_at
            FROM reaction_role_panels
            WHERE guild_id = ?
            ORDER BY id DESC
            LIMIT 25
          `).all(guild.id);
          const identity = getBotIdentity();
          const embed = publicEmbed(`${identity.username} Reaction-Role Panels`,
            panels.length ? "Panel IDs can be used with `/reactionrole edit` and `/reactionrole delete`." : "No role panels have been published yet.",
            0x5865F2);
          for (const panel of panels) {
            embed.addFields({
              name: `Panel #${panel.id} — ${safeText(panel.title)}`.slice(0, 256),
              value: `Channel: ${channelMention(panel.channel_id)}\nCreated: ${timestamp(panel.created_at)}`,
              inline: false
            });
          }
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (subcommand === "delete") {
          const panelId = interaction.options.getInteger("panel_id", true);
          const panel = db.prepare("SELECT * FROM reaction_role_panels WHERE id = ? AND guild_id = ?").get(panelId, guild.id);
          if (!panel) return interaction.reply({ embeds: [errorEmbed("That panel does not exist in this server.")], ephemeral: true });
          await interaction.deferReply({ ephemeral: true });
          db.transaction(() => {
            db.prepare("DELETE FROM reaction_role_panel_roles WHERE panel_id = ?").run(panelId);
            db.prepare("DELETE FROM reaction_role_panels WHERE id = ? AND guild_id = ?").run(panelId, guild.id);
          })();
          let messageRemoved = true;
          if (panel.message_id) {
            let channel;
            try {
              channel = await guild.channels.fetch(panel.channel_id);
            } catch (error) {
              messageRemoved = false;
              console.error(`Could not fetch channel for reaction-role panel #${panelId}:`, error);
            }
            if (channel?.isTextBased()) {
              try {
                const message = await channel.messages.fetch(panel.message_id);
                await message.delete();
              } catch (error) {
                if (error.code !== 10008) {
                  messageRemoved = false;
                  console.error(`Could not remove reaction-role panel #${panelId} message:`, error);
                }
              }
            } else if (channel) {
              messageRemoved = false;
            }
          }
          addModLog(guild.id, "reaction_role_panel", guild.id, interaction.user.id,
            "Reaction-role panel deleted", `Panel #${panelId}`);
          return interaction.editReply({
            embeds: [publicEmbed("Reaction-Role Panel Deleted",
              messageRemoved ? `Panel **#${panelId}** and its published message were deleted.` :
                `Panel **#${panelId}** was removed from storage, but I couldn't delete its old message. Its buttons will no longer work.`,
              messageRemoved ? 0x57F287 : 0xFEE75C)]
          });
        }

        if (subcommand === "create") {
          const channel = interaction.options.getChannel("channel", true);
          const identity = getBotIdentity();
          const title = interaction.options.getString("title")?.trim() || `${identity.username} Roles`;
          const description = interaction.options.getString("description")?.trim() || "Use the buttons below to add or remove roles.";
          return startReactionRoleSetup(interaction, {
            mode: "create",
            channelId: channel.id,
            title,
            description,
            existingEmojiByRoleId: new Map()
          });
        }

        if (subcommand === "edit") {
          const panelId = interaction.options.getInteger("panel_id", true);
          const panel = db.prepare("SELECT * FROM reaction_role_panels WHERE id = ? AND guild_id = ?").get(panelId, guild.id);
          if (!panel) return interaction.reply({ embeds: [errorEmbed("That panel does not exist in this server.")], ephemeral: true });
          const title = interaction.options.getString("title");
          const description = interaction.options.getString("description");
          if ((title !== null && !title.trim()) || (description !== null && !description.trim())) {
            return interaction.reply({ embeds: [errorEmbed("Panel title and description cannot be blank.")], ephemeral: true });
          }
          const roleRows = db.prepare(`
            SELECT role_id, emoji FROM reaction_role_panel_roles WHERE panel_id = ? ORDER BY position
          `).all(panelId);
          const currentRoles = roleRows.map(row => guild.roles.cache.get(row.role_id)).filter(Boolean);
          const existingEmojiByRoleId = new Map();
          for (const row of roleRows) {
            const parsedEmoji = parseReactionRoleButtonEmoji(row.emoji, guild);
            existingEmojiByRoleId.set(row.role_id, parsedEmoji.error ? null : parsedEmoji.value);
          }
          return startReactionRoleSetup(interaction, {
            mode: "edit",
            panelId,
            channelId: panel.channel_id,
            title: title === null ? panel.title : title.trim(),
            description: description === null ? panel.description : description.trim(),
            initialRoleIds: currentRoles.map(role => role.id),
            existingEmojiByRoleId
          });
        }
      }

      if (command === "help") {
        return interaction.reply({ embeds: [helpEmbed()], components: helpComponents() });
      }

      if (command === "changelogs") {
        const identity = getBotIdentity();
        const embed = publicEmbed(
          `📋 ${identity.username} Changelogs`,
          `Recent ${identity.username} updates and improvements.`,
          0x5865F2
        ).setFooter({ text: `${identity.username} v${identity.version}` }).addFields(
          { name: `${identity.username} v2.0.0 — Complete management upgrade`, value: "• Added tickets, security automation and community tools\n• Added advanced giveaways and persistent reminders\n• Added administration, backup and restore commands\n• Added configurable role-based command permissions\n• Redesigned `/help`", inline: false },
          { name: `${identity.username} v1.2.0 — Giveaway reliability`, value: "• Added weighted entries and winner-history protection\n• Added restart-safe giveaway recovery\n• Added required roles and bot-entry controls", inline: false },
          { name: `${identity.username} v1.1.0 — Moderation expansion`, value: "• Added timeout, unban, nickname and moderation-case commands\n• Improved hierarchy and bot-permission checks", inline: false }
        );
        return interaction.reply({ embeds: [embed] });
      }

      if (command === "about") {
        return interaction.reply({ embeds: [aboutEmbed()] });
      }

      if (command === "serverinfo") {
        return interaction.reply({ embeds: [serverInfoEmbed(guild)] });
      }

      if (["roleinfo", "channelinfo", "avatar", "membercount", "serverstats", "botinfo", "ping", "invite"].includes(command)) {
        if (command === "roleinfo") {
          const role = interaction.options.getRole("role", true);
          return interaction.reply({ embeds: [publicEmbed("🎭 Role Information", role.toString(), 0x5865F2).addFields(
            { name: "ID", value: role.id, inline: true },
            { name: "Members", value: String(role.members.size), inline: true },
            { name: "Color", value: role.hexColor, inline: true },
            { name: "Position", value: String(role.position), inline: true },
            { name: "Created", value: timestamp(role.createdTimestamp), inline: true }
          )], ephemeral: false });
        }
        if (command === "channelinfo") {
          const channel = interaction.options.getChannel("channel") || interaction.channel;
          return interaction.reply({ embeds: [publicEmbed("📺 Channel Information", channel.toString(), 0x5865F2).addFields(
            { name: "ID", value: channel.id, inline: true },
            { name: "Type", value: String(channel.type), inline: true },
            { name: "Created", value: timestamp(channel.createdTimestamp), inline: true },
            { name: "Category", value: channel.parent?.name || "None", inline: true }
          )] });
        }
        if (command === "avatar") {
          const user = interaction.options.getUser("user") || interaction.user;
          const embed = publicEmbed("🖼️ Avatar", user.toString(), 0x5865F2).setImage(user.displayAvatarURL({ size: 512, extension: "png" }));
          return interaction.reply({ embeds: [embed] });
        }
        if (command === "membercount") {
          return interaction.reply({ embeds: [publicEmbed("👥 Member Count", `**${guild.memberCount}** members are in ${guild.name}.`, 0x5865F2)] });
        }
        if (command === "serverstats") {
          const text = guild.channels.cache.filter(channel => channel.isTextBased()).size;
          const voice = guild.channels.cache.filter(channel => channel.isVoiceBased()).size;
          const bots = guild.members.cache.filter(member => member.user.bot).size;
          const humans = guild.memberCount - bots;
          return interaction.reply({ embeds: [publicEmbed("📊 Server Statistics", guild.name, 0x5865F2).addFields(
            { name: "Members", value: String(guild.memberCount), inline: true },
            { name: "Humans", value: String(humans), inline: true },
            { name: "Bots", value: String(bots), inline: true },
            { name: "Text channels", value: String(text), inline: true },
            { name: "Voice channels", value: String(voice), inline: true },
            { name: "Roles", value: String(guild.roles.cache.size), inline: true }
          )] });
        }
        if (command === "botinfo") {
          const identity = getBotIdentity();
          const embed = publicEmbed(`🤖 ${identity.username}`, "A professional Discord server management bot.", 0x5865F2).addFields(
            { name: "Servers", value: String(client.guilds.cache.size), inline: true },
            { name: "Users", value: String(client.guilds.cache.reduce((total, server) => total + server.memberCount, 0)), inline: true },
            { name: "Version", value: `v${identity.version}`, inline: true },
            { name: "Bot ID", value: identity.id || "Unavailable", inline: true },
            { name: "Library", value: "Discord.js v14", inline: true },
            { name: "Node.js", value: process.version, inline: true }
          );
          if (identity.avatarURL) embed.setThumbnail(identity.avatarURL);
          return interaction.reply({ embeds: [embed] });
        }
        if (command === "ping") {
          return interaction.reply({ embeds: [publicEmbed("🏓 Pong", `Gateway: **${client.ws.ping}ms**\nShard: **${guild.shardId}**`, 0x5865F2)], ephemeral: true });
        }
        if (command === "invite") {
          const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&integration_type=0&scope=bot%20applications.commands`;
          const botName = getBotIdentity().username;
          return interaction.reply({ embeds: [publicEmbed(`➕ Invite ${botName}`, `[Add ${botName} to a server](${inviteUrl})`, 0x5865F2)], ephemeral: true });
        }
      }

      if (command === "giveaway") {
        const action = interaction.options.getSubcommand();
        if (action !== "list" && !hasGiveawayManageAccess(interaction)) {
          return interaction.reply({ embeds: [errorEmbed("Only administrators or roles authorized for `/giveaway` in `/setup` can manage giveaways.")], ephemeral: true });
        }

        if (action === "list") {
          const activeGiveaways = db.prepare(`
            SELECT *
            FROM giveaways
            WHERE guild_id = ? AND status = 'active'
            ORDER BY ends_at ASC
            LIMIT 25
          `).all(guild.id);
          const embed = publicEmbed(
            "🎉 Active Giveaways",
            activeGiveaways.length
              ? activeGiveaways.map(giveaway => {
                const totals = getGiveawayEntryTotals(giveaway.id);
                return `**#${giveaway.id} — ${safeText(giveaway.prize)}**\nChannel: ${channelMention(giveaway.channel_id)} • Ends ${timestamp(giveaway.ends_at)} • ${totals.participants} participant(s), ${totals.entries} entry/entries`;
              }).join("\n\n")
              : "There are no active giveaways in this server.",
            0x5865F2
          );
          return interaction.reply({ embeds: [embed] });
        }

        if (action === "create") {
          const prize = interaction.options.getString("prize", true).trim();
          const winnerCount = interaction.options.getInteger("winners", true);
          const durationMs = parseGiveawayDuration(interaction.options.getString("duration", true));
          const channel = interaction.options.getChannel("channel", true);
          const description = interaction.options.getString("description")?.trim() || null;
          const bonusRole = interaction.options.getRole("bonus_role");
          const requiredRole = interaction.options.getRole("required_role");
          const bonusEntries = interaction.options.getInteger("bonus_entries");
          const allowBots = interaction.options.getBoolean("allow_bots") ?? false;
          if (!prize) {
            return interaction.reply({ embeds: [errorEmbed("The prize can't be empty.")], ephemeral: true });
          }
          if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 25) {
            return interaction.reply({ embeds: [errorEmbed("Choose between 1 and 25 winners.")], ephemeral: true });
          }
          if (!durationMs) {
            return interaction.reply({ embeds: [errorEmbed("Enter a duration from 1 minute to 30 days, such as `10m`, `1h`, or `2d`.")], ephemeral: true });
          }
          if ((bonusRole && bonusRole.id === guild.id) ||
              (bonusRole && bonusEntries !== 2) ||
              (!bonusRole && bonusEntries !== null)) {
            return interaction.reply({ embeds: [errorEmbed("Bonus entries require a non-@everyone bonus role and the `2 entries` setting.")], ephemeral: true });
          }
          const botMember = guild.members.me;
          const botPermissions = botMember ? channel.permissionsFor(botMember) : null;
          if (!botPermissions?.has(PermissionFlagsBits.ViewChannel) ||
              !botPermissions.has(PermissionFlagsBits.SendMessages) ||
              !botPermissions.has(PermissionFlagsBits.EmbedLinks)) {
            return interaction.reply({ embeds: [errorEmbed("I need View Channel, Send Messages, and Embed Links permissions in the giveaway channel.")], ephemeral: true });
          }

          const createdAt = now();
          const endsAt = createdAt + durationMs;
          const insert = db.prepare(`
            INSERT INTO giveaways (
              guild_id, channel_id, host_id, prize, description, winner_count,
              duration_ms, ends_at, bonus_role_id, bonus_entries, required_role_id, allow_bots, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            guild.id,
            channel.id,
            interaction.user.id,
            prize,
            description,
            winnerCount,
            durationMs,
            endsAt,
            bonusRole?.id || null,
            bonusRole ? bonusEntries : null,
            requiredRole?.id || null,
            allowBots ? 1 : 0,
            createdAt
          );
          const giveawayId = Number(insert.lastInsertRowid);
          let giveaway = getGiveaway(guild.id, giveawayId);
          let post;
          try {
            post = await channel.send({
              embeds: [giveawayEmbed(giveaway)],
              components: [giveawayEntryButton(giveawayId)],
              allowedMentions: { parse: [] }
            });
          } catch (error) {
            console.error(`Could not post giveaway #${giveawayId}:`, error);
            db.prepare("DELETE FROM giveaway_entries WHERE giveaway_id = ?").run(giveawayId);
            db.prepare("DELETE FROM giveaways WHERE id = ?").run(giveawayId);
            return interaction.reply({ embeds: [errorEmbed("I couldn't post that giveaway. Check my channel permissions and try again.")], ephemeral: true });
          }
          try {
            db.prepare("UPDATE giveaways SET message_id = ? WHERE id = ?").run(post.id, giveawayId);
            giveaway = getGiveaway(guild.id, giveawayId);
            scheduleGiveaway(giveawayId);
          } catch (error) {
            console.error(`Could not persist giveaway post #${giveawayId}:`, error);
            await post.delete().catch(cleanupError => {
              console.warn(`Could not remove incomplete giveaway post #${giveawayId}:`, cleanupError.message);
            });
            db.prepare("DELETE FROM giveaway_entries WHERE giveaway_id = ?").run(giveawayId);
            db.prepare("DELETE FROM giveaways WHERE id = ?").run(giveawayId);
            return interaction.reply({ embeds: [errorEmbed("I couldn't save that giveaway. The incomplete post was cleaned up.")], ephemeral: true });
          }
          return interaction.reply({
            embeds: [publicEmbed("✅ Giveaway Created", `Giveaway **#${giveawayId}** was posted in ${channel}.\n[Jump to giveaway](https://discord.com/channels/${guild.id}/${channel.id}/${post.id})`, 0x57F287)],
            ephemeral: true
          });
        }

        const giveawayId = interaction.options.getInteger("giveaway_id", true);
        await interaction.deferReply({ ephemeral: true });
        if (action === "end") {
          const result = await endGiveaway(guild.id, giveawayId, { manual: true });
          if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
          const response = publicEmbed("✅ Giveaway Ended", `Giveaway **#${giveawayId}** has ended.\nWinner(s): ${result.winnerIds.length ? result.winnerIds.map(userMention).join(", ") : "No eligible participants."}`, 0x57F287);
          if (result.warning) response.addFields({ name: "⚠️ Notice", value: result.warning });
          return interaction.editReply({ embeds: [response], allowedMentions: { users: result.winnerIds } });
        }
        if (action === "cancel") {
          const result = await cancelGiveaway(guild.id, giveawayId);
          if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
          const response = publicEmbed("🚫 Giveaway Cancelled", `Giveaway **#${giveawayId}** was cancelled without selecting winners.`, 0xED4245);
          if (result.warning) response.addFields({ name: "⚠️ Notice", value: result.warning });
          return interaction.editReply({ embeds: [response] });
        }
        if (action === "reroll") {
          const result = await rerollGiveaway(guild.id, giveawayId);
          if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
          const response = publicEmbed("🔄 Giveaway Rerolled", `New winner(s) for giveaway **#${giveawayId}**: ${result.winnerIds.length ? result.winnerIds.map(userMention).join(", ") : "No eligible participants."}`, 0x57F287);
          if (result.warning) response.addFields({ name: "⚠️ Notice", value: result.warning });
          return interaction.editReply({ embeds: [response], allowedMentions: { users: result.winnerIds } });
        }
      }

      if (command === "ticket-setup") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ embeds: [errorEmbed("Only administrators can configure tickets.")], ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        const panelChannel = interaction.options.getChannel("panel_channel", true);
        const category = interaction.options.getChannel("category", true);
        const supportRole = interaction.options.getRole("support_role", true);
        const openLimit = interaction.options.getInteger("open_limit") || 1;
        if (!panelChannel.isTextBased()) return interaction.editReply({ embeds: [errorEmbed("The panel channel must be a text channel.")] });
        const panel = publicEmbed("🎫 Support Tickets", "Select the button below to create a private support ticket.", 0x5865F2);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("ticket_create").setLabel("Create Ticket").setStyle(ButtonStyle.Primary)
        );
        const message = await panelChannel.send({ embeds: [panel], components: [row] }).catch(error => {
          console.error("Could not post ticket panel:", error);
          return null;
        });
        if (!message) return interaction.editReply({ embeds: [errorEmbed("I couldn't post the ticket panel. Check my channel permissions.")] });
        db.prepare(`
          INSERT INTO ticket_settings (guild_id, panel_channel_id, panel_message_id, category_id, support_role_id, open_limit)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(guild_id) DO UPDATE SET
            panel_channel_id = excluded.panel_channel_id,
            panel_message_id = excluded.panel_message_id,
            category_id = excluded.category_id,
            support_role_id = excluded.support_role_id,
            open_limit = excluded.open_limit
        `).run(guild.id, panelChannel.id, message.id, category.id, supportRole.id, openLimit);
        return interaction.editReply({ embeds: [publicEmbed("✅ Ticket Setup Saved", `Panel posted in ${panelChannel}. Tickets will be created under ${category} for ${supportRole}.`, 0x57F287)] });
      }

      if (["ticket-add", "ticket-remove", "ticket-close", "ticket-reopen", "ticket-transcript", "ticket-claim"].includes(command)) {
        const settings = db.prepare("SELECT * FROM ticket_settings WHERE guild_id = ?").get(guild.id);
        const ticket = db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ?").get(guild.id, interaction.channelId);
        if (!settings || !ticket) return interaction.reply({ embeds: [errorEmbed("This command can only be used inside a ticket channel.")], ephemeral: true });
        const isStaff = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
          (settings.support_role_id && interaction.member.roles.cache.has(settings.support_role_id));
        if (!isStaff) return interaction.reply({ embeds: [errorEmbed("Only ticket staff can manage tickets.")], ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        if (command === "ticket-add" || command === "ticket-remove") {
          const member = await guild.members.fetch(interaction.options.getUser("user", true).id).catch(() => null);
          if (!member) return interaction.editReply({ embeds: [errorEmbed("Member not found.")] });
          const channel = interaction.channel;
          if (command === "ticket-add") {
            await channel.permissionOverwrites.edit(member, { ViewChannel: true, SendMessages: true }).catch(error => {
              throw error;
            });
          } else {
            await channel.permissionOverwrites.delete(member).catch(error => {
              throw error;
            });
          }
          addModLog(guild.id, command, member.id, interaction.user.id, `${command === "ticket-add" ? "Added" : "Removed"} in ticket #${ticket.ticket_number}`);
          return interaction.editReply({ embeds: [publicEmbed("🎫 Ticket Updated", `${member} was ${command === "ticket-add" ? "added to" : "removed from"} ticket **#${ticket.ticket_number}**.`, 0x57F287)] });
        }
        if (command === "ticket-close") {
          if (ticket.status === "closed") return interaction.editReply({ embeds: [errorEmbed("This ticket is already closed.")] });
          const reason = interaction.options.getString("reason")?.trim() || "No reason provided";
          db.prepare("UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?").run(now(), ticket.id);
          await interaction.channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: false }).catch(() => {});
          addModLog(guild.id, "ticket_close", ticket.user_id, interaction.user.id, reason, `Ticket #${ticket.ticket_number} closed`);
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ticket_reopen:${ticket.id}`).setLabel("Reopen Ticket").setStyle(ButtonStyle.Success)
          );
          await interaction.channel.send({ embeds: [publicEmbed("🔒 Ticket Closed", `Ticket **#${ticket.ticket_number}** was closed by ${userMention(interaction.user.id)}.\nReason: ${safeText(reason)}`, 0xED4245)], components: [row] }).catch(() => {});
          return interaction.editReply({ embeds: [publicEmbed("🔒 Ticket Closed", `Ticket **#${ticket.ticket_number}** is now closed.`, 0x57F287)] });
        }
        if (command === "ticket-reopen") {
          if (ticket.status === "open") return interaction.editReply({ embeds: [errorEmbed("This ticket is already open.")] });
          const reason = interaction.options.getString("reason")?.trim() || "No reason provided";
          db.prepare("UPDATE tickets SET status = 'open', closed_at = NULL WHERE id = ?").run(ticket.id);
          await interaction.channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: true }).catch(() => {});
          addModLog(guild.id, "ticket_reopen", ticket.user_id, interaction.user.id, reason, `Ticket #${ticket.ticket_number} reopened`);
          return interaction.editReply({ embeds: [publicEmbed("🔓 Ticket Reopened", `Ticket **#${ticket.ticket_number}** was reopened.\nReason: ${safeText(reason)}`, 0x57F287)] });
        }
        if (command === "ticket-claim") {
          db.prepare("UPDATE tickets SET claimed_by = ? WHERE id = ?").run(interaction.user.id, ticket.id);
          addModLog(guild.id, "ticket_claim", ticket.user_id, interaction.user.id, "Ticket claimed", `Ticket #${ticket.ticket_number}`);
          return interaction.editReply({ embeds: [publicEmbed("🙋 Ticket Claimed", `Ticket **#${ticket.ticket_number}** is now claimed by ${userMention(interaction.user.id)}.`, 0x5865F2)] });
        }
        if (command === "ticket-transcript") {
          const channel = interaction.channel;
          const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
          const lines = messages
            ? [...messages.values()].reverse().map(message => `${new Date(message.createdTimestamp).toISOString()} ${message.author.tag}: ${message.cleanContent}`)
            : [];
          const attachment = {
            name: `ticket-${ticket.ticket_number}-transcript.txt`,
            attachment: Buffer.from(lines.join("\n") || "No messages found.", "utf8")
          };
          await interaction.editReply({ content: `Transcript for ticket **#${ticket.ticket_number}**`, files: [attachment] });
          addModLog(guild.id, "ticket_transcript", ticket.user_id, interaction.user.id, "Transcript generated", `Ticket #${ticket.ticket_number}`);
          return;
        }
      }

      if (["config", "permissions", "commandtoggle", "setlogs", "resetconfig", "backup", "restore"].includes(command)) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ embeds: [errorEmbed("Only administrators can use this command.")], ephemeral: true });
        }
        if (command === "config") {
          const settings = getSettings(guild.id);
          return interaction.reply({ embeds: [publicEmbed(`⚙️ ${getBotIdentity().username} Configuration`, "Current server configuration.", 0x5865F2).addFields(
            { name: "Setup complete", value: settings.setup_complete ? "Yes" : "No", inline: true },
            { name: "Log channel", value: settings.log_channel_id ? channelMention(settings.log_channel_id) : "Not set", inline: true },
            { name: "Server log channel", value: settings.server_log_channel_id ? channelMention(settings.server_log_channel_id) : "Not set", inline: true },
            { name: "Welcome", value: (db.prepare("SELECT welcome_channel_id FROM community_settings WHERE guild_id = ?").get(guild.id)?.welcome_channel_id ? "Configured" : "Not set"), inline: true },
            { name: "Tickets", value: (db.prepare("SELECT panel_channel_id FROM ticket_settings WHERE guild_id = ?").get(guild.id)?.panel_channel_id ? "Configured" : "Not set"), inline: true },
            { name: "Security", value: db.prepare("SELECT 1 FROM security_settings WHERE guild_id = ?").get(guild.id) ? "Configured" : "Defaults", inline: true }
          )], ephemeral: true });
        }
        if (command === "permissions") {
          const commandName = interaction.options.getString("command", true).toLowerCase();
          const action = interaction.options.getString("action") || "replace";
          const role = interaction.options.getRole("role");
          if (action === "clear") {
            setCommandRoles(guild.id, commandName, []);
            db.prepare(`
              INSERT INTO permission_audit (guild_id, command_name, role_id, actor_id, action, created_at)
              VALUES (?, ?, NULL, ?, 'clear', ?)
            `).run(guild.id, commandName, interaction.user.id, now());
            addModLog(guild.id, "permission_config", guild.id, interaction.user.id,
              `Cleared custom role permissions for /${commandName}; normal Discord requirements restored`);
            return interaction.reply({ embeds: [publicEmbed("🔐 Permissions Cleared", `**/${safeText(commandName)}** now uses its normal Discord permission requirement.`, 0x57F287)], ephemeral: true });
          }
          if (!role && action !== "replace") {
            const roles = getCommandRoles(guild.id, commandName);
            return interaction.reply({ embeds: [publicEmbed("🔐 Command Permissions", `**/${safeText(commandName)}**`, 0x5865F2).addFields({ name: "Authorized roles", value: roles.length ? roles.map(roleId => roleMention(roleId)).join(", ") : "No roles; standard command permission applies." })], ephemeral: true });
          }
          if (!role) {
            const roles = getCommandRoles(guild.id, commandName);
            return interaction.reply({ embeds: [publicEmbed("🔐 Command Permissions", `**/${safeText(commandName)}**`, 0x5865F2).addFields({ name: "Authorized roles", value: roles.length ? roles.map(roleId => roleMention(roleId)).join(", ") : "No roles; standard command permission applies." })], ephemeral: true });
          }
          if (role.id === guild.id || role.managed) {
            return interaction.reply({ embeds: [errorEmbed("@everyone and managed roles cannot be assigned as custom command roles.")], ephemeral: true });
          }
          const existing = getCommandRoles(guild.id, commandName);
          const nextRoles = action === "add"
            ? [...new Set([...existing, role.id])]
            : action === "remove"
              ? existing.filter(roleId => roleId !== role.id)
              : [role.id];
          setCommandRoles(guild.id, commandName, nextRoles);
          db.prepare(`
            INSERT INTO permission_audit (guild_id, command_name, role_id, actor_id, action, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(guild.id, commandName, role.id, interaction.user.id, action, now());
          addModLog(guild.id, "permission_config", role.id, interaction.user.id,
            `${action === "add" ? "Added" : action === "remove" ? "Removed" : "Replaced"} custom role permission for /${commandName}`);
          return interaction.reply({ embeds: [publicEmbed("🔐 Permission Saved", `**/${safeText(commandName)}**: ${nextRoles.length ? nextRoles.map(roleId => roleMention(roleId)).join(", ") : "no custom roles"}.`, 0x57F287)], ephemeral: true });
        }
        if (command === "commandtoggle") {
          const commandName = interaction.options.getString("command", true).toLowerCase();
          const enabled = interaction.options.getBoolean("enabled", true);
          db.prepare(`
            INSERT INTO command_settings (guild_id, command_name, enabled)
            VALUES (?, ?, ?)
            ON CONFLICT(guild_id, command_name) DO UPDATE SET enabled = excluded.enabled
          `).run(guild.id, commandName, enabled ? 1 : 0);
          return interaction.reply({ embeds: [publicEmbed("🔧 Command Updated", `**/${safeText(commandName)}** is now ${enabled ? "enabled" : "disabled"} in this server.`, enabled ? 0x57F287 : 0xED4245)], ephemeral: true });
        }
        if (command === "setlogs") {
          const channel = interaction.options.getChannel("channel");
          ensureSettings(guild.id);
          db.prepare("UPDATE settings SET log_channel_id = ? WHERE guild_id = ?").run(channel?.id || null, guild.id);
          return interaction.reply({ embeds: [publicEmbed("📝 Logging Updated", channel ? `Moderation logs will use ${channel}.` : "Moderation logging channel was cleared.", 0x57F287)], ephemeral: true });
        }
        if (command === "resetconfig") {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_reset_yes").setLabel("Yes, Reset Configuration").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_reset_no").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
          );
          return interaction.reply({ embeds: [publicEmbed("⚠️ Confirm Reset", "Resetting configuration removes server settings and role permissions, but preserves moderation records and database history.", 0xFEE75C)], components: [row], ephemeral: true });
        }
        if (command === "backup") {
          await interaction.deferReply({ ephemeral: true });
          const fs = require("node:fs");
          const path = require("node:path");
          fs.mkdirSync("backups", { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const backupPath = path.join("backups", `sentinel-${stamp}.db`);
          await db.backup(backupPath);
          const fileName = path.basename(backupPath);
          return interaction.editReply({ content: "SQLite backup created.", files: [{ attachment: backupPath, name: fileName }] });
        }
        if (command === "restore") {
          await interaction.deferReply({ ephemeral: true });
          const attachment = interaction.options.getAttachment("backup", true);
          if (!attachment.name?.toLowerCase().endsWith(".db")) {
            return interaction.editReply({ embeds: [errorEmbed("Upload a `.db` SQLite backup file.")] });
          }
          const fs = require("node:fs");
          const os = require("node:os");
          const path = require("node:path");
          const tempPath = path.join(os.tmpdir(), `sentinel-restore-${randomUUID()}.db`);
          const response = await fetch(attachment.url);
          if (!response.ok) return interaction.editReply({ embeds: [errorEmbed("I couldn't download the backup attachment.")] });
          fs.writeFileSync(tempPath, Buffer.from(await response.arrayBuffer()));
          let restoreDb;
          try {
            restoreDb = new Database(tempPath, { readonly: true, fileMustExist: true });
            if (restoreDb.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Integrity check failed");
            restoreDb.close();
            fs.copyFileSync(tempPath, `${liveDbPath}.restore.pending`);
            fs.rmSync(tempPath, { force: true });
            return interaction.editReply({ embeds: [publicEmbed("✅ Restore Staged", "The backup passed validation. Restart the bot process to apply it; a pre-restore copy will be created automatically.", 0x57F287)] });
          } catch (error) {
            if (restoreDb?.open) restoreDb.close();
            fs.rmSync(tempPath, { force: true });
            console.error("Restore validation failed:", error);
            return interaction.editReply({ embeds: [errorEmbed("The uploaded file is not a valid SQLite database.")] });
          }
        }
      }

      if (["welcome-setup", "goodbye-setup", "autorole", "suggest", "suggestion-setup", "poll", "embed", "remind"].includes(command)) {
        if (["welcome-setup", "goodbye-setup", "autorole", "suggestion-setup", "embed"].includes(command) &&
            !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
            !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ embeds: [errorEmbed("You need Manage Server permission.")], ephemeral: true });
        }
        db.prepare("INSERT INTO community_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING").run(guild.id);
        if (command === "welcome-setup") {
          const channel = interaction.options.getChannel("channel", true);
          const message = interaction.options.getString("message", true).trim();
          db.prepare("UPDATE community_settings SET welcome_channel_id = ?, welcome_message = ? WHERE guild_id = ?").run(channel.id, message, guild.id);
          return interaction.reply({ embeds: [publicEmbed("👋 Welcome Setup Saved", `Welcome messages will be sent in ${channel}.`, 0x57F287)], ephemeral: true });
        }
        if (command === "goodbye-setup") {
          const channel = interaction.options.getChannel("channel", true);
          const message = interaction.options.getString("message", true).trim();
          db.prepare("UPDATE community_settings SET goodbye_channel_id = ?, goodbye_message = ? WHERE guild_id = ?").run(channel.id, message, guild.id);
          return interaction.reply({ embeds: [publicEmbed("👋 Goodbye Setup Saved", `Goodbye messages will be sent in ${channel}.`, 0x57F287)], ephemeral: true });
        }
        if (command === "autorole") {
          const role = interaction.options.getRole("role");
          db.prepare("UPDATE community_settings SET autorole_id = ? WHERE guild_id = ?").run(role?.id || null, guild.id);
          return interaction.reply({ embeds: [publicEmbed("🎭 Autorole Updated", role ? `New members will receive ${role}.` : "Autorole was disabled.", 0x57F287)], ephemeral: true });
        }
        if (command === "suggestion-setup") {
          const channel = interaction.options.getChannel("channel", true);
          db.prepare("UPDATE community_settings SET suggestion_channel_id = ? WHERE guild_id = ?").run(channel.id, guild.id);
          return interaction.reply({ embeds: [publicEmbed("💡 Suggestions Configured", `Suggestions will be posted in ${channel}.`, 0x57F287)], ephemeral: true });
        }
        if (command === "suggest") {
          const settings = db.prepare("SELECT * FROM community_settings WHERE guild_id = ?").get(guild.id);
          if (!settings?.suggestion_channel_id) return interaction.reply({ embeds: [errorEmbed("Suggestions have not been configured.")], ephemeral: true });
          const channel = guild.channels.cache.get(settings.suggestion_channel_id);
          if (!channel?.isTextBased()) return interaction.reply({ embeds: [errorEmbed("The configured suggestion channel is unavailable.")], ephemeral: true });
          const text = interaction.options.getString("text", true).trim();
          await interaction.deferReply({ ephemeral: true });
          const message = await channel.send({ embeds: [publicEmbed("💡 Suggestion", text, 0x5865F2).addFields({ name: "Submitted by", value: userMention(interaction.user.id) })] });
          await message.react("👍").catch(() => {});
          await message.react("👎").catch(() => {});
          db.prepare("INSERT INTO suggestions (guild_id, user_id, message_id, content, created_at) VALUES (?, ?, ?, ?, ?)").run(guild.id, interaction.user.id, message.id, text, now());
          return interaction.editReply({ embeds: [publicEmbed("💡 Suggestion Submitted", `[Open suggestion](https://discord.com/channels/${guild.id}/${channel.id}/${message.id})`, 0x57F287)] });
        }
        if (command === "poll") {
          const question = interaction.options.getString("question", true).trim();
          const options = interaction.options.getString("options", true).split("|").map(option => option.trim()).filter(Boolean).slice(0, 10);
          if (options.length < 2) return interaction.reply({ embeds: [errorEmbed("Provide at least two options separated by `|`.")], ephemeral: true });
          const pollEmbed = publicEmbed("📊 Poll", question, 0x5865F2);
          options.forEach((option, index) => pollEmbed.addFields({ name: `Option ${index + 1}`, value: safeText(option), inline: false }));
          await interaction.deferReply();
          const message = await interaction.channel.send({ embeds: [pollEmbed] });
          const reactions = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
          for (let index = 0; index < options.length; index++) await message.react(reactions[index]).catch(() => {});
          db.prepare("INSERT INTO polls (guild_id, channel_id, message_id, question, options_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(guild.id, interaction.channelId, message.id, question, JSON.stringify(options), interaction.user.id, now());
          return interaction.editReply({ embeds: [publicEmbed("📊 Poll Created", "Voting is now open.", 0x57F287)] });
        }
        if (command === "embed") {
          const title = interaction.options.getString("title", true).trim();
          const description = interaction.options.getString("description", true).trim();
          const colorText = interaction.options.getString("color") || "5865F2";
          const color = /^[0-9A-Fa-f]{6}$/.test(colorText) ? Number.parseInt(colorText, 16) : 0x5865F2;
          return interaction.reply({ embeds: [publicEmbed(title, description, color)] });
        }
        if (command === "remind") {
          const durationMs = parseDuration(interaction.options.getString("duration", true));
          const text = interaction.options.getString("message", true).trim();
          if (!durationMs || durationMs > 365 * 86400000) return interaction.reply({ embeds: [errorEmbed("Enter a valid duration such as `10m`, `2h`, or `1d` (maximum 365 days).")], ephemeral: true });
          const remindAt = now() + durationMs;
          const result = db.prepare("INSERT INTO reminders (guild_id, user_id, channel_id, message, remind_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(guild.id, interaction.user.id, interaction.channelId, text, remindAt, now());
          scheduleReminder(Number(result.lastInsertRowid));
          return interaction.reply({ embeds: [publicEmbed("⏰ Reminder Set", `I’ll remind you ${timestamp(remindAt)}.`, 0x57F287)], ephemeral: true });
        }
      }

      if (["antispam", "antiraid", "antilink", "antimention", "antibot", "raidmode", "security"].includes(command)) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ embeds: [errorEmbed("You need Manage Server permission to configure security.")], ephemeral: true });
        }
        db.prepare(`
          INSERT INTO security_settings (guild_id) VALUES (?)
          ON CONFLICT(guild_id) DO NOTHING
        `).run(guild.id);
        if (command === "security") {
          const s = db.prepare("SELECT * FROM security_settings WHERE guild_id = ?").get(guild.id);
          return interaction.reply({ embeds: [publicEmbed("🛡️ Server Security", "Current security configuration.", 0x5865F2).addFields(
            { name: "Anti-spam", value: s.antispam ? `Enabled (${s.spam_limit} messages)` : "Disabled", inline: true },
            { name: "Anti-raid", value: s.antiraid ? `Enabled (${s.account_age_days}d minimum)` : "Disabled", inline: true },
            { name: "Anti-link", value: s.antilink ? "Enabled" : "Disabled", inline: true },
            { name: "Anti-mention", value: s.antimention ? `Enabled (${s.mention_limit} mentions)` : "Disabled", inline: true },
            { name: "Bot protection", value: s.antibot ? "Enabled" : "Disabled", inline: true },
            { name: "Raid mode", value: s.raidmode ? "Enabled" : "Disabled", inline: true }
          )], ephemeral: true });
        }
        const enabled = interaction.options.getBoolean("enabled", true);
        const columns = {
          antispam: "antispam",
          antiraid: "antiraid",
          antilink: "antilink",
          antimention: "antimention",
          antibot: "antibot",
          raidmode: "raidmode"
        };
        db.prepare(`UPDATE security_settings SET ${columns[command]} = ? WHERE guild_id = ?`).run(enabled ? 1 : 0, guild.id);
        if (command === "antispam") {
          const limit = interaction.options.getInteger("limit");
          if (limit) db.prepare("UPDATE security_settings SET spam_limit = ? WHERE guild_id = ?").run(limit, guild.id);
        }
        if (command === "antiraid") {
          const age = interaction.options.getInteger("account_age_days");
          if (age !== null) db.prepare("UPDATE security_settings SET account_age_days = ? WHERE guild_id = ?").run(age, guild.id);
        }
        if (command === "antimention") {
          const limit = interaction.options.getInteger("limit");
          if (limit) db.prepare("UPDATE security_settings SET mention_limit = ? WHERE guild_id = ?").run(limit, guild.id);
        }
        if (command === "raidmode" && enabled) {
          if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({ embeds: [errorEmbed("I need Manage Channels permission for raid-mode lockdown.")], ephemeral: true });
          }
          db.prepare("UPDATE security_settings SET lockdown = 1 WHERE guild_id = ?").run(guild.id);
          for (const channel of guild.channels.cache.filter(channel => channel.isTextBased()).values()) {
            await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }, { reason: "Emergency raid mode enabled" }).catch(() => {});
          }
        }
        if (command === "raidmode" && !enabled) db.prepare("UPDATE security_settings SET lockdown = 0 WHERE guild_id = ?").run(guild.id);
        return interaction.reply({ embeds: [publicEmbed("🛡️ Security Updated", `**${command}** is now ${enabled ? "enabled" : "disabled"}.`, enabled ? 0x57F287 : 0xED4245)] });
      }

      if (["giveawayreroll", "giveawayend", "giveawaylist", "giveawayedit", "giveawayentries", "giveawaydelete"].includes(command)) {
        if (command !== "giveawaylist" && command !== "giveawayentries" && !hasGiveawayManageAccess(interaction)) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to manage giveaways.")], ephemeral: true });
        }
        if (command === "giveawaylist") {
          const giveaways = db.prepare(`
            SELECT *
            FROM giveaways
            WHERE guild_id = ?
            ORDER BY created_at DESC
            LIMIT 25
          `).all(guild.id);
          const embed = publicEmbed("🎉 Giveaways", giveaways.length ? "Recent giveaways in this server:" : "There are no giveaways in this server.", 0x5865F2);
          if (giveaways.length) {
            for (const giveaway of giveaways) {
              const totals = getGiveawayEntryTotals(giveaway.id);
              embed.addFields({
                name: `#${giveaway.id} • ${safeText(giveaway.prize)}`,
                value: `Status: **${giveaway.status}** • ${totals.participants} participant(s) • ${totals.entries} entry/entries\nEnds ${timestamp(giveaway.ends_at)}`
              });
            }
          }
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (command === "giveawayentries") {
          const giveawayId = interaction.options.getInteger("giveaway_id", true);
          const giveaway = getGiveaway(guild.id, giveawayId);
          if (!giveaway) return interaction.reply({ embeds: [errorEmbed("Giveaway not found.")], ephemeral: true });
          const entries = db.prepare(`
            SELECT user_id, entry_weight, entered_at
            FROM giveaway_entries
            WHERE giveaway_id = ?
            ORDER BY entered_at DESC
            LIMIT 25
          `).all(giveawayId);
          const embed = publicEmbed(`🎟️ Giveaway #${giveawayId} Entries`, `${entries.length} displayed entry/entries.`, 0x5865F2);
          if (!entries.length) {
            embed.setDescription("There are no entries.");
          } else {
            embed.setDescription(entries.map(entry => `${userMention(entry.user_id)} — **${entry.entry_weight}** entry/entries — ${timestamp(entry.entered_at)}`).join("\n").slice(0, 4096));
          }
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const giveawayId = interaction.options.getInteger("giveaway_id", true);
        if (command === "giveawayend") {
          const result = await endGiveaway(guild.id, giveawayId, { manual: true });
          if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
          const response = publicEmbed("✅ Giveaway Ended", `Giveaway **#${giveawayId}** ended. Winner(s): ${result.winnerIds.length ? result.winnerIds.map(userMention).join(", ") : "No eligible participants."}`, 0x57F287);
          if (result.warning) response.addFields({ name: "Notice", value: result.warning });
          return interaction.editReply({ embeds: [response], allowedMentions: { users: result.winnerIds } });
        }
        if (command === "giveawayreroll") {
          const result = await rerollGiveaway(guild.id, giveawayId);
          if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
          const response = publicEmbed("🔄 Giveaway Rerolled", `New winner(s): ${result.winnerIds.length ? result.winnerIds.map(userMention).join(", ") : "No eligible participants."}`, 0x57F287);
          if (result.warning) response.addFields({ name: "Notice", value: result.warning });
          return interaction.editReply({ embeds: [response], allowedMentions: { users: result.winnerIds } });
        }
        if (command === "giveawaydelete") {
          const giveaway = getGiveaway(guild.id, giveawayId);
          if (!giveaway) return interaction.editReply({ embeds: [errorEmbed("Giveaway not found.")] });
          const timer = giveawayTimers.get(giveawayId);
          if (timer) clearTimeout(timer);
          giveawayTimers.delete(giveawayId);
          await updateGiveawayPost(giveaway, { cancelled: true }).catch(() => null);
          db.transaction(() => {
            db.prepare("DELETE FROM giveaway_entries WHERE giveaway_id = ?").run(giveawayId);
            db.prepare("DELETE FROM giveaway_winner_history WHERE giveaway_id = ?").run(giveawayId);
            db.prepare("DELETE FROM giveaways WHERE id = ? AND guild_id = ?").run(giveawayId, guild.id);
          })();
          return interaction.editReply({ embeds: [publicEmbed("🗑️ Giveaway Deleted", `Giveaway **#${giveawayId}** and all of its entries and winner history were deleted.`, 0x57F287)] });
        }
        if (command === "giveawayedit") {
          const giveaway = getGiveaway(guild.id, giveawayId);
          if (!giveaway || giveaway.status !== "active") return interaction.editReply({ embeds: [errorEmbed("Only an active giveaway can be edited.")] });
          const prize = interaction.options.getString("prize")?.trim();
          const description = interaction.options.getString("description")?.trim();
          const winnerCount = interaction.options.getInteger("winners");
          const durationText = interaction.options.getString("duration")?.trim();
          const requiredRole = interaction.options.getRole("required_role");
          const durationMs = durationText ? parseGiveawayDuration(durationText) : null;
          if (durationText && !durationMs) return interaction.editReply({ embeds: [errorEmbed("Enter a duration such as `10m`, `1h`, or `2d` (maximum 30 days).")] });
          if (prize && !prize.length) return interaction.editReply({ embeds: [errorEmbed("The prize cannot be empty.")] });
          if (winnerCount && !Number.isInteger(winnerCount)) return interaction.editReply({ embeds: [errorEmbed("Winner count must be a number.")] });
          db.prepare(`
            UPDATE giveaways
            SET prize = COALESCE(?, prize),
                description = CASE WHEN ? IS NULL THEN description ELSE ? END,
                winner_count = COALESCE(?, winner_count),
                duration_ms = CASE WHEN ? IS NULL THEN duration_ms ELSE ? END,
                ends_at = CASE WHEN ? IS NULL THEN ends_at ELSE ? END,
                required_role_id = CASE WHEN ? IS NULL THEN required_role_id ELSE ? END
            WHERE id = ? AND guild_id = ? AND status = 'active'
          `).run(
            prize || null,
            description || null, description || null,
            winnerCount || null,
            durationMs, durationMs,
            durationMs, durationMs ? now() + durationMs : null,
            requiredRole?.id || null, requiredRole?.id || null,
            giveawayId, guild.id
          );
          const updated = getGiveaway(guild.id, giveawayId);
          await updateGiveawayPost(updated).catch(error => console.error(`Could not update edited giveaway #${giveawayId}:`, error));
          scheduleGiveaway(giveawayId);
          return interaction.editReply({ embeds: [publicEmbed("✏️ Giveaway Edited", `Giveaway **#${giveawayId}** was updated.`, 0x57F287)] });
        }
      }

      if (command === "lb-make") {
        if (!hasCommandAccess(interaction, "lb-make")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/lb-make`.")], ephemeral: true });
        }

        const name = interaction.options.getString("name", true).trim();
        const channel = interaction.options.getChannel("channel", true);
        if (!name) {
          return interaction.reply({ embeds: [errorEmbed("Leaderboard names can't be empty.")], ephemeral: true });
        }
        if (getLeaderboard(guild.id, name)) {
          return interaction.reply({ embeds: [errorEmbed(`A leaderboard named **${safeText(name)}** already exists in this server.`)], ephemeral: true });
        }

        const botMember = guild.members.me;
        const botPermissions = botMember ? channel.permissionsFor(botMember) : null;
        const requiredPermissions = [
          [PermissionFlagsBits.ViewChannel, "View Channel"],
          [PermissionFlagsBits.ManageWebhooks, "Manage Webhooks"],
          [PermissionFlagsBits.SendMessages, "Send Messages"],
          [PermissionFlagsBits.EmbedLinks, "Embed Links"]
        ];
        const missingPermissions = requiredPermissions
          .filter(([permission]) => !botPermissions?.has(permission))
          .map(([, name]) => name);
        if (missingPermissions.length) {
          return interaction.reply({
            embeds: [errorEmbed(`I need ${missingPermissions.join(", ")} permission${missingPermissions.length === 1 ? "" : "s"} in ${channel}.`)],
            ephemeral: true
          });
        }

        await interaction.deferReply({ ephemeral: true });
        const webhook = await channel.createWebhook({
          name: `${name} Leaderboard`,
          reason: `Leaderboard created by ${interaction.user.tag}`
        });
        let boardId;
        let messageId;
        try {
          const result = db.prepare(`
            INSERT INTO leaderboards (guild_id, name, channel_id, webhook_id, webhook_token, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(guild.id, name, channel.id, webhook.id, webhook.token, interaction.user.id, now());
          boardId = Number(result.lastInsertRowid);
          const board = db.prepare("SELECT * FROM leaderboards WHERE id = ?").get(boardId);
          messageId = await publishLeaderboard(board, guild);
        } catch (error) {
          if (boardId) db.prepare("DELETE FROM leaderboards WHERE id = ?").run(boardId);
          await webhook.delete("Cleaning up failed leaderboard creation").catch(cleanupError => {
            console.warn(`Could not remove webhook for failed leaderboard creation (${webhook.id}):`, cleanupError.message);
          });
          throw error;
        }

        return interaction.editReply({
            embeds: [publicEmbed(
              "🏆 Leaderboard Created",
              `**${safeText(name)}** is now posted in ${channel} through a webhook.\n[Open leaderboard](https://discord.com/channels/${guild.id}/${channel.id}/${messageId})`,
              0x57F287
            )],
          });
      }

      if (command === "lb-edit") {
        if (!hasCommandAccess(interaction, "lb-edit")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/lb-edit`.")], ephemeral: true });
        }

        return interaction.reply({
          ...leaderboardPickerPanel(guild.id, interaction.user.id),
          ephemeral: true
        });
      }

      if (command === "lb-delete") {
        if (!hasCommandAccess(interaction, "lb-delete")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/lb-delete`.")], ephemeral: true });
        }

        const name = interaction.options.getString("name", true).trim();
        const board = getLeaderboard(guild.id, name);
        if (!board) {
          return interaction.reply({ embeds: [errorEmbed(`No leaderboard named **${safeText(name)}** exists in this server.`)], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const webhook = new WebhookClient({ id: board.webhook_id, token: board.webhook_token });
        if (board.message_id) {
          try {
            await webhook.deleteMessage(board.message_id);
          } catch (error) {
            if (![10008, 10015].includes(error.code) && error.status !== 404) throw error;
          }
        }
        try {
          await webhook.delete(`Leaderboard "${board.name}" deleted by ${interaction.user.tag}`);
        } catch (error) {
          if (error.code !== 10015 && error.status !== 404) throw error;
        }
        db.transaction(() => {
          db.prepare("DELETE FROM leaderboard_scores WHERE leaderboard_id = ?").run(board.id);
          db.prepare("DELETE FROM leaderboards WHERE id = ? AND guild_id = ?").run(board.id, guild.id);
        })();

        return interaction.editReply({
          embeds: [publicEmbed("🗑️ Leaderboard Deleted", `**${safeText(board.name)}**, its scores, webhook, and post have been deleted.`, 0x57F287)]
        });
      }

      if (command === "lbremove") {
        if (!hasCommandAccess(interaction, "lbremove")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/lbremove`.")], ephemeral: true });
        }

        const name = interaction.options.getString("name", true).trim();
        const player = interaction.options.getUser("player", true);
        const board = getLeaderboard(guild.id, name);
        if (!board) {
          return interaction.reply({ embeds: [errorEmbed(`No leaderboard named **${safeText(name)}** exists in this server.`)], ephemeral: true });
        }
        if (player.bot) {
          return interaction.reply({ embeds: [errorEmbed("Bots can't be removed as leaderboard players.")], ephemeral: true });
        }

        const scoreRecord = db.prepare(`
          SELECT 1
          FROM leaderboard_scores
          WHERE leaderboard_id = ? AND user_id = ?
        `).get(board.id, player.id);
        if (!scoreRecord) {
          return interaction.reply({ embeds: [errorEmbed(`${player} isn't listed on **${safeText(board.name)}**.`)], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        db.prepare(`
          DELETE FROM leaderboard_scores
          WHERE leaderboard_id = ? AND user_id = ?
        `).run(board.id, player.id);
        try {
          await publishLeaderboard(board, guild);
        } catch (error) {
          console.error(`Leaderboard webhook update failed after removing member ${player.id} from board #${board.id}:`, error);
          const errorMessage = error instanceof Error ? safeText(error.message).slice(0, 500) : "Unknown webhook error";
          return interaction.editReply({
            embeds: [errorEmbed(`The player was removed, but the webhook post couldn't be updated. Check that the webhook still exists and can post.\n\n${errorMessage}`)]
          });
        }

        return interaction.editReply({
          embeds: [publicEmbed("✅ Player Removed", `${player} was removed from **${safeText(board.name)}**.`, 0x57F287)]
        });
      }

      if (command === "lb-switch") {
        if (!hasCommandAccess(interaction, "lb-switch")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/lb-switch`.")], ephemeral: true });
        }

        const name = interaction.options.getString("name", true).trim();
        const firstRank = interaction.options.getInteger("first_rank", true);
        const secondRank = interaction.options.getInteger("second_rank", true);
        if (firstRank === secondRank) {
          return interaction.reply({ embeds: [errorEmbed("Choose two different leaderboard ranks.")], ephemeral: true });
        }

        const board = getLeaderboard(guild.id, name);
        if (!board) {
          return interaction.reply({ embeds: [errorEmbed(`No leaderboard named **${safeText(name)}** exists in this server.`)], ephemeral: true });
        }
        const firstPlayer = db.prepare(`
          SELECT user_id, spot
          FROM leaderboard_scores
          WHERE leaderboard_id = ? AND spot = ?
        `).get(board.id, firstRank);
        const secondPlayer = db.prepare(`
          SELECT user_id, spot
          FROM leaderboard_scores
          WHERE leaderboard_id = ? AND spot = ?
        `).get(board.id, secondRank);
        if (!firstPlayer || !secondPlayer) {
          const occupiedTopSpots = db.prepare(`
            SELECT COUNT(*) AS count
            FROM leaderboard_scores
            WHERE leaderboard_id = ? AND spot BETWEEN 1 AND 10
          `).get(board.id).count;
          return interaction.reply({
            embeds: [errorEmbed(`Both spots must be occupied. This leaderboard currently has **${occupiedTopSpots}** player${occupiedTopSpots === 1 ? "" : "s"} in its top 10.`)],
            ephemeral: true
          });
        }
        await interaction.deferReply({ ephemeral: true });
        swapLeaderboardSpots(board.id, firstPlayer.user_id, secondPlayer.user_id);

        try {
          await publishLeaderboard(board, guild);
        } catch (error) {
          console.error(`Leaderboard webhook update failed after switching ranks ${firstRank} and ${secondRank} on board #${board.id}:`, error);
          const errorMessage = error instanceof Error ? safeText(error.message).slice(0, 500) : "Unknown webhook error";
          return interaction.editReply({
            embeds: [errorEmbed(`The spots were switched, but the webhook post couldn't be updated. Check that the webhook still exists and can post.\n\n${errorMessage}`)]
          });
        }

        return interaction.editReply({
          embeds: [publicEmbed(
            "✅ Leaderboard Ranks Switched",
            `Spots **#${firstRank}** and **#${secondRank}** on **${safeText(board.name)}** have been switched.`,
            0x57F287
          )]
        });
      }

      if (command === "scoreschannel") {
        if (!hasCommandAccess(interaction, "scoreschannel")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/scoreschannel`.")], ephemeral: true });
        }

        const channel = interaction.options.getChannel("channel", true);
        const botPermissions = channel.permissionsFor(guild.members.me);
        const missingPermissions = [
          [PermissionFlagsBits.ViewChannel, "View Channel"],
          [PermissionFlagsBits.SendMessages, "Send Messages"],
          [PermissionFlagsBits.ManageWebhooks, "Manage Webhooks"]
        ].filter(([permission]) => !botPermissions?.has(permission)).map(([, label]) => label);
        if (missingPermissions.length) {
          return interaction.reply({
            embeds: [errorEmbed(`I need ${missingPermissions.join(", ")} permission${missingPermissions.length === 1 ? "" : "s"} in ${channel}.`)],
            ephemeral: true
          });
        }

        await interaction.deferReply({ ephemeral: true });
        const previous = db.prepare("SELECT webhook_id, webhook_token FROM score_channels WHERE guild_id = ?").get(guild.id);
        const webhook = await channel.createWebhook({
          name: "Score Challenge Logs",
          reason: `Score challenge channel configured by ${interaction.user.tag}`
        });
        try {
          db.prepare(`
            INSERT INTO score_channels (guild_id, channel_id, webhook_id, webhook_token)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (guild_id)
            DO UPDATE SET
              channel_id = excluded.channel_id,
              webhook_id = excluded.webhook_id,
              webhook_token = excluded.webhook_token
          `).run(guild.id, channel.id, webhook.id, webhook.token);
        } catch (error) {
          await webhook.delete("Cleaning up failed score channel configuration").catch(cleanupError => {
            console.warn(`Could not remove webhook for failed score channel configuration (${webhook.id}):`, cleanupError.message);
          });
          throw error;
        }

        if (previous?.webhook_id && previous.webhook_id !== webhook.id) {
          try {
            await new WebhookClient({ id: previous.webhook_id, token: previous.webhook_token })
              .delete("Replaced by new score challenge webhook");
          } catch (error) {
            console.warn(`Could not remove the previous score webhook (${previous.webhook_id}):`, error.message);
          }
        }

        return interaction.editReply({
          embeds: [publicEmbed("✅ Scores Channel Set", `Challenge results will be posted through a webhook in ${channel}.`, 0x57F287)]
        });
      }

      if (command === "score") {
        if (!hasCommandAccess(interaction, "score")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/score`.")], ephemeral: true });
        }

        const boardName = interaction.options.getString("leaderboard", true).trim();
        const player1 = interaction.options.getUser("player1", true);
        const player2 = interaction.options.getUser("player2", true);
        const result = interaction.options.getString("result", true).trim();
        const winner = interaction.options.getUser("winner", true);
        const allowLeaderboardUpdate = interaction.options.getString("lb_update") !== "no";
        const scoreMatch = result.match(/^(\d{1,6})-(\d{1,6})$/);
        if (!scoreMatch) {
          return interaction.reply({ embeds: [errorEmbed("Enter the challenge score as two numbers separated by a hyphen, for example `5-2`.")], ephemeral: true });
        }
        if (player1.bot || player2.bot || player1.id === player2.id) {
          return interaction.reply({ embeds: [errorEmbed("Choose two different human server members as player1 and player2.")], ephemeral: true });
        }
        if (winner.id !== player1.id && winner.id !== player2.id) {
          return interaction.reply({ embeds: [errorEmbed("The winner must be either player1 or player2.")], ephemeral: true });
        }
        const scores = scoreMatch.slice(1).map(Number);
        if (scores[0] === scores[1]) {
          return interaction.reply({ embeds: [errorEmbed("A tied score has no winner. Enter a result with two different scores.")], ephemeral: true });
        }
        if (scores[0] < scores[1]) {
          return interaction.reply({ embeds: [errorEmbed("Enter the winner's score first, for example `5-2` for a 5 to 2 win.")], ephemeral: true });
        }

        const board = getLeaderboard(guild.id, boardName);
        if (!board) {
          return interaction.reply({ embeds: [errorEmbed(`No leaderboard named **${safeText(boardName)}** exists in this server.`)], ephemeral: true });
        }
        const scoreChannel = db.prepare("SELECT * FROM score_channels WHERE guild_id = ?").get(guild.id);
        if (!scoreChannel) {
          return interaction.reply({ embeds: [errorEmbed("Set a challenge results channel first with `/scoreschannel channel:#channel`.")], ephemeral: true });
        }

        const participants = [player1.id, player2.id];
        const participantSpots = db.prepare(`
          SELECT user_id, spot
          FROM leaderboard_scores
          WHERE leaderboard_id = ? AND user_id IN (?, ?)
        `).all(board.id, ...participants);
        const spots = new Map(participantSpots.map(player => [player.user_id, player.spot]));
        if (!spots.has(player1.id) || !spots.has(player2.id) ||
            spots.get(player1.id) > 10 || spots.get(player2.id) > 10) {
          return interaction.reply({
            embeds: [errorEmbed("Both players must have a spot in this leaderboard's top 10 to challenge for a spot.")],
            ephemeral: true
          });
        }

        const winnerId = winner.id;
        const loserId = winnerId === player1.id ? player2.id : player1.id;
        const shouldSwap = allowLeaderboardUpdate && spots.get(winnerId) > spots.get(loserId);
        const startSpots = new Map(spots);
        await interaction.deferReply({ ephemeral: true });

        let leaderboardUpdated = false;
        if (shouldSwap) {
          swapLeaderboardSpots(board.id, winnerId, loserId);
          try {
            await publishLeaderboard(board, guild);
            leaderboardUpdated = true;
          } catch (error) {
            console.error(`Leaderboard webhook update failed after challenge on board #${board.id}:`, error);
            swapLeaderboardSpots(board.id, winnerId, loserId);
          }
        }

        const webhook = new WebhookClient({ id: scoreChannel.webhook_id, token: scoreChannel.webhook_token });
        const content = [
          `**top ${startSpots.get(player1.id)}** player1: ${userMention(player1.id)} is challenging **top ${startSpots.get(player2.id)}** player2: ${userMention(player2.id)} for their spot`,
          "━━━━━━━━━━━━━━━━━━━━",
          `**score:** ${result} for ${userMention(winnerId)}`,
          `**lb upd:** ${leaderboardUpdated ? "✅" : "❌"}`
        ].join("\n");
        try {
          await webhook.send({
            content,
            username: "Score Challenge",
            avatarURL: getBotIdentity().avatarURL,
            allowedMentions: { users: [...new Set([player1.id, player2.id, winnerId])] }
          });
        } catch (error) {
          console.error(`Could not post score challenge for leaderboard #${board.id}:`, error);
          const errorMessage = error instanceof Error ? safeText(error.message).slice(0, 500) : "Unknown webhook error";
          return interaction.editReply({
            embeds: [errorEmbed(
              `${leaderboardUpdated ? "The players' spots were switched, but" : "The challenge was not posted, and"} the score webhook could not send the result.\n\n${errorMessage}`
            )]
          });
        }

        return interaction.deleteReply();
      }

      if (command === "gradechannel") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ embeds: [errorEmbed("You need Manage Server permission to configure `/gradechannel`.")], ephemeral: true });
        }

        const channel = interaction.options.getChannel("channel");
        if (channel) {
          ensureSettings(guild.id);
          const botMember = guild.members.me;
          const botPermissions = botMember ? channel.permissionsFor(botMember) : null;
          if (!botPermissions?.has(PermissionFlagsBits.ViewChannel) ||
              !botPermissions.has(PermissionFlagsBits.SendMessages) ||
              !botPermissions.has(PermissionFlagsBits.EmbedLinks) ||
              !botPermissions.has(PermissionFlagsBits.AddReactions) ||
              !botPermissions.has(PermissionFlagsBits.ReadMessageHistory)) {
            return interaction.reply({
              embeds: [errorEmbed("I need View Channel, Send Messages, Embed Links, Add Reactions, and Read Message History permissions in the grade channel.")],
              ephemeral: true
            });
          }
          db.prepare("UPDATE settings SET grade_channel_id = ? WHERE guild_id = ?").run(channel.id, guild.id);
        }

        const configuredChannel = getSettings(guild.id).grade_channel_id;
        const lines = [];
        if (configuredChannel) {
          lines.push(`Grade assignments work only in ${channelMention(configuredChannel)}. Messages in other channels are ignored.`);
          lines.push("Format: `@member <grade> <sub1> <sub2>`, for example `@member semi g1 low strong`. Use `spg` for Special Grade.");
        } else {
          lines.push("No grade channel is configured. Set one with `/gradechannel channel:#channel`.");
        }

        const problems = gradeSetupProblems(guild);
        const gradeEmbed = publicEmbed("🎓 Grade Channel", lines.join("\n\n"), problems.length ? 0xFEE75C : 0x5865F2);
        if (problems.length) {
          gradeEmbed.addFields({ name: "⚠️ Fix these so grading works", value: problems.join("\n").slice(0, 1024) });
        }
        return interaction.reply({ embeds: [gradeEmbed], ephemeral: true });
      }

      if (command === "serverlogs") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ embeds: [errorEmbed("You need Manage Server permission to configure `/serverlogs`.")], ephemeral: true });
        }

        const channel = interaction.options.getChannel("channel");
        const enabled = interaction.options.getBoolean("enabled");
        const settings = getSettings(guild.id);
        const willEnable = channel ? enabled !== false : enabled === true;

        if (willEnable && !guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
          return interaction.reply({ embeds: [errorEmbed("I need View Audit Log permission to identify who made each change.")], ephemeral: true });
        }

        if (channel) {
          const botPermissions = channel.permissionsFor(guild.members.me);
          if (!botPermissions?.has(PermissionFlagsBits.ViewChannel) ||
              !botPermissions.has(PermissionFlagsBits.SendMessages) ||
              !botPermissions.has(PermissionFlagsBits.EmbedLinks)) {
            return interaction.reply({ embeds: [errorEmbed("I need View Channel, Send Messages, and Embed Links permissions in that channel.")], ephemeral: true });
          }
        }

        if (channel || enabled !== null) {
          if (channel) {
            db.prepare(`
              UPDATE settings
              SET server_log_channel_id = ?, server_logs_enabled = ?
              WHERE guild_id = ?
            `).run(channel.id, enabled === false ? 0 : 1, guild.id);
          } else if (enabled === false) {
            db.prepare(`UPDATE settings SET server_logs_enabled = 0 WHERE guild_id = ?`).run(guild.id);
          } else if (enabled === true && !settings.server_log_channel_id) {
            return interaction.reply({ embeds: [errorEmbed("Choose a channel first with `/serverlogs channel:#channel`.")], ephemeral: true });
          } else {
            db.prepare(`UPDATE settings SET server_logs_enabled = 1 WHERE guild_id = ?`).run(guild.id);
          }

          const updated = getSettings(guild.id);
          return interaction.reply({
            embeds: [publicEmbed(
              "🧾 Server Audit Logs",
              `${updated.server_logs_enabled ? "Enabled" : "Disabled"}\nChannel: ${channelMention(updated.server_log_channel_id)}\nTracked events: message deletes, moderation, member, role, channel, and server changes.`,
              updated.server_logs_enabled ? 0x57F287 : 0x5865F2
            )],
            ephemeral: true
          });
        }

        return interaction.reply({
          embeds: [publicEmbed(
            "🧾 Server Audit Logs",
            `${settings.server_logs_enabled ? "Enabled" : "Disabled"}\nChannel: ${channelMention(settings.server_log_channel_id)}\nTracked events: message deletes, moderation, member, role, channel, and server changes.`,
            0x5865F2
          )],
          ephemeral: true
        });
      }

      if (command === "userinfo") {
        await interaction.deferReply();
        const targetUser = interaction.options.getUser("user") || interaction.user;
        const member = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!member) {
          return interaction.editReply({ embeds: [errorEmbed("That user is not a member of this server.")] });
        }

        return interaction.editReply({ embeds: [userInfoEmbed(member)] });
      }

      if (command === "autoping") {
        if (!hasCommandAccess(interaction, "autoping")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/autoping`.")], ephemeral: true });
        }

        const channel = interaction.options.getChannel("channel");
        const enabledValue = interaction.options.getBoolean("enabled");
        const settings = getSettings(guild.id);

        if (channel) {
          setAutoPingChannel(guild.id, channel.id, true);
          return interaction.reply({ embeds: [publicEmbed("📣 Auto Ping Enabled", `Ghost-pings will be sent in ${channel} whenever a member joins.`, 0x57F287)], ephemeral: true });
        }

        if (enabledValue !== null) {
          if (enabledValue) {
            const existing = settings.auto_ping_channel_id;
            if (!existing) {
              return interaction.reply({ embeds: [errorEmbed("Choose a channel first, then enable auto pinging." )], ephemeral: true });
            }
            db.prepare(`UPDATE settings SET auto_ping_enabled = 1 WHERE guild_id = ?`).run(guild.id);
            return interaction.reply({ embeds: [publicEmbed("📣 Auto Ping Enabled", `Join ghost-pinging is enabled in ${channelMention(existing)}.`, 0x57F287)], ephemeral: true });
          }

          db.prepare(`UPDATE settings SET auto_ping_enabled = 0 WHERE guild_id = ?`).run(guild.id);
          return interaction.reply({ embeds: [publicEmbed("📣 Auto Ping Disabled", "Join ghost-pinging is now disabled for this server.", 0x5865F2)], ephemeral: true });
        }

        const currentChannel = settings.auto_ping_channel_id ? channelMention(settings.auto_ping_channel_id) : "Not set";
        const status = settings.auto_ping_enabled ? "Enabled" : "Disabled";
        return interaction.reply({ embeds: [publicEmbed("📣 Auto Ping Status", `Status: ${status}\nChannel: ${currentChannel}`, 0x5865F2)], ephemeral: true });
      }

      if (command === "testsecuritydm") {
        const botMember = guild.members.me;
        if (!botMember || interaction.member.roles.highest.comparePositionTo(botMember.roles.highest) <= 0) {
          return interaction.reply({ embeds: [errorEmbed("Only members with a role higher than the bot can send administrator test DMs.")], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const displayName = interaction.member.displayName || interaction.user.globalName || interaction.user.username;
        const delivery = await notifyGuildAdministrators(guild, `this is a nuke msg test from ${displayName}`);
        return interaction.editReply({ embeds: [publicEmbed("📨 Security DM Test", `Sent to ${delivery.dmCount} of ${delivery.adminCount} administrator(s). Some admins may have DMs disabled.`, 0x57F287)] });
      }

      if (command === "honeypot") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ embeds: [errorEmbed("You need the Manage Server permission to configure the honeypot.")], ephemeral: true });
        }

        const action = interaction.options.getSubcommand();
        if (action === "setup") {
          const channel = interaction.options.getChannel("channel", true);
          if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
            return interaction.reply({ embeds: [errorEmbed("Choose a text or announcement channel.")], ephemeral: true });
          }

          const botMember = guild.members.me;
          if (!botMember) {
            return interaction.reply({ embeds: [errorEmbed("I couldn't verify my server permissions. Please try again in a moment.")], ephemeral: true });
          }

          const botPermissions = channel.permissionsFor(botMember);
          if (!botPermissions?.has(PermissionFlagsBits.ViewChannel) || !botPermissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({ embeds: [errorEmbed("I need View Channel and Manage Messages permissions in the honeypot channel.")], ephemeral: true });
          }
          if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) {
            return interaction.reply({ embeds: [errorEmbed("I need the Kick Members server permission to enable the honeypot.")], ephemeral: true });
          }

          db.prepare(`
            INSERT INTO honeypot_settings (guild_id, channel_id)
            VALUES (?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id
          `).run(guild.id, channel.id);
          return interaction.reply({ embeds: [publicEmbed("🍯 Honeypot Configured", `${channel} is now monitored. Non-admin members who speak here will have their message deleted and be kicked automatically.`, 0x57F287)], ephemeral: true });
        }

        if (action === "disable") {
          const result = db.prepare("DELETE FROM honeypot_settings WHERE guild_id = ?").run(guild.id);
          const description = result.changes ? "Honeypot monitoring has been disabled." : "Honeypot monitoring was not configured.";
          return interaction.reply({ embeds: [publicEmbed("🍯 Honeypot", description, 0x5865F2)], ephemeral: true });
        }

        const config = db.prepare("SELECT channel_id FROM honeypot_settings WHERE guild_id = ?").get(guild.id);
        return interaction.reply({ embeds: [publicEmbed("🍯 Honeypot Status", config ? `Monitoring ${channelMention(config.channel_id)}.` : "Honeypot monitoring is not configured.", 0x5865F2)], ephemeral: true });
      }

      if (command === "whitelist") {
        const applicationOwner = client.application?.owner;
        const isBotOwner = applicationOwner?.id === interaction.user.id ||
          applicationOwner?.ownerId === interaction.user.id;
        let isAboveBot = false;
        if (!isBotOwner) {
          const moderator = await guild.members.fetch(interaction.user.id).catch(error => {
            console.warn(`Could not fetch ${interaction.user.tag} to authorize /whitelist in ${guild.name}:`, error.message);
            return null;
          });
          const botMember = guild.members.me;
          isAboveBot = Boolean(
            moderator?.roles?.highest &&
            botMember?.roles?.highest &&
            moderator.roles.highest.comparePositionTo(botMember.roles.highest) > 0
          );
        }
        if (!isBotOwner && !isAboveBot) {
          return interaction.reply({ embeds: [errorEmbed("Only the bot owner or a member with a role higher than the bot can manage the anti-nuke whitelist.")], ephemeral: true });
        }

        const action = interaction.options.getSubcommand();
        const target = interaction.options.getUser("user");
        if (action === "add") {
          const result = db.prepare(`
            INSERT OR IGNORE INTO anti_nuke_whitelist (guild_id, user_id)
            VALUES (?, ?)
          `).run(guild.id, target.id);
          const description = result.changes ? `${userMention(target.id)} is now exempt from automatic anti-nuke blacklisting.` : `${userMention(target.id)} is already on the anti-nuke whitelist.`;
          return interaction.reply({ embeds: [publicEmbed("🛡️ Anti-Nuke Whitelist", description, 0x57F287)], ephemeral: true });
        }

        const result = db.prepare(`
          DELETE FROM anti_nuke_whitelist
          WHERE guild_id = ? AND user_id = ?
        `).run(guild.id, target.id);
        const description = result.changes ? `${userMention(target.id)} was removed from the anti-nuke whitelist.` : `${userMention(target.id)} was not on the anti-nuke whitelist.`;
        return interaction.reply({ embeds: [publicEmbed("🛡️ Anti-Nuke Whitelist", description, 0x5865F2)], ephemeral: true });
      }

      if (command === "purge") {
        if (!hasCommandAccess(interaction, "purge")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/purge`.")], ephemeral: true });
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
          return interaction.reply({ embeds: [errorEmbed("You need the Manage Messages permission to use `/purge`.")], ephemeral: true });
        }

        const channel = interaction.channel;
        if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel?.type)) {
          return interaction.reply({ embeds: [errorEmbed("`/purge` can only be used in a text or announcement channel.")], ephemeral: true });
        }

        const botPermissions = channel.permissionsFor(guild.members.me);
        if (!botPermissions?.has(PermissionFlagsBits.ManageMessages) || !botPermissions.has(PermissionFlagsBits.ReadMessageHistory)) {
          return interaction.reply({ embeds: [errorEmbed("I need Manage Messages and Read Message History permissions to purge messages.")], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        try {
          const deleted = await channel.bulkDelete(interaction.options.getInteger("amount"), true);
          return interaction.editReply({ embeds: [publicEmbed("🧹 Messages Purged", `Deleted ${deleted.size} message(s). Messages older than 14 days cannot be bulk deleted.`, 0x57F287)] });
        } catch (error) {
          console.error("Purge failed:", error);
          return interaction.editReply({ embeds: [errorEmbed("I couldn't delete those messages. Check my channel permissions and try again.")] });
        }
      }

      if (command === "slowmode") {
        if (!hasCommandAccess(interaction, "slowmode")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/slowmode`.")], ephemeral: true });
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
          return interaction.reply({ embeds: [errorEmbed("You need the Manage Channels permission to use `/slowmode`.")], ephemeral: true });
        }

        const channel = interaction.channel;
        if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel?.type)) {
          return interaction.reply({ embeds: [errorEmbed("`/slowmode` can only be used in a text or announcement channel.")], ephemeral: true });
        }

        const botPermissions = channel.permissionsFor(guild.members.me);
        if (!botPermissions?.has(PermissionFlagsBits.ManageChannels)) {
          return interaction.reply({ embeds: [errorEmbed("I need the Manage Channels permission in this channel to change its slowmode.")], ephemeral: true });
        }

        const seconds = interaction.options.getInteger("seconds");
        const reason = interaction.options.getString("reason") || `Changed by ${interaction.user.tag}`;
        await interaction.deferReply({ ephemeral: true });
        try {
          await channel.setRateLimitPerUser(seconds, reason);
          addModLog(guild.id, "slowmode", interaction.user.id, interaction.user.id, reason);
          const result = seconds === 0 ? "disabled" : `set to ${seconds} second(s)`;
          return interaction.editReply({ embeds: [publicEmbed("🐢 Slowmode Updated", `Slowmode in ${channel} was ${result}.`, 0x57F287)] });
        } catch (error) {
          console.error("Slowmode update failed:", error);
          return interaction.editReply({ embeds: [errorEmbed("I couldn't update slowmode. Check my channel permissions and try again.")] });
        }
      }

      if (command === "lock" || command === "unlock") {
        if (!hasCommandAccess(interaction, command)) {
          return interaction.reply({ embeds: [errorEmbed(`You don't have permission to use \`/${command}\`.`)], ephemeral: true });
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
          return interaction.reply({ embeds: [errorEmbed(`You need the Manage Channels permission to use \`/${command}\`.`)], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const result = await setChannelLock(guild, interaction.channel, command === "lock");
        if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });

        const action = result.locked ? "locked" : "unlocked";
        return interaction.editReply({ embeds: [publicEmbed(`🔒 Channel ${action}`, `${result.channel} has been ${action} for @everyone.`, result.locked ? 0xED4245 : 0x57F287)] });
      }

      if (command === "setup") {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ embeds: [errorEmbed("Only server administrators can use `/setup`.")], ephemeral: true });
        }

        ensureSettings(guild.id);
        return interaction.reply({ embeds: [setupSummary(guild.id)], components: setupControls(), ephemeral: true });
      }

      if (command === "warn") {
        if (!hasCommandAccess(interaction, "warn")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/warn`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        const reason = interaction.options.getString("reason");

        if (!target) return interaction.editReply({ embeds: [errorEmbed("User not found.")] });
        if (target.id === interaction.user.id) {
          return interaction.editReply({ embeds: [errorEmbed("You cannot warn yourself.")] });
        }
        if (target.id === guild.members.me?.id) {
          return interaction.editReply({ embeds: [errorEmbed("You cannot warn the bot.")] });
        }
        if (!reason?.trim()) {
          return interaction.editReply({ embeds: [errorEmbed("A warning reason is required.")] });
        }

        const result = db.prepare(`
          INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(guild.id, target.id, interaction.user.id, reason, now());

        addModLog(guild.id, "warn", target.id, interaction.user.id, reason);

        let dmStatus = "❌ Failed";
        try {
          await target.send({
            embeds: [publicEmbed("⚠️ You Have Been Warned", `You were warned in **${guild.name}** by ${userMention(interaction.user.id)}.`, 0xFEE75C).addFields(
              { name: "📝 Reason", value: safeText(reason) },
              { name: "🏠 Server", value: guild.name, inline: true },
              { name: "👮 Moderator", value: userMention(interaction.user.id), inline: true }
            )]
          });
          dmStatus = "✅ Sent";
        } catch {
          dmStatus = "❌ Failed (DMs may be disabled)";
        }

        return interaction.editReply({
          embeds: [publicEmbed("⚠️ User Warned", `${userMention(target.id)} has received a warning.`, 0xFEE75C).addFields(
            { name: "👤 User", value: userMention(target.id), inline: true },
            { name: "👮 Moderator", value: userMention(interaction.user.id), inline: true },
            { name: "⚠️ Warning ID", value: `#${result.lastInsertRowid}`, inline: true },
            { name: "📝 Reason", value: safeText(reason) },
            { name: "📩 DM Status", value: dmStatus, inline: true }
          )]
        });
      }

      if (command === "warns") {
        if (!hasCommandAccess(interaction, "warns")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/warns`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        if (!target) return interaction.editReply({ embeds: [errorEmbed("User not found.")] });

        const warnings = db.prepare(`
          SELECT *
          FROM warnings
          WHERE guild_id = ?
          AND user_id = ?
          ORDER BY id DESC
        `).all(guild.id, target.id);

        if (!warnings.length) {
          return interaction.editReply({ embeds: [publicEmbed("⚠️ Warnings", `${userMention(target.id)} has no warnings.`, 0x57F287)] });
        }

        const embed = publicEmbed("⚠️ User Warnings", `${userMention(target.id)} has **${warnings.length}** warning(s).`, 0xFEE75C);
        for (const warning of warnings.slice(0, 25)) {
          embed.addFields({ name: `Warning #${warning.id}`, value: `**Reason:** ${safeText(warning.reason)}\n**Moderator:** ${userMention(warning.moderator_id)}\n**Date:** ${timestamp(warning.created_at)}` });
        }

        return interaction.editReply({ embeds: [embed] });
      }

      if (command === "warnings") {
        if (!hasCommandAccess(interaction, "warnings")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/warnings`.")], ephemeral: true });
        }
        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        if (!target) return interaction.editReply({ embeds: [errorEmbed("User not found.")] });
        const warnings = db.prepare(`
          SELECT *
          FROM warnings
          WHERE guild_id = ? AND user_id = ?
          ORDER BY id DESC
        `).all(guild.id, target.id);
        if (!warnings.length) {
          return interaction.editReply({ embeds: [publicEmbed("⚠️ Warnings", `${userMention(target.id)} has no warnings.`, 0x57F287)] });
        }
        const embed = publicEmbed("⚠️ User Warnings", `${userMention(target.id)} has **${warnings.length}** warning(s).`, 0xFEE75C);
        for (const warning of warnings.slice(0, 25)) {
          embed.addFields({
            name: `Warning #${warning.id}`,
            value: `**Reason:** ${safeText(warning.reason)}\n**Moderator:** ${userMention(warning.moderator_id)}\n**Date:** ${timestamp(warning.created_at)}`
          });
        }
        return interaction.editReply({ embeds: [embed] });
      }

      if (command === "clearwarnings") {
        if (!hasCommandAccess(interaction, "clearwarnings")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/clearwarnings`.")], ephemeral: true });
        }
        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        const reason = interaction.options.getString("reason", true).trim();
        if (!target) return interaction.editReply({ embeds: [errorEmbed("User not found.")] });
        if (target.id === guild.members.me?.id || target.id === interaction.user.id) {
          return interaction.editReply({ embeds: [errorEmbed("You cannot clear warnings for yourself or the bot.")] });
        }
        const result = db.prepare(`
          DELETE FROM warnings
          WHERE guild_id = ? AND user_id = ?
        `).run(guild.id, target.id);
        addModLog(guild.id, "clearwarnings", target.id, interaction.user.id, reason, `Cleared ${result.changes} warning(s).`);
        return interaction.editReply({
          embeds: [publicEmbed("🧹 Warnings Cleared", `Cleared **${result.changes}** warning(s) for ${userMention(target.id)}.`, 0x57F287).addFields(
            { name: "Moderator", value: userMention(interaction.user.id), inline: true },
            { name: "Reason", value: safeText(reason) }
          )]
        });
      }

      if (command === "kick") {
        if (!hasCommandAccess(interaction, "kick")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/kick`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        const reason = interaction.options.getString("reason");
        if (!target) return interaction.editReply({ embeds: [errorEmbed("User not found.")] });
        if (target.id === interaction.user.id) return interaction.editReply({ embeds: [errorEmbed("You cannot kick yourself.")] });
        if (target.id === guild.members.me?.id) return interaction.editReply({ embeds: [errorEmbed("You cannot kick the bot.")] });
        if (!canModerateMember(guild, interaction.member, target)) return interaction.editReply({ embeds: [errorEmbed("That user is higher than you in the hierarchy.")] });
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.KickMembers)) return interaction.editReply({ embeds: [errorEmbed("I need the Kick Members permission.")] });

        try {
          await target.kick(reason || "No reason provided");
        } catch (error) {
          console.error("Kick failed:", error);
          return interaction.editReply({ embeds: [errorEmbed("I couldn't kick that user.")] });
        }

        addModLog(guild.id, "kick", target.id, interaction.user.id, reason || "No reason provided");
        return interaction.editReply({ embeds: [publicEmbed("👢 User Kicked", `${userMention(target.id)} was kicked.`, 0xED4245).addFields(
          { name: "👤 User", value: userMention(target.id), inline: true },
          { name: "👮 Moderator", value: userMention(interaction.user.id), inline: true },
          { name: "📝 Reason", value: safeText(reason || "No reason provided") }
        )] });
      }

      if (command === "ban") {
        if (!hasCommandAccess(interaction, "ban")) {
          return interaction.reply({ embeds: [errorEmbed("You need the Ban Members permission or a role allowed to use `/ban`.")], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const targetId = parseUserId(interaction.options.getString("user", true));
        if (!targetId) {
          return interaction.editReply({ embeds: [errorEmbed("Enter a valid Discord user ID or mention.")] });
        }
        if (targetId === interaction.user.id) {
          return interaction.editReply({ embeds: [errorEmbed("You cannot ban yourself.")] });
        }
        if (targetId === guild.members.me?.id) {
          return interaction.editReply({ embeds: [errorEmbed("You cannot ban the bot.")] });
        }
        const target = await guild.members.fetch(targetId).catch(() => null);
        const reason = interaction.options.getString("reason", true).trim();
        if (target && !canModerateMember(guild, interaction.member, target)) {
          return interaction.editReply({ embeds: [errorEmbed("That user is higher than you in the hierarchy.")] });
        }
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
          return interaction.editReply({ embeds: [errorEmbed("I need the Ban Members permission.")] });
        }
        if (target && !target.bannable) {
          return interaction.editReply({ embeds: [errorEmbed("I can't ban that user. Check my role hierarchy and permissions.")] });
        }

        let ban;
        try {
          ban = await guild.members.ban(targetId, { reason });
        } catch (error) {
          console.error("Ban failed:", error);
          return interaction.editReply({ embeds: [errorEmbed("I couldn't ban that user.")] });
        }

        addModLog(guild.id, "ban", targetId, interaction.user.id, reason);
        const logResult = await sendBanLog(guild, targetId, target?.user || ban.user, interaction.user.id, reason);
        const response = publicEmbed("🔨 User Banned", `${userMention(targetId)} was banned from the server.`, 0xED4245);
        if (!logResult.sent) {
          response.addFields({ name: "⚠️ Blacklist Channel Log", value: logResult.error });
        }
        return interaction.editReply({ embeds: [response] });
      }

      if (command === "unban") {
        if (!hasCommandAccess(interaction, "unban")) {
          return interaction.reply({ embeds: [errorEmbed("You need the Ban Members permission to use `/unban`.")], ephemeral: true });
        }
        await interaction.deferReply();
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
          return interaction.editReply({ embeds: [errorEmbed("I need the Ban Members permission.")] });
        }
        const targetId = parseUserId(interaction.options.getString("user", true));
        const reason = interaction.options.getString("reason", true).trim();
        if (!targetId) return interaction.editReply({ embeds: [errorEmbed("Enter a valid Discord user ID or mention.")] });
        if (targetId === guild.members.me?.id || targetId === interaction.user.id) {
          return interaction.editReply({ embeds: [errorEmbed("You cannot unban yourself or the bot.")] });
        }
        try {
          await guild.members.unban(targetId, reason);
        } catch (error) {
          if (error?.code !== 10026) {
            console.error("Unban failed:", error);
            return interaction.editReply({ embeds: [errorEmbed("I couldn't unban that user. Confirm the user ID and my Ban Members permission.")] });
          }
        }
        addModLog(guild.id, "unban", targetId, interaction.user.id, reason);
        return interaction.editReply({
          embeds: [publicEmbed("🔓 User Unbanned", `${userMention(targetId)} was unbanned.`, 0x57F287).addFields(
            { name: "User", value: userMention(targetId), inline: true },
            { name: "Moderator", value: userMention(interaction.user.id), inline: true },
            { name: "Reason", value: safeText(reason) }
          )]
        });
      }

      if (command === "case") {
        if (!hasCommandAccess(interaction, "case")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/case`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const caseId = interaction.options.getInteger("case");
        const record = db.prepare(`
          SELECT *
          FROM blacklist_records
          WHERE guild_id = ?
          AND case_number = ?
        `).get(guild.id, caseId);

        if (!record) {
          return interaction.editReply({ embeds: [errorEmbed(`I couldn't find blacklist case #${caseId}.`)] });
        }

        return interaction.editReply({ embeds: [blacklistCaseEmbed(record)] });
      }

      if (command === "editcase") {
        if (!hasCommandAccess(interaction, "editcase")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/editcase`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const caseId = interaction.options.getInteger("case");
        const newReason = interaction.options.getString("reason");
        const existing = db.prepare(`
          SELECT *
          FROM blacklist_records
          WHERE guild_id = ?
          AND case_number = ?
        `).get(guild.id, caseId);

        if (!existing) {
          return interaction.editReply({ embeds: [errorEmbed(`I couldn't find blacklist case #${caseId}.`)] });
        }

        db.prepare(`
          UPDATE blacklist_records
          SET reason = ?
          WHERE guild_id = ?
          AND case_number = ?
        `).run(newReason, guild.id, caseId);

        const updated = db.prepare(`
          SELECT *
          FROM blacklist_records
          WHERE guild_id = ?
          AND case_number = ?
        `).get(guild.id, caseId);

        return interaction.editReply({ embeds: [blacklistCaseEmbed(updated, "✏️ Blacklist Case Updated", `Updated blacklist case #${updated.case_number}.`)] });
      }

      if (command === "raid") {
        if (!hasCommandAccess(interaction, "raid")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/raid`.")], ephemeral: true });
        }

        const enabled = interaction.options.getBoolean("enabled");
        if (!canActivateSecurityCommand(guild, interaction.member)) {
          return interaction.reply({ embeds: [errorEmbed("Only a member above the bot can activate raid protection.")], ephemeral: true });
        }

        if (enabled) {
          raidProtectionUntil.set(guild.id, Date.now() + (24 * 60 * 60 * 1000));
          return interaction.reply({ embeds: [publicEmbed("🛡️ Raid Protection Enabled", "Raid protection has been activated for this server. A member above the bot can disable it later.", 0xED4245)] });
        }

        raidProtectionUntil.delete(guild.id);
        return interaction.reply({ embeds: [publicEmbed("🛡️ Raid Protection Disabled", "Raid protection has been disabled for this server.", 0x57F287)] });
      }

      if (command === "deletewarns") {
        if (!hasCommandAccess(interaction, "deletewarns")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/deletewarns`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        if (!target) return interaction.editReply({ embeds: [errorEmbed("User not found.")] });

        const warnings = db.prepare(`
          SELECT *
          FROM warnings
          WHERE guild_id = ?
          AND user_id = ?
          ORDER BY id DESC
        `).all(guild.id, target.id);

        if (!warnings.length) {
          return interaction.editReply({ embeds: [publicEmbed("🗑️ Delete Warnings", `${userMention(target.id)} has no warnings.`, 0x57F287)] });
        }

        const rows = [];
        for (let i = 0; i < warnings.length && rows.length < 5; i += 5) {
          const row = new ActionRowBuilder();
          for (const warning of warnings.slice(i, i + 5)) {
            row.addComponents(new ButtonBuilder().setCustomId(`delete_warning:${warning.id}`).setLabel(`Delete #${warning.id}`).setStyle(ButtonStyle.Danger));
          }
          rows.push(row);
        }

        return interaction.editReply({ embeds: [publicEmbed("🗑️ Delete Warnings", `Choose a warning to delete for ${userMention(target.id)}.`, 0xED4245).addFields({ name: "⚠️ Warning Count", value: String(warnings.length), inline: true })], components: rows });
      }

      if (command === "blacklist") {
        if (!hasCommandAccess(interaction, "blacklist")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/blacklist`.")], ephemeral: true });
        }

        await interaction.deferReply();

        const targetId = parseUserId(interaction.options.getString("user", true));
        if (!targetId) {
          return interaction.editReply({ embeds: [errorEmbed("Enter a valid Discord user ID or mention.")] });
        }
        const targetMember = await guild.members.fetch(targetId).catch(() => null);
        const target = targetMember || await client.users.fetch(targetId).catch(() => ({ id: targetId }));
        const category = interaction.options.getString("category");
        const reason = interaction.options.getString("reason");

        const result = await doBlacklist(guild, interaction.member, target, category, reason);
        if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });

        await interaction.editReply({ embeds: [result.embed] });

        const settings = getSettings(guild.id);
        if (settings.blacklist_channel_id) {
          const channel = guild.channels.cache.get(settings.blacklist_channel_id);
          if (channel && channel.isTextBased()) await channel.send({ embeds: [result.embed] }).catch(() => {});
        }

        return;
      }

      if (command === "blacklistcheck") {
        if (!hasCommandAccess(interaction, "blacklistcheck")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/blacklistcheck`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        if (!target) return interaction.editReply({ embeds: [errorEmbed("User not found.")] });

        const record = db.prepare(`
          SELECT *
          FROM blacklist_records
          WHERE guild_id = ?
          AND user_id = ?
          ORDER BY id DESC
          LIMIT 1
        `).get(guild.id, target.id);

        if (!record) {
          return interaction.editReply({ embeds: [publicEmbed("🔎 Blacklist Check", `${userMention(target.id)} has no blacklist record.`, 0x57F287)] });
        }

        return interaction.editReply({
          embeds: [publicEmbed("🔎 Blacklist Check", `${userMention(target.id)} blacklist record.`, record.active ? 0xED4245 : 0x57F287).addFields(
            { name: "Status", value: record.active ? "⛔ Active" : "✅ Inactive", inline: true },
            { name: "Category", value: record.category, inline: true },
            { name: "Roles Stored", value: String(record.roles_count), inline: true },
            { name: "Reason", value: safeText(record.reason) },
            { name: "Moderator", value: userMention(record.moderator_id), inline: true },
            { name: "Date", value: timestamp(record.created_at), inline: true }
          )]
        });
      }

      if (command === "blacklistlist") {
        if (!hasCommandAccess(interaction, "blacklistlist")) {
          return interaction.reply({ embeds: [errorEmbed("You need Administrator, Moderate Members, or a role assigned to `/blacklistlist` in `/setup`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const result = blacklistListEmbed(guild.id, 1);
        if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
        return interaction.editReply({
          content: result.mentionContent,
          embeds: [result.embed],
          components: result.components,
          allowedMentions: { users: result.moderatorIds }
        });
      }

      if (command === "unblacklist") {
        if (!hasCommandAccess(interaction, "unblacklist")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/unblacklist`.")], ephemeral: true });
        }

        await interaction.deferReply();

        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        const reason = interaction.options.getString("reason");
        if (!target) return interaction.editReply({ embeds: [errorEmbed("User not found.")] });

        const result = await doUnblacklist(guild, interaction.member, target, reason);
        if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });

        await interaction.editReply({ embeds: [result.embed] });

        const settings = getSettings(guild.id);
        if (settings.unblacklist_channel_id) {
          const channel = guild.channels.cache.get(settings.unblacklist_channel_id);
          if (channel && channel.isTextBased()) await channel.send({ embeds: [result.embed] }).catch(() => {});
        }

        return;
      }

      if (command === "mute") {
        if (!hasCommandAccess(interaction, "mute")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/mute`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        const duration = interaction.options.getString("duration");
        const reason = interaction.options.getString("reason") || "No reason provided";

        const result = await doMute(guild, interaction.member, target, duration, reason);
        if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });

        return interaction.editReply({ embeds: [result.embed] });
      }

      if (command === "timeout") {
        if (!hasCommandAccess(interaction, "timeout")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/timeout`.")], ephemeral: true });
        }
        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        const duration = interaction.options.getString("duration", true);
        const reason = interaction.options.getString("reason", true).trim();
        const result = await doMute(guild, interaction.member, target, duration, reason);
        if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
        return interaction.editReply({ embeds: [result.embed] });
      }

      if (command === "unmute") {
        if (!hasCommandAccess(interaction, "unmute")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/unmute`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        const reason = interaction.options.getString("reason");
        const result = await doUnmute(guild, interaction.member, target, reason);
        if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
        return interaction.editReply({ embeds: [result.embed] });
      }

      if (command === "untimeout") {
        if (!hasCommandAccess(interaction, "untimeout")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/untimeout`.")], ephemeral: true });
        }
        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        const reason = interaction.options.getString("reason", true).trim();
        if (!target) return interaction.editReply({ embeds: [errorEmbed("User not found.")] });
        if (target.id === guild.members.me?.id || target.id === interaction.user.id) {
          return interaction.editReply({ embeds: [errorEmbed("You cannot remove a timeout from yourself or the bot.")] });
        }
        const result = await doUnmute(guild, interaction.member, target, reason);
        if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
        return interaction.editReply({ embeds: [result.embed] });
      }

      if (command === "addrole") {
        if (!hasCommandAccess(interaction, "addrole")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/addrole`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        const role = interaction.options.getRole("role");
        const reason = interaction.options.getString("reason") || "No reason provided";
        const result = await doAddRole(guild, interaction.member, target, role, reason);
        if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
        return interaction.editReply({ embeds: [result.embed] });
      }

      if (command === "removerole") {
        if (!hasCommandAccess(interaction, "removerole")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/removerole`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        const role = interaction.options.getRole("role");
        const reason = interaction.options.getString("reason") || "No reason provided";
        const result = await doRemoveRole(guild, interaction.member, target, role, reason);
        if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
        return interaction.editReply({ embeds: [result.embed] });
      }

      if (command === "nick") {
        if (!hasCommandAccess(interaction, "nick")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/nick`.")], ephemeral: true });
        }
        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user", true).id).catch(() => null);
        const nickname = interaction.options.getString("nickname")?.trim() || null;
        const reason = interaction.options.getString("reason")?.trim() || "Nickname changed by moderator";
        if (!target) return interaction.editReply({ embeds: [errorEmbed("User not found.")] });
        if (target.id === interaction.user.id) return interaction.editReply({ embeds: [errorEmbed("You cannot change your own nickname with `/nick`.")] });
        if (target.id === guild.members.me?.id) return interaction.editReply({ embeds: [errorEmbed("You cannot change the bot nickname with `/nick`.")] });
        if (!canModerateMember(guild, interaction.member, target)) {
          return interaction.editReply({ embeds: [errorEmbed("That member is higher than you in the hierarchy.")] });
        }
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageNicknames)) {
          return interaction.editReply({ embeds: [errorEmbed("I need the Manage Nicknames permission.")] });
        }
        if (!target.manageable) return interaction.editReply({ embeds: [errorEmbed("I cannot manage that member's nickname. Check my role hierarchy.")] });
        try {
          await target.setNickname(nickname, reason);
        } catch (error) {
          console.error("Nick failed:", error);
          return interaction.editReply({ embeds: [errorEmbed("I couldn't change that nickname.")] });
        }
        addModLog(guild.id, "nick", target.id, interaction.user.id, reason, nickname ? `Nickname set to ${nickname}` : "Nickname cleared");
        return interaction.editReply({
          embeds: [publicEmbed("✏️ Nickname Updated", `${userMention(target.id)}'s nickname was ${nickname ? "changed" : "cleared"} by ${userMention(interaction.user.id)}.`, 0x57F287).addFields(
            { name: "Nickname", value: nickname ? safeText(nickname) : "Cleared", inline: true },
            { name: "Reason", value: safeText(reason) }
          )]
        });
      }

      if (command === "role") {
        if (!hasCommandAccess(interaction, "role")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/role`.")], ephemeral: true });
        }
        await interaction.deferReply();
        const action = interaction.options.getSubcommand(true);
        const target = await guild.members.fetch(interaction.options.getUser("user", true).id).catch(() => null);
        const role = interaction.options.getRole("role", true);
        const reason = interaction.options.getString("reason")?.trim() || "No reason provided";
        const result = action === "add"
          ? await doAddRole(guild, interaction.member, target, role, reason)
          : await doRemoveRole(guild, interaction.member, target, role, reason);
        if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
        return interaction.editReply({ embeds: [result.embed] });
      }

      if (command === "cases") {
        if (!hasCommandAccess(interaction, "cases")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/cases`.")], ephemeral: true });
        }
        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user", true).id).catch(() => null);
        if (!target) return interaction.editReply({ embeds: [errorEmbed("User not found.")] });
        const records = db.prepare(`
          SELECT id, action, moderator_id, reason, created_at
          FROM moderation
          WHERE guild_id = ? AND user_id = ?
          ORDER BY id DESC
          LIMIT 25
        `).all(guild.id, target.id);
        const warnings = db.prepare(`
          SELECT COUNT(*) AS count
          FROM warnings
          WHERE guild_id = ? AND user_id = ?
        `).get(guild.id, target.id);
        const embed = publicEmbed("📋 Moderation Cases", `${userMention(target.id)} • ${warnings.count} active warning(s).`, 0x5865F2);
        if (!records.length) {
          embed.setDescription(`${userMention(target.id)} has no moderation cases.`);
        } else {
          for (const record of records) {
            embed.addFields({
              name: `Case #${record.id} • ${String(record.action).toUpperCase()}`,
              value: `**Moderator:** ${userMention(record.moderator_id)}\n**Reason:** ${safeText(record.reason || "No reason provided")}\n**Date:** ${timestamp(record.created_at)}`
            });
          }
        }
        return interaction.editReply({ embeds: [embed] });
      }

      if (command === "temprole") {
        if (!hasCommandAccess(interaction, "temprole")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/temprole`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
        const role = interaction.options.getRole("role");
        const duration = interaction.options.getString("duration");
        const reason = interaction.options.getString("reason") || "No reason provided";
        const result = await doTempRole(guild, interaction.member, target, role, duration, reason);
        if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
        return interaction.editReply({ embeds: [result.embed] });
      }

          if (command === "modlogs") {
        if (!hasCommandAccess(interaction, "modlogs")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/modlogs`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const moderator = interaction.options.getUser("moderator");
        if (!moderator) {
          return interaction.editReply({ embeds: [errorEmbed("Select a moderator to view their logs.")] });
        }

        return interaction.editReply({ embeds: [modlogsEmbed(guild.id, moderator.id)] });
      }

      if (command === "logs") {
        if (!hasCommandAccess(interaction, "logs")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/logs`.")], ephemeral: true });
        }

        await interaction.deferReply();
        const rows = db.prepare(`
          SELECT *
          FROM moderation
          WHERE guild_id = ?
          ORDER BY id DESC
          LIMIT 10
        `).all(guild.id);

        if (!rows.length) {
          return interaction.editReply({ embeds: [publicEmbed("📜 Recent Logs", "No moderation or security events have been recorded yet.", 0x5865F2)] });
        }

        const embed = publicEmbed("📜 Recent Server Logs", "Latest moderation and security events.", 0x5865F2);
        for (const row of rows) {
          embed.addFields({
            name: `#${row.id} • ${String(row.action || "event").toUpperCase()}`,
            value: `User: ${userMention(row.user_id)}\nModerator: ${userMention(row.moderator_id)}\nReason: ${safeText(row.reason || "No reason provided")}\nDate: ${timestamp(row.created_at)}`
          });
        }

        return interaction.editReply({ embeds: [embed] });
      }

      if (command === "strike" || command === "strikecheck") {
        const checkingStrikes = command === "strikecheck";
        const strikeAction = checkingStrikes ? "check" : interaction.options.getSubcommand(false) || "add";
        const permissionCommand = checkingStrikes ? "strikecheck" : "strike";
        if (!hasCommandAccess(interaction, permissionCommand)) {
          return interaction.reply({ embeds: [errorEmbed(`You don't have permission to use \`/${command}\`.`)] });
        }
        if (!canActivateSecurityCommand(guild, interaction.member)) {
          return interaction.reply({ embeds: [errorEmbed(`You must have a role above the bot to use \`/${command}\`.`)] });
        }

        const targetUser = interaction.options.getUser("user", true);

        await interaction.deferReply();
        const target = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!target) return interaction.editReply({ embeds: [errorEmbed("That user is not a member of this server.")] });

        if (strikeAction === "delete") {
          const result = strikeDeleteSelection(guild.id, target.id);
          return interaction.editReply({ embeds: [result.embed], components: result.components });
        }

        if (strikeAction === "add") {
          if (target.user.bot) return interaction.editReply({ embeds: [errorEmbed("Staff strikes can only be given to people, not bots.")] });
          if (!canModerateMember(guild, interaction.member, target)) {
            return interaction.editReply({ embeds: [errorEmbed("You can only give a strike to a member below you in the role hierarchy.")] });
          }

          const reason = interaction.options.getString("reason", true).trim();
          const result = db.transaction(() => {
            const count = db.prepare(`
              SELECT COUNT(*) AS count
              FROM staff_strikes
              WHERE guild_id = ? AND user_id = ?
            `).get(guild.id, target.id).count;
            if (count >= 3) return { error: "That staff member already has the maximum of 3/3 strikes." };

            const createdAt = now();
            db.prepare(`
              INSERT INTO staff_strikes (guild_id, user_id, moderator_id, reason, created_at)
              VALUES (?, ?, ?, ?, ?)
            `).run(guild.id, target.id, interaction.user.id, reason, createdAt);
            return { count: count + 1, createdAt };
          })();

          if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });

          addModLog(guild.id, "staffstrike", target.id, interaction.user.id, reason);
          let dmStatus = "❌ Failed (DMs may be disabled)";
          try {
            await target.send({
              embeds: [publicEmbed(
                "⚠️ You Received a Staff Strike",
                `You received a staff strike in **${safeText(guild.name)}** from ${userMention(interaction.user.id)}.`,
                0xFEE75C
              ).addFields(
                { name: "Strike Count", value: `${result.count}/3`, inline: true },
                { name: "Reason", value: safeText(reason) }
              )]
            });
            dmStatus = "✅ Sent";
          } catch (error) {
            console.warn(`Could not DM ${target.user.tag} about staff strike:`, error.message);
          }

          return interaction.editReply({ embeds: [publicEmbed(
            "⚠️ Staff Strike Given",
            `${userMention(target.id)} now has **${result.count}/3** staff strikes.`,
            result.count >= 3 ? 0xED4245 : 0xFEE75C
          ).addFields(
            { name: "Reason", value: safeText(reason) },
            { name: "Given By", value: userMention(interaction.user.id), inline: true },
            { name: "Date", value: timestamp(result.createdAt), inline: true },
            { name: "DM Status", value: dmStatus, inline: true }
          )] });
        }

        const strikes = db.prepare(`
          SELECT id, moderator_id, reason, created_at,
            ROW_NUMBER() OVER (ORDER BY id ASC) AS strike_number
          FROM staff_strikes
          WHERE guild_id = ? AND user_id = ?
          ORDER BY id ASC
        `).all(guild.id, target.id);
        return interaction.editReply({ embeds: [staffStrikeEmbed(target, strikes)] });
      }

      if (command === "strikelist") {
        if (!hasCommandAccess(interaction, "strikelist") || !canActivateSecurityCommand(guild, interaction.member)) {
          return interaction.reply({ embeds: [errorEmbed("You must have a role above the bot to use `/strikelist`.")] });
        }

        await interaction.deferReply();
        const result = staffStrikeListEmbed(guild.id, 1);
        if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
        return interaction.editReply({ embeds: [result.embed], components: result.components });
      }

      // Safety net: a command with no handler (for example an old command Discord still has
      // cached) used to hang with "The application did not respond". Always answer instead.
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          embeds: [errorEmbed(`\`/${command}\` isn't available. If you still see old commands, press Ctrl+R in Discord to refresh the command list.`)],
          ephemeral: true
        });
      }
    }

    if (interaction.isButton()) {
      const setupButton = interaction.customId.match(/^rr_(publish|emojis):([a-f0-9]{20})$/);
      if (setupButton) {
        const [, action, token] = setupButton;
        const state = reactionRoleSetupSessions.get(token);
        const accessError = reactionRoleManagerError(interaction);
        if (!state || state.completed || state.userId !== interaction.user.id || state.guildId !== interaction.guildId) {
          return interaction.reply({ embeds: [errorEmbed("This reaction-role setup has expired or belongs to another user.")], ephemeral: true });
        }
        if (accessError) return interaction.reply({ embeds: [errorEmbed(accessError)], ephemeral: true });

        if (action === "emojis") {
          const modal = new ModalBuilder()
            .setCustomId(`rr_emojis:${token}`)
            .setTitle("Optional Role Emojis")
            .addComponents(new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("reaction_role_emoji_mappings")
                .setLabel("Role name or ID = emoji")
                .setPlaceholder("Updates: 🎮\n123456789012345678 = <:news:123456789012345678>")
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setRequired(false)
            ));
          return interaction.showModal(modal);
        }

        await interaction.deferUpdate();
        try {
          const result = await saveReactionRoleSetup(state, interaction);
          if (result.error) {
            return interaction.editReply({ content: result.error, embeds: [], components: [] });
          }
          state.completed = true;
          return interaction.editReply({
            content: `Panel **#${result.panelId}** was published in ${result.channel}. [Open panel](https://discord.com/channels/${interaction.guildId}/${result.channel.id}/${result.message.id})`,
            embeds: [],
            components: []
          });
        } catch (error) {
          console.error("Could not publish reaction-role panel:", error);
          return interaction.editReply({ content: "I couldn't publish the panel. Check my channel permissions and try again.", embeds: [], components: [] });
        }
      }

      const panelButton = interaction.customId.match(/^rr:(t|[gr]):(\d{1,12}):(\d{17,20})$/);
      if (panelButton) {
        const [, , panelIdText, roleId] = panelButton;
        const panelId = Number(panelIdText);
        const panel = interaction.guildId && db.prepare(`
          SELECT id FROM reaction_role_panels
          WHERE id = ? AND guild_id = ? AND channel_id = ? AND message_id = ?
        `).get(panelId, interaction.guildId, interaction.channelId, interaction.message.id);
        const panelRole = panel && db.prepare(`
          SELECT 1 FROM reaction_role_panel_roles WHERE panel_id = ? AND role_id = ?
        `).get(panelId, roleId);
        if (!panelRole) {
          return interaction.reply({ content: "This role panel is no longer active.", ephemeral: true });
        }
        const guild = interaction.guild;
        const botMember = guild?.members.me;
        if (!guild || !botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          return interaction.reply({ content: "I need the Manage Roles permission to operate this panel.", ephemeral: true });
        }
        const role = guild.roles.cache.get(roleId);
        if (!role || role.managed || role.id === guild.id) {
          return interaction.reply({ content: "That role no longer exists or cannot be assigned. Ask a server administrator to edit this panel.", ephemeral: true });
        }
        if (!role.editable) {
          return interaction.reply({ content: `I can't manage ${role}. Ask an administrator to move my highest role above it.`, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        const member = interaction.member?.roles
          ? interaction.member
          : await guild.members.fetch(interaction.user.id).catch(error => {
            console.warn(`Could not fetch reaction-role member ${interaction.user.id}:`, error.message);
            return null;
          });
        if (!member) {
          return interaction.editReply({ content: "I couldn't verify your server membership." });
        }
        const hasRole = member.roles.cache.has(role.id);
        try {
          if (!hasRole) {
            await member.roles.add(role, "Self-assigned through a reaction-role panel");
            return interaction.editReply({ content: `Added **${safeText(role.name)}** to your roles.` });
          }
          await member.roles.remove(role, "Self-removed through a reaction-role panel");
          return interaction.editReply({ content: `Removed **${safeText(role.name)}** from your roles.` });
        } catch (error) {
          console.error(`Reaction-role ${hasRole ? "removal" : "assignment"} failed for role ${role.id}:`, error);
          return interaction.editReply({ content: "I couldn't update your roles. The role may be above my highest role, or I may be missing Manage Roles." });
        }
      }

      if (interaction.customId === "ticket_create") {
        const settings = db.prepare("SELECT * FROM ticket_settings WHERE guild_id = ?").get(interaction.guildId);
        if (!settings?.category_id || !settings.support_role_id) {
          return interaction.reply({ content: "Ticket support is not configured yet.", ephemeral: true });
        }
        const openCount = db.prepare(`
          SELECT COUNT(*) AS count
          FROM tickets
          WHERE guild_id = ? AND user_id = ? AND status = 'open'
        `).get(interaction.guildId, interaction.user.id).count;
        if (openCount >= (settings.open_limit || 1)) {
          return interaction.reply({ content: `You already have ${openCount} open ticket(s). Close it before opening another.`, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        const row = db.prepare(`
          SELECT COALESCE(MAX(ticket_number), 0) AS number
          FROM tickets
          WHERE guild_id = ?
        `).get(interaction.guildId);
        const ticketNumber = Number(row.number) + 1;
        try {
          const channel = await interaction.guild.channels.create({
            name: `ticket-${ticketNumber}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90),
            type: ChannelType.GuildText,
            parent: settings.category_id,
            permissionOverwrites: [
              { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
              { id: interaction.guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
              { id: settings.support_role_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
              { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
            ],
            reason: `Ticket opened by ${interaction.user.tag}`
          });
          const insert = db.prepare(`
            INSERT INTO tickets (guild_id, channel_id, user_id, status, ticket_number, created_at)
            VALUES (?, ?, ?, 'open', ?, ?)
          `);
          insert.run(interaction.guildId, channel.id, interaction.user.id, ticketNumber, now());
          const closeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ticket_close:${channel.id}`).setLabel("Close Ticket").setStyle(ButtonStyle.Danger)
          );
          await channel.send({
            content: `${userMention(interaction.user.id)} ${roleMention(settings.support_role_id)}`,
            embeds: [publicEmbed("🎫 Ticket Opened", `Ticket **#${ticketNumber}** was created for ${userMention(interaction.user.id)}.`, 0x5865F2)],
            components: [closeRow]
          });
          addModLog(interaction.guildId, "ticket_create", interaction.user.id, interaction.user.id, "Ticket opened", `Ticket #${ticketNumber}`);
          return interaction.editReply({ embeds: [publicEmbed("🎫 Ticket Created", `${channel} was created.`, 0x57F287)] });
        } catch (error) {
          console.error("Ticket creation failed:", error);
          return interaction.editReply({ embeds: [errorEmbed("I couldn't create the ticket. Check my channel permissions and category configuration.")] });
        }
      }
      if (interaction.customId.startsWith("ticket_reopen:")) {
        const ticketId = Number(interaction.customId.split(":")[1]);
        const ticket = db.prepare("SELECT * FROM tickets WHERE id = ? AND guild_id = ?").get(ticketId, interaction.guildId);
        const settings = db.prepare("SELECT * FROM ticket_settings WHERE guild_id = ?").get(interaction.guildId);
        const isStaff = ticket && settings &&
          (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
           (settings.support_role_id && interaction.member.roles.cache.has(settings.support_role_id)));
        if (!isStaff) return interaction.reply({ embeds: [errorEmbed("Only ticket staff can reopen tickets.")], ephemeral: true });
        db.prepare("UPDATE tickets SET status = 'open', closed_at = NULL WHERE id = ?").run(ticketId);
        await interaction.channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: true }).catch(() => {});
        addModLog(interaction.guildId, "ticket_reopen", ticket.user_id, interaction.user.id, "Reopened with button", `Ticket #${ticket.ticket_number}`);
        return interaction.reply({ embeds: [publicEmbed("🔓 Ticket Reopened", `Ticket **#${ticket.ticket_number}** was reopened.`, 0x57F287)], ephemeral: true });
      }
      if (interaction.customId.startsWith("ticket_close:")) {
        const channelId = interaction.customId.split(":")[1];
        const ticket = db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ?").get(interaction.guildId, channelId);
        const settings = db.prepare("SELECT * FROM ticket_settings WHERE guild_id = ?").get(interaction.guildId);
        const isStaff = ticket && settings &&
          (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
           (settings.support_role_id && interaction.member.roles.cache.has(settings.support_role_id)));
        if (!isStaff) return interaction.reply({ embeds: [errorEmbed("Only ticket staff can close tickets.")], ephemeral: true });
        db.prepare("UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?").run(now(), ticket.id);
        await interaction.channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: false }).catch(() => {});
        addModLog(interaction.guildId, "ticket_close", ticket.user_id, interaction.user.id, "Closed with button", `Ticket #${ticket.ticket_number}`);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ticket_reopen:${ticket.id}`).setLabel("Reopen Ticket").setStyle(ButtonStyle.Success)
        );
        return interaction.reply({ embeds: [publicEmbed("🔒 Ticket Closed", `Ticket **#${ticket.ticket_number}** was closed.`, 0xED4245)], components: [row] });
      }
      if (interaction.customId.startsWith("giveaway_enter:")) {
        const giveawayId = Number(interaction.customId.split(":")[1]);
        const giveaway = getGiveaway(interaction.guildId, giveawayId);
        if (!Number.isSafeInteger(giveawayId) || !giveaway) {
          return interaction.reply({ content: "That giveaway is unavailable.", ephemeral: true });
        }
        if (giveaway.status !== "active" || giveaway.ends_at <= now()) {
          if (giveaway.status === "active") scheduleGiveaway(giveaway.id);
          return interaction.reply({ content: "This giveaway has ended or is no longer accepting entries.", ephemeral: true });
        }
        if (interaction.user.bot && !giveaway.allow_bots) {
          return interaction.reply({ content: "Bots can't enter giveaways.", ephemeral: true });
        }
        const member = interaction.guild.members.cache.get(interaction.user.id) ||
          await interaction.guild.members.fetch(interaction.user.id).catch(error => {
            console.warn(`Could not fetch giveaway entrant ${interaction.user.id}:`, error.message);
            return null;
          });
        if (!member) {
          return interaction.reply({ content: "I couldn't verify your server membership, so you were not entered.", ephemeral: true });
        }
        if (giveaway.required_role_id && !member.roles.cache.has(giveaway.required_role_id)) {
          return interaction.reply({
            content: `You need ${roleMention(giveaway.required_role_id)} to enter this giveaway.`,
            ephemeral: true
          });
        }

        const toggleEntry = db.transaction(() => {
          const current = db.prepare("SELECT status, ends_at FROM giveaways WHERE id = ?").get(giveaway.id);
          if (!current || current.status !== "active" || current.ends_at <= now()) {
            return { closed: true };
          }
          const existing = db.prepare(`
            SELECT 1
            FROM giveaway_entries
            WHERE giveaway_id = ? AND user_id = ?
          `).get(giveaway.id, interaction.user.id);
          if (existing) {
            db.prepare("DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?")
              .run(giveaway.id, interaction.user.id);
            return { entered: false, weight: 0 };
          }
          const weight = giveaway.bonus_role_id && member.roles.cache.has(giveaway.bonus_role_id)
            ? giveaway.bonus_entries
            : 1;
          db.prepare(`
            INSERT INTO giveaway_entries (giveaway_id, user_id, entry_weight, entered_at)
            VALUES (?, ?, ?, ?)
          `).run(giveaway.id, interaction.user.id, weight, now());
          return { entered: true, weight };
        })();
        if (toggleEntry.closed) {
          scheduleGiveaway(giveaway.id);
          return interaction.reply({ content: "This giveaway has ended or is no longer accepting entries.", ephemeral: true });
        }

        await interaction.reply({
          content: toggleEntry.entered
            ? `You're entered with **${toggleEntry.weight}** entry/entries! Click again to leave.`
            : "You left the giveaway.",
          ephemeral: true
        });
        const latestGiveaway = getGiveaway(interaction.guildId, giveaway.id);
        await interaction.message.edit({
          embeds: [giveawayEmbed(latestGiveaway, {
            ended: latestGiveaway.status === "ended",
            cancelled: latestGiveaway.status === "cancelled",
            winnerIds: latestGiveaway.status === "ended" ? JSON.parse(latestGiveaway.winner_ids_json || "[]") : null
          })],
          components: [giveawayEntryButton(giveaway.id, latestGiveaway.status !== "active")]
        }).catch(error => {
          console.error(`Could not update the participant count on giveaway #${giveaway.id}:`, error);
          return null;
        });
        return;
      }

      if (interaction.customId.startsWith("leaderboard_picker_page:")) {
        const [, ownerId, pageText] = interaction.customId.split(":");
        if (ownerId !== interaction.user.id) {
          return interaction.reply({ embeds: [errorEmbed("This leaderboard picker belongs to another user.")], ephemeral: true });
        }
        if (!hasCommandAccess(interaction, "lb-edit")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/lb-edit`.")], ephemeral: true });
        }

        const page = Number(pageText);
        if (!Number.isInteger(page) || page < 1) {
          return interaction.reply({ embeds: [errorEmbed("That leaderboard page is invalid.")], ephemeral: true });
        }
        return interaction.update(leaderboardPickerPanel(interaction.guild.id, interaction.user.id, page));
      }

      if (interaction.customId.startsWith("strikelist_page:")) {
        if (!hasCommandAccess(interaction, "strikelist") || !canActivateSecurityCommand(interaction.guild, interaction.member)) {
          return interaction.reply({ embeds: [errorEmbed("You must have a role above the bot to use `/strikelist`.")] });
        }

        const page = Number.parseInt(interaction.customId.split(":").pop(), 10);
        const result = staffStrikeListEmbed(interaction.guild.id, page);
        if (result.error) return interaction.reply({ embeds: [errorEmbed(result.error)] });
        return interaction.update({ embeds: [result.embed], components: result.components });
      }

      if (interaction.customId.startsWith("blacklistlist_page:")) {
        if (!hasCommandAccess(interaction, "blacklistlist")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/blacklistlist`.")], ephemeral: true });
        }

        const page = Number.parseInt(interaction.customId.split(":").pop(), 10);
        const result = blacklistListEmbed(interaction.guild.id, page);
        if (result.error) return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
        return interaction.update({
          content: result.mentionContent,
          embeds: [result.embed],
          components: result.components,
          allowedMentions: { users: result.moderatorIds }
        });
      }

      const id = interaction.customId;

      // Delete buttons do their own permission check below (deletewarns roles / above-bot role).
      // Only the /setup buttons are administrator-only.
      const isModerationButton = id.startsWith("delete_warning:") || id.startsWith("delete_strike:");
      if (!isModerationButton && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ embeds: [errorEmbed("Only administrators can change setup.")], ephemeral: true });
      }

      if (id === "setup_channels") {
        return interaction.update({ embeds: [publicEmbed("📢 Channel Setup", "Choose the blacklist, unblacklist, and join-ping channels below.\n\nThe blacklist logs go to the blacklist channel.\nThe unblacklist logs go to the unblacklist channel.\nThe auto-ping channel is used for ghost-ping on member join.", 0x5865F2)], components: channelSelects() });
      }

      if (id === "setup_log_channel") {
        const panel = logSetupPanel(interaction.guild.id);
        return interaction.update({ embeds: [panel.embed], components: panel.components });
      }

      if (id === "setup_security_alerts") {
        const panel = securityAlertSetupPanel(interaction.guild.id);
        return interaction.update({ embeds: [panel.embed], components: panel.components });
      }

      if (id === "setup_log_done") {
        return interaction.update({ embeds: [setupSummary(interaction.guild.id)], components: setupControls() });
      }

      if (id === "setup_auto_ping") {
        return interaction.update({ embeds: [publicEmbed("📣 Join Ping Setup", "Choose the channel that should receive a ghost ping whenever a member joins.", 0x5865F2)], components: [
          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId("setup_auto_ping_channel").setPlaceholder("📣 Pick a join ping channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          ),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_channels_done").setLabel("✅ Done").setStyle(ButtonStyle.Success)
          )
        ] });
      }

      if (id === "setup_blacklist_access") {
        const panel = blacklistAccessPanel(interaction.guild.id);
        return interaction.update({ embeds: [panel.embed], components: panel.components });
      }

      if (id.startsWith("setup_role_clear:")) {
        const command = id.split(":")[1];
        setCommandRoles(interaction.guild.id, command, []);
        db.prepare(`
          INSERT INTO permission_audit (guild_id, command_name, role_id, actor_id, action, created_at)
          VALUES (?, ?, NULL, ?, 'clear', ?)
        `).run(interaction.guild.id, command, interaction.user.id, now());
        addModLog(interaction.guild.id, "permission_config", interaction.guild.id, interaction.user.id,
          `Cleared custom role permissions for /${command}; normal Discord requirements restored`);
        return interaction.update({ embeds: [setupSummary(interaction.guild.id)], components: setupControls() });
      }

      if (id === "setup_blacklist_access_clear") {
        const botPermissions = interaction.guild.members.me?.permissions;
        if (!botPermissions?.has(PermissionFlagsBits.ManageRoles) ||
            !botPermissions.has(PermissionFlagsBits.ManageChannels)) {
          return interaction.reply({
            embeds: [errorEmbed("I need Manage Roles and Manage Channels permissions to apply the Blacklisted role's channel access settings.")],
            ephemeral: true
          });
        }

        await interaction.deferUpdate();
        db.prepare("DELETE FROM blacklist_allowed_channels WHERE guild_id = ?").run(interaction.guild.id);
        const result = await syncBlacklistChannelPermissions(interaction.guild);
        const summary = setupSummary(interaction.guild.id);
        if (result.failures.length) {
          summary.addFields({
            name: "⚠️ Channel permission updates failed",
            value: result.failures.slice(0, 10).map(({ channel }) => channel.name).join(", ").slice(0, 1024)
          });
        }
        return interaction.editReply({ embeds: [summary], components: setupControls() });
      }

      if (id === "setup_blacklist_role_default") {
        const botPermissions = interaction.guild.members.me?.permissions;
        if (!botPermissions?.has(PermissionFlagsBits.ManageRoles)) {
          return interaction.reply({ embeds: [errorEmbed("I need Manage Roles permission to create the default Blacklisted role.")], ephemeral: true });
        }
        if (!botPermissions.has(PermissionFlagsBits.ManageChannels)) {
          return interaction.reply({ embeds: [errorEmbed("I also need Manage Channels permission to apply the Blacklisted role's channel access settings.")], ephemeral: true });
        }

        await interaction.deferUpdate();
        const previousRoleId = getSettings(interaction.guild.id).blacklist_role_id;
        const role = await ensureDefaultBlacklistRole(interaction.guild);
        db.prepare("UPDATE settings SET blacklist_role_id = ? WHERE guild_id = ?").run(role.id, interaction.guild.id);
        const result = await syncBlacklistChannelPermissions(interaction.guild);
        const roleMoveFailures = await moveActiveBlacklistedMembers(interaction.guild, previousRoleId, role);
        const oldPermissionFailures = previousRoleId === role.id
          ? []
          : await clearBlacklistRoleChannelPermissions(interaction.guild, previousRoleId);
        return interaction.editReply({
          embeds: [publicEmbed(
            "🚫 Blacklisted Role Ready",
            `${roleMention(role.id)} is configured${previousRoleId && previousRoleId !== role.id ? ` (previous role: ${roleMention(previousRoleId)})` : ""}.\n${result.failures.length ? `⚠️ I couldn't update ${result.failures.length} channel permission overwrite(s).` : "Channel permissions are synchronized with the selected allowlist."}${roleMoveFailures.length ? `\n⚠️ I couldn't update the role for ${roleMoveFailures.length} currently blacklisted member(s).` : ""}${oldPermissionFailures.length ? `\n⚠️ I couldn't clear ${oldPermissionFailures.length} overwrite(s) from the previous role.` : ""}`,
            result.failures.length || roleMoveFailures.length || oldPermissionFailures.length ? 0xFEE75C : 0x57F287
          )],
          components: setupControls()
        });
      }

      if (id === "setup_blacklist_role") {
        const current = getSettings(interaction.guild.id).blacklist_role_id;
        return interaction.update({
          embeds: [publicEmbed(
            "🚫 Blacklist Role",
            `Pick the role that gets assigned when someone is blacklisted, or use the automatically created default role.\n\nCurrent: ${current ? roleMention(current) : `default (the role named \`${BLACKLIST_ROLE_NAME}\`)`}\n\nMake sure my bot role is **above** this role in Server Settings > Roles, and grant me Manage Channels so I can apply the channel allowlist.`,
            0x5865F2
          )],
          components: [
            new ActionRowBuilder().addComponents(
              new RoleSelectMenuBuilder()
                .setCustomId("setup_blacklist_role_select")
                .setPlaceholder("Choose the blacklist role")
                .setMinValues(1)
                .setMaxValues(1)
            ),
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId("setup_blacklist_role_default").setLabel("↩ Use default blacklisted role").setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId("setup_channels_done").setLabel("✅ Done").setStyle(ButtonStyle.Success)
            )
          ]
        });
      }

      if (id === "setup_appeal_link") {
        return interaction.showModal(blacklistAppealModal());
      }

      if (id === "setup_channels_done") {
        return interaction.update({ embeds: [setupSummary(interaction.guild.id)], components: setupControls() });
      }

      if (id === "setup_prefixes") {
        return interaction.update({ embeds: [publicEmbed("🔤 Prefix Setup", "Select **as many prefixes as you want**.", 0x5865F2)], components: [prefixSelect()] });
      }

      if (id === "setup_finish") {
        db.prepare(`
          UPDATE settings
          SET setup_complete = 1
          WHERE guild_id = ?
        `).run(interaction.guild.id);

        return interaction.update({ embeds: [setupSummary(interaction.guild.id)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("setup_reset").setLabel("🔴 Reset Setup").setStyle(ButtonStyle.Danger))] });
      }

      if (id === "setup_reset") {
        return interaction.update({ embeds: [publicEmbed("⚠️ Reset Setup?", "Are you sure you want to reset the setup?\n\nThis will remove all command roles, prefixes and configured channels, including security alert channels.", 0xED4245)], components: resetConfirmRows() });
      }

      if (id === "setup_reset_yes") {
        const botPermissions = interaction.guild.members.me?.permissions;
        if (!botPermissions?.has(PermissionFlagsBits.ManageRoles) ||
            !botPermissions.has(PermissionFlagsBits.ManageChannels)) {
          return interaction.reply({
            embeds: [errorEmbed("I need Manage Roles and Manage Channels permissions to reset blacklist channel access safely.")],
            ephemeral: true
          });
        }

        await interaction.deferUpdate();
        const guildId = interaction.guild.id;
        const previousRoleId = getSettings(guildId).blacklist_role_id;
        const transaction = db.transaction(() => {
          db.prepare(`DELETE FROM command_roles WHERE guild_id = ?`).run(guildId);
          db.prepare(`DELETE FROM prefixes WHERE guild_id = ?`).run(guildId);
          db.prepare(`DELETE FROM blacklist_allowed_channels WHERE guild_id = ?`).run(guildId);
          db.prepare(`UPDATE settings SET blacklist_channel_id = NULL, unblacklist_channel_id = NULL, blacklist_role_id = NULL, log_channel_id = NULL, log_events_json = NULL, server_log_channel_id = NULL, server_logs_enabled = 0, nuke_alert_channel_id = NULL, raid_alert_channel_id = NULL, grade_channel_id = NULL, appeal_link = NULL, setup_complete = 0 WHERE guild_id = ?`).run(guildId);
        });

        transaction();
        const result = await syncBlacklistChannelPermissions(interaction.guild);
        const roleMoveFailures = await moveActiveBlacklistedMembers(interaction.guild, previousRoleId, result.role);
        const oldPermissionFailures = previousRoleId === result.role.id
          ? []
          : await clearBlacklistRoleChannelPermissions(interaction.guild, previousRoleId);
        const embed = publicEmbed("✅ Setup Reset", "The bot setup has been completely reset.", 0x57F287);
        if (result.failures.length || roleMoveFailures.length || oldPermissionFailures.length) {
          embed.addFields({
            name: "⚠️ Some blacklist updates failed",
            value: [
              result.failures.length ? `Could not update ${result.failures.length} channel overwrite(s).` : "",
              roleMoveFailures.length ? `Could not move ${roleMoveFailures.length} currently blacklisted member role(s).` : "",
              oldPermissionFailures.length ? `Could not clear ${oldPermissionFailures.length} old channel overwrite(s).` : ""
            ].filter(Boolean).join("\n")
          });
        }
        return interaction.editReply({ embeds: [embed], components: [] });
      }

      if (id === "setup_reset_no") {
        return interaction.update({ embeds: [setupSummary(interaction.guild.id)], components: setupControls() });
      }

      if (id.startsWith("delete_warning:")) {
        if (!hasCommandAccess(interaction, "deletewarns")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to delete warnings.")], ephemeral: true });
        }

        const warningId = Number(id.split(":")[1]);
        const warning = db.prepare(`SELECT * FROM warnings WHERE guild_id = ? AND id = ?`).get(interaction.guild.id, warningId);

        if (!warning) {
          return interaction.reply({ embeds: [errorEmbed("That warning no longer exists.")], ephemeral: true });
        }

        db.prepare(`DELETE FROM warnings WHERE guild_id = ? AND id = ?`).run(interaction.guild.id, warningId);
        addModLog(interaction.guild.id, "deletewarn", warning.user_id, interaction.user.id, `Deleted warning #${warningId}`);

        return interaction.update({
          embeds: [publicEmbed("🗑️ Warning Deleted", `Warning **#${warningId}** belonging to ${userMention(warning.user_id)} has been deleted.`, 0x57F287).addFields(
            { name: "👮 Deleted By", value: userMention(interaction.user.id), inline: true },
            { name: "⚠️ Warning ID", value: `#${warningId}`, inline: true },
            { name: "📝 Original Reason", value: safeText(warning.reason) }
          )],
          components: []
        });
      }

      if (id.startsWith("delete_strike:")) {
        if (!canActivateSecurityCommand(interaction.guild, interaction.member)) {
          return interaction.reply({ embeds: [errorEmbed("Only a member above the bot can delete staff strikes.")] });
        }

        const strikeId = Number(id.split(":")[1]);
        const strike = db.prepare(`
          SELECT user_id, moderator_id, reason
          FROM staff_strikes
          WHERE guild_id = ? AND id = ?
        `).get(interaction.guild.id, strikeId);
        if (!strike) {
          return interaction.reply({ embeds: [errorEmbed("That staff strike no longer exists.")] });
        }

        const deletion = db.prepare(`
          DELETE FROM staff_strikes
          WHERE guild_id = ? AND id = ?
        `).run(interaction.guild.id, strikeId);
        if (!deletion.changes) {
          return interaction.reply({ embeds: [errorEmbed("That staff strike could not be deleted.")] });
        }

        const remainingCount = db.prepare(`
          SELECT COUNT(*) AS count
          FROM staff_strikes
          WHERE guild_id = ? AND user_id = ?
        `).get(interaction.guild.id, strike.user_id).count;
        addModLog(
          interaction.guild.id,
          "deletestrike",
          strike.user_id,
          interaction.user.id,
          `Deleted staff strike #${strikeId}: ${strike.reason}`
        );

        return interaction.update({
          embeds: [publicEmbed(
            "🗑️ Staff Strike Deleted",
            `Staff strike **#${strikeId}** for ${userMention(strike.user_id)} was deleted.`,
            0x57F287
          ).addFields(
            { name: "👮 Deleted By", value: userMention(interaction.user.id), inline: true },
            { name: "⚠️ Remaining Strikes", value: `${remainingCount}/3`, inline: true },
            { name: "📝 Original Reason", value: safeText(strike.reason) }
          )],
          components: []
        });
      }
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith("leaderboard_member:")) {
      const [, boardIdText, ownerId] = interaction.customId.split(":");
      if (ownerId !== interaction.user.id) {
        return interaction.reply({ embeds: [errorEmbed("This leaderboard editor belongs to another user.")], ephemeral: true });
      }
      if (!hasCommandAccess(interaction, "lb-edit")) {
        return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/lb-edit`.")], ephemeral: true });
      }

      const boardId = Number(boardIdText);
      const board = db.prepare("SELECT * FROM leaderboards WHERE id = ? AND guild_id = ?").get(boardId, interaction.guild.id);
      if (!board) {
        return interaction.reply({ embeds: [errorEmbed("That leaderboard no longer exists.")], ephemeral: true });
      }

      const targetId = interaction.values[0];
      const target = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!target || target.user.bot) {
        return interaction.reply({ embeds: [errorEmbed("Choose a current server member who isn't a bot.")], ephemeral: true });
      }

      const profile = db.prepare(`
        SELECT spot, roblox_username, country, stage, avatar_url
        FROM leaderboard_scores
        WHERE leaderboard_id = ? AND user_id = ?
      `).get(board.id, targetId);
      const occupiedSpots = new Set(db.prepare(`
        SELECT spot
        FROM leaderboard_scores
        WHERE leaderboard_id = ?
      `).all(board.id).map(entry => entry.spot));
      const firstAvailableSpot = Array.from({ length: 10 }, (_, index) => index + 1)
        .find(spot => !occupiedSpots.has(spot));
      const defaultSpot = profile?.spot >= 1 && profile.spot <= 10
        ? profile.spot
        : firstAvailableSpot || 10;
      const spotInput = new TextInputBuilder()
        .setCustomId("leaderboard_spot_value")
        .setLabel("Spot (1-10)")
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(2)
        .setValue(String(defaultSpot))
        .setRequired(true);
      const robloxImageInput = new TextInputBuilder()
        .setCustomId("leaderboard_roblox_image_url")
        .setLabel("Roblox image URL (optional)")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(400)
        .setRequired(false);
      if (profile?.avatar_url) robloxImageInput.setValue(profile.avatar_url);
      const countryInput = new TextInputBuilder()
        .setCustomId("leaderboard_country")
        .setLabel("Country (include flag emoji if desired)")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(50)
        .setValue(profile?.country || "Unknown")
        .setRequired(true);
      const stageInput = new TextInputBuilder()
        .setCustomId("leaderboard_stage")
        .setLabel("Grade")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setValue(profile?.stage || "Not set")
        .setRequired(true);
      const modal = new ModalBuilder()
        .setCustomId(`leaderboard_score:${board.id}:${interaction.user.id}:${target.id}`)
        .setTitle(`Set ${board.name}`.slice(0, 45))
        .addComponents(
          new ActionRowBuilder().addComponents(spotInput),
          new ActionRowBuilder().addComponents(robloxImageInput),
          new ActionRowBuilder().addComponents(countryInput),
          new ActionRowBuilder().addComponents(stageInput)
        );
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit()) {
      const reactionRoleEmojiModal = interaction.customId.match(/^rr_emojis:([a-f0-9]{20})$/);
      if (reactionRoleEmojiModal) {
        const state = reactionRoleSetupSessions.get(reactionRoleEmojiModal[1]);
        const accessError = reactionRoleManagerError(interaction);
        if (!state || state.completed || state.userId !== interaction.user.id || state.guildId !== interaction.guildId) {
          return interaction.reply({ embeds: [errorEmbed("This reaction-role setup has expired or belongs to another user.")], ephemeral: true });
        }
        if (accessError) return interaction.reply({ embeds: [errorEmbed(accessError)], ephemeral: true });

        const validation = validateReactionRoleSelection(interaction, state.selectedRoleIds);
        if (validation.error) return interaction.reply({ embeds: [errorEmbed(validation.error)], ephemeral: true });
        const mappings = parseReactionRoleEmojiMappings(
          interaction.fields.getTextInputValue("reaction_role_emoji_mappings"),
          validation.roles,
          interaction.guild
        );
        if (mappings.error) return interaction.reply({ embeds: [errorEmbed(mappings.error)], ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        try {
          const result = await saveReactionRoleSetup(state, interaction, mappings.emojiByRoleId);
          if (result.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
          state.completed = true;
          return interaction.editReply({
            embeds: [publicEmbed("Reaction-Role Panel Published",
              `Panel **#${result.panelId}** was published in ${result.channel}. [Open panel](https://discord.com/channels/${interaction.guildId}/${result.channel.id}/${result.message.id})`,
              0x57F287)]
          });
        } catch (error) {
          console.error("Could not publish reaction-role panel with emojis:", error);
          return interaction.editReply({ embeds: [errorEmbed("I couldn't publish the panel. Check my channel permissions and try again.")] });
        }
      }

      if (interaction.customId.startsWith("leaderboard_score:")) {
        const [, boardIdText, ownerId, targetId] = interaction.customId.split(":");
        if (ownerId !== interaction.user.id) {
          return interaction.reply({ embeds: [errorEmbed("This score editor belongs to another user.")], ephemeral: true });
        }
        if (!hasCommandAccess(interaction, "lb-edit")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/lb-edit`.")], ephemeral: true });
        }

        const boardId = Number(boardIdText);
        const board = db.prepare("SELECT * FROM leaderboards WHERE id = ? AND guild_id = ?").get(boardId, interaction.guild.id);
        if (!board) {
          return interaction.reply({ embeds: [errorEmbed("That leaderboard no longer exists.")], ephemeral: true });
        }

        const spotText = interaction.fields.getTextInputValue("leaderboard_spot_value").trim();
        const spot = Number(spotText);
        if (!/^\d+$/.test(spotText) || !Number.isInteger(spot) || spot < 1 || spot > 10) {
          return interaction.reply({ embeds: [errorEmbed("Enter a leaderboard spot from 1 to 10.")], ephemeral: true });
        }
        const avatarUrl = interaction.fields.getTextInputValue("leaderboard_roblox_image_url").trim();
        const country = interaction.fields.getTextInputValue("leaderboard_country").trim();
        const stage = interaction.fields.getTextInputValue("leaderboard_stage").trim();
        if (!country || !stage) {
          return interaction.reply({ embeds: [errorEmbed("Country and grade can't be empty.")], ephemeral: true });
        }
        if (avatarUrl) {
          let parsedAvatarUrl;
          try {
            parsedAvatarUrl = new URL(avatarUrl);
          } catch {
            return interaction.reply({ embeds: [errorEmbed("Avatar image URL must be a valid HTTPS or HTTP URL.")], ephemeral: true });
          }
          if (!["http:", "https:"].includes(parsedAvatarUrl.protocol)) {
            return interaction.reply({ embeds: [errorEmbed("Avatar image URL must use HTTPS or HTTP.")], ephemeral: true });
          }
        }

        await interaction.deferReply({ ephemeral: true });
        const target = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!target || target.user.bot) {
          return interaction.editReply({ embeds: [errorEmbed("That member is no longer in the server or is a bot.")] });
        }

        const currentProfile = db.prepare(`
          SELECT spot
          FROM leaderboard_scores
          WHERE leaderboard_id = ? AND user_id = ?
        `).get(board.id, target.id);
        const lastSpot = db.prepare(`
          SELECT COALESCE(MAX(spot), 0) AS spot
          FROM leaderboard_scores
          WHERE leaderboard_id = ?
        `).get(board.id).spot;
        db.prepare(`
          INSERT INTO leaderboard_scores (
            leaderboard_id, user_id, score, spot, country, stage, avatar_url, updated_at
          )
          VALUES (?, ?, 0, ?, ?, ?, ?, ?)
          ON CONFLICT (leaderboard_id, user_id)
          DO UPDATE SET
            country = excluded.country,
            stage = excluded.stage,
            avatar_url = excluded.avatar_url,
            updated_at = excluded.updated_at
        `).run(board.id, target.id, currentProfile?.spot ?? lastSpot + 1, country, stage, avatarUrl || null, now());
        assignLeaderboardSpot(board.id, target.id, spot);

        try {
          await publishLeaderboard(board, interaction.guild);
        } catch (error) {
          console.error(`Leaderboard webhook update failed for board #${board.id}:`, error);
          const errorMessage = error instanceof Error ? safeText(error.message).slice(0, 500) : "Unknown webhook error";
          return interaction.editReply({
            embeds: [errorEmbed(`The player's spot and details were saved, but the webhook post couldn't be updated. Check that the webhook still exists and can post.\n\n${errorMessage}`)]
          });
        }

        return interaction.editReply({
          embeds: [publicEmbed("✅ Leaderboard Updated", `Set ${target}'s spot on **${safeText(board.name)}** to **#${spot}**.`, 0x57F287)]
        });
      }

      if (interaction.customId === "setup_appeal_modal") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ embeds: [errorEmbed("Only administrators can change setup.")], ephemeral: true });
        }

        const value = interaction.fields.getTextInputValue("setup_appeal_link_input").trim();
        db.prepare(`UPDATE settings SET appeal_link = ? WHERE guild_id = ?`).run(value || null, interaction.guild.id);

        return interaction.reply({ embeds: [publicEmbed("📎 Appeal Link Saved", value ? `Saved: ${value}` : "Cleared the appeal link.", 0x57F287)], ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "help_category") {
        const category = interaction.values[0];
        return interaction.update({ embeds: [helpCategoryEmbed(category)], components: helpComponents(category) });
      }
      if (interaction.customId.startsWith("leaderboard_pick:")) {
        const [, ownerId] = interaction.customId.split(":");
        if (ownerId !== interaction.user.id) {
          return interaction.reply({ embeds: [errorEmbed("This leaderboard picker belongs to another user.")], ephemeral: true });
        }
        if (!hasCommandAccess(interaction, "lb-edit")) {
          return interaction.reply({ embeds: [errorEmbed("You don't have permission to use `/lb-edit`.")], ephemeral: true });
        }

        const boardId = Number(interaction.values[0]);
        const board = db.prepare("SELECT * FROM leaderboards WHERE id = ? AND guild_id = ?").get(boardId, interaction.guild.id);
        if (!board) {
          return interaction.update({
            embeds: [errorEmbed("That leaderboard no longer exists. Run `/lb-edit` again to choose an active leaderboard.")],
            components: []
          });
        }
        return interaction.update(leaderboardEditPanel(board, interaction.user.id));
      }

      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ embeds: [errorEmbed("Only administrators can change setup.")], ephemeral: true });
      }

      if (interaction.customId.startsWith("setup_command_select:")) {
        const command = interaction.values[0];
        const roles = getCommandRoles(interaction.guild.id, command);
        const normal = getCommandPermissionRequirement(command);
        const normalText = normal
          ? "Normal Discord requirement: the command's configured Discord permission"
          : "Normal Discord requirement: server-specific/default command access";
        return interaction.update({
          embeds: [publicEmbed(
            `🎭 Roles for /${command}`,
            `${normalText}\n\nCurrent custom roles: ${roles.length ? roles.map(roleMention).join(", ") : "None"}\n\nSelecting roles replaces the current custom role list. Clearing custom roles restores the normal Discord requirement.`,
            0x5865F2
          )],
          components: roleSelectFor(command)
        });
      }

      if (interaction.customId === "setup_prefix_select") {
        savePrefixes(interaction.guild.id, interaction.values);
        return interaction.update({ embeds: [setupSummary(interaction.guild.id)], components: setupControls() });
      }

      if (interaction.customId === "setup_log_events_select") {
        saveEnabledLogEvents(interaction.guild.id, interaction.values);
        const panel = logSetupPanel(interaction.guild.id);
        return interaction.update({ embeds: [panel.embed], components: panel.components });
      }
    }

    if (interaction.isRoleSelectMenu()) {
      const reactionRoleSelect = interaction.customId.match(/^rr_roles:([a-f0-9]{20})$/);
      if (!reactionRoleSelect && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ embeds: [errorEmbed("Only administrators can change setup.")], ephemeral: true });
      }

      if (reactionRoleSelect) {
        const state = reactionRoleSetupSessions.get(reactionRoleSelect[1]);
        const accessError = reactionRoleManagerError(interaction);
        if (!state || state.completed || state.userId !== interaction.user.id || state.guildId !== interaction.guildId) {
          return interaction.reply({ embeds: [errorEmbed("This reaction-role setup has expired or belongs to another user.")], ephemeral: true });
        }
        if (accessError) return interaction.reply({ embeds: [errorEmbed(accessError)], ephemeral: true });
        const validation = validateReactionRoleSelection(interaction, interaction.values);
        if (validation.error) return interaction.reply({ embeds: [errorEmbed(validation.error)], ephemeral: true });

        state.selectedRoleIds = validation.roles.map(role => role.id);
        const preview = reactionRoleSetupPreview(state, interaction.guild);
        const actionRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rr_publish:${reactionRoleSelect[1]}`).setLabel("Publish Panel").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`rr_emojis:${reactionRoleSelect[1]}`).setLabel("Set Optional Emojis").setStyle(ButtonStyle.Secondary)
        );
        const previewButtons = reactionRolePanelComponents(`preview-${reactionRoleSelect[1]}`, preview.roles, true);
        return interaction.update({
          content: "Review the panel preview below. You can publish it now or set optional button emojis first.",
          embeds: [preview.embed],
          components: [...previewButtons, actionRow],
          allowedMentions: { parse: [] }
        });
      }

      if (interaction.customId === "setup_blacklist_role_select") {
        const role = interaction.guild.roles.cache.get(interaction.values[0]);
        if (!role || role.id === interaction.guild.id || role.managed) {
          return interaction.reply({ embeds: [errorEmbed("Pick a normal role. @everyone and bot/integration roles can't be used as the blacklist role.")], ephemeral: true });
        }
        const botPermissions = interaction.guild.members.me?.permissions;
        if (!botPermissions?.has(PermissionFlagsBits.ManageRoles) ||
            !botPermissions.has(PermissionFlagsBits.ManageChannels)) {
          return interaction.reply({
            embeds: [errorEmbed("I need Manage Roles and Manage Channels permissions to configure the Blacklisted role.")],
            ephemeral: true
          });
        }
        if (!role.editable) {
          return interaction.reply({ embeds: [errorEmbed("Move my bot role above the role you selected so I can manage it.")], ephemeral: true });
        }

        await interaction.deferUpdate();
        const previousRoleId = getSettings(interaction.guild.id).blacklist_role_id;
        ensureSettings(interaction.guild.id);
        db.prepare("UPDATE settings SET blacklist_role_id = ? WHERE guild_id = ?").run(role.id, interaction.guild.id);
        const permissionResult = await syncBlacklistChannelPermissions(interaction.guild);
        const roleMoveFailures = await moveActiveBlacklistedMembers(interaction.guild, previousRoleId, role);
        const oldPermissionFailures = previousRoleId === role.id
          ? []
          : await clearBlacklistRoleChannelPermissions(interaction.guild, previousRoleId);

        const summary = setupSummary(interaction.guild.id);
        if (permissionResult.failures.length || roleMoveFailures.length || oldPermissionFailures.length) {
          summary.addFields({
            name: "⚠️ Blacklist role configuration incomplete",
            value: [
              permissionResult.failures.length ? `Could not update ${permissionResult.failures.length} channel permission overwrite(s).` : "",
              roleMoveFailures.length ? `Could not move ${roleMoveFailures.length} currently blacklisted member role(s).` : "",
              oldPermissionFailures.length ? `Could not clear ${oldPermissionFailures.length} old channel overwrite(s).` : ""
            ].filter(Boolean).join("\n")
          });
        }
        return interaction.editReply({ embeds: [summary], components: setupControls() });
      }

      if (interaction.customId.startsWith("setup_role_select:")) {
        const command = interaction.customId.split(":")[1];
        const selectedRoles = interaction.values
          .map(roleId => interaction.guild.roles.cache.get(roleId))
          .filter(role => role && role.id !== interaction.guild.id && !role.managed);
        setCommandRoles(interaction.guild.id, command, selectedRoles.map(role => role.id));
        db.prepare(`
          INSERT INTO permission_audit (guild_id, command_name, role_id, actor_id, action, created_at)
          VALUES (?, ?, NULL, ?, 'replace', ?)
        `).run(interaction.guild.id, command, interaction.user.id, now());
        addModLog(interaction.guild.id, "permission_config", interaction.guild.id, interaction.user.id,
          `Replaced custom role permissions for /${command}: ${selectedRoles.length ? selectedRoles.map(role => role.name).join(", ") : "none"}`);
        return interaction.update({ embeds: [setupSummary(interaction.guild.id)], components: setupControls() });
      }
    }

    if (interaction.isChannelSelectMenu()) {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ embeds: [errorEmbed("Only administrators can change setup.")], ephemeral: true });
      }

      if (interaction.customId === "setup_blacklist_access_select") {
        const botPermissions = interaction.guild.members.me?.permissions;
        if (!botPermissions?.has(PermissionFlagsBits.ManageRoles) ||
            !botPermissions.has(PermissionFlagsBits.ManageChannels)) {
          return interaction.reply({
            embeds: [errorEmbed("I need Manage Roles and Manage Channels permissions to apply the Blacklisted role's channel access settings.")],
            ephemeral: true
          });
        }

        await interaction.deferUpdate();
        const saveChannels = db.transaction(() => {
          db.prepare("DELETE FROM blacklist_allowed_channels WHERE guild_id = ?").run(interaction.guild.id);
          const insert = db.prepare("INSERT INTO blacklist_allowed_channels (guild_id, channel_id) VALUES (?, ?)");
          for (const channelId of new Set(interaction.values)) {
            insert.run(interaction.guild.id, channelId);
          }
        });
        saveChannels();
        const result = await syncBlacklistChannelPermissions(interaction.guild);
        const summary = setupSummary(interaction.guild.id);
        if (result.failures.length) {
          summary.addFields({
            name: "⚠️ Channel permission updates failed",
            value: result.failures.slice(0, 10).map(({ channel }) => channel.name).join(", ").slice(0, 1024)
          });
        }
        return interaction.editReply({ embeds: [summary], components: setupControls() });
      }

      if (interaction.customId === "setup_blacklist_channel") {
        db.prepare(`UPDATE settings SET blacklist_channel_id = ? WHERE guild_id = ?`).run(interaction.values[0], interaction.guild.id);
        return interaction.update({ embeds: [publicEmbed("📢 Channel Setup", "✅ Blacklist log channel saved.\n\nNow choose the unblacklist channel.", 0x57F287)], components: channelSelects() });
      }

      if (interaction.customId === "setup_unblacklist_channel") {
        db.prepare(`UPDATE settings SET unblacklist_channel_id = ? WHERE guild_id = ?`).run(interaction.values[0], interaction.guild.id);
        return interaction.update({ embeds: [publicEmbed("📢 Channel Setup", "✅ Unblacklist log channel saved.\n\nNow choose the join ping channel.", 0x57F287)], components: channelSelects() });
      }

      if (interaction.customId === "setup_auto_ping_channel") {
        const channelId = interaction.values[0];
        setAutoPingChannel(interaction.guild.id, channelId, true);
        return interaction.update({ embeds: [setupSummary(interaction.guild.id)], components: setupControls() });
      }

      if (interaction.customId === "setup_nuke_alert_channel" ||
          interaction.customId === "setup_raid_alert_channel") {
        const channel = interaction.guild.channels.cache.get(interaction.values[0]);
        const botMember = interaction.guild.members.me;
        const botPermissions = channel && botMember ? channel.permissionsFor(botMember) : null;
        if (!botPermissions?.has(PermissionFlagsBits.ViewChannel) ||
            !botPermissions.has(PermissionFlagsBits.SendMessages) ||
            !botPermissions.has(PermissionFlagsBits.EmbedLinks)) {
          return interaction.reply({
            embeds: [errorEmbed("I need View Channel, Send Messages, and Embed Links permissions in the security alert channel.")],
            ephemeral: true
          });
        }

        const column = interaction.customId === "setup_nuke_alert_channel"
          ? "nuke_alert_channel_id"
          : "raid_alert_channel_id";
        db.prepare(`UPDATE settings SET ${column} = ? WHERE guild_id = ?`).run(channel.id, interaction.guild.id);
        const panel = securityAlertSetupPanel(interaction.guild.id);
        return interaction.update({ embeds: [panel.embed], components: panel.components });
      }

      if (interaction.customId === "setup_log_channel_select") {
        db.prepare(`UPDATE settings SET log_channel_id = ? WHERE guild_id = ?`).run(interaction.values[0], interaction.guild.id);
        const panel = logSetupPanel(interaction.guild.id);
        return interaction.update({ embeds: [panel.embed], components: panel.components });
      }
    }

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      return interaction.reply({
        embeds: [errorEmbed("This interaction isn't recognized or is out of date. Please rerun the command or reopen the menu.")],
        ephemeral: true
      });
    }
  } catch (error) {
    const interactionContext = interaction.isChatInputCommand()
      ? `/${interaction.commandName}`
      : interaction.customId || "unknown interaction";
    console.error(`Interaction error (${interactionContext}):`, error);

    if (interaction.isRepliable()) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const embed = errorEmbed(`\`${interactionContext}\` failed.\n\n${safeText(errorMessage).slice(0, 800)}`);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ embeds: [embed], ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
      }
    }
  }
});

client.on("messageCreate", async message => {
  if (message.guild) rememberMessage(message);
  if (message.author.bot || !message.guild) return;

  const honeypot = db.prepare("SELECT channel_id FROM honeypot_settings WHERE guild_id = ?").get(message.guild.id);
  if (honeypot?.channel_id === message.channelId) {
    const member = message.member;
    const isBypass = canBypassHoneypot(member);

    if (isBypass) {
      return;
    }

    try {
      await message.delete();
    } catch (error) {
      console.warn(`Could not delete a honeypot message in ${message.guild.name}:`, error.message);
    }

    if (member) {
      if (!member.kickable) {
        console.warn(`Cannot kick ${member.user.tag} for posting in the honeypot channel in ${message.guild.name}; check my Kick Members permission and role hierarchy.`);
        return;
      }

      // The DM has to go out BEFORE the kick. Once the member is removed the bot
      // normally shares no server with them and Discord rejects the DM (error 50007).
      try {
        await member.send({
          embeds: [publicEmbed(
            "🍯 You Were Kicked",
            `You were automatically kicked from **${safeText(message.guild.name)}**.`,
            0xED4245
          ).addFields(
            { name: "📝 Reason", value: "You posted in a channel that is monitored as a trap for raiders and scam accounts. Nobody is supposed to post there." },
            { name: "ℹ️ If this was a mistake", value: "Contact a server administrator and ask to be re-invited." }
          )]
        });
      } catch (dmError) {
        console.warn(`Could not DM ${member.user.tag} before the honeypot kick:`, dmError.message);
      }

      try {
        await member.kick("Posted in the honeypot channel");
      } catch (error) {
        console.warn(`Could not kick ${member.user.tag} for posting in the honeypot channel:`, error.message);
      }
    }

    return;
  }

  const security = db.prepare("SELECT * FROM security_settings WHERE guild_id = ?").get(message.guild.id);
  if (security) {
    const trustedRoles = JSON.parse(security.trusted_role_ids_json || "[]");
    const trustedChannels = JSON.parse(security.trusted_channel_ids_json || "[]");
    const trusted = trustedChannels.includes(message.channelId) ||
      trustedRoles.some(roleId => message.member?.roles.cache.has(roleId));
    if (!trusted) {
      let alert = null;
      if (security.antimention && message.mentions.users.size + message.mentions.roles.size >= security.mention_limit) {
        alert = `Mass mention detected (${message.mentions.users.size + message.mentions.roles.size} mentions)`;
      }
      if (!alert && security.antilink && /https?:\/\/|discord\.gg\/|discord\.com\/invite/i.test(message.content)) {
        alert = "Unauthorized link detected";
      }
      if (!alert && security.antispam) {
        const key = `${message.guild.id}:${message.author.id}`;
        const window = securityMessageWindows.get(key) || [];
        const recent = window.filter(timestamp => Date.now() - timestamp < 10_000);
        recent.push(Date.now());
        securityMessageWindows.set(key, recent);
        if (recent.length >= security.spam_limit) alert = `Repeated-message spam detected (${recent.length} messages in 10 seconds)`;
      }
      if (alert) {
        db.prepare("INSERT INTO security_events (guild_id, user_id, type, details, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(message.guild.id, message.author.id, "message", alert, now());
        await message.delete().catch(() => {});
        const member = message.member;
        if (security.action === "timeout" && member?.moderatable) {
          await member.timeout(10 * 60_000, alert).catch(() => {});
        } else if (security.action === "kick" && member?.kickable) {
          await member.kick(alert).catch(() => {});
        } else {
          db.prepare("INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at)")
            .run(message.guild.id, message.author.id, message.guild.members.me.id, alert, now());
        }
        addModLog(message.guild.id, "security_alert", message.author.id, message.guild.members.me.id, alert);
        return;
      }
    }
  }

  const gradeMessageMatch = message.content.match(/^<@!?(\d+)>\s+(.+)$/s);
  if (gradeMessageMatch && getSettings(message.guild.id).grade_channel_id === message.channelId) {
    const canGrade = hasCommandAccess(message, "grade");
    const target = await message.guild.members.fetch(gradeMessageMatch[1]).catch(() => null);
    const gradeRoles = parseGradeRoleMessage(message.guild, gradeMessageMatch[2]);

    if (target && gradeRoles) {
      if (!canGrade) {
        return message.reply({ embeds: [errorEmbed("You don't have permission to assign grade roles.")] });
      }

      const result = await doGradeUpdate(
        message.guild,
        message.member,
        target,
        gradeRoles.gradeRole,
        gradeRoles.sub1Role,
        gradeRoles.sub2Role
      );
      if (result.error) {
        return message.reply({ embeds: [errorEmbed(result.error)] });
      }

      const response = await message.reply({ embeds: [result.embed] });
      try {
        await response.react("✅");
      } catch (error) {
        console.warn("Could not add the grade assignment confirmation reaction:", error);
      }
      return;
    }

    // Graders get feedback when a grade message can't be read instead of the bot silently doing nothing.
    if (canGrade && GRADE_ATTEMPT_PATTERN.test(gradeMessageMatch[2])) {
      const hint = target
        ? gradeFormatHint(message.guild)
        : "I couldn't find that member in this server.";
      return message.reply({ embeds: [errorEmbed(hint)] });
    }
  }

  const prefixes = getPrefixes(message.guild.id);
  if (!prefixes.length) return;

  const prefix = prefixes.find(p => message.content.startsWith(p));
  if (!prefix) return;

  const input = message.content.slice(prefix.length).trim();
  if (!input) return;

  const args = input.split(/\s+/);
  const command = args.shift().toLowerCase();

  if (!COMMANDS.includes(command)) return;

  if (command === "grade") {
    return message.reply({ embeds: [errorEmbed("Grade assignments are made by mentioning a member in the configured grade channel; `grade` isn't a prefix command.")] });
  }
  if (SLASH_ONLY_PREFIX_COMMANDS.has(command)) {
    return message.reply({ embeds: [errorEmbed(`\`${prefix}${command}\` isn't available as a prefix command. Use \`/${command}\` instead.`)] });
  }

  if (command === "help") {
    return message.reply({ embeds: [helpEmbed()] });
  }

  if (command === "serverinfo") {
    return message.reply({ embeds: [serverInfoEmbed(message.guild)] });
  }

  if (command === "userinfo") {
    const memberId = args[0]?.replace(/[<@!>]/g, "");
    const member = memberId
      ? await message.guild.members.fetch(memberId).catch(() => null)
      : message.member;
    if (!member) return message.reply({ embeds: [errorEmbed("That user is not a member of this server.")] });
    return message.reply({ embeds: [userInfoEmbed(member)] });
  }

  const deletingStrike = command === "strike" && args[0]?.toLowerCase() === "delete";
  if (!hasCommandAccess(message, command) &&
      !(deletingStrike && canActivateSecurityCommand(message.guild, message.member))) {
    return message.reply({ embeds: [errorEmbed("You don't have permission to use this command.")] });
  }

  if (command === "lock" || command === "unlock") {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return message.reply({ embeds: [errorEmbed(`You need the Manage Channels permission to use \`${prefix}${command}\`.`)] });
    }

    const result = await setChannelLock(message.guild, message.channel, command === "lock");
    if (result.error) return message.reply({ embeds: [errorEmbed(result.error)] });

    const action = result.locked ? "locked" : "unlocked";
    return message.reply({ embeds: [publicEmbed(`🔒 Channel ${action}`, `${result.channel} has been ${action} for @everyone.`, result.locked ? 0xED4245 : 0x57F287)] });
  }

  if (command === "slowmode") {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return message.reply({ embeds: [errorEmbed(`You need the Manage Channels permission to use \`${prefix}slowmode\`.`)] });
    }

    const seconds = Number.parseInt(args[0], 10);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) {
      return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}slowmode <seconds 0-21600> [reason]\``)] });
    }

    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(message.channel.type)) {
      return message.reply({ embeds: [errorEmbed("Slowmode can only be changed in a text or announcement channel.")] });
    }

    const botPermissions = message.channel.permissionsFor(message.guild.members.me);
    if (!botPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return message.reply({ embeds: [errorEmbed("I need the Manage Channels permission in this channel to change slowmode.")] });
    }

    const reason = args.slice(1).join(" ") || `Changed by ${message.author.tag}`;
    try {
      await message.channel.setRateLimitPerUser(seconds, reason);
      addModLog(message.guild.id, "slowmode", message.author.id, message.author.id, reason);
      const result = seconds === 0 ? "disabled" : `set to ${seconds} second(s)`;
      return message.reply({ embeds: [publicEmbed("🐢 Slowmode Updated", `Slowmode in ${message.channel} was ${result}.`, 0x57F287)] });
    } catch (error) {
      console.error("Prefix slowmode update failed:", error);
      return message.reply({ embeds: [errorEmbed("I couldn't update slowmode. Check my channel permissions and try again.")] });
    }
  }

  if (command === "purge") {
    const amount = Number.parseInt(args[0], 10);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}purge <amount 1-100>\``)] });
    }

    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(message.channel.type)) {
      return message.reply({ embeds: [errorEmbed("Purge can only be used in a text or announcement channel.")] });
    }

    const botPermissions = message.channel.permissionsFor(message.guild.members.me);
    if (!botPermissions?.has(PermissionFlagsBits.ManageMessages) ||
        !botPermissions.has(PermissionFlagsBits.ReadMessageHistory)) {
      return message.reply({ embeds: [errorEmbed("I need Manage Messages and Read Message History permissions to purge messages.")] });
    }

    try {
      const deleted = await message.channel.bulkDelete(amount, true);
      return message.channel.send({
        embeds: [publicEmbed("🧹 Messages Purged", `Deleted ${deleted.size} message(s). Messages older than 14 days cannot be bulk deleted.`, 0x57F287)]
      });
    } catch (error) {
      console.error("Prefix purge failed:", error);
      return message.reply({ embeds: [errorEmbed("I couldn't delete those messages. Check my channel permissions and try again.")] });
    }
  }

  if (command === "warn") {
    const target = message.mentions.members.first();
    const reason = args.slice(1).join(" ");

    if (!target || !reason) {
      return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}warn @user reason\``)] });
    }

    const result = db.prepare(`
      INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(message.guild.id, target.id, message.author.id, reason, now());

    addModLog(message.guild.id, "warn", target.id, message.author.id, reason);

    let dmStatus = "❌ Failed";
    try {
      await target.send({
        embeds: [publicEmbed("⚠️ You Have Been Warned", `You were warned in **${message.guild.name}** by ${userMention(message.author.id)}.`, 0xFEE75C).addFields(
          { name: "📝 Reason", value: safeText(reason) },
          { name: "🏠 Server", value: message.guild.name, inline: true },
          { name: "👮 Moderator", value: userMention(message.author.id), inline: true }
        )]
      });
      dmStatus = "✅ Sent";
    } catch {
      dmStatus = "❌ Failed (DMs may be disabled)";
    }

    return message.reply({
      embeds: [publicEmbed("⚠️ User Warned", `${userMention(target.id)} has received a warning.`, 0xFEE75C).addFields(
        { name: "⚠️ Warning ID", value: `#${result.lastInsertRowid}`, inline: true },
        { name: "👮 Moderator", value: userMention(message.author.id), inline: true },
        { name: "📝 Reason", value: safeText(reason) },
        { name: "📩 DM Status", value: dmStatus, inline: true }
      )]
    });
  }

  if (command === "warns") {
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}warns @user\``)] });

    const warnings = db.prepare(`
      SELECT *
      FROM warnings
      WHERE guild_id = ?
      AND user_id = ?
      ORDER BY id DESC
    `).all(message.guild.id, target.id);

    if (!warnings.length) {
      return message.reply({ embeds: [publicEmbed("⚠️ Warnings", `${userMention(target.id)} has no warnings.`, 0x57F287)] });
    }

    const embed = publicEmbed("⚠️ User Warnings", `${userMention(target.id)} has **${warnings.length}** warning(s).`, 0xFEE75C);
    for (const warning of warnings.slice(0, 25)) {
      embed.addFields({ name: `Warning #${warning.id}`, value: `**Reason:** ${safeText(warning.reason)}\n**Moderator:** ${userMention(warning.moderator_id)}\n**Date:** ${timestamp(warning.created_at)}` });
    }

    return message.reply({ embeds: [embed] });
  }

  if (command === "kick") {
    const target = message.mentions.members.first();
    const reason = args.slice(1).join(" ");

    if (!target || !reason) {
      return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}kick @user reason\``)] });
    }

    if (!canModerateMember(message.guild, message.member, target)) {
      return message.reply({ embeds: [errorEmbed("That user is higher than you in the hierarchy.")] });
    }

    const botMember = message.guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.KickMembers)) {
      return message.reply({ embeds: [errorEmbed("I need the Kick Members permission.")] });
    }

    try {
      await target.kick(reason || "No reason provided");
    } catch (error) {
      console.error("Kick failed:", error);
      return message.reply({ embeds: [errorEmbed("I couldn't kick that user.")] });
    }

    addModLog(message.guild.id, "kick", target.id, message.author.id, reason || "No reason provided");
    return message.reply({ embeds: [publicEmbed("👢 User Kicked", `${userMention(target.id)} was kicked.`, 0xED4245).addFields(
      { name: "👤 User", value: userMention(target.id), inline: true },
      { name: "👮 Moderator", value: userMention(message.author.id), inline: true },
      { name: "📝 Reason", value: safeText(reason || "No reason provided") }
    )] });
  }

  if (command === "ban") {
    const targetId = parseUserId(args[0]);
    const reason = args.slice(1).join(" ").trim();
    if (!targetId || !reason) {
      return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}ban <user ID or mention> reason\``)] });
    }
    const target = await message.guild.members.fetch(targetId).catch(() => null);
    if (target && !canModerateMember(message.guild, message.member, target)) {
      return message.reply({ embeds: [errorEmbed("That user is higher than you in the hierarchy.")] });
    }
    if (!message.guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply({ embeds: [errorEmbed("I need the Ban Members permission.")] });
    }
    if (target && !target.bannable) {
      return message.reply({ embeds: [errorEmbed("I can't ban that user. Check my role hierarchy and permissions.")] });
    }

    let ban;
    try {
      ban = await message.guild.members.ban(targetId, { reason });
    } catch (error) {
      console.error("Prefix ban failed:", error);
      return message.reply({ embeds: [errorEmbed("I couldn't ban that user.")] });
    }

    addModLog(message.guild.id, "ban", targetId, message.author.id, reason);
    const logResult = await sendBanLog(message.guild, targetId, target?.user || ban.user, message.author.id, reason);
    const response = publicEmbed("🔨 User Banned", `${userMention(targetId)} was banned from the server.`, 0xED4245);
    if (!logResult.sent) {
      response.addFields({ name: "⚠️ Blacklist Channel Log", value: logResult.error });
    }
    return message.reply({ embeds: [response] });
  }

  if (command === "case") {
    const caseId = Number.parseInt(args[0], 10);
    if (!caseId) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}case <case_number>\``)] });

    const record = db.prepare(`
      SELECT *
      FROM blacklist_records
      WHERE guild_id = ?
      AND case_number = ?
    `).get(message.guild.id, caseId);

    if (!record) {
      return message.reply({ embeds: [errorEmbed(`I couldn't find blacklist case #${caseId}.`)] });
    }

    return message.reply({ embeds: [blacklistCaseEmbed(record)] });
  }

  if (command === "editcase") {
    const caseId = Number.parseInt(args[0], 10);
    const newReason = args.slice(1).join(" ");
    if (!caseId || !newReason) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}editcase <case_number> <new_reason>\``)] });
    if (newReason.length > 1000) return message.reply({ embeds: [errorEmbed("The updated reason must be 1,000 characters or fewer.")] });

    const existing = db.prepare(`
      SELECT *
      FROM blacklist_records
      WHERE guild_id = ?
      AND case_number = ?
    `).get(message.guild.id, caseId);

    if (!existing) {
      return message.reply({ embeds: [errorEmbed(`I couldn't find blacklist case #${caseId}.`)] });
    }

    db.prepare(`
      UPDATE blacklist_records
      SET reason = ?
      WHERE guild_id = ?
      AND case_number = ?
    `).run(newReason, message.guild.id, caseId);

    const updated = db.prepare(`
      SELECT *
      FROM blacklist_records
      WHERE guild_id = ?
      AND case_number = ?
    `).get(message.guild.id, caseId);

    return message.reply({ embeds: [blacklistCaseEmbed(updated, "✏️ Blacklist Case Updated", `Updated blacklist case #${updated.case_number}.`)] });
  }

  if (command === "raid") {
    const mode = args[0]?.toLowerCase();
    if (!["on", "off", "true", "false", "1", "0"].includes(mode)) {
      return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}raid <on|off>\``)] });
    }
    const enabled = ["on", "true", "1"].includes(mode);
    if (!canActivateSecurityCommand(message.guild, message.member)) {
      return message.reply({ embeds: [errorEmbed("Only a member above the bot can activate raid protection.")] });
    }

    if (enabled) {
      raidProtectionUntil.set(message.guild.id, Date.now() + (24 * 60 * 60 * 1000));
      return message.reply({ embeds: [publicEmbed("🛡️ Raid Protection Enabled", "Raid protection has been activated for this server. A member above the bot can disable it later.", 0xED4245)] });
    }

    raidProtectionUntil.delete(message.guild.id);
    return message.reply({ embeds: [publicEmbed("🛡️ Raid Protection Disabled", "Raid protection has been disabled for this server.", 0x57F287)] });
  }

  if (command === "unmute") {
    const target = message.mentions.members.first();
    const reason = args.slice(1).join(" ");
    if (!target || !reason) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}unmute @user reason\``)] });

    const result = await doUnmute(message.guild, message.member, target, reason);
    if (result.error) return message.reply({ embeds: [errorEmbed(result.error)] });
    return message.reply({ embeds: [result.embed] });
  }

  if (command === "blacklist") {
    const targetId = parseUserId(args[0]);
    const category = args[1];
    const reason = args.slice(2).join(" ");

    if (!targetId || !category || !reason) {
      return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}blacklist <user ID or mention> category reason\``)] });
    }

    const targetMember = await message.guild.members.fetch(targetId).catch(() => null);
    const target = targetMember || await client.users.fetch(targetId).catch(() => ({ id: targetId }));
    const result = await doBlacklist(message.guild, message.member, target, category, reason);
    if (result.error) return message.reply({ embeds: [errorEmbed(result.error)] });

    await message.reply({ embeds: [result.embed] });

    const settings = getSettings(message.guild.id);
    if (settings.blacklist_channel_id) {
      const channel = message.guild.channels.cache.get(settings.blacklist_channel_id);
      if (channel && channel.isTextBased()) await channel.send({ embeds: [result.embed] }).catch(() => {});
    }

    return;
  }

  if (command === "blacklistlist") {
    const page = Number.parseInt(args[0], 10) || 1;
    const result = blacklistListEmbed(message.guild.id, page);
    if (result.error) return message.reply({ embeds: [errorEmbed(result.error)] });
    return message.reply({
      content: result.mentionContent,
      embeds: [result.embed],
      components: result.components || [],
      allowedMentions: { users: result.moderatorIds || [] }
    });
  }

  if (command === "strike") {
    const action = args[0]?.toLowerCase() === "delete" ? "delete" : "add";
    const strikeArgs = ["add", "delete"].includes(args[0]?.toLowerCase()) ? args.slice(1) : args;
    const target = message.mentions.members.first();
    if (!target) {
      const usage = action === "delete"
        ? `${prefix}strike delete @user`
        : `${prefix}strike add @user reason`;
      return message.reply({ embeds: [errorEmbed(`Usage: \`${usage}\``)] });
    }

    if (!canActivateSecurityCommand(message.guild, message.member)) {
      return message.reply({ embeds: [errorEmbed("You must have a role above the bot to use strike commands.")] });
    }

    if (action === "delete") {
      const result = strikeDeleteSelection(message.guild.id, target.id);
      return message.reply({ embeds: [result.embed], components: result.components });
    }

    if (target.user.bot) {
      return message.reply({ embeds: [errorEmbed("Staff strikes can only be given to people, not bots.")] });
    }
    if (!canModerateMember(message.guild, message.member, target)) {
      return message.reply({ embeds: [errorEmbed("You can only give a strike to a member below you in the role hierarchy.")] });
    }

    const reason = strikeArgs.filter(argument => !message.mentions.users.has(argument.replace(/[<@!>]/g, ""))).join(" ").trim();
    if (!reason) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}strike add @user reason\``)] });

    const result = db.transaction(() => {
      const count = db.prepare(`
        SELECT COUNT(*) AS count
        FROM staff_strikes
        WHERE guild_id = ? AND user_id = ?
      `).get(message.guild.id, target.id).count;
      if (count >= 3) return { error: "That staff member already has the maximum of 3/3 strikes." };

      const createdAt = now();
      db.prepare(`
        INSERT INTO staff_strikes (guild_id, user_id, moderator_id, reason, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(message.guild.id, target.id, message.author.id, reason, createdAt);
      return { count: count + 1, createdAt };
    })();
    if (result.error) return message.reply({ embeds: [errorEmbed(result.error)] });

    addModLog(message.guild.id, "staffstrike", target.id, message.author.id, reason);
    let dmStatus = "❌ Failed (DMs may be disabled)";
    try {
      await target.send({
        embeds: [publicEmbed(
          "⚠️ You Received a Staff Strike",
          `You received a staff strike in **${safeText(message.guild.name)}** from ${userMention(message.author.id)}.`,
          0xFEE75C
        ).addFields(
          { name: "Strike Count", value: `${result.count}/3`, inline: true },
          { name: "Reason", value: safeText(reason) }
        )]
      });
      dmStatus = "✅ Sent";
    } catch (error) {
      console.warn(`Could not DM ${target.user.tag} about staff strike:`, error.message);
    }

    return message.reply({
      embeds: [publicEmbed(
        "⚠️ Staff Strike Given",
        `${userMention(target.id)} now has **${result.count}/3** staff strikes.`,
        result.count >= 3 ? 0xED4245 : 0xFEE75C
      ).addFields(
        { name: "Reason", value: safeText(reason) },
        { name: "Given By", value: userMention(message.author.id), inline: true },
        { name: "Date", value: timestamp(result.createdAt), inline: true },
        { name: "DM Status", value: dmStatus, inline: true }
      )]
    });
  }

  if (command === "strikecheck") {
    if (!canActivateSecurityCommand(message.guild, message.member)) {
      return message.reply({ embeds: [errorEmbed("You must have a role above the bot to check staff strikes.")] });
    }

    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}strikecheck @user\``)] });

    const strikes = db.prepare(`
      SELECT id, moderator_id, reason, created_at,
        ROW_NUMBER() OVER (ORDER BY id ASC) AS strike_number
      FROM staff_strikes
      WHERE guild_id = ? AND user_id = ?
      ORDER BY id ASC
    `).all(message.guild.id, target.id);
    return message.reply({ embeds: [staffStrikeEmbed(target, strikes)] });
  }

  if (command === "strikelist") {
    if (!canActivateSecurityCommand(message.guild, message.member)) {
      return message.reply({ embeds: [errorEmbed("You must have a role above the bot to use this command.")] });
    }

    const page = Number.parseInt(args[0], 10) || 1;
    const result = staffStrikeListEmbed(message.guild.id, page);
    if (result.error) return message.reply({ embeds: [errorEmbed(result.error)] });
    return message.reply({ embeds: [result.embed], components: result.components });
  }

  if (command === "unblacklist") {
    const target = message.mentions.members.first();
    const reason = args.slice(1).join(" ");
    if (!target || !reason) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}unblacklist @user reason\``)] });

    const result = await doUnblacklist(message.guild, message.member, target, reason);
    if (result.error) return message.reply({ embeds: [errorEmbed(result.error)] });

    await message.reply({ embeds: [result.embed] });

    const settings = getSettings(message.guild.id);
    if (settings.unblacklist_channel_id) {
      const channel = message.guild.channels.cache.get(settings.unblacklist_channel_id);
      if (channel && channel.isTextBased()) await channel.send({ embeds: [result.embed] }).catch(() => {});
    }

    return;
  }

  if (command === "mute") {
    const target = message.mentions.members.first();
    const duration = args[1];
    const reason = args.slice(2).join(" ") || "No reason provided";

    if (!target || !duration) {
      return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}mute @user 10m [reason]\``)] });
    }

    const result = await doMute(message.guild, message.member, target, duration, reason);
    if (result.error) return message.reply({ embeds: [errorEmbed(result.error)] });

    return message.reply({ embeds: [result.embed] });
  }

  if (command === "modlogs") {
    const moderator = message.mentions.members.first();
    if (!moderator) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}modlogs @moderator\``)] });

    return message.reply({ embeds: [modlogsEmbed(message.guild.id, moderator.id)] });
  }

  if (command === "blacklistcheck") {
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}blacklistcheck @user\``)] });

    const record = db.prepare(`
      SELECT *
      FROM blacklist_records
      WHERE guild_id = ?
      AND user_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(message.guild.id, target.id);

    if (!record) {
      return message.reply({ embeds: [publicEmbed("🔎 Blacklist Check", `${userMention(target.id)} has no blacklist record.`, 0x57F287)] });
    }

    return message.reply({
      embeds: [publicEmbed("🔎 Blacklist Check", `${userMention(target.id)} blacklist record.`, record.active ? 0xED4245 : 0x57F287).addFields(
        { name: "Status", value: record.active ? "⛔ Active" : "✅ Inactive", inline: true },
        { name: "Category", value: record.category, inline: true },
        { name: "Roles Stored", value: String(record.roles_count), inline: true },
        { name: "Reason", value: safeText(record.reason) },
        { name: "Moderator", value: userMention(record.moderator_id), inline: true },
        { name: "Date", value: timestamp(record.created_at), inline: true }
      )]
    });
  }
});

client.on("guildAuditLogEntryCreate", async (entry, guild) => {
  try {
    await handleAntiNukeAuditEntry(entry, guild);
  } catch (error) {
    console.error("Anti-nuke audit handler error:", error);
  }
  try {
    await logServerAuditEntry(entry, guild);
  } catch (error) {
    console.error("Server audit log handler error:", error);
  }
});

client.on("guildMemberAdd", async member => {
  try {
    const community = db.prepare("SELECT * FROM community_settings WHERE guild_id = ?").get(member.guild.id);
    if (community?.autorole_id) {
      const role = member.guild.roles.cache.get(community.autorole_id);
      if (role?.editable) await member.roles.add(role, "Configured autorole").catch(() => {});
    }
    if (community?.welcome_channel_id && community.welcome_message) {
      const channel = member.guild.channels.cache.get(community.welcome_channel_id);
      if (channel?.isTextBased()) {
        const text = community.welcome_message
          .replaceAll("{user}", userMention(member.id))
          .replaceAll("{server}", member.guild.name)
          .replaceAll("{membercount}", String(member.guild.memberCount));
        await channel.send({ content: text }).catch(() => {});
      }
    }
    const security = db.prepare("SELECT * FROM security_settings WHERE guild_id = ?").get(member.guild.id);
    if (security?.antiraid || security?.antibot) {
      const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86400000;
      if ((security.antiraid && accountAgeDays < security.account_age_days) ||
          (security.antibot && member.user.bot)) {
        const details = member.user.bot
          ? "Bot account join blocked by anti-bot protection"
          : `Suspicious account age: ${accountAgeDays.toFixed(1)} days`;
        db.prepare("INSERT INTO security_events (guild_id, user_id, type, details, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(member.guild.id, member.id, "member_join", details, now());
        addModLog(member.guild.id, "security_alert", member.id, member.guild.members.me.id, details);
        if (security.action === "kick" && member.kickable) await member.kick(details).catch(() => {});
        if (security.action === "timeout" && member.moderatable) await member.timeout(10 * 60_000, details).catch(() => {});
      }
    }
    await handleRaidJoin(member);
    await logGuildEvent(member.guild, "👋 Member Joined", `${userMention(member.id)} joined the server.`, 0x5865F2, "members");

    const settings = getSettings(member.guild.id);
    if (settings.auto_ping_enabled && settings.auto_ping_channel_id) {
      const channel = member.guild.channels.cache.get(settings.auto_ping_channel_id);
      const botPermissions = channel?.permissionsFor(member.guild.members.me);
      if (channel && channel.isTextBased() && channel.viewable && botPermissions?.has(PermissionFlagsBits.SendMessages)) {
        const pingMessage = await channel.send({
          content: `<@${member.id}>`,
          allowedMentions: { users: [member.id] }
        }).catch(error => {
          console.warn(`Could not send the join ghost-ping in ${member.guild.name}:`, error.message);
          return null;
        });

        if (pingMessage) {
          ignoreDeleteOf(pingMessage.id);
          setTimeout(() => {
            pingMessage.delete().catch(error => {
              console.warn(`Could not delete the join ghost-ping in ${member.guild.name}:`, error.message);
            });
          }, GHOST_PING_DELAY_MS);
        }
      } else if (channel) {
        console.warn(`Cannot send the join ghost-ping in ${member.guild.name}; check View Channel and Send Messages permissions in ${channel.name}.`);
      }
    }

    const record = db.prepare(`
      SELECT *
      FROM blacklist_records
      WHERE guild_id = ?
      AND user_id = ?
      AND active = 1
      ORDER BY id DESC
      LIMIT 1
    `).get(member.guild.id, member.id);

    if (record) {
      const blacklistRole = getBlacklistRole(member.guild);
      if (blacklistRole && blacklistRole.editable) {
        const rolesToRemove = member.roles.cache.filter(role =>
          role.id !== member.guild.id &&
          role.id !== blacklistRole.id &&
          !role.managed &&
          role.editable
        );
        if (rolesToRemove.size) {
          await member.roles.remove(rolesToRemove, "Apply active blacklist on join").catch(error => {
            console.warn(`Could not remove roles from blacklisted member ${member.user.tag} in ${member.guild.name}:`, error.message);
          });
        }
        await member.roles.add(blacklistRole).catch(error => {
          console.warn(`Could not apply the Blacklisted role to ${member.user.tag} in ${member.guild.name}:`, error.message);
        });
      }
    }
  } catch (error) {
    console.error("guildMemberAdd error:", error);
  }
});

async function initializeBlacklistGuild(guild) {
  const botPermissions = guild.members.me?.permissions;
  if (!botPermissions?.has(PermissionFlagsBits.ManageRoles) ||
      !botPermissions.has(PermissionFlagsBits.ManageChannels)) {
    console.warn(`Could not initialize Blacklisted role protections in ${guild.name}; grant the bot Manage Roles and Manage Channels permissions.`);
    return;
  }

  try {
    await ensureDefaultBlacklistRole(guild);
    const result = await syncBlacklistChannelPermissions(guild);
    if (result.failures.length) {
      console.warn(`Blacklisted role channel restrictions are incomplete in ${guild.name}: ${result.failures.length} channel overwrite(s) failed. Check Manage Channels and Manage Roles permissions.`);
    }
  } catch (error) {
    console.error(`Could not initialize the Blacklisted role in ${guild.name}:`, error);
  }
}

client.on("guildCreate", guild => {
  void initializeBlacklistGuild(guild);
});

client.on("channelCreate", async channel => {
  if (!channel.guild) return;
  try {
    const role = await ensureBlacklistRole(channel.guild);
    const allowedChannelIds = getBlacklistAllowedChannelIds(channel.guild.id);
    await applyBlacklistChannelPermissions(channel.guild, channel, role, allowedChannelIds);
  } catch (error) {
    console.error(`Could not apply Blacklisted role restrictions to new channel ${channel.name} in ${channel.guild.name}:`, error);
  }
});

client.on("channelDelete", channel => {
  if (!channel.guild) return;
  db.prepare("DELETE FROM blacklist_allowed_channels WHERE guild_id = ? AND channel_id = ?")
    .run(channel.guild.id, channel.id);
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const previousTimeout = oldMember.communicationDisabledUntilTimestamp;
  const currentTimeout = newMember.communicationDisabledUntilTimestamp;
  const settings = getSettings(newMember.guild.id);
  const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
  const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

  if (addedRoles.size || removedRoles.size) {
    const legacyLogUsesAuditChannel = settings.server_logs_enabled &&
      settings.log_channel_id &&
      settings.log_channel_id === settings.server_log_channel_id;
    if (!legacyLogUsesAuditChannel) {
      const logText = [];
      if (addedRoles.size) logText.push(`Added: ${addedRoles.map(role => role.name).join(", ")}`);
      if (removedRoles.size) logText.push(`Removed: ${removedRoles.map(role => role.name).join(", ")}`);
      await logGuildEvent(newMember.guild, "🧩 Role Update", `${userMention(newMember.id)}\n${logText.join("\n")}`, 0x5865F2, "roles");
    }
  }

  if (oldMember.nickname !== newMember.nickname) {
    const legacyNicknameLogging = settings.log_channel_id &&
      getEnabledLogEvents(settings).includes("member_updates");
    const serverLogsEnabled = settings.server_logs_enabled && settings.server_log_channel_id;
    const legacyLogUsesAuditChannel = serverLogsEnabled &&
      legacyNicknameLogging &&
      settings.log_channel_id === settings.server_log_channel_id;
    if (legacyNicknameLogging && !legacyLogUsesAuditChannel) {
      const auditEntry = await findRecentAuditEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
      const before = oldMember.nickname || oldMember.user.username;
      const after = newMember.nickname || newMember.user.username;
      const actor = auditEntry?.executorId ? userMention(auditEntry.executorId) : "Unavailable";
      const auditId = auditEntry ? auditEntry.id : "Unavailable";
      await logGuildEvent(
        newMember.guild,
        "✏️ Member Nickname Changed",
        `${userMention(newMember.id)}\nBefore: ${safeText(before)}\nAfter: ${safeText(after)}\nChanged by: ${actor}\nAudit Entry ID: ${auditId}`,
        0x5865F2,
        "member_updates"
      );
    }
  }

  if (!previousTimeout || previousTimeout > Date.now()) return;
  if (currentTimeout && currentTimeout > Date.now()) return;
  if (currentTimeout === previousTimeout) return;

  await newMember.send(`Your timeout in **${newMember.guild.name}** has ended. You can now send messages and interact in the server again.`)
    .catch(error => console.warn(`Could not DM ${newMember.user.tag} about their expired timeout:`, error.message));
});

client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot || !reaction.message.guild) return;
  if (reaction.partial) await reaction.fetch().catch(() => {});
  const emoji = reaction.emoji.id ? reaction.emoji.id : reaction.emoji.name;
  const entry = db.prepare(`
    SELECT role_id FROM reaction_roles
    WHERE guild_id = ? AND message_id = ? AND emoji = ?
  `).get(reaction.message.guild.id, reaction.message.id, emoji);
  if (!entry) return;
  const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
  const role = reaction.message.guild.roles.cache.get(entry.role_id);
  if (member && role?.editable) await member.roles.add(role, "Reaction role").catch(() => {});
});

client.on("messageReactionRemove", async (reaction, user) => {
  if (user.bot || !reaction.message.guild) return;
  if (reaction.partial) await reaction.fetch().catch(() => {});
  const emoji = reaction.emoji.id ? reaction.emoji.id : reaction.emoji.name;
  const entry = db.prepare(`
    SELECT role_id FROM reaction_roles
    WHERE guild_id = ? AND message_id = ? AND emoji = ?
  `).get(reaction.message.guild.id, reaction.message.id, emoji);
  if (!entry) return;
  const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
  const role = reaction.message.guild.roles.cache.get(entry.role_id);
  if (member && role?.editable) await member.roles.remove(role, "Reaction role removed").catch(() => {});
});

client.on("guildMemberRemove", async member => {
  const community = db.prepare("SELECT * FROM community_settings WHERE guild_id = ?").get(member.guild.id);
  if (community?.goodbye_channel_id && community.goodbye_message) {
    const channel = member.guild.channels.cache.get(community.goodbye_channel_id);
    if (channel?.isTextBased()) {
      const text = community.goodbye_message
        .replaceAll("{user}", member.user.tag)
        .replaceAll("{server}", member.guild.name)
        .replaceAll("{membercount}", String(member.guild.memberCount));
      await channel.send({ content: text }).catch(() => {});
    }
  }
  await logGuildEvent(member.guild, "🚪 Member Left", `${userMention(member.id)} left the server.\nJoined: ${timestamp(member.joinedAt?.getTime?.() || Date.now())}`, 0x5865F2, "members");
});

client.on("guildBanAdd", async (ban) => {
  const settings = getSettings(ban.guild.id);
  if (settings.server_logs_enabled && settings.server_log_channel_id === settings.log_channel_id) return;
  await logGuildEvent(ban.guild, "🔒 Member Banned", `${userMention(ban.user.id)} was banned.\nReason: ${safeText(ban.reason || "No reason provided")}`, 0x5865F2, "bans");
});

client.on("guildBanRemove", async (ban) => {
  const settings = getSettings(ban.guild.id);
  if (settings.server_logs_enabled && settings.server_log_channel_id === settings.log_channel_id) return;
  await logGuildEvent(ban.guild, "✅ Member Unbanned", `${userMention(ban.user.id)} was unbanned.`, 0x5865F2, "bans");
});

client.on("messageUpdate", (oldMessage, newMessage) => {
  // Keep the remembered text current so a message edited and then deleted shows its latest wording.
  if (!newMessage.guild || newMessage.content === null || newMessage.content === undefined) return;
  const cached = messageCache.get(newMessage.id);
  if (cached) cached.content = newMessage.content;
});

client.on("messageDelete", async message => {
  try {
    const guild = message.guild;
    if (!guild) return;

    const cached = messageCache.get(message.id);
    messageCache.delete(message.id);
    if (ignoredDeletes.delete(message.id)) return;
    if (!serverLogsActive(guild.id)) return;

    const authorId = message.author?.id || cached?.authorId || null;
    const authorTag = message.author?.tag || cached?.authorTag || null;
    const content = message.content ?? cached?.content ?? null;
    const attachments = message.attachments?.size ? attachmentsOf(message) : (cached?.attachments || []);

    let deletedBy = "Not recorded by Discord (usually the author deleted it)";
    if (authorId) {
      const entry = await findRecentAuditEntry(guild, AuditLogEvent.MessageDelete, authorId);
      if (entry?.executorId && (!entry.extra?.channel?.id || entry.extra.channel.id === message.channelId)) {
        deletedBy = userMention(entry.executorId);
      }
    }

    let shown;
    if (content === null) shown = "*Unknown. I only remember messages I saw since I last started.*";
    else if (!content.trim()) shown = "*(no text)*";
    else shown = content.length > 1000 ? `${content.slice(0, 997)}...` : content;

    const fields = [
      { name: "👤 Author", value: authorId ? `${userMention(authorId)}${authorTag ? ` (${safeText(authorTag)})` : ""}` : "Unknown", inline: true },
      { name: "#️⃣ Channel", value: channelMention(message.channelId), inline: true },
      { name: "🗑️ Deleted by", value: deletedBy, inline: true },
      { name: "💬 Message", value: safeText(shown), inline: false }
    ];
    if (attachments.length) {
      const lines = attachments.slice(0, 5).map(file => `• ${safeText(file.name).slice(0, 60)} — ${file.url}`);
      if (attachments.length > 5) lines.push(`…and ${attachments.length - 5} more`);
      fields.push({ name: "📎 Attachments", value: lines.join("\n").slice(0, 1024), inline: false });
    }
    fields.push({ name: "🆔 Message ID", value: String(message.id), inline: true });

    await sendServerAuditLog(guild, publicEmbed("🗑️ Message Deleted", `A message in ${channelMention(message.channelId)} was deleted.`, 0xED4245).addFields(fields));
  } catch (error) {
    console.error("Deleted message log error:", error);
  }
});

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    const botPermissions = guild.members.me?.permissions;
    const missingPermissions = [];
    if (!botPermissions?.has(PermissionFlagsBits.ViewAuditLog)) missingPermissions.push("View Audit Log");
    if (!botPermissions?.has(PermissionFlagsBits.ManageRoles)) missingPermissions.push("Manage Roles");
    if (!botPermissions?.has(PermissionFlagsBits.ModerateMembers)) missingPermissions.push("Moderate Members");
    if (missingPermissions.length) {
      console.warn(`Anti-nuke/raid protection is limited in ${guild.name}; grant the bot: ${missingPermissions.join(", ")}.`);
    }

    await initializeBlacklistGuild(guild);
    await upgradeReactionRolePanels(guild);
  }

  resumeGiveaways();
  resumeReminders();

  try {
    await registerCommands();
  } catch (error) {
    console.error("❌ Command registration or duplicate cleanup failed; command state may be partially updated:", error);
  }

  // Web dashboard bridge. Disable with DASHBOARD_API_ENABLED=0.
  if (String(process.env.DASHBOARD_API_ENABLED || "1") !== "0") {
    try {
      startDashboardApi({ db, client });
    } catch (error) {
      console.error("❌ Dashboard API failed to start:", error.message);
    }
  }
});

client.login(TOKEN).catch(error => {
  console.error("❌ Discord login failed:", error.message);
  if (/disallowed intents/i.test(error.message)) {
    console.error("   Turn on 'Server Members Intent' and 'Message Content Intent' under Bot > Privileged Gateway Intents in the Discord Developer Portal.");
  } else if (/invalid token|an invalid token/i.test(error.message)) {
    console.error("   DISCORD_TOKEN in your .env is wrong or has been reset. Copy a fresh token from the Developer Portal.");
  }
  process.exit(1);
});
