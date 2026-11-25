import { useState } from "react";
import { Badge } from "../components/ui";
import {
  Cell,
  ConfirmButton,
  ErrorNote,
  Input,
  Loading,
  Row,
  Section,
  Stat,
  Table,
  Textarea,
} from "../components/Section";
import { formatDateTime } from "../lib/format";
import { runMemberAction } from "../lib/botApi";
import { sectionsApi } from "../lib/sections";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";

export default function MembersPage() {
  const { notify, data: dashboard } = useDashboard();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const list = useSection(() => sectionsApi.members(query), [query]);
  const detail = useSection(
    () => (selected ? sectionsApi.member(selected) : Promise.resolve(null)),
    [selected],
  );

  const muteMinutes = dashboard.settings.defaultMuteMinutes;

  async function act(action: "warn" | "mute" | "unmute") {
    if (!selected) return;
    setBusy(true);
    try {
      await runMemberAction(selected, action, {
        minutes: action === "mute" ? muteMinutes : undefined,
        reason: reason || undefined,
      });
      notify(
        action === "warn"
          ? "Warning recorded"
          : action === "mute"
            ? `Member muted for ${muteMinutes}m`
            : "Timeout cleared",
      );
      setReason("");
      await Promise.all([list.reload(), detail.reload()]);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "That action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function sanction(action: "kick" | "ban" | "unban") {
    if (!selected) return;
    setBusy(true);
    try {
      await sectionsApi.memberSanction(selected, action, reason || "No reason provided");
      notify(action === "kick" ? "Member kicked" : action === "ban" ? "Member banned" : "Ban lifted");
      setReason("");
      await Promise.all([list.reload(), detail.reload()]);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : `That ${action} failed.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {list.error ? <ErrorNote message={list.error} onRetry={() => void list.reload()} /> : null}

      <Section
        title="Members"
        description="Everyone the bot has a record for — warnings, strikes, moderation actions and blacklists."
      >
        <Input
          placeholder="Search by username or Discord ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search members"
          className="mb-4 max-w-md"
        />
        {list.loading && !list.data ? (
          <Loading label="Loading members…" />
        ) : (
          <Table head={["Member", "Warnings", "Strikes", "Actions", "Blacklist", "First seen", ""]} empty="No members recorded yet.">
            {(list.data?.members ?? []).map((member) => (
              <Row key={member.id}>
                <Cell>
                  <span className="text-mist-100">{member.name}</span>
                  <span className="mono ml-1.5 text-[11px] text-mist-600">{member.id}</span>
                </Cell>
                <Cell className="mono">{member.warnings}</Cell>
                <Cell className="mono">{member.strikes}</Cell>
                <Cell className="mono">{member.actions}</Cell>
                <Cell>{member.blacklisted ? <Badge tone="bad">Blacklisted</Badge> : <span className="text-mist-600">—</span>}</Cell>
                <Cell className="whitespace-nowrap text-[11px]">
                  {member.firstSeen ? formatDateTime(member.firstSeen) : "—"}
                </Cell>
                <Cell>
                  <button
                    type="button"
                    className="btn-ghost px-2 py-1 text-[11px]"
                    onClick={() => setSelected(member.id)}
                  >
                    Open
                  </button>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      {selected ? (
        <Section
          title={`Member ${detail.data?.user?.name ?? selected}`}
          description="Full history from the database, with the actions this dashboard can perform."
          actions={
            <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setSelected(null)}>
              Close
            </button>
          }
        >
          {detail.loading && !detail.data ? (
            <Loading label="Loading member history…" />
          ) : detail.data ? (
            <div className="space-y-4">
              {detail.error ? <ErrorNote message={detail.error} onRetry={() => void detail.reload()} /> : null}
              <div className="grid gap-3 sm:grid-cols-4">
                <Stat label="Warnings" value={detail.data.counts.warnings} tone="warn" />
                <Stat label="Strikes" value={detail.data.counts.strikes} tone="bad" />
                <Stat label="Actions" value={detail.data.counts.moderation} />
                <Stat label="Blacklists" value={detail.data.counts.blacklists} tone="bad" />
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <div>
                  <span className="label">Reason (used by every action below)</span>
                  <Textarea
                    rows={2}
                    placeholder="Reason for this action"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => void act("warn")}>
                    Warn
                  </button>
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => void act("mute")}>
                    Mute {muteMinutes}m
                  </button>
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => void act("unmute")}>
                    Unmute
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <ConfirmButton
                  title="Kick this member?"
                  message="Discord removes them from the server. The action is written to the moderation log."
                  confirmLabel="Kick"
                  onConfirm={() => sanction("kick")}
                >
                  Kick
                </ConfirmButton>
                <ConfirmButton
                  title="Ban this member?"
                  message="Discord bans them from the server. The action is written to the moderation log and blacklist logs."
                  confirmLabel="Ban"
                  onConfirm={() => sanction("ban")}
                >
                  Ban
                </ConfirmButton>
                <ConfirmButton
                  title="Unban this user?"
                  message="The ban is lifted in Discord. They need an invite to rejoin."
                  confirmLabel="Unban"
                  onConfirm={() => sanction("unban")}
                >
                  Unban
                </ConfirmButton>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mist-500">Warnings</h3>
                  <Table head={["ID", "Reason", "When"]} empty="No warnings.">
                    {detail.data.warnings.map((entry) => (
                      <Row key={entry.id}>
                        <Cell className="mono">#{entry.id}</Cell>
                        <Cell className="max-w-[14rem] truncate">{entry.reason}</Cell>
                        <Cell className="whitespace-nowrap text-[11px]">{formatDateTime(entry.createdAt)}</Cell>
                      </Row>
                    ))}
                  </Table>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mist-500">Moderation history</h3>
                  <Table head={["Action", "Reason", "When"]} empty="No actions.">
                    {detail.data.moderation.map((entry) => (
                      <Row key={entry.id}>
                        <Cell className="capitalize">{entry.action.replace(/_/g, " ")}</Cell>
                        <Cell className="max-w-[14rem] truncate">{entry.reason ?? "—"}</Cell>
                        <Cell className="whitespace-nowrap text-[11px]">
                          {formatDateTime(entry.createdAt)}
                          {entry.durationMs ? ` · ${Math.round(entry.durationMs / 60000)}m` : ""}
                        </Cell>
                      </Row>
                    ))}
                  </Table>
                </div>
              </div>

              <p className="text-[11px] text-mist-600">
                {detail.data.inServer
                  ? `In server · ${detail.data.roles.length} role(s)${detail.data.joinedAt ? ` · joined ${formatDateTime(detail.data.joinedAt)}` : ""}`
                  : "This member is not in the server right now; Discord actions will fail until they rejoin."}
              </p>
            </div>
          ) : (
            <ErrorNote message={detail.error || "Could not load this member."} onRetry={() => void detail.reload()} />
          )}
        </Section>
      ) : null}
    </div>
  );
}
