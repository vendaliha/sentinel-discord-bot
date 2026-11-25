import { useMemo, useState } from "react";
import { Badge } from "../components/ui";
import { Cell, ErrorNote, Input, Loading, Row, Section, Select, Table } from "../components/Section";
import { formatDateTime } from "../lib/format";
import { updateCaseStatus } from "../lib/botApi";
import { apiRequest } from "../lib/botApi";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";
import type { CaseStatus, CaseType } from "../lib/types";

interface CaseRow {
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

const typeLabels: Record<string, string> = {
  all: "All types",
  blacklist: "Blacklist",
  warn: "Warn",
  mute: "Mute",
  kick: "Kick",
  ban: "Ban",
  automod: "Automod",
};

export default function ModerationPage() {
  const { notify } = useDashboard();
  const { data, loading, error, reload } = useSection(() =>
    apiRequest<{ data: { cases: CaseRow[] } }>("/dashboard"),
  );
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);

  const cases = data?.data.cases ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cases.filter((entry) => {
      if (type !== "all" && entry.type !== type) return false;
      if (status !== "all" && entry.status !== status) return false;
      if (!needle) return true;
      return `${entry.number} ${entry.user.name} ${entry.user.id} ${entry.reason} ${entry.moderator}`
        .toLowerCase()
        .includes(needle);
    });
  }, [cases, query, status, type]);

  async function setCaseStatus(id: string, next: CaseStatus) {
    setBusy(id);
    try {
      await updateCaseStatus(id, next);
      notify(`Case ${next === "resolved" ? "resolved" : "reopened"}`);
      await reload();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "That case could not be updated.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}
      <Section
        title="Moderation cases"
        description="Every action the bot logged, plus blacklist cases. Bot-recorded actions are immutable; blacklist cases can be resolved or reopened."
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Input
            placeholder="Search member, ID, reason or case number"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search cases"
          />
          <Select
            value={type}
            onChange={(event) => setType(event.target.value)}
            aria-label="Filter by type"
            options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))}
          />
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter by status"
            options={[
              { value: "all", label: "All statuses" },
              { value: "open", label: "Open" },
              { value: "resolved", label: "Resolved" },
            ]}
          />
        </div>

        {loading && !data ? (
          <Loading label="Loading cases…" />
        ) : (
          <Table head={["Case", "Type", "Member", "Moderator", "Reason", "Channel", "When", "Status", ""]} empty="No cases match these filters.">
            {filtered.map((entry) => (
              <Row key={entry.id}>
                <Cell className="mono text-mist-400">#{entry.number}</Cell>
                <Cell>
                  <Badge tone={entry.type === "blacklist" ? "bad" : entry.type === "automod" ? "warn" : "neutral"}>
                    {typeLabels[entry.type] ?? entry.type}
                  </Badge>
                </Cell>
                <Cell>
                  <span className="text-mist-100">{entry.user.name}</span>
                  <span className="mono ml-1.5 text-[11px] text-mist-600">{entry.user.id}</span>
                </Cell>
                <Cell>{entry.moderator}</Cell>
                <Cell className="max-w-[16rem] truncate" title={entry.reason}>
                  {entry.reason}
                </Cell>
                <Cell className="text-[11px]">{entry.channel}</Cell>
                <Cell className="whitespace-nowrap text-[11px]">
                  {formatDateTime(entry.createdAt)}
                  {entry.durationMinutes ? ` · ${entry.durationMinutes}m` : ""}
                </Cell>
                <Cell>
                  <Badge tone={entry.status === "open" ? "warn" : "good"}>{entry.status}</Badge>
                </Cell>
                <Cell>
                  {entry.type === "blacklist" ? (
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-[11px]"
                      disabled={busy === entry.id}
                      onClick={() => void setCaseStatus(entry.id, entry.status === "open" ? "resolved" : "open")}
                    >
                      {entry.status === "open" ? "Resolve" : "Reopen"}
                    </button>
                  ) : null}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
