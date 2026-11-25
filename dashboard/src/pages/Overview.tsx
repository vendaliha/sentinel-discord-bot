import { Link } from "react-router-dom";
import {
  BanIcon,
  BotIcon,
  ClockIcon,
  InboxIcon,
  ShieldIcon,
  SparkleIcon,
  UsersIcon,
} from "../components/icons";
import { BarChart, ErrorNote, Loading, Notice, Section, Stat } from "../components/Section";
import { Badge } from "../components/ui";
import { formatNumber, timeAgo } from "../lib/format";
import { sectionsApi } from "../lib/sections";
import { useSection } from "../lib/useSection";

const quickActions = [
  { to: "/moderation", label: "Review moderation", icon: ShieldIcon },
  { to: "/giveaways", label: "Manage giveaways", icon: SparkleIcon },
  { to: "/tickets", label: "Open tickets", icon: InboxIcon },
  { to: "/security", label: "Security settings", icon: BanIcon },
];

export default function OverviewPage() {
  const { data, loading, error, reload } = useSection(sectionsApi.overview);

  if (loading && !data) return <Loading label="Loading your server…" />;
  if (!data) {
    return <ErrorNote message={error || "Could not load the overview."} onRetry={() => void reload()} />;
  }

  const { stats, bot, guild } = data;

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/25 to-brand-600/10 text-brand-300 ring-1 ring-inset ring-brand-500/25">
            <ShieldIcon size={24} />
          </span>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-mist-500">Workspace</p>
            <h1 className="text-xl font-semibold tracking-tight text-white">{guild.name}</h1>
            <p className="mt-0.5 text-xs text-mist-500">
              {guild.memberCountKnown
                ? `${formatNumber(guild.memberCount ?? 0)} members · ${formatNumber(guild.onlineCount)} online`
                : "Member counts need the running bot"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={bot.live ? "good" : "warn"}>
            <BotIcon size={12} />
            {bot.live ? "Bot connected" : "Bot offline"}
          </Badge>
          <Badge tone="neutral">
            <ClockIcon size={12} />
            Uptime {bot.uptime}
          </Badge>
          <Badge tone="neutral">{bot.version}</Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Members"
          value={guild.memberCountKnown ? formatNumber(guild.memberCount ?? 0) : "—"}
          hint={guild.memberCountKnown ? "In this server" : "Needs the running bot"}
          tone="brand"
        />
        <Stat label="Warnings" value={formatNumber(stats.warnings)} hint="Recorded in the database" />
        <Stat
          label="Blacklists"
          value={formatNumber(stats.blacklistActive)}
          hint={`${formatNumber(stats.blacklistTotal)} cases in total`}
          tone="bad"
        />
        <Stat label="Moderation actions" value={formatNumber(stats.moderationActions)} hint="All logged actions" />
        <Stat label="Active giveaways" value={formatNumber(stats.activeGiveaways)} hint="Running now" tone="good" />
        <Stat label="Open tickets" value={formatNumber(stats.openTickets)} hint="Awaiting staff" tone="warn" />
        <Stat
          label="Security events"
          value={formatNumber(stats.securityEvents7d)}
          hint="Last 7 days"
          tone="bad"
        />
        <Stat label="Staff strikes" value={formatNumber(stats.strikes)} hint="Inside the team" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Section
          title="Moderation activity"
          description="Moderation actions and warnings recorded over the last 14 days."
        >
          <BarChart
            points={data.activity}
            series={[
              { key: "cases", label: "Moderation actions", className: "bg-brand-500/80" },
              { key: "warnings", label: "Warnings", className: "bg-warn/70" },
            ]}
          />
        </Section>

        <Section title="Quick actions" description="Jump straight into the busiest areas.">
          <div className="grid gap-2">
            {quickActions.map((action) => (
              <Link
                key={action.to}
                to={action.to}
                className="flex items-center gap-3 rounded-lg border border-line bg-ink-850 px-3 py-2.5 text-sm text-mist-300 transition-colors hover:border-brand-500/40 hover:text-white"
              >
                <span className="grid size-8 place-items-center rounded-lg bg-ink-800 text-brand-300">
                  <action.icon size={16} />
                </span>
                {action.label}
              </Link>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section
          title="Recent moderation"
          description="Latest actions from the bot's moderation table."
          actions={
            <Link to="/moderation" className="text-xs text-brand-300 hover:text-brand-400">
              View all
            </Link>
          }
        >
          {stats.recent.moderation.length ? (
            <ul className="divide-y divide-line-soft">
              {stats.recent.moderation.map((entry, index) => (
                <li key={`${entry.created_at}-${index}`} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm capitalize text-mist-200">{entry.action.replace(/_/g, " ")}</span>
                  <span className="text-[11px] text-mist-500">{timeAgo(new Date(entry.created_at).toISOString())}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-xs text-mist-500">No moderation actions recorded yet.</p>
          )}
        </Section>

        <Section
          title="Recent security events"
          description="Automod and anti-raid events stored by the bot."
          actions={
            <Link to="/security" className="text-xs text-brand-300 hover:text-brand-400">
              Review security
            </Link>
          }
        >
          {stats.recent.security.length ? (
            <ul className="divide-y divide-line-soft">
              {stats.recent.security.map((entry, index) => (
                <li key={`${entry.created_at}-${index}`} className="py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm capitalize text-mist-200">{entry.type.replace(/_/g, " ")}</span>
                    <span className="text-[11px] text-mist-500">{timeAgo(new Date(entry.created_at).toISOString())}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-mist-500">{entry.details || "No details"}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-xs text-mist-500">No security events recorded yet.</p>
          )}
        </Section>
      </div>

      <Notice tone="neutral">
        Every number here is read from the bot's SQLite database and its live Discord client. Values that
        cannot be retrieved are shown as “—” instead of being estimated.
      </Notice>
    </div>
  );
}
