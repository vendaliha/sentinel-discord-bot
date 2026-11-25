import { ErrorNote, Loading, Notice, Section, Stat } from "../components/Section";
import { Avatar, Badge } from "../components/ui";
import { formatNumber, timeAgo } from "../lib/format";
import { sectionsApi } from "../lib/sections";
import { useSection } from "../lib/useSection";

export default function BotPage() {
  const { data, loading, error, reload } = useSection(sectionsApi.bot);

  if (loading && !data) return <Loading label="Loading bot information…" />;
  if (!data) return <ErrorNote message={error || "Could not load bot information."} onRetry={() => void reload()} />;

  const startedAt = data.uptimeMs ? new Date(Date.now() - data.uptimeMs).toISOString() : null;

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-4">
          <Avatar name={data.name || "Sentinel"} hue={268} size={52} src={data.avatar ?? undefined} />
          <div>
            <h1 className="text-lg font-semibold text-white">{data.name || "Sentinel"}</h1>
            <p className="mono text-xs text-mist-500">{data.id || "Not connected"}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={data.online ? "good" : "bad"}>{data.online ? "Connected" : "Offline"}</Badge>
          <Badge tone="neutral">v{data.version || "unknown"}</Badge>
          <Badge tone="neutral">
            <span className="mono">{data.latencyMs ?? "—"} ms</span>
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Servers" value={formatNumber(data.guilds)} hint="Discord guilds the bot is in" tone="brand" />
        <Stat label="Commands" value={formatNumber(data.commands)} hint="Registered slash commands" />
        <Stat
          label="Uptime"
          value={startedAt ? timeAgo(startedAt) : "—"}
          hint={startedAt ? `Started ${new Date(startedAt).toLocaleString()}` : "Needs the running bot"}
          tone="good"
        />
        <Stat label="Latency" value={`${data.latencyMs ?? "—"} ms`} hint="WebSocket heartbeat" />
      </div>

      <Section title="About this deployment" description="Live details read from the running Discord client.">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-ink-850 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-mist-500">Invite link</dt>
            <dd className="mono mt-1 break-all text-xs text-brand-300">{data.invite || "Not configured"}</dd>
          </div>
          <div className="rounded-lg border border-line bg-ink-850 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-mist-500">Available commands</dt>
            <dd className="mt-1 text-xs text-mist-300">{formatNumber(data.commands)} slash commands registered</dd>
          </div>
          <div className="rounded-lg border border-line bg-ink-850 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-mist-500">Database</dt>
            <dd className="mt-1 text-xs text-mist-300">SQLite (better-sqlite3), shared with the bot</dd>
          </div>
          <div className="rounded-lg border border-line bg-ink-850 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-mist-500">Dashboard API</dt>
            <dd className="mt-1 text-xs text-mist-300">node dashboard-api.js · token-authenticated</dd>
          </div>
        </dl>
      </Section>

      <Section title="Diagnostics" description="What the dashboard can and cannot see right now.">
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-mist-400">
          <li>Database reads and writes always work; they do not need the Discord gateway.</li>
          <li>
            Member counts, role names, channel names and every Discord action need the live client
            {data.online ? " — it is connected." : " — it is currently offline."}
          </li>
          <li>When the client is missing, actions return a clear “bot offline” error instead of pretending to succeed.</li>
        </ul>
        <div className="mt-4">
          <Notice tone={data.online ? "good" : "warn"}>
            {data.online
              ? "The bot is connected. Dashboard actions that touch Discord will be applied immediately."
              : "The bot process is not connected. Start it on the host to enable Discord actions; database management still works."}
          </Notice>
        </div>
      </Section>
    </div>
  );
}
