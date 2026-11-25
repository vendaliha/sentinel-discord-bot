import { useMemo, useState } from "react";
import { Cell, ErrorNote, Input, Loading, Notice, Row, Section, Table } from "../components/Section";
import { Badge } from "../components/ui";
import { formatDateTime } from "../lib/format";
import { sectionsApi } from "../lib/sections";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";

export default function PermissionsPage() {
  const { notify } = useDashboard();
  const { data, loading, error, saving, reload, save } = useSection(sectionsApi.permissions);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<{ command: string; roles: string } | null>(null);

  const commands = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = data?.commands ?? [];
    if (!needle) return list;
    return list.filter((command) => command.name.includes(needle));
  }, [data, query]);

  if (loading && !data) return <Loading label="Loading permissions…" />;
  if (!data) return <ErrorNote message={error || "Could not load permissions."} onRetry={() => void reload()} />;

  async function saveRoles(command: string) {
    const roleIds = (draft?.roles ?? "")
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => /^\d{5,25}$/.test(value));
    const result = await save(() => sectionsApi.updatePermission({ command, roleIds }), "Permissions updated");
    notify(result.ok ? `Permissions updated for /${command}` : result.message || "Could not update permissions");
    if (result.ok) setDraft(null);
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <Notice tone="neutral">
        Administrators always keep access: a command with no allowed roles stays available to members with Administrator
        or Manage Server, exactly like the bot's own permission checks.
      </Notice>

      <Section
        title="Command permissions"
        description="Restrict slash commands to specific roles. Saved to command_roles and used by the bot immediately."
      >
        <Input
          className="mb-4 max-w-sm"
          placeholder="Search commands"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search commands"
        />
        {!data.commands.length ? (
          <Notice tone="warn">
            The command registry belongs to the running bot. Start the bot with the dashboard API mounted to manage
            per-command roles here.
          </Notice>
        ) : null}
        <Table head={["Command", "Status", "Allowed roles", ""]} empty="No commands found.">
          {commands.map((command) => (
            <Row key={command.name}>
              <Cell className="mono text-mist-100">/{command.name}</Cell>
              <Cell>
                <Badge tone={command.enabled ? "good" : "neutral"}>{command.enabled ? "Enabled" : "Disabled"}</Badge>
              </Cell>
              <Cell className="text-[11px]">
                {draft?.command === command.name ? (
                  <Input
                    value={draft.roles}
                    placeholder="role IDs separated by commas"
                    onChange={(event) => setDraft({ ...draft, roles: event.target.value })}
                  />
                ) : command.roles.length ? (
                  command.roles.map((role) => role.name || role.id).join(", ")
                ) : (
                  <span className="text-mist-600">Everyone with manage permissions</span>
                )}
              </Cell>
              <Cell>
                {draft?.command === command.name ? (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className="btn-primary px-2 py-1 text-[11px]"
                      disabled={saving}
                      onClick={() => void saveRoles(command.name)}
                    >
                      Save
                    </button>
                    <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={() => setDraft(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost px-2 py-1 text-[11px]"
                    onClick={() =>
                      setDraft({ command: command.name, roles: command.roles.map((role) => role.id).join(", ") })
                    }
                  >
                    Edit roles
                  </button>
                )}
              </Cell>
            </Row>
          ))}
        </Table>
      </Section>

      <Section title="Permission audit" description="Every change recorded by the bot and this dashboard.">
        <Table head={["Command", "Role", "Actor", "Action", "When"]} empty="No permission changes recorded yet.">
          {data.audit.map((entry) => (
            <Row key={entry.id}>
              <Cell className="mono">/{entry.command}</Cell>
              <Cell>{entry.roleName || entry.roleId || "—"}</Cell>
              <Cell className="mono text-[11px]">{entry.actorId}</Cell>
              <Cell className="capitalize">{entry.action}</Cell>
              <Cell className="whitespace-nowrap text-[11px]">{formatDateTime(entry.createdAt)}</Cell>
            </Row>
          ))}
        </Table>
      </Section>
    </div>
  );
}
