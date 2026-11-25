import { Link } from "react-router-dom";
import { ArrowUpRightIcon, BotIcon, ClockIcon, ShieldIcon, UsersIcon } from "../components/icons";
import { AreaChart, Badge, SectionHeader, Sparkline, StatCard, type Tone } from "../components/ui";
import { formatDate, formatNumber, timeAgo } from "../lib/format";
import { useDashboard } from "../lib/store";
import { CASE_TYPE_LABEL, type CaseStatus, type CaseType } from "../lib/types";

const statusTone: Record<CaseStatus, Tone> = {
  open: "warn",
  resolved: "good",
  expired: "neutral",
};

const typeTone: Record<CaseType, Tone> = {
  ban: "bad",
  kick: "warn",
  mute: "brand",
  warn: "neutral",
  automod: "brand",
  blacklist: "bad",
};

export default function OverviewPage() {
  const { data } = useDashboard();
  const openCases = data.cases.filter((item) => item.status === "open");
  const automodLast7 = data.activity.slice(-7).reduce((sum, point) => sum + point.automod, 0);
  const recent = [...data.cases]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 6);
  const topRules = [...data.rules]
    .filter((rule) => rule.hitsToday > 0)
    .sort((a, b) => b.hitsToday - a.hitsToday);
  const maxHits = Math.max(1, ...topRules.map((rule) => rule.hitsToday));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Overview</h1>
          <p className="mt-1 text-sm text-mist-400">
            {data.guild.name} · moderation activity across the last 14 days
          </p>
        </div>
        <Link to="/cases" className="btn-ghost">
          Review open cases
          <ArrowUpRightIcon size={15} />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Members"
          value={
            data.guild.memberCountKnown === false ? "—" : formatNumber(data.guild.memberCount)
          }
          hint={
            data.guild.memberCountKnown === false
              ? "start the bot for member counts"
              : `${formatNumber(data.guild.onlineCount)} online right now`
          }
          icon={<UsersIcon size={16} />}
        />
        <StatCard
          label="Open cases"
          value={String(openCases.length)}
          hint={`${data.cases.filter((item) => item.status === "resolved").length} resolved recently`}
          icon={<ShieldIcon size={16} />}
          accent={openCases.length > 0 ? "warn" : "good"}
        />
        <StatCard
          label="Automod actions"
          value={formatNumber(automodLast7)}
          hint="triggered in the last 7 days"
          icon={<BotIcon size={16} />}
          accent="brand"
        />
        <StatCard
          label="Bot actions today"
          value={formatNumber(data.bot.commandsToday)}
          hint={
            data.bot.latencyMs === null
              ? "recorded in the bot database"
              : `gateway latency ${data.bot.latencyMs} ms`
          }
          icon={<ClockIcon size={16} />}
          accent="good"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <SectionHeader
            title="Moderation activity"
            subtitle="Cases opened vs. automod triggers, per day"
            action={
              <div className="text-right">
                <p className="mono text-lg font-semibold text-white">
                  {formatNumber(
                    data.activity.reduce((sum, point) => sum + point.cases + point.automod, 0),
                  )}
                </p>
                <p className="text-[11px] text-mist-500">total events</p>
              </div>
            }
          />
          <AreaChart
            labels={data.activity.map((point) =>
              new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            )}
            series={[
              {
                name: "Automod triggers",
                color: "var(--color-brand-400)",
                values: data.activity.map((point) => point.automod),
              },
              {
                name: "Moderation cases",
                color: "var(--color-good)",
                values: data.activity.map((point) => point.cases),
              },
            ]}
          />
        </section>

        <section className="card flex flex-col p-5">
          <SectionHeader
            title="Bot health"
            action={
              <Badge tone={data.bot.live ? "good" : "warn"}>
                <span className={`size-1.5 rounded-full ${data.bot.live ? "bg-good" : "bg-warn"}`} />
                {data.bot.live ? "Operational" : "Gateway offline"}
              </Badge>
            }
          />
          <div className="flex items-end justify-between">
            <div>
              <p className="mono text-3xl font-semibold text-white">{data.bot.uptime}</p>
              <p className="text-[11px] text-mist-500">30-day uptime</p>
            </div>
            <Sparkline values={data.bot.latencySamples} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line-soft pt-4 text-sm">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-mist-600">Latency</dt>
              <dd className="mono mt-0.5 text-mist-100">
                {data.bot.latencyMs === null ? "—" : `${data.bot.latencyMs} ms`}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-mist-600">Shards</dt>
              <dd className="mono mt-0.5 text-mist-100">
                {data.bot.shardsTotal === 0
                  ? "—"
                  : `${data.bot.shardsOnline}/${data.bot.shardsTotal}`}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-mist-600">Version</dt>
              <dd className="mono mt-0.5 text-mist-100">{data.bot.version}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-mist-600">Restarted</dt>
              <dd className="mt-0.5 text-mist-100">{formatDate(data.bot.lastRestart)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between gap-3 border-b border-line-soft p-5">
            <SectionHeader title="Recent cases" subtitle="Latest moderation actions" />
            <Link
              to="/cases"
              className="shrink-0 text-xs font-medium text-brand-400 hover:text-brand-400/80"
            >
              View all
            </Link>
          </div>
          <ul className="divide-y divide-line-soft">
            {recent.map((item) => (
              <li key={item.id}>
                <Link to="/cases" className="flex items-center gap-3 px-5 py-3 hover:bg-ink-800/50">
                  <Badge tone={typeTone[item.type]} className="w-20 justify-center">
                    {CASE_TYPE_LABEL[item.type]}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-mist-100">
                      {item.user.name}
                      <span className="text-mist-600"> · #{item.number}</span>
                    </p>
                    <p className="truncate text-xs text-mist-500">{item.reason}</p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-xs text-mist-400">{timeAgo(item.createdAt)}</p>
                    <p className="text-[11px] text-mist-600">{item.moderator}</p>
                  </div>
                  <Badge tone={statusTone[item.status]}>{item.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5">
          <SectionHeader title="Automod triggers" subtitle="Today, by rule" />
          <ul className="space-y-3">
            {topRules.map((rule) => (
              <li key={rule.id}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-mist-200">{rule.name}</span>
                  <span className="mono text-mist-400">{rule.hitsToday}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400"
                    style={{ width: `${Math.max(6, (rule.hitsToday / maxHits) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <Link
            to="/automod"
            className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:text-brand-400/80"
          >
            Configure rules
            <ArrowUpRightIcon size={13} />
          </Link>
        </section>
      </div>
    </div>
  );
}
