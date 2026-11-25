export type CaseType = "ban" | "kick" | "mute" | "warn" | "automod" | "blacklist";
export type CaseStatus = "open" | "resolved" | "expired";
export type AutomodAction = "warn" | "timeout" | "kick";

export interface ModCase {
  id: string;
  number: number;
  type: CaseType;
  status: CaseStatus;
  user: { id: string; name: string; tag: string };
  moderator: string;
  reason: string;
  channel: string;
  createdAt: string;
  durationMinutes: number | null;
  notes: string[];
}

export interface AutomodRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  action: AutomodAction;
  threshold: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  binary?: boolean;
  hitsToday: number;
  scope: string;
}

export interface Member {
  id: string;
  name: string;
  tag: string;
  hue: number;
  joinedAt: string;
  roles: string[];
  warnings: number;
  mutedUntil: string | null;
  messages30d: number;
}

export interface GuildSettings {
  prefix: string;
  timezone: string;
  logChannel: string;
  muteRole: string;
  defaultMuteMinutes: number;
  dmOnAction: boolean;
  autoEscalate: boolean;
  deleteTriggerMessages: boolean;
  retentionDays: number;
}

export interface Guild {
  id: string;
  name: string;
  owner: string;
  memberCount: number;
  memberCountKnown?: boolean;
  onlineCount: number;
  createdAt: string;
  hue: number;
}

export interface BotStatus {
  live: boolean;
  uptime: string;
  latencyMs: number | null;
  shardsOnline: number;
  shardsTotal: number;
  version: string;
  commandsToday: number;
  lastRestart: string;
  latencySamples: number[];
}

export interface ActivityPoint {
  date: string;
  cases: number;
  automod: number;
}

export interface TriggerLogEntry {
  id: string;
  ruleId: string;
  user: string;
  action: AutomodAction;
  at: string;
}

export interface RuleHit {
  ruleId: string;
  count: number;
}

export interface DashboardData {
  version: number;
  guild: Guild;
  bot: BotStatus;
  settings: GuildSettings;
  cases: ModCase[];
  members: Member[];
  rules: AutomodRule[];
  activity: ActivityPoint[];
  log: TriggerLogEntry[];
}

export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  ban: "Ban",
  kick: "Kick",
  mute: "Mute",
  warn: "Warn",
  automod: "Automod",
  blacklist: "Blacklist",
};

export const ACTION_LABEL: Record<AutomodAction, string> = {
  warn: "Warn",
  timeout: "Timeout",
  kick: "Kick",
};
