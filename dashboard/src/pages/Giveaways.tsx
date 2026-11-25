import { useState } from "react";
import {
  Cell,
  ConfirmButton,
  ErrorNote,
  Field,
  Input,
  Loading,
  Notice,
  Row,
  Section,
  Stat,
  Table,
} from "../components/Section";
import { Badge } from "../components/ui";
import { formatDateTime } from "../lib/format";
import { sectionsApi, type Giveaway } from "../lib/sections";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";

const statusTone = { active: "good", ending: "warn", ended: "neutral", cancelled: "bad" } as const;

export default function GiveawaysPage() {
  const { notify } = useDashboard();
  const { data, loading, error, saving, reload, save } = useSection(sectionsApi.giveaways);
  const [editing, setEditing] = useState<{ id: number; prize: string; winnerCount: string } | null>(null);

  if (loading && !data) return <Loading label="Loading giveaways…" />;
  if (!data) return <ErrorNote message={error || "Could not load giveaways."} onRetry={() => void reload()} />;

  const giveaways = data.giveaways;
  const active = giveaways.filter((entry) => entry.status === "active" || entry.status === "ending");
  const totalEntries = giveaways.reduce((total, entry) => total + entry.entries, 0);

  async function run(action: () => Promise<unknown>, message: string) {
    const result = await save(action, message);
    notify(result.ok ? message : result.message || "That action failed.");
    return result.ok;
  }

  function rowActions(entry: Giveaway) {
    const live = entry.status === "active" || entry.status === "ending";
    return (
      <div className="flex flex-wrap gap-1.5">
        {live ? (
          <ConfirmButton
            className="btn-ghost px-2 py-1 text-[11px]"
            title="End this giveaway now?"
            message={`${entry.prize} ends immediately, winners are drawn and the message is edited in Discord.`}
            confirmLabel="End giveaway"
            disabled={saving}
            onConfirm={() => run(() => sectionsApi.giveawayAction(entry.id, "end"), "Giveaway ended")}
          >
            End
          </ConfirmButton>
        ) : (
          <ConfirmButton
            className="btn-ghost px-2 py-1 text-[11px]"
            title="Reroll winners?"
            message="New winners are drawn from the same weighted entry pool and announced in the giveaway channel."
            confirmLabel="Reroll"
            disabled={saving}
            onConfirm={() => run(() => sectionsApi.giveawayAction(entry.id, "reroll"), "Winners rerolled")}
          >
            Reroll
          </ConfirmButton>
        )}
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-[11px]"
          onClick={() => setEditing({ id: entry.id, prize: entry.prize, winnerCount: String(entry.winnerCount) })}
        >
          Edit
        </button>
        <ConfirmButton
          className="btn-ghost px-2 py-1 text-[11px]"
          title="Delete this giveaway?"
          message="The giveaway row and its entries are removed from the database and the message is deleted in Discord. Winner history for other giveaways is untouched."
          confirmLabel="Delete"
          disabled={saving}
          onConfirm={() => run(() => sectionsApi.giveawayAction(entry.id, "delete"), "Giveaway deleted")}
        >
          Delete
        </ConfirmButton>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Active" value={active.length} hint="Running right now" tone="good" />
        <Stat label="Ended" value={giveaways.length - active.length} hint="With winner history" />
        <Stat label="Entries" value={totalEntries} hint="Including bonus entries" />
        <Stat label="Giveaways" value={giveaways.length} hint="All time" tone="brand" />
      </div>

      <Notice tone="neutral">
        Giveaways are started from Discord with <span className="mono">/giveaway</span> — the bot's creation flow uses a
        modal that cannot be reproduced here. Everything after creation (edit, end, reroll, delete) is controlled from
        this page.
      </Notice>

      <Section
        title="Active giveaways"
        description="Weighted entries, required roles and bonus roles come straight from giveaway_entries."
      >
        <Table
          head={["Prize", "Host", "Status", "Entries", "Weight", "Winners", "Ends", "Requirements", ""]}
          empty="No giveaways are running."
        >
          {active.map((entry) => (
            <Row key={entry.id}>
              <Cell className="max-w-[14rem] truncate text-mist-100" title={entry.prize}>
                {entry.prize}
              </Cell>
              <Cell>{entry.host}</Cell>
              <Cell>
                <Badge tone={statusTone[entry.status]}>{entry.status}</Badge>
              </Cell>
              <Cell className="mono">{entry.entries}</Cell>
              <Cell className="mono">{entry.totalWeight}</Cell>
              <Cell className="mono">{entry.winnerCount}</Cell>
              <Cell className="whitespace-nowrap text-[11px]">{formatDateTime(entry.endsAt)}</Cell>
              <Cell className="text-[11px]">
                {entry.requiredRoleId ? `role ${entry.requiredRoleId}` : "open to all"}
                {entry.bonusRoleId ? ` · bonus ×${entry.bonusEntries ?? 1}` : ""}
              </Cell>
              <Cell>{rowActions(entry)}</Cell>
            </Row>
          ))}
        </Table>
      </Section>

      <Section title="Giveaway history" description="Ended and cancelled giveaways with their stored winners.">
        <Table head={["Prize", "Host", "Status", "Entries", "Winners", "Ended", ""]} empty="No finished giveaways yet.">
          {giveaways
            .filter((entry) => entry.status === "ended" || entry.status === "cancelled")
            .map((entry) => (
              <Row key={entry.id}>
                <Cell className="max-w-[14rem] truncate text-mist-100" title={entry.prize}>
                  {entry.prize}
                </Cell>
                <Cell>{entry.host}</Cell>
                <Cell>
                  <Badge tone={statusTone[entry.status]}>{entry.status}</Badge>
                </Cell>
                <Cell className="mono">{entry.entries}</Cell>
                <Cell className="text-[11px]">{entry.winners.length ? entry.winners.join(", ") : "—"}</Cell>
                <Cell className="whitespace-nowrap text-[11px]">{entry.endedAt ? formatDateTime(entry.endedAt) : "—"}</Cell>
                <Cell>{rowActions(entry)}</Cell>
              </Row>
            ))}
        </Table>
      </Section>

      {editing ? (
        <Section title="Edit giveaway" description="Prize text and winner count only, matching what /giveawayedit can change.">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Prize">
              <Input value={editing.prize} onChange={(event) => setEditing({ ...editing, prize: event.target.value })} />
            </Field>
            <Field label="Winner count">
              <Input
                type="number"
                min={1}
                max={20}
                value={editing.winnerCount}
                onChange={(event) => setEditing({ ...editing, winnerCount: event.target.value })}
              />
            </Field>
            <div className="flex items-end gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={saving}
                onClick={async () => {
                  const id = editing.id;
                  const ok = await run(
                    () =>
                      sectionsApi.updateGiveaway(id, {
                        prize: editing.prize.trim(),
                        winnerCount: Math.max(1, Number(editing.winnerCount) || 1),
                      }),
                    "Giveaway updated",
                  );
                  if (ok) setEditing(null);
                }}
              >
                Save
              </button>
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
