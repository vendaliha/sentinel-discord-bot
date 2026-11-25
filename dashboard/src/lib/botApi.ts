import type { AutomodAction, CaseStatus, DashboardData, GuildSettings } from "./types";

const API_BASE = (import.meta.env.VITE_BOT_API_URL as string | undefined) || "/api";

export interface DashboardCapabilities {
  settings: string[];
  caseStatus: boolean;
  memberActions: boolean;
}

export class DashboardApiError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
    this.code = code;
  }
}

export interface AuthGuild {
  id: string;
  name: string;
  icon: string | null;
  canManage: boolean;
  canModerate: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  avatar: string | null;
}

export interface AuthStatus {
  authConfigured: boolean;
  authenticated: boolean;
  setupHint: string | null;
  user: AuthUser | null;
  guilds: AuthGuild[];
  selectedGuild: { id: string; name: string; icon: string | null } | null;
  canModerate: boolean;
  csrfToken: string | null;
}

export type DashboardResult =
  | { kind: "live"; data: DashboardData; capabilities: DashboardCapabilities }
  | { kind: "unauthorized"; message: string }
  | { kind: "demo"; error: string };

const fallbackCapabilities: DashboardCapabilities = {
  settings: [],
  caseStatus: false,
  memberActions: false,
};

let csrfToken: string | null = null;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });

  if (!response.ok) {
    let message = `Dashboard API request failed (${response.status})`;
    let code: string | null = null;
    try {
      const body = (await response.json()) as { error?: string; code?: string | null };
      if (body?.error) message = body.error;
      code = body?.code ?? null;
    } catch {
      /* non-JSON error body */
    }
    throw new DashboardApiError(message, response.status, code);
  }
  return (await response.json()) as T;
}

export function signInUrl() {
  return `${API_BASE}/auth/login`;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const status = await request<AuthStatus>("/auth/status");
  csrfToken = status.authenticated ? status.csrfToken : null;
  return status;
}

export function signOut() {
  return request<{ ok: boolean }>("/auth/logout", { method: "POST" }).finally(() => {
    csrfToken = null;
  });
}

export function selectGuild(guildId: string) {
  return request<{ ok: boolean; selectedGuild: { id: string; name: string } }>("/auth/guild", {
    method: "POST",
    body: JSON.stringify({ guildId }),
  });
}

export async function fetchDashboard(): Promise<DashboardResult> {
  try {
    const payload = await request<{
      data: DashboardData;
      capabilities?: DashboardCapabilities;
    }>("/dashboard");
    if (!payload?.data?.guild || !Array.isArray(payload.data.rules)) {
      throw new Error("Dashboard API returned an unexpected payload.");
    }
    return {
      kind: "live",
      data: payload.data,
      capabilities: payload.capabilities ?? fallbackCapabilities,
    };
  } catch (error) {
    const unauthorized =
      error instanceof DashboardApiError &&
      (error.status === 401 || error.status === 403 || error.status === 409);
    if (unauthorized) {
      return {
        kind: "unauthorized",
        message: error instanceof Error ? error.message : "Sign in again to continue.",
      };
    }
    return {
      kind: "demo",
      error:
        error instanceof Error
          ? error.message
          : "Could not reach the bot dashboard API.",
    };
  }
}

export function updateSecurityRule(body: {
  ruleId: string;
  enabled?: boolean;
  threshold?: number;
  action?: AutomodAction;
}) {
  return request<{ ok: boolean }>("/security", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function updateBotSettings(body: Pick<GuildSettings, "prefix" | "logChannel">) {
  return request<{ ok: boolean; applied: string[] }>("/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function updateCaseStatus(caseId: string, status: CaseStatus) {
  return request<{ ok: boolean }>(`/cases/${encodeURIComponent(caseId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function runMemberAction(
  userId: string,
  action: "warn" | "mute" | "unmute",
  body: { minutes?: number; reason?: string } = {},
) {
  return request<{ ok: boolean }>(`/members/${userId}/${action}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
