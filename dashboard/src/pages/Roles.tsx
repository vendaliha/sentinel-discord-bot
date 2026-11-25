import { Link } from "react-router-dom";
import { Cell, ErrorNote, Loading, Notice, Row, Section, Stat, Table } from "../components/Section";
import { Badge } from "../components/ui";
import { sectionsApi } from "../lib/sections";
import { useSection } from "../lib/useSection";

export default function RolesPage() {
  const { data, loading, error, reload } = useSection(sectionsApi.roles);

  if (loading && !data) return <Loading label="Loading roles…" />;
  if (!data) return <ErrorNote message={error || "Could not load role data."} onRetry={() => void reload()} />;

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Reaction panels" value={data.panels.length} hint="Interactive role menus" tone="brand" />
        <Stat label="Reaction mappings" value={data.reactionRoles.length} hint="Emoji → role links" />
        <Stat
          label="Grade channel"
          value={data.gradeChannelName || data.gradeChannelId || "Not set"}
          tone={data.gradeChannelId ? "good" : "warn"}
        />
      </div>

      <Section
        title="Automatic roles"
        description="Roles the bot assigns without a command."
        actions={
          <Link to="/community" className="text-xs text-brand-300 hover:text-brand-400">
            Change autorole
          </Link>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-ink-850 p-3">
            <p className="text-[11px] uppercase tracking-wide text-mist-500">Autorole</p>
            <p className="mt-1 text-sm text-mist-100">{data.autoroleName || "Not configured"}</p>
            <p className="mono text-[11px] text-mist-600">{data.autoroleId || "—"}</p>
          </div>
          <div className="rounded-lg border border-line bg-ink-850 p-3">
            <p className="text-[11px] uppercase tracking-wide text-mist-500">Blacklist role</p>
            <p className="mt-1 text-sm text-mist-100">{data.blacklistRoleName || "Not configured"}</p>
            <p className="mono text-[11px] text-mist-600">{data.blacklistRoleId || "—"}</p>
          </div>
          <div className="rounded-lg border border-line bg-ink-850 p-3">
            <p className="text-[11px] uppercase tracking-wide text-mist-500">Grade channel</p>
            <p className="mt-1 text-sm text-mist-100">{data.gradeChannelName || "Not configured"}</p>
            <p className="mono text-[11px] text-mist-600">{data.gradeChannelId || "—"}</p>
          </div>
        </div>
      </Section>

      <Section title="Reaction role panels" description="Posted with /reactionrole; the bot keeps them in sync.">
        {data.panels.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.panels.map((panel) => (
              <div key={panel.id} className="rounded-xl border border-line bg-ink-850 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-mist-100">{panel.title}</p>
                  <Badge tone={panel.messageId ? "good" : "warn"}>{panel.messageId ? "Posted" : "Not posted"}</Badge>
                </div>
                <p className="mt-1 text-[11px] text-mist-500">
                  {panel.channelName ? `#${panel.channelName}` : "Unknown channel"} · {panel.roles.length} option(s)
                </p>
                {panel.description ? <p className="mt-2 text-xs text-mist-400">{panel.description}</p> : null}
                <ul className="mt-3 space-y-1">
                  {panel.roles.map((role) => (
                    <li key={role.roleId} className="flex items-center justify-between gap-2 text-xs text-mist-300">
                      <span>
                        {role.emoji || "•"} {role.roleName || "Unknown role"}
                      </span>
                      <span className="mono text-[11px] text-mist-600">{role.roleId}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-4 text-xs text-mist-500">No reaction role panels yet. Create one in Discord with /reactionrole.</p>
        )}
      </Section>

      <Section title="Reaction mappings" description="Every emoji-to-role link currently active.">
        <Table head={["Emoji", "Role", "Channel", "Message"]} empty="No reaction roles configured.">
          {data.reactionRoles.map((entry) => (
            <Row key={entry.id}>
              <Cell>{entry.emoji}</Cell>
              <Cell>
                {entry.roleName || "Unknown role"}
                <span className="mono ml-1.5 text-[11px] text-mist-600">{entry.roleId}</span>
              </Cell>
              <Cell>{entry.channelName ? `#${entry.channelName}` : "—"}</Cell>
              <Cell className="mono text-[11px]">{entry.messageId}</Cell>
            </Row>
          ))}
        </Table>
      </Section>

      <Notice tone="neutral">
        Role creation, deletion and hierarchy belong to Discord itself. The dashboard manages the bot's automatic and
        reaction roles, which is where permission problems usually come from.
      </Notice>
    </div>
  );
}
