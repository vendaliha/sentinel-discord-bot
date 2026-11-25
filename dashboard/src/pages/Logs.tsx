import { useEffect, useState } from "react";
import {
  Cell,
  ErrorNote,
  Field,
  Input,
  Loading,
  Notice,
  Row,
  Section,
  Stat,
  Table,
  ToggleRow,
} from "../components/Section";
import { formatDateTime } from "../lib/format";
import { sectionsApi } from "../lib/sections";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";

export default function LogsPage() {
  const { notify } = useDashboard();
  const { data, loading, error, saving, reload, save } = useSection(sectionsApi.logs);
  const [channelId, setChannelId] = useState("");
  const [enabled, setEnabled] = useState<string[]>([]);

  useEffect(() => {
    if (!data) return;
    setChannelId(data.channelId ?? "");
    setEnabled(data.enabled);
  }, [data]);

  if (loading && !data) return <Loading label="Loading logging settings…" />;
  if (!data) return <ErrorNote message={error || "Could not load logging settings."} onRetry={() => void reload()} />;

  async function persist(nextChannel = channelId, nextEvents = enabled) {
    const result = await save(
      () => sectionsApi.updateLogs({ channelId: nextChannel.trim() || undefined, events: nextEvents }),
      "Logging settings saved",
    );
    notify(result.ok ? "Logging settings saved" : result.message || "Could not save logging settings");
  }

  function toggleEvent(value: string, next: boolean) {
    const updated = next ? [...new Set([...enabled, value])] : enabled.filter((entry) => entry !== value);
    setEnabled(updated);
    void persist(channelId, updated);
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Log channel" value={data.channelName || data.channelId || "Not set"} hint="Moderation log destination" tone="brand" />
        <Stat label="Event categories" value={`${enabled.length}/${data.options.length}`} hint="Recorded to that channel" tone="good" />
        <Stat label="Recent entries" value={data.events.length} hint="Newest first" />
      </div>

      <Section
        title="Moderation log channel"
        description="The bot sends every enabled event to this channel. Leave it empty to stop logging."
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Channel ID" hint={data.channelName ? `Currently #${data.channelName}` : "Paste the channel ID from Discord"}>
            <Input value={channelId} onChange={(event) => setChannelId(event.target.value)} placeholder="123456789012345678" />
          </Field>
          <div className="flex items-end">
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void persist()}>
              {saving ? "Saving…" : "Save channel"}
            </button>
          </div>
        </div>
        {data.serverLogChannelId ? (
          <p className="mt-3 text-[11px] text-mist-500">
            Server audit log channel: <span className="mono">{data.serverLogChannelId}</span> ·{" "}
            {data.serverLogsEnabled ? "enabled" : "disabled"}
          </p>
        ) : null}
      </Section>

      <Section
        title="Recorded events"
        description="Each toggle writes to log_settings immediately and is used by the bot's /setlogs command."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {data.options.map((option) => (
            <div
              key={option.value}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ink-850 px-3 py-2.5"
            >
              <span className="text-sm text-mist-200">{option.label}</span>
              <ToggleRow
                checked={enabled.includes(option.value)}
                label={`Toggle ${option.label}`}
                disabled={saving}
                onChange={(next) => toggleEvent(option.value, next)}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Recent log entries" description="Merged from moderation, audit and security tables.">
        <Table head={["Event", "Member", "Staff", "Detail", "When"]} empty="No log entries recorded yet.">
          {data.events.map((event) => (
            <Row key={event.id}>
              <Cell className="text-mist-100">{event.label}</Cell>
              <Cell className="mono text-[11px]">{event.userId || "—"}</Cell>
              <Cell className="mono text-[11px]">{event.moderatorId || "—"}</Cell>
              <Cell className="max-w-[20rem] truncate" title={event.detail ?? undefined}>
                {event.detail || "—"}
              </Cell>
              <Cell className="whitespace-nowrap text-[11px]">{formatDateTime(event.createdAt)}</Cell>
            </Row>
          ))}
        </Table>
        <div className="mt-4">
          <Notice tone="neutral">{data.note}</Notice>
        </div>
      </Section>
    </div>
  );
}
