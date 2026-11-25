import { useMemo, useState } from "react";
import { ErrorNote, Input, Loading, Notice, Section, Stat, ToggleRow } from "../components/Section";
import { Badge } from "../components/ui";
import { sectionsApi } from "../lib/sections";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";

export default function CommandSettingsPage() {
  const { notify } = useDashboard();
  const { data, loading, error, saving, reload, save } = useSection(sectionsApi.permissions);
  const [query, setQuery] = useState("");

  const commands = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = data?.commands ?? [];
    return needle ? list.filter((command) => command.name.includes(needle)) : list;
  }, [data, query]);

  if (loading && !data) return <Loading label="Loading commands…" />;
  if (!data) return <ErrorNote message={error || "Could not load commands."} onRetry={() => void reload()} />;

  const disabled = data.commands.filter((command) => !command.enabled).length;

  async function toggle(command: string, enabled: boolean) {
    const result = await save(() => sectionsApi.updatePermission({ command, enabled }), "Command updated");
    notify(
      result.ok
        ? `/${command} ${enabled ? "enabled" : "disabled"}`
        : result.message || "Could not update that command",
    );
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Commands" value={data.commands.length} hint="Registered by the bot" tone="brand" />
        <Stat label="Enabled" value={data.commands.length - disabled} tone="good" />
        <Stat label="Disabled" value={disabled} tone={disabled ? "warn" : "neutral"} />
      </div>

      <Section
        title="Command switches"
        description="Disabling a command hides it from members without manage permissions. Saved to command_settings and enforced by the bot."
        actions={<Badge tone="neutral">Changes apply immediately</Badge>}
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
            The command registry belongs to the running bot. Start the bot with the dashboard API mounted to list and
            toggle commands here.
          </Notice>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {commands.map((command) => (
            <div
              key={command.name}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ink-850 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="mono truncate text-sm text-mist-100">/{command.name}</p>
                <p className="text-[11px] text-mist-500">
                  {command.roles.length ? `${command.roles.length} role(s) allowed` : "No role restriction"}
                </p>
              </div>
              <ToggleRow
                checked={command.enabled}
                label={`Toggle /${command.name}`}
                disabled={saving}
                onChange={(next) => void toggle(command.name, next)}
              />
            </div>
          ))}
          {!commands.length ? <p className="text-xs text-mist-500">No commands match that search.</p> : null}
        </div>
      </Section>

      <Notice tone="neutral">
        Role-level access is configured on the Permissions page. Both pages write to the same tables the bot reads on
        every command.
      </Notice>
    </div>
  );
}
