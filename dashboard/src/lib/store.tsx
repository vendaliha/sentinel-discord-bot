import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createSeed } from "./api";
import {
  fetchAuthStatus,
  fetchDashboard,
  runMemberAction,
  selectGuild,
  signOut,
  updateBotSettings,
  updateCaseStatus,
  updateSecurityRule,
  type AuthGuild,
  type AuthUser,
  type DashboardCapabilities,
} from "./botApi";
import type {
  AutomodAction,
  CaseStatus,
  DashboardData,
  GuildSettings,
} from "./types";

const STORAGE_KEY = "sentinel:dashboard:v1";
const OVERLAY_KEY = "sentinel:dashboard:settings-overlay:v1";

/** Settings the bot database has no column for — kept as dashboard preferences. */
const DASHBOARD_ONLY_SETTINGS: Array<keyof GuildSettings> = [
  "timezone",
  "muteRole",
  "defaultMuteMinutes",
  "dmOnAction",
  "autoEscalate",
  "deleteTriggerMessages",
  "retentionDays",
];

type SettingsOverlay = Partial<GuildSettings>;
type Source = "live" | "demo";
type MemberAction = "warn" | "mute" | "unmute";

export interface AuthState {
  loaded: boolean;
  configured: boolean;
  authenticated: boolean;
  setupHint: string | null;
  user: AuthUser | null;
  guilds: AuthGuild[];
  selectedGuild: { id: string; name: string; icon: string | null } | null;
  canModerate: boolean;
  error: string | null;
}

const initialAuth: AuthState = {
  loaded: false,
  configured: false,
  authenticated: false,
  setupHint: null,
  user: null,
  guilds: [],
  selectedGuild: null,
  canModerate: false,
  error: null,
};

interface Toast {
  id: number;
  message: string;
}

interface DashboardContextValue {
  data: DashboardData;
  source: Source;
  loading: boolean;
  apiError: string | null;
  auth: AuthState;
  capabilities: DashboardCapabilities;
  chooseGuild: (guildId: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  toasts: Toast[];
  refresh: () => Promise<void>;
  setRuleEnabled: (ruleId: string, enabled: boolean) => void;
  setRuleThreshold: (ruleId: string, threshold: number) => void;
  setRuleAction: (ruleId: string, action: AutomodAction) => void;
  setCaseStatus: (caseId: string, status: CaseStatus) => Promise<void>;
  warnMember: (memberId: string) => Promise<void>;
  muteMember: (memberId: string) => Promise<void>;
  unmuteMember: (memberId: string) => Promise<void>;
  saveSettings: (settings: GuildSettings) => Promise<void>;
  resetDemoData: () => Promise<void>;
  notify: (message: string) => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

const emptyCapabilities: DashboardCapabilities = {
  settings: [],
  caseStatus: false,
  memberActions: false,
};

function loadStored(): DashboardData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeed();
    const parsed = JSON.parse(raw) as DashboardData;
    if (parsed.version !== createSeed().version) return createSeed();
    return parsed;
  } catch {
    return createSeed();
  }
}

function readOverlay(): SettingsOverlay {
  try {
    return JSON.parse(localStorage.getItem(OVERLAY_KEY) || "{}") as SettingsOverlay;
  } catch {
    return {};
  }
}

function writeOverlay(overlay: SettingsOverlay) {
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay));
  } catch {
    /* storage unavailable — preferences stay in memory */
  }
}

function withOverlay(data: DashboardData): DashboardData {
  return { ...data, settings: { ...data.settings, ...readOverlay() } };
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DashboardData>(loadStored);
  const [source, setSource] = useState<Source>("demo");
  const [capabilities, setCapabilities] = useState<DashboardCapabilities>(emptyCapabilities);
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [auth, setAuth] = useState<AuthState>(initialAuth);
  const toastId = useRef(0);
  const timers = useRef<number[]>([]);
  const thresholdTimers = useRef<Record<string, number>>({});

  useEffect(() => () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    Object.values(thresholdTimers.current).forEach((id) => window.clearTimeout(id));
  }, []);

  useEffect(() => {
    if (source !== "demo") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage may be unavailable — the dashboard still works in memory */
    }
  }, [data, source]);

  const notify = useCallback((message: string) => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, message }]);
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3800);
    timers.current.push(timer);
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const status = await fetchAuthStatus();
      setAuth({
        loaded: true,
        configured: status.authConfigured,
        authenticated: status.authenticated,
        setupHint: status.setupHint,
        user: status.user,
        guilds: status.guilds,
        selectedGuild: status.selectedGuild,
        canModerate: status.canModerate,
        error: null,
      });
      return status;
    } catch (error) {
      setAuth((current) => ({
        ...current,
        loaded: true,
        error:
          error instanceof Error
            ? error.message
            : "Could not check the dashboard sign-in state.",
      }));
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    const result = await fetchDashboard();
    if (result.kind === "live") {
      setSource("live");
      setCapabilities(result.capabilities);
      setApiError(null);
      setData(withOverlay(result.data));
    } else {
      setSource("demo");
      setCapabilities(emptyCapabilities);
      setApiError(result.kind === "unauthorized" ? result.message : result.error);
      setData(loadStored());
      if (result.kind === "unauthorized") await refreshAuth();
    }
    setLoading(false);
  }, [refreshAuth]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = await refreshAuth();
      if (cancelled) return;
      if (status?.authConfigured && !status.authenticated) {
        setLoading(false);
        return;
      }
      if (status?.authenticated && !status.selectedGuild) {
        setLoading(false);
        return;
      }
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, refreshAuth]);

  const reportError = useCallback(
    async (error: unknown) => {
      notify(error instanceof Error ? error.message : "Dashboard API request failed");
      await refresh();
    },
    [notify, refresh],
  );

  const setRuleEnabled = useCallback(
    (ruleId: string, enabled: boolean) => {
      const rule = data.rules.find((item) => item.id === ruleId);
      setData((current) => ({
        ...current,
        rules: current.rules.map((item) =>
          item.id === ruleId ? { ...item, enabled } : item,
        ),
      }));
      notify(`${rule?.name ?? "Rule"} ${enabled ? "enabled" : "paused"}`);
      if (source === "live") {
        updateSecurityRule({ ruleId, enabled }).catch(reportError);
      }
    },
    [data.rules, notify, reportError, source],
  );

  const setRuleThreshold = useCallback(
    (ruleId: string, threshold: number) => {
      setData((current) => ({
        ...current,
        rules: current.rules.map((rule) =>
          rule.id === ruleId ? { ...rule, threshold } : rule,
        ),
      }));
      if (source !== "live") return;
      window.clearTimeout(thresholdTimers.current[ruleId]);
      thresholdTimers.current[ruleId] = window.setTimeout(() => {
        updateSecurityRule({ ruleId, threshold }).catch(reportError);
      }, 400);
    },
    [reportError, source],
  );

  const setRuleAction = useCallback(
    (ruleId: string, action: AutomodAction) => {
      setData((current) => ({
        ...current,
        rules: current.rules.map((rule) => (rule.id === ruleId ? { ...rule, action } : rule)),
      }));
      if (source === "live") {
        updateSecurityRule({ ruleId, action }).catch(reportError);
      }
    },
    [reportError, source],
  );

  const setCaseStatus = useCallback(
    async (caseId: string, status: CaseStatus) => {
      const target = data.cases.find((item) => item.id === caseId);
      const label = `Case #${target?.number ?? "?"}`;
      if (source === "live") {
        try {
          await updateCaseStatus(caseId, status);
          notify(`${label} marked ${status}`);
          await refresh();
        } catch (error) {
          await reportError(error);
        }
        return;
      }
      setData((current) => ({
        ...current,
        cases: current.cases.map((item) => (item.id === caseId ? { ...item, status } : item)),
      }));
      notify(`${label} marked ${status}`);
    },
    [data.cases, notify, refresh, reportError, source],
  );

  const applyMemberAction = useCallback(
    async (memberId: string, action: MemberAction) => {
      const member = data.members.find((item) => item.id === memberId);
      if (!member) return;
      const minutes = data.settings.defaultMuteMinutes;

      if (source === "live") {
        try {
          if (action === "mute") {
            await runMemberAction(memberId, "mute", { minutes });
            notify(`${member.name} muted for ${minutes}m`);
          } else if (action === "unmute") {
            await runMemberAction(memberId, "unmute", {});
            notify(`${member.name} unmuted`);
          } else {
            await runMemberAction(memberId, "warn", {
              reason: "Warned from the Sentinel dashboard",
            });
            notify(`Warning added for ${member.name}`);
          }
          await refresh();
        } catch (error) {
          await reportError(error);
        }
        return;
      }

      if (action === "warn") {
        setData((current) => ({
          ...current,
          members: current.members.map((item) =>
            item.id === memberId ? { ...item, warnings: item.warnings + 1 } : item,
          ),
        }));
        notify(`Warning added for ${member.name} (${member.warnings + 1} total)`);
      } else if (action === "mute") {
        setData((current) => ({
          ...current,
          members: current.members.map((item) =>
            item.id === memberId
              ? { ...item, mutedUntil: new Date(Date.now() + minutes * 60_000).toISOString() }
              : item,
          ),
        }));
        notify(`${member.name} muted for ${minutes}m`);
      } else {
        setData((current) => ({
          ...current,
          members: current.members.map((item) =>
            item.id === memberId ? { ...item, mutedUntil: null } : item,
          ),
        }));
        notify(`${member.name} unmuted`);
      }
    },
    [data.members, data.settings.defaultMuteMinutes, notify, refresh, reportError, source],
  );

  const warnMember = useCallback((id: string) => applyMemberAction(id, "warn"), [applyMemberAction]);
  const muteMember = useCallback((id: string) => applyMemberAction(id, "mute"), [applyMemberAction]);
  const unmuteMember = useCallback((id: string) => applyMemberAction(id, "unmute"), [applyMemberAction]);

  const saveSettings = useCallback(
    async (settings: GuildSettings) => {
      const overlay: SettingsOverlay = {};
      for (const key of DASHBOARD_ONLY_SETTINGS) {
        (overlay as Record<string, unknown>)[key] = settings[key];
      }
      writeOverlay(overlay);
      setData((current) => ({ ...current, settings }));

      if (source !== "live") {
        notify("Settings saved");
        return;
      }
      try {
        await updateBotSettings({ prefix: settings.prefix, logChannel: settings.logChannel });
        notify("Settings saved");
        await refresh();
      } catch (error) {
        await reportError(error);
      }
    },
    [notify, refresh, reportError, source],
  );

  const resetDemoData = useCallback(async () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(OVERLAY_KEY);
    } catch {
      /* ignore */
    }
    if (source === "live") {
      notify("Dashboard preferences reset");
      await refresh();
      return;
    }
    setData(createSeed());
    notify("Demo data reset");
  }, [notify, refresh, source]);

  const chooseGuild = useCallback(
    async (guildId: string) => {
      try {
        await selectGuild(guildId);
        setLoading(true);
        await refreshAuth();
        await refresh();
      } catch (error) {
        notify(error instanceof Error ? error.message : "Could not select that server.");
      }
    },
    [notify, refresh, refreshAuth],
  );

  const signOutUser = useCallback(async () => {
    try {
      await signOut();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not sign out.");
    }
    await refreshAuth();
    setSource("demo");
    setData(loadStored());
  }, [notify, refreshAuth]);

  const value = useMemo<DashboardContextValue>(
    () => ({
      data,
      source,
      loading,
      apiError,
      auth,
      capabilities,
      chooseGuild,
      signOutUser,
      toasts,
      refresh,
      setRuleEnabled,
      setRuleThreshold,
      setRuleAction,
      setCaseStatus,
      warnMember,
      muteMember,
      unmuteMember,
      saveSettings,
      resetDemoData,
      notify,
    }),
    [
      data,
      source,
      loading,
      apiError,
      auth,
      capabilities,
      chooseGuild,
      signOutUser,
      toasts,
      refresh,
      setRuleEnabled,
      setRuleThreshold,
      setRuleAction,
      setCaseStatus,
      warnMember,
      muteMember,
      unmuteMember,
      saveSettings,
      resetDemoData,
      notify,
    ],
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext);
  if (!context) throw new Error("useDashboard must be used inside DashboardProvider");
  return context;
}
