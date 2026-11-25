import { useMemo, useState } from "react";
import { CloseIcon, InboxIcon, SearchIcon } from "../components/icons";
import { Badge, EmptyState, type Tone } from "../components/ui";
import { formatDateTime, formatDuration, timeAgo } from "../lib/format";
import { useDashboard } from "../lib/store";
import {
  CASE_TYPE_LABEL,
  type CaseStatus,
  type CaseType,
  type ModCase,
} from "../lib/types";

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

const types: CaseType[] = ["blacklist", "ban", "kick", "mute", "warn", "automod"];
const statuses: CaseStatus[] = ["open", "resolved", "expired"];

export default function CasesPage() {
  const { data, setCaseStatus } = useDashboard();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | CaseType>("all");
  const [status, setStatus] = useState<"all" | CaseStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cases = useMemo(() => {
    const search = query.trim().toLowerCase();
    return [...data.cases]
      .filter((item) => (type === "all" ? true : item.type === type))
      .filter((item) => (status === "all" ? true : item.status === status))
      .filter((item) =>
        search === ""
          ? true
          : [item.user.name, item.user.tag, item.reason, item.moderator, `#${item.number}`]
              .join(" ")
              .toLowerCase()
              .includes(search),
      )
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [data.cases, query, status, type]);

  const selected = data.cases.find((item) => item.id === selectedId) ?? null;
  const openCount = data.cases.filter((item) => item.status === "open").length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Moderation</h1>
        <p className="mt-1 text-sm text-mist-400">
          {data.cases.length} cases on record · {openCount} awaiting review
        </p>
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line-soft p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-600"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search member, reason or case number"
              className="input pl-9"
              aria-label="Search cases"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={type}
              onChange={(event) => setType(event.target.value as "all" | CaseType)}
              className="input w-auto"
              aria-label="Filter by type"
            >
              <option value="all">All types</option>
              {types.map((item) => (
                <option key={item} value={item}>
                  {CASE_TYPE_LABEL[item]}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as "all" | CaseStatus)}
              className="input w-auto"
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              {statuses.map((item) => (
                <option key={item} value={item}>
                  {item[0].toUpperCase() + item.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {cases.length === 0 ? (
          <EmptyState
            icon={<InboxIcon size={20} />}
            title="No cases match those filters"
            hint="Try a different search term, or clear the type and status filters."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-line-soft text-[11px] uppercase tracking-wide text-mist-600">
                  <th className="px-4 py-2.5 font-medium">Case</th>
                  <th className="px-4 py-2.5 font-medium">Member</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Moderator</th>
                  <th className="px-4 py-2.5 font-medium">Opened</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {cases.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className="cursor-pointer transition-colors hover:bg-ink-800/60"
                  >
                    <td className="mono px-4 py-3 text-mist-400">#{item.number}</td>
                    <td className="px-4 py-3">
                      <p className="text-mist-100">{item.user.name}</p>
                      <p className="text-xs text-mist-500">{item.channel}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={typeTone[item.type]}>{CASE_TYPE_LABEL[item.type]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-mist-300">{item.moderator}</td>
                    <td className="px-4 py-3 text-mist-400">{timeAgo(item.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone[item.status]}>{item.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected ? (
        <CaseDrawer
          item={selected}
          onClose={() => setSelectedId(null)}
          onStatus={(next) => setCaseStatus(selected.id, next)}
        />
      ) : null}
    </div>
  );
}

function CaseDrawer({
  item,
  onClose,
  onStatus,
}: {
  item: ModCase;
  onClose: () => void;
  onStatus: (status: CaseStatus) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close case details"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-ink-900 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div>
            <p className="text-xs text-mist-500">Case</p>
            <h2 className="mono text-xl font-semibold text-white">#{item.number}</h2>
            <div className="mt-2 flex items-center gap-2">
              <Badge tone={typeTone[item.type]}>{CASE_TYPE_LABEL[item.type]}</Badge>
              <Badge tone={statusTone[item.status]}>{item.status}</Badge>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-mist-400 hover:bg-ink-800 hover:text-white"
            aria-label="Close"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div>
            <p className="label">Member</p>
            <p className="text-sm text-mist-100">
              {item.user.name}{" "}
              <span className="mono text-mist-500">#{item.user.tag}</span>
            </p>
          </div>

          <div>
            <p className="label">Reason</p>
            <p className="rounded-lg border border-line-soft bg-ink-850 p-3 text-sm leading-relaxed text-mist-200">
              {item.reason}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="label">Moderator</dt>
              <dd className="text-mist-200">{item.moderator}</dd>
            </div>
            <div>
              <dt className="label">Channel</dt>
              <dd className="text-mist-200">{item.channel}</dd>
            </div>
            <div>
              <dt className="label">Opened</dt>
              <dd className="text-mist-200">{formatDateTime(item.createdAt)}</dd>
            </div>
            <div>
              <dt className="label">Duration</dt>
              <dd className="text-mist-200">{formatDuration(item.durationMinutes)}</dd>
            </div>
          </dl>

          <div>
            <p className="label">Notes</p>
            {item.notes.length === 0 ? (
              <p className="text-xs text-mist-500">No notes added to this case yet.</p>
            ) : (
              <ul className="space-y-2">
                {item.notes.map((note) => (
                  <li
                    key={note}
                    className="rounded-lg border border-line-soft bg-ink-850 p-3 text-xs text-mist-300"
                  >
                    {note}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer className="flex gap-2 border-t border-line p-4">
          {item.id.startsWith("bl-") ? (
            item.status === "open" ? (
              <button
                type="button"
                onClick={() => onStatus("resolved")}
                className="btn-primary flex-1"
              >
                Mark resolved
              </button>
            ) : (
              <button type="button" onClick={() => onStatus("open")} className="btn-ghost flex-1">
                Reopen case
              </button>
            )
          ) : (
            <p className="flex-1 self-center text-xs text-mist-500">
              Bot-recorded actions are immutable — reverse them with the matching Discord command.
            </p>
          )}
          <button type="button" onClick={onClose} className="btn-ghost">
            Close
          </button>
        </footer>
      </aside>
    </div>
  );
}
