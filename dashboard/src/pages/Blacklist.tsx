import { useMemo, useState } from "react";
import { Badge } from "../components/ui";
import {
  Cell,
  ConfirmButton,
  ErrorNote,
  Input,
  Loading,
  Row,
  Section,
  Select,
  Stat,
  Table,
} from "../components/Section";
import { formatDateTime } from "../lib/format";
import { updateCaseStatus } from "../lib/botApi";
import { sectionsApi } from "../lib/sections";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";

export default function BlacklistPage() {
  const { notify } = useDashboard();
  const [status, setStatus] = useState<"all" | "active" | "resolved">("all");
  const [query, setQuery] = useState("");
  const { data, loading, error, reload } = useSection(() => sectionsApi.blacklist("all"));

  const records = data?.records ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((entry) => {
      if (status === "active" && !entry.active) return false;
      if (status === "resolved" && entry.active) return false;
      if (!needle) return true;
      return `${entry.caseNumber} ${entry.user?.name ?? ""} ${entry.user?.id ?? ""} ${entry.reason} ${entry.moderator}`
        .toLowerCase()
        .includes(needle);
    });
  }, [query, records, status]);

  async function toggle(recordId: number, active: boolean) {
    try {
      await updateCaseStatus(`bl-${recordId}`, active ? "open" : "resolved");
      notify(active ? "Case reopened" : "Case resolved");
      await reload();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "That case could not be updated.");
    }
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total cases" value={data?.counts.total ?? "—"} hint="Never deleted, only resolved" tone="brand" />
        <Stat label="Active" value={data?.counts.active ?? "—"} hint="Currently blacklisted" tone="bad" />
        <Stat
          label="Resolved"
          value={data ? data.counts.total - data.counts.active : "—"}
          hint="History retained"
          tone="good"
        />
      </div>

      <Section
        title="Blacklist records"
        description="Case numbers, categories and stored role counts come straight from the bot's blacklist_records table."
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Input
            placeholder="Search username, Discord ID, reason or case"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search blacklist"
          />
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as "all" | "active" | "resolved")}
            aria-label="Filter blacklist"
            options={[
              { value: "all", label: "All cases" },
              { value: "active", label: "Active only" },
              { value: "resolved", label: "Resolved only" },
            ]}
          />
        </div>

        {loading && !data ? (
          <Loading label="Loading blacklist…" />
        ) : (
          <Table
            head={["Case", "Member", "Category", "Reason", "Moderator", "Roles", "Added", "Status", ""]}
            empty="No blacklist records match this filter."
          >
            {filtered.map((entry) => (
              <Row key={entry.id}>
                <Cell className="mono text-mist-400">#{entry.caseNumber}</Cell>
                <Cell>
                  <span className="text-mist-100">{entry.user?.name ?? "Unknown"}</span>
                  <span className="mono ml-1.5 text-[11px] text-mist-600">{entry.user?.id}</span>
                </Cell>
                <Cell className="capitalize">{entry.category}</Cell>
                <Cell className="max-w-[16rem] truncate" title={entry.reason}>
                  {entry.reason}
                </Cell>
                <Cell>{entry.moderator}</Cell>
                <Cell className="mono text-[11px]">{entry.rolesCount}</Cell>
                <Cell className="whitespace-nowrap text-[11px]">{formatDateTime(entry.createdAt)}</Cell>
                <Cell>
                  <Badge tone={entry.active ? "bad" : "good"}>{entry.active ? "Active" : "Resolved"}</Badge>
                </Cell>
                <Cell>
                  {entry.active ? (
                    <ConfirmButton
                      className="btn-ghost px-2 py-1 text-[11px]"
                      title="Resolve this blacklist case?"
                      message={`The record for ${entry.user?.name ?? entry.user?.id} stays in the history and the blacklist role is removed if the bot is running.`}
                      confirmLabel="Resolve case"
                      onConfirm={() => toggle(entry.id, false)}
                    >
                      Resolve
                    </ConfirmButton>
                  ) : (
                    <ConfirmButton
                      className="btn-ghost px-2 py-1 text-[11px]"
                      title="Reopen this blacklist case?"
                      message="The member is blacklisted again and the blacklist role is restored when the bot is online."
                      confirmLabel="Reopen case"
                      onConfirm={() => toggle(entry.id, true)}
                    >
                      Reopen
                    </ConfirmButton>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
