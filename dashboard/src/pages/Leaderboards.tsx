import { useEffect, useState } from "react";
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
import { sectionsApi, type LeaderboardPlayer } from "../lib/sections";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";

const emptyAdd = { userId: "", spot: "1", robloxUsername: "", country: "", stage: "" };

export default function LeaderboardsPage() {
  const { notify } = useDashboard();
  const { data, loading, error, saving, reload, save } = useSection(sectionsApi.leaderboards);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState({ name: "", channelId: "" });
  const [add, setAdd] = useState(emptyAdd);
  const [editing, setEditing] = useState<(LeaderboardPlayer & { scoreText: string; spotText: string }) | null>(null);
  const [scoreChannel, setScoreChannel] = useState("");
  const [rename, setRename] = useState("");

  const boards = data?.boards ?? [];
  const selected = boards.find((board) => board.id === selectedId) ?? boards[0] ?? null;

  useEffect(() => {
    if (!data) return;
    setScoreChannel(data.scoreChannelId ?? "");
    if (selected && rename === "") setRename(selected.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedId]);

  useEffect(() => {
    setRename(selected?.name ?? "");
    setEditing(null);
  }, [selected?.id, selected?.name]);

  if (loading && !data) return <Loading label="Loading leaderboards…" />;
  if (!data) {
    return <ErrorNote message={error || "Could not load leaderboards."} onRetry={() => void reload()} />;
  }

  async function run(action: () => Promise<unknown>, message: string) {
    const result = await save(action, message);
    notify(result.ok ? message : result.message || "That change did not save.");
    return result.ok;
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Leaderboards" value={boards.length} hint="In this server" tone="brand" />
        <Stat label="Players listed" value={boards.reduce((total, board) => total + board.players.length, 0)} hint="Across all boards" />
        <Stat
          label="Score channel"
          value={data.scoreChannelId ? "Configured" : "Not set"}
          hint={data.scoreChannelId ?? "Uses a webhook to announce results"}
          tone={data.scoreChannelId ? "good" : "warn"}
        />
      </div>

      <Section
        title="Your leaderboards"
        description="Published embeds are refreshed by the bot after every change made here."
        actions={
          <ConfirmButton
            title="Create a leaderboard?"
            message="A new board is created and published to the chosen channel when the bot is online."
            confirmLabel="Create"
            disabled={!creating.name.trim() || !creating.channelId.trim() || saving}
            onConfirm={() =>
              run(async () => {
                await sectionsApi.createLeaderboard({ name: creating.name.trim(), channelId: creating.channelId.trim() });
                setCreating({ name: "", channelId: "" });
              }, "Leaderboard created")
            }
          >
            Create leaderboard
          </ConfirmButton>
        }
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="New leaderboard name">
            <Input
              value={creating.name}
              placeholder="Season 1 standings"
              onChange={(event) => setCreating({ ...creating, name: event.target.value })}
            />
          </Field>
          <Field label="Channel ID" hint="The channel the board is published in">
            <Input
              value={creating.channelId}
              placeholder="123456789012345678"
              onChange={(event) => setCreating({ ...creating, channelId: event.target.value })}
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {boards.map((board) => (
            <button
              key={board.id}
              type="button"
              onClick={() => setSelectedId(board.id)}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                selected?.id === board.id
                  ? "border-brand-500/40 bg-brand-500/10 text-white"
                  : "border-line bg-ink-850 text-mist-400 hover:text-mist-100"
              }`}
            >
              <span className="block font-medium">{board.name}</span>
              <span className="text-[11px] text-mist-500">
                {board.channelName ? `#${board.channelName}` : board.channelId} · {board.players.length} players
              </span>
            </button>
          ))}
          {!boards.length ? <p className="text-xs text-mist-500">No leaderboards yet — create the first one above.</p> : null}
        </div>
      </Section>

      {selected ? (
        <Section
          title={selected.name}
          description={`Published to ${selected.channelName ? `#${selected.channelName}` : selected.channelId}. Message ${selected.messageId ? "linked" : "will be posted on the next publish"}.`}
          actions={
            <>
              <button
                type="button"
                className="btn-ghost px-2.5 py-1.5 text-xs"
                disabled={saving || !rename.trim()}
                onClick={() => void run(() => sectionsApi.updateLeaderboard(selected.id, { name: rename.trim() }), "Leaderboard renamed")}
              >
                Save name
              </button>
              <ConfirmButton
                title="Delete this leaderboard?"
                message="The board, its players and its published message are removed. This cannot be undone."
                confirmLabel="Delete leaderboard"
                disabled={saving}
                onConfirm={() => run(() => sectionsApi.deleteLeaderboard(selected.id), "Leaderboard deleted")}
              >
                Delete
              </ConfirmButton>
            </>
          }
        >
          <div className="mb-4 max-w-sm">
            <Field label="Leaderboard name">
              <Input value={rename} onChange={(event) => setRename(event.target.value)} />
            </Field>
          </div>

          <Table head={["Spot", "Member", "Roblox", "Country", "Stage", "Score", "Updated", ""]} empty="No players on this board yet.">
            {selected.players.map((player) => (
              <Row key={player.userId}>
                <Cell className="mono">#{player.spot}</Cell>
                <Cell>
                  <span className="text-mist-100">{player.name}</span>
                  <span className="mono ml-1.5 text-[11px] text-mist-600">{player.userId}</span>
                </Cell>
                <Cell>{player.robloxUsername || "—"}</Cell>
                <Cell>{player.country || "—"}</Cell>
                <Cell>{player.stage || "—"}</Cell>
                <Cell className="mono">{player.score}</Cell>
                <Cell className="whitespace-nowrap text-[11px]">{formatDateTime(player.updatedAt)}</Cell>
                <Cell>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-[11px]"
                      onClick={() => setEditing({ ...player, scoreText: String(player.score), spotText: String(player.spot) })}
                    >
                      Edit
                    </button>
                    <ConfirmButton
                      className="btn-ghost px-2 py-1 text-[11px]"
                      title="Remove this player?"
                      message={`${player.name} is removed from ${selected.name} and the board is republished.`}
                      confirmLabel="Remove"
                      onConfirm={() => run(() => sectionsApi.removePlayer(selected.id, player.userId), "Player removed")}
                    >
                      Remove
                    </ConfirmButton>
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>

          {editing ? (
            <div className="mt-4 rounded-xl border border-line bg-ink-850 p-4">
              <p className="mb-3 text-xs font-semibold text-mist-200">Editing {editing.name}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Spot" hint="1–10 · needs the bot">
                  <Input value={editing.spotText} onChange={(event) => setEditing({ ...editing, spotText: event.target.value })} />
                </Field>
                <Field label="Roblox username">
                  <Input value={editing.robloxUsername} onChange={(event) => setEditing({ ...editing, robloxUsername: event.target.value })} />
                </Field>
                <Field label="Country">
                  <Input value={editing.country} onChange={(event) => setEditing({ ...editing, country: event.target.value })} />
                </Field>
                <Field label="Stage / grade">
                  <Input value={editing.stage} onChange={(event) => setEditing({ ...editing, stage: event.target.value })} />
                </Field>
                <Field label="Avatar URL">
                  <Input
                    value={editing.avatarUrl ?? ""}
                    placeholder="https://…"
                    onChange={(event) => setEditing({ ...editing, avatarUrl: event.target.value })}
                  />
                </Field>
                <Field label="Score">
                  <Input value={editing.scoreText} onChange={(event) => setEditing({ ...editing, scoreText: event.target.value })} />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={saving}
                  onClick={async () => {
                    const playerId = editing.userId;
                    const ok = await run(async () => {
                      await sectionsApi.updatePlayer(selected.id, playerId, {
                        robloxUsername: editing.robloxUsername,
                        country: editing.country,
                        stage: editing.stage,
                        avatarUrl: editing.avatarUrl ?? "",
                        ...(Number(editing.spotText) && Number(editing.spotText) !== editing.spot ? { spot: Number(editing.spotText) } : {}),
                      });
                      if (Number(editing.scoreText) !== editing.score) {
                        await sectionsApi.setScore(selected.id, { userId: playerId, score: Number(editing.scoreText) || 0 });
                      }
                    }, "Player updated");
                    if (ok) setEditing(null);
                  }}
                >
                  {saving ? "Saving…" : "Save player"}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-line bg-ink-850 p-4">
            <p className="mb-3 text-xs font-semibold text-mist-200">Add a player</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Discord user ID">
                <Input value={add.userId} placeholder="123456789012345678" onChange={(event) => setAdd({ ...add, userId: event.target.value })} />
              </Field>
              <Field label="Spot">
                <Input value={add.spot} onChange={(event) => setAdd({ ...add, spot: event.target.value })} />
              </Field>
              <Field label="Roblox username">
                <Input value={add.robloxUsername} onChange={(event) => setAdd({ ...add, robloxUsername: event.target.value })} />
              </Field>
              <Field label="Country">
                <Input value={add.country} onChange={(event) => setAdd({ ...add, country: event.target.value })} />
              </Field>
              <Field label="Stage / grade">
                <Input value={add.stage} onChange={(event) => setAdd({ ...add, stage: event.target.value })} />
              </Field>
              <div className="flex items-end">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={saving || !add.userId.trim()}
                  onClick={() =>
                    void run(async () => {
                      await sectionsApi.addPlayer(selected.id, {
                        userId: add.userId.trim(),
                        spot: Number(add.spot) || 1,
                        robloxUsername: add.robloxUsername,
                        country: add.country,
                        stage: add.stage,
                      });
                      setAdd(emptyAdd);
                    }, "Player added")
                  }
                >
                  Add player
                </button>
              </div>
            </div>
          </div>
        </Section>
      ) : null}

      <Section
        title="Score announcement channel"
        description="The bot creates a webhook here and posts score results. Changing it needs the bot online."
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Channel ID">
            <Input value={scoreChannel} onChange={(event) => setScoreChannel(event.target.value)} placeholder="123456789012345678" />
          </Field>
          <div className="flex items-end">
            <button
              type="button"
              className="btn-primary"
              disabled={saving || !scoreChannel.trim()}
              onClick={() => void run(() => sectionsApi.setScoreChannel(scoreChannel.trim()), "Score channel saved")}
            >
              Save channel
            </button>
          </div>
        </div>
        <div className="mt-4">
          <Notice tone="neutral">
            Score recording uses <span className="mono">/score</span> in Discord and the same table; nothing here bypasses the
            bot's weighted match logic.
          </Notice>
        </div>
      </Section>

      <div className="flex flex-wrap gap-2">
        {boards.map((board) => (
          <Badge key={board.id} tone="neutral">
            {board.name}: {board.players.length}
          </Badge>
        ))}
      </div>
    </div>
  );
}
