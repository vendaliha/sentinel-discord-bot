import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { formatNumber } from "../lib/format";
import { useDashboard } from "../lib/store";
import {
  AlertIcon,
  BanIcon,
  BoltIcon,
  CheckIcon,
  CloseIcon,
  CogIcon,
  DatabaseIcon,
  GiftIcon,
  InfoIcon,
  KeyIcon,
  LockIcon,
  MenuIcon,
  OverviewIcon,
  RefreshIcon,
  ScrollIcon,
  ShieldIcon,
  SlidersIcon,
  SparkleIcon,
  TicketIcon,
  TrophyIcon,
  UsersIcon,
} from "./icons";
import { Avatar } from "./ui";

const nav = [
  { to: "/", label: "Overview", icon: OverviewIcon, end: true, section: "Workspace" },
  { to: "/moderation", label: "Moderation", icon: ShieldIcon, end: false, section: "Workspace" },
  { to: "/blacklist", label: "Blacklist", icon: BanIcon, end: false, section: "Workspace" },
  { to: "/members", label: "Members", icon: UsersIcon, end: false, section: "Workspace" },
  { to: "/security", label: "Security", icon: SlidersIcon, end: false, section: "Protection" },
  { to: "/logs", label: "Server Logs", icon: ScrollIcon, end: false, section: "Protection" },
  { to: "/leaderboards", label: "Leaderboards", icon: TrophyIcon, end: false, section: "Community" },
  { to: "/grades", label: "Grade Management", icon: SparkleIcon, end: false, section: "Community" },
  { to: "/tickets", label: "Tickets", icon: TicketIcon, end: false, section: "Community" },
  { to: "/giveaways", label: "Giveaways", icon: GiftIcon, end: false, section: "Community" },
  { to: "/community", label: "Community", icon: BoltIcon, end: false, section: "Community" },
  { to: "/roles", label: "Role Management", icon: LockIcon, end: false, section: "Community" },
  { to: "/permissions", label: "Permissions", icon: KeyIcon, end: false, section: "System" },
  { to: "/command-settings", label: "Command Settings", icon: ShieldIcon, end: false, section: "System" },
  { to: "/config", label: "Server Configuration", icon: CogIcon, end: false, section: "System" },
  { to: "/backups", label: "Backups", icon: DatabaseIcon, end: false, section: "System" },
  { to: "/bot", label: "Bot Information", icon: InfoIcon, end: false, section: "System" },
];

const pageTitles: Record<string, string> = {
  "/": "Overview",
  "/moderation": "Moderation",
  "/blacklist": "Blacklist",
  "/members": "Members",
  "/security": "Security",
  "/logs": "Server Logs",
  "/leaderboards": "Leaderboards",
  "/grades": "Grade Management",
  "/tickets": "Tickets",
  "/giveaways": "Giveaways",
  "/community": "Community",
  "/roles": "Role Management",
  "/permissions": "Permissions",
  "/command-settings": "Command Settings",
  "/config": "Server Configuration",
  "/backups": "Backups",
  "/bot": "Bot Information",
};

const sections = ["Workspace", "Protection", "Community", "System"];

export default function Layout() {
  const { data, toasts, source, apiError, loading, refresh, auth, chooseGuild, signOutUser } =
    useDashboard();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const title = pageTitles[location.pathname] ?? "Dashboard";

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col gap-4 border-r border-line bg-ink-900/95 px-3 py-4">
      <div className="flex items-center justify-between px-1.5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-lg shadow-brand-600/30">
            <ShieldIcon size={20} />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight text-white">Sentinel</p>
            <p className="text-[11px] text-mist-500">Moderation suite</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen(false)}
          className="grid size-8 place-items-center rounded-lg text-mist-400 hover:bg-ink-800 hover:text-white lg:hidden"
          aria-label="Close navigation"
        >
          <CloseIcon size={18} />
        </button>
      </div>

      <div className="rounded-xl border border-line bg-ink-850 p-2.5">
        <div className="flex items-center gap-2.5">
          <Avatar name={data.guild.name} hue={data.guild.hue} size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-mist-100">{data.guild.name}</p>
            <p className="text-[11px] text-mist-500">
              {data.guild.memberCountKnown ? `${formatNumber(data.guild.memberCount)} members` : "Member count unavailable"}
            </p>
          </div>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
              source === "live" ? "bg-good/10 text-good" : "bg-warn/10 text-warn"
            }`}
          >
            {source === "live" ? "Live" : "Demo"}
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto pr-1" aria-label="Dashboard navigation">
        {sections.map((section) => (
          <div key={section}>
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-mist-600">
              {section}
            </p>
            <div className="space-y-0.5">
              {nav
                .filter((item) => item.section === section)
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
                        isActive
                          ? "bg-brand-500/12 font-medium text-white ring-1 ring-inset ring-brand-500/25"
                          : "text-mist-400 hover:bg-ink-800 hover:text-mist-100"
                      }`
                    }
                  >
                    <item.icon size={17} />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="rounded-xl border border-line bg-ink-850 p-3">
        <div className="flex items-center justify-between">
          <span
            className={`flex items-center gap-1.5 text-[11px] font-medium ${
              data.bot.live ? "text-good" : "text-warn"
            }`}
          >
            <span className="relative flex size-2">
              <span
                className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${
                  data.bot.live ? "bg-good" : "bg-warn"
                }`}
              />
              <span
                className={`relative inline-flex size-2 rounded-full ${
                  data.bot.live ? "bg-good" : "bg-warn"
                }`}
              />
            </span>
            {data.bot.live ? "Bot online" : source === "live" ? "Database live" : "Demo mode"}
          </span>
          <span className="mono text-[11px] text-mist-500">{data.bot.version}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-mist-400">
          <div>
            <p className="text-mist-600">Latency</p>
            <p className="mono text-mist-200">{data.bot.latencyMs ?? "—"} ms</p>
          </div>
          <div>
            <p className="text-mist-600">Uptime</p>
            <p className="mono text-mist-200">{data.bot.uptime}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen lg:block">{sidebar}</aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation overlay"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 w-72 shadow-2xl">{sidebar}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-ink-950/80 px-4 backdrop-blur-md lg:px-8">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="grid size-9 place-items-center rounded-lg border border-line bg-ink-850 text-mist-300 lg:hidden"
              aria-label="Open navigation"
            >
              <MenuIcon size={18} />
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="max-w-[10rem] truncate text-mist-500">{data.guild.name}</span>
              <span className="text-mist-600">/</span>
              <span className="font-medium text-mist-100">{title}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-line bg-ink-850 px-2.5 py-1 text-[11px] text-mist-400 sm:flex">
              <BoltIcon size={13} className="text-warn" />
              <span className="mono">{formatNumber(data.bot.commandsToday)}</span> actions today
            </span>
            {auth.authenticated && auth.user ? (
              <div className="flex items-center gap-2">
                {auth.guilds.length > 1 ? (
                  <select
                    value={auth.selectedGuild?.id ?? ""}
                    onChange={(event) => void chooseGuild(event.target.value)}
                    className="hidden max-w-[11rem] rounded-lg border border-line bg-ink-850 px-2 py-1.5 text-xs text-mist-300 sm:block"
                    aria-label="Switch server"
                  >
                    {auth.guilds.map((guild) => (
                      <option key={guild.id} value={guild.id}>
                        {guild.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <div className="flex items-center gap-2 rounded-full border border-line bg-ink-850 py-1 pl-1 pr-2.5">
                  <Avatar name={auth.user.name || auth.user.username} hue={268} size={24} />
                  <span className="hidden text-xs text-mist-300 sm:inline">
                    {auth.user.name || auth.user.username}
                  </span>
                </div>
                <button type="button" onClick={() => void signOutUser()} className="btn-ghost px-2.5 py-1.5 text-xs">
                  Sign out
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-full border border-line bg-ink-850 py-1 pl-1 pr-2.5">
                <Avatar name={data.guild.owner} hue={268} size={24} />
                <span className="hidden text-xs text-mist-300 sm:inline">{data.guild.owner}</span>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
          {source === "demo" ? (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/25 bg-warn/5 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <AlertIcon size={16} className="mt-0.5 shrink-0 text-warn" />
                <div>
                  <p className="text-sm font-medium text-warn">Showing demo data</p>
                  <p className="mt-0.5 text-xs text-mist-400">
                    {apiError || "The bot dashboard API is unreachable."} Run{" "}
                    <code className="mono rounded bg-ink-800 px-1 py-0.5 text-mist-300">
                      npm run dashboard-api
                    </code>{" "}
                    or start the bot to load the real database.
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => void refresh()} disabled={loading} className="btn-ghost shrink-0">
                <RefreshIcon size={14} />
                {loading ? "Connecting…" : "Retry"}
              </button>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,22rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-2.5 rounded-lg border border-line bg-ink-800/95 px-3 py-2.5 text-sm text-mist-100 shadow-xl backdrop-blur"
          >
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-good/15 text-good">
              <CheckIcon size={13} />
            </span>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
