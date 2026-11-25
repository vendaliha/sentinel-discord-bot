import { useMemo, useState } from "react";
import { InboxIcon, MuteIcon, SearchIcon, ShieldIcon, UsersIcon } from "../components/icons";
import { Avatar, Badge, EmptyState, StatCard } from "../components/ui";
import { formatDate, formatNumber, timeAgo } from "../lib/format";
import { useDashboard } from "../lib/store";

export default function MembersPage() {
  const { data, warnMember, muteMember, unmuteMember, capabilities } = useDashboard();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");

  const roles = useMemo(
    () => Array.from(new Set(data.members.flatMap((member) => member.roles))).sort(),
    [data.members],
  );

  const members = useMemo(() => {
    const search = query.trim().toLowerCase();
    return data.members
      .filter((member) => (role === "all" ? true : member.roles.includes(role)))
      .filter((member) =>
        search === ""
          ? true
          : `${member.name} ${member.tag} ${member.roles.join(" ")} ${member.id}`
              .toLowerCase()
              .includes(search),
      )
      .sort((a, b) => b.warnings - a.warnings || a.name.localeCompare(b.name));
  }, [data.members, query, role]);

  const now = Date.now();
  const mutedCount = data.members.filter(
    (member) => member.mutedUntil && new Date(member.mutedUntil).getTime() > now,
  ).length;
  const flaggedCount = data.members.filter((member) => member.warnings > 0).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Members</h1>
        <p className="mt-1 text-sm text-mist-400">
          {data.guild.memberCountKnown === false
            ? "Member counts unavailable while the bot is offline"
            : `${formatNumber(data.guild.memberCount)} members`}{" "}
          · {data.members.length} tracked in the moderation database
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Tracked members"
          value={String(data.members.length)}
          hint="appear in warnings or cases"
          icon={<UsersIcon size={16} />}
        />
        <StatCard
          label="Muted now"
          value={String(mutedCount)}
          hint={`default mute ${data.settings.defaultMuteMinutes}m`}
          icon={<MuteIcon size={16} />}
          accent={mutedCount > 0 ? "warn" : "good"}
        />
        <StatCard
          label="With warnings"
          value={String(flaggedCount)}
          hint={
            capabilities.memberActions
              ? "warn and mute from here"
              : "start the bot for member actions"
          }
          icon={<ShieldIcon size={16} />}
          accent={flaggedCount > 0 ? "warn" : "neutral"}
        />
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
              placeholder="Search by name, ID or role"
              className="input pl-9"
              aria-label="Search members"
            />
          </div>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="input w-auto"
            aria-label="Filter by role"
          >
            <option value="all">All roles</option>
            {roles.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        {members.length === 0 ? (
          <EmptyState
            icon={<InboxIcon size={20} />}
            title="No members found"
            hint="Try a different name or ID, or reset the role filter."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-line-soft text-[11px] uppercase tracking-wide text-mist-600">
                  <th className="px-4 py-2.5 font-medium">Member</th>
                  <th className="px-4 py-2.5 font-medium">Roles</th>
                  <th className="px-4 py-2.5 font-medium">Warnings</th>
                  <th className="px-4 py-2.5 font-medium">First seen</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {members.map((member) => {
                  const muted =
                    member.mutedUntil && new Date(member.mutedUntil).getTime() > now;
                  return (
                    <tr key={member.id} className="hover:bg-ink-800/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={member.name} hue={member.hue} size={32} />
                          <div>
                            <p className="text-mist-100">{member.name}</p>
                            <p className="mono text-[11px] text-mist-600">
                              #{member.tag} · {member.id}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {member.roles.length === 0 ? (
                          <span className="text-xs text-mist-600">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {member.roles.map((item) => (
                              <Badge key={item} tone={item === "Moderator" ? "brand" : "neutral"}>
                                {item}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            member.warnings > 0
                              ? "mono font-medium text-warn"
                              : "mono text-mist-500"
                          }
                        >
                          {member.warnings}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-mist-400">
                        {formatDate(member.joinedAt)}
                        <p className="text-[10px] text-mist-600">{timeAgo(member.joinedAt)}</p>
                      </td>
                      <td className="px-4 py-3">
                        {muted ? (
                          <Badge tone="warn">Muted</Badge>
                        ) : (
                          <Badge tone="good">Active</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => void warnMember(member.id)}
                            className="btn-ghost px-2 py-1 text-xs"
                          >
                            Warn
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void (muted ? unmuteMember(member.id) : muteMember(member.id))
                            }
                            className={`px-2 py-1 text-xs ${muted ? "btn-ghost" : "btn-danger"}`}
                          >
                            {muted ? "Unmute" : "Mute"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
