import { apiRequest } from "./botApi";

async function send<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const sectionsApi = {
  overview: () => apiRequest<OverviewPayload>("/overview"),
  blacklist: (status: "all" | "active" | "resolved") =>
    apiRequest<BlacklistPayload>(`/blacklist?status=${status}`),
  members: (query: string) =>
    apiRequest<{ members: MemberSummary[] }>(`/members${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  member: (id: string) => apiRequest<MemberDetail>(`/members?id=${encodeURIComponent(id)}`),
  security: () => apiRequest<SecurityPayload>("/security"),
  logs: () => apiRequest<LogsPayload>("/logs"),
  leaderboards: () => apiRequest<LeaderboardsPayload>("/leaderboards"),
  grades: () => apiRequest<GradesPayload>("/grades"),
  giveaways: () => apiRequest<GiveawaysPayload>("/giveaways"),
  tickets: () => apiRequest<TicketsPayload>("/tickets"),
  community: () => apiRequest<CommunityPayload>("/community"),
  roles: () => apiRequest<RolesPayload>("/roles"),
  permissions: () => apiRequest<PermissionsPayload>("/permissions"),
  config: () => apiRequest<ConfigPayload>("/config"),
  backups: () => apiRequest<BackupsPayload>("/backups"),
  bot: () => apiRequest<BotPayload>("/bot"),

  updateTrusted: (body: { trustedRoleIds?: string[]; trustedChannelIds?: string[]; accountAgeDays?: number }) =>
    send<{ ok: boolean }>("/security/trusted", "PATCH", body),
  updateLogs: (body: { channelId?: string; events?: string[] }) => send<{ ok: boolean }>("/logs", "PATCH", body),
  updateCommunity: (body: Record<string, string>) => send<{ ok: boolean }>("/community", "PATCH", body),
  updateConfig: (body: Record<string, unknown>) => send<{ ok: boolean }>("/config", "PATCH", body),
  updatePermission: (body: { command: string; enabled?: boolean; roleIds?: string[] }) =>
    send<{ ok: boolean }>("/permissions", "PATCH", body),
  updateTicketSettings: (body: { categoryId?: string; supportRoleId?: string; openLimit?: number }) =>
    send<{ ok: boolean }>("/tickets", "PATCH", body),
  publishTicketPanel: (body: {
    title: string;
    description: string;
    colour: number;
    footer?: string;
    panelChannelId?: string;
    categoryId?: string;
    supportRoleId?: string;
    openLimit?: number;
  }) => send<{ ok: boolean; messageId: string; channelId: string }>("/tickets/panel", "POST", body),
  createLeaderboard: (body: { name: string; channelId: string }) =>
    send<{ ok: boolean; id: number }>("/leaderboards", "POST", body),
  updateLeaderboard: (id: number, body: { name?: string }) =>
    send<{ ok: boolean }>(`/leaderboards/${id}`, "PATCH", body),
  deleteLeaderboard: (id: number) => send<{ ok: boolean }>(`/leaderboards/${id}`, "DELETE"),
  addPlayer: (id: number, body: Record<string, unknown>) =>
    send<{ ok: boolean }>(`/leaderboards/${id}/players`, "POST", body),
  updatePlayer: (id: number, userId: string, body: Record<string, unknown>) =>
    send<{ ok: boolean }>(`/leaderboards/${id}/players/${userId}`, "PATCH", body),
  removePlayer: (id: number, userId: string) =>
    send<{ ok: boolean }>(`/leaderboards/${id}/players/${userId}`, "DELETE"),
  setScore: (id: number, body: { userId: string; score: number }) =>
    send<{ ok: boolean }>(`/leaderboards/${id}/score`, "POST", body),
  setScoreChannel: (channelId: string) => send<{ ok: boolean }>("/scores/channel", "PATCH", { channelId }),
  assignGrade: (body: { userId: string; grade: string; sub1: string; sub2: string }) =>
    send<{ ok: boolean }>("/grades/assign", "POST", body),
  giveawayAction: (id: number, action: "end" | "reroll" | "delete") =>
    send<{ ok: boolean; winnerIds: string[] | null }>(`/giveaways/${id}/${action}`, "POST", {}),
  updateGiveaway: (id: number, body: { prize?: string; winnerCount?: number }) =>
    send<{ ok: boolean }>(`/giveaways/${id}`, "PATCH", body),
  memberSanction: (id: string, action: "kick" | "ban" | "unban", reason: string) =>
    send<{ ok: boolean }>(`/members/${id}/${action}`, "POST", { reason }),
  createBackup: () => send<{ ok: boolean; file: string; bytes: number; createdAt: string }>("/backups", "POST"),
};

export interface GuildRef {
  id: string;
  name: string;
  memberCount: number | null;
  memberCountKnown?: boolean;
  onlineCount: number;
}

export interface OverviewStats {
  members: number | null;
  onlineMembers: number | null;
  warnings: number;
  strikes: number;
  blacklistActive: number;
  blacklistTotal: number;
  moderationActions: number;
  activeGiveaways: number;
  openTickets: number;
  securityEvents7d: number;
  pendingSuggestions: number;
  leaderboards: number;
  recent: {
    moderation: { action: string; created_at: number }[];
    security: { type: string; details: string | null; created_at: number }[];
  };
}

export interface OverviewPayload {
  stats: OverviewStats;
  activity: { date: string; cases: number; warnings: number }[];
  bot: {
    live: boolean;
    uptime: string;
    latencyMs: number | null;
    version: string;
    shardsOnline: number;
    shardsTotal: number;
  };
  guild: GuildRef;
}

export interface BlacklistRecord {
  id: number;
  caseNumber: number;
  user: { id: string; name: string; tag: string } | null;
  moderator: string;
  category: string;
  reason: string;
  rolesCount: number;
  active: boolean;
  createdAt: string;
}

export interface BlacklistPayload {
  records: BlacklistRecord[];
  counts: { total: number; active: number };
}

export interface MemberSummary {
  id: string;
  name: string;
  tag: string;
  warnings: number;
  strikes: number;
  actions: number;
  blacklisted: boolean;
  firstSeen: string | null;
}

export interface MemberDetail {
  user: { id: string; name: string; tag: string } | null;
  inServer: boolean;
  joinedAt: string | null;
  roles: string[];
  counts: { warnings: number; strikes: number; moderation: number; blacklists: number };
  warnings: { id: number; reason: string; moderator: string; createdAt: string }[];
  strikes: { id: number; reason: string; moderator: string; createdAt: string }[];
  moderation: {
    id: number;
    action: string;
    reason: string | null;
    moderator: string;
    createdAt: string;
    durationMs: number | null;
    channel: string | null;
  }[];
  blacklist: { id: number; caseNumber: number; category: string; reason: string; active: boolean; createdAt: string }[];
}

export interface AutomodRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  action: "warn" | "timeout" | "kick";
  threshold: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  binary: boolean;
  hitsToday: number;
  scope: string;
}

export interface SecurityPayload {
  rules: AutomodRule[];
  action: "warn" | "timeout" | "kick";
  lockdown: boolean;
  accountAgeDays: number;
  spamLimit: number;
  mentionLimit: number;
  trustedRoles: { id: string; name: string | null }[];
  trustedChannels: { id: string; name: string | null }[];
  events: { id: number; type: string; details: string; userId: string | null; createdAt: string }[];
  whitelist: string[];
  honeypotChannelId: string | null;
}

export interface LogsPayload {
  channelId: string | null;
  channelName: string | null;
  serverLogChannelId: string | null;
  serverLogsEnabled: boolean;
  options: { label: string; value: string }[];
  enabled: string[];
  events: {
    id: string;
    kind: string;
    label: string;
    userId: string | null;
    moderatorId?: string | null;
    detail: string | null;
    createdAt: string;
  }[];
  note: string;
}

export interface LeaderboardPlayer {
  userId: string;
  name: string;
  spot: number;
  score: number;
  robloxUsername: string;
  country: string;
  stage: string;
  avatarUrl: string | null;
  updatedAt: string;
}

export interface Leaderboard {
  id: number;
  name: string;
  channelId: string;
  channelName: string | null;
  messageId: string | null;
  createdAt: string;
  players: LeaderboardPlayer[];
}

export interface LeaderboardsPayload {
  boards: Leaderboard[];
  scoreChannelId: string | null;
}

export interface GradesPayload {
  gradeRoles: { name: string; roleId: string | null }[];
  sub1Roles: { name: string; roleId: string | null }[];
  sub2Roles: { name: string; roleId: string | null }[];
  missing: string[];
  guildLoaded: boolean;
  channelId: string | null;
  channelName: string | null;
}

export interface Giveaway {
  id: number;
  prize: string;
  description: string | null;
  host: string;
  winnerCount: number;
  entries: number;
  totalWeight: number;
  winners: string[];
  status: "active" | "ending" | "ended" | "cancelled";
  channelName: string | null;
  endsAt: string;
  createdAt: string;
  endedAt: string | null;
  requiredRoleId: string | null;
  bonusRoleId: string | null;
  bonusEntries: number | null;
  allowBots: boolean;
}

export interface GiveawaysPayload {
  giveaways: Giveaway[];
}

export interface TicketsPayload {
  settings: {
    panelChannelId: string | null;
    panelChannelName: string | null;
    panelMessageId: string | null;
    categoryId: string | null;
    categoryName: string | null;
    supportRoleId: string | null;
    supportRoleName: string | null;
    openLimit: number;
  } | null;
  design: { title: string; description: string; colour: number; footer: string; updatedAt: string | null };
  tickets: {
    id: number;
    number: number;
    status: "open" | "closed";
    user: string;
    userId: string;
    claimedBy: string | null;
    channelName: string | null;
    channelId: string;
    createdAt: string;
    closedAt: string | null;
  }[];
  counts: { open: number; closed: number };
  limitations: string[];
}

export interface CommunityPayload {
  welcome: { channelId: string | null; channelName: string | null; message: string };
  goodbye: { channelId: string | null; channelName: string | null; message: string };
  autoroleId: string | null;
  autoroleName: string | null;
  suggestionChannelId: string | null;
  suggestionChannelName: string | null;
  autoPing: { channelId: string | null; channelName: string | null; enabled: boolean };
  suggestions: { id: number; content: string; status: string; userId: string; createdAt: string }[];
  polls: { id: number; question: string; options: string[]; channelName: string | null; createdBy: string; createdAt: string }[];
  reminders: { id: number; message: string; userId: string; channelName: string | null; remindAt: string }[];
}

export interface RolesPayload {
  autoroleId: string | null;
  autoroleName: string | null;
  blacklistRoleId: string | null;
  blacklistRoleName: string | null;
  gradeChannelId: string | null;
  gradeChannelName: string | null;
  panels: {
    id: number;
    title: string;
    description: string;
    channelName: string | null;
    messageId: string | null;
    roles: { roleId: string; roleName: string | null; emoji: string | null }[];
  }[];
  reactionRoles: {
    id: number;
    emoji: string;
    roleName: string | null;
    roleId: string;
    messageId: string;
    channelName: string | null;
  }[];
}

export interface PermissionsPayload {
  commands: { name: string; enabled: boolean; roles: { id: string; name: string | null }[] }[];
  audit: {
    id: number;
    command: string;
    roleName: string | null;
    roleId: string | null;
    actorId: string;
    action: string;
    createdAt: string;
  }[];
}

export interface ConfigPayload {
  prefix: string;
  prefixOptions: string[];
  logChannelId: string | null;
  logChannelName: string | null;
  blacklistChannelId: string | null;
  blacklistRoleId: string | null;
  appealLink: string;
  setupComplete: boolean;
  honeypotChannelId: string | null;
  blacklistAllowedChannels: string[];
  antiNukeWhitelist: string[];
}

export interface BackupsPayload {
  directory: string;
  files: { name: string; bytes: number; createdAt: string }[];
}

export interface BotPayload {
  online: boolean;
  name: string | null;
  id: string | null;
  avatar: string | null;
  version: string | null;
  uptimeMs: number;
  latencyMs: number | null;
  guilds: number;
  commands: number;
  invite: string | null;
}
