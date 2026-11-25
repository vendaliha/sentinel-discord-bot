import { useEffect, useState } from "react";
import {
  ErrorNote,
  Field,
  Input,
  Loading,
  Notice,
  Section,
  Select,
  Stat,
} from "../components/Section";
import { sectionsApi } from "../lib/sections";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";

export default function ConfigPage() {
  const { notify } = useDashboard();
  const { data, loading, error, saving, reload, save } = useSection(sectionsApi.config);
  const [form, setForm] = useState({
    prefix: "!",
    logChannelId: "",
    blacklistChannelId: "",
    appealLink: "",
    honeypotChannelId: "",
    antiNukeWhitelist: "",
    blacklistAllowedChannels: "",
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      prefix: data.prefix,
      logChannelId: data.logChannelId ?? "",
      blacklistChannelId: data.blacklistChannelId ?? "",
      appealLink: data.appealLink,
      honeypotChannelId: data.honeypotChannelId ?? "",
      antiNukeWhitelist: data.antiNukeWhitelist.join(", "),
      blacklistAllowedChannels: data.blacklistAllowedChannels.join(", "),
    });
  }, [data]);

  if (loading && !data) return <Loading label="Loading server configuration…" />;
  if (!data) return <ErrorNote message={error || "Could not load server configuration."} onRetry={() => void reload()} />;

  const parseIds = (value: string) =>
    value
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => /^\d{5,25}$/.test(entry));

  async function persist() {
    const result = await save(
      () =>
        sectionsApi.updateConfig({
          prefix: form.prefix,
          logChannelId: form.logChannelId.trim(),
          blacklistChannelId: form.blacklistChannelId.trim(),
          appealLink: form.appealLink.trim(),
          honeypotChannelId: form.honeypotChannelId.trim(),
          antiNukeWhitelist: parseIds(form.antiNukeWhitelist),
          blacklistAllowedChannels: parseIds(form.blacklistAllowedChannels),
        }),
      "Configuration saved",
    );
    notify(result.ok ? "Configuration saved" : result.message || "Could not save the configuration");
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Prefix" value={form.prefix} hint="For legacy text commands" tone="brand" />
        <Stat
          label="Setup"
          value={data.setupComplete ? "Complete" : "Incomplete"}
          hint="Bot onboarding state"
          tone={data.setupComplete ? "good" : "warn"}
        />
        <Stat label="Blacklist channels" value={data.blacklistAllowedChannels.length} hint="Where blacklist commands may run" />
      </div>

      <Section
        title="General configuration"
        description="Written to the settings table — the same rows the bot reads at startup and on every command."
        actions={
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void persist()}>
            {saving ? "Saving…" : "Save configuration"}
          </button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Prefix" hint="Only the prefixes the bot supports">
            <Select
              value={form.prefix}
              onChange={(event) => setForm({ ...form, prefix: event.target.value })}
              options={data.prefixOptions.map((option) => ({ value: option, label: option }))}
            />
          </Field>
          <Field label="Moderation log channel ID" hint={data.logChannelName ? `Currently #${data.logChannelName}` : undefined}>
            <Input value={form.logChannelId} onChange={(event) => setForm({ ...form, logChannelId: event.target.value })} />
          </Field>
          <Field label="Blacklist channel ID">
            <Input
              value={form.blacklistChannelId}
              onChange={(event) => setForm({ ...form, blacklistChannelId: event.target.value })}
            />
          </Field>
          <Field label="Appeal link" hint="Shown to blacklisted members">
            <Input
              value={form.appealLink}
              placeholder="https://…"
              onChange={(event) => setForm({ ...form, appealLink: event.target.value })}
            />
          </Field>
          <Field label="Honeypot channel ID" hint="Used by anti-raid bait channels">
            <Input
              value={form.honeypotChannelId}
              onChange={(event) => setForm({ ...form, honeypotChannelId: event.target.value })}
            />
          </Field>
          <Field label="Anti-nuke whitelist" hint="User IDs, comma separated">
            <Input
              value={form.antiNukeWhitelist}
              onChange={(event) => setForm({ ...form, antiNukeWhitelist: event.target.value })}
            />
          </Field>
          <Field label="Blacklist allowed channels" hint="Channel IDs, comma separated">
            <Input
              value={form.blacklistAllowedChannels}
              onChange={(event) => setForm({ ...form, blacklistAllowedChannels: event.target.value })}
            />
          </Field>
        </div>
      </Section>

      <Section title="Reset and restore" description="The bot ships its own guarded reset and restore commands.">
        <div className="space-y-2 text-xs text-mist-400">
          <p>
            <span className="mono text-mist-200">/resetconfig</span> clears server configuration inside Discord after a
            confirmation prompt. It is deliberately not triggered from the dashboard, so a mis-click cannot wipe a
            server's settings.
          </p>
          <p>
            <span className="mono text-mist-200">/backup</span> and <span className="mono text-mist-200">/restore</span>{" "}
            are handled on the Backups page and by the bot itself. Restoring overwrites the live database and is only
            available from Discord with its confirmation step.
          </p>
        </div>
        <div className="mt-4">
          <Notice tone="neutral">
            Every field on this page is validated by the API before it is written (numeric IDs, http(s) appeal links and
            supported prefixes only).
          </Notice>
        </div>
      </Section>
    </div>
  );
}
