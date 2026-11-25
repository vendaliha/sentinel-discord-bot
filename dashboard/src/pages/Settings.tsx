import { useEffect, useState } from "react";
import { RefreshIcon } from "../components/icons";
import { SectionHeader, Toggle } from "../components/ui";
import { useDashboard } from "../lib/store";
import type { GuildSettings } from "../lib/types";

const timezones = ["Etc/UTC", "Europe/London", "Europe/Berlin", "America/New_York", "Asia/Tokyo"];
const retentionOptions = [30, 90, 180, 365];

export default function SettingsPage() {
  const { data, saveSettings, resetDemoData, source, capabilities } = useDashboard();
  const [draft, setDraft] = useState<GuildSettings>(data.settings);

  useEffect(() => {
    setDraft(data.settings);
  }, [data.settings]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);

  const update = (patch: Partial<GuildSettings>) =>
    setDraft((current) => ({ ...current, ...patch }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-mist-400">
          Guild configuration for {data.guild.name} · {data.guild.id}
        </p>
        {source === "live" ? (
          <p className="mt-2 rounded-lg border border-line bg-ink-850 px-3 py-2 text-xs text-mist-500">
            Prefix and log channel are written to the bot database.{" "}
            {capabilities.settings.length > 0
              ? "Other values here are dashboard preferences stored in this browser."
              : ""}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <SectionHeader title="General" subtitle="How Sentinel responds to commands" />
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="label">Command prefix</span>
              <input
                value={draft.prefix}
                onChange={(event) => update({ prefix: event.target.value.slice(0, 3) })}
                className="input"
                maxLength={3}
              />
            </label>
            <label>
              <span className="label">Timezone</span>
              <select
                value={draft.timezone}
                onChange={(event) => update({ timezone: event.target.value })}
                className="input"
              >
                {timezones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Log channel</span>
              <input
                value={draft.logChannel}
                onChange={(event) => update({ logChannel: event.target.value })}
                className="input"
              />
            </label>
            <label>
              <span className="label">Mute role</span>
              <input
                value={draft.muteRole}
                onChange={(event) => update({ muteRole: event.target.value })}
                className="input"
              />
            </label>
            <label>
              <span className="label">Default mute (minutes)</span>
              <input
                type="number"
                min={5}
                max={10080}
                value={draft.defaultMuteMinutes}
                onChange={(event) =>
                  update({ defaultMuteMinutes: Math.max(5, Number(event.target.value) || 5) })
                }
                className="input mono"
              />
            </label>
            <label>
              <span className="label">Case retention (days)</span>
              <select
                value={draft.retentionDays}
                onChange={(event) => update({ retentionDays: Number(event.target.value) })}
                className="input"
              >
                {retentionOptions.map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="card p-5">
          <SectionHeader title="Behaviour" subtitle="What happens after an action" />
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-mist-100">DM on action</p>
                <p className="text-xs text-mist-500">Send the member a reason when actioned.</p>
              </div>
              <Toggle
                checked={draft.dmOnAction}
                onChange={(next) => update({ dmOnAction: next })}
                label="Direct message on action"
              />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-mist-100">Auto-escalate</p>
                <p className="text-xs text-mist-500">3 warnings in 30 days becomes a 24h mute.</p>
              </div>
              <Toggle
                checked={draft.autoEscalate}
                onChange={(next) => update({ autoEscalate: next })}
                label="Automatic escalation"
              />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-mist-100">Delete triggers</p>
                <p className="text-xs text-mist-500">Remove the message that fired automod.</p>
              </div>
              <Toggle
                checked={draft.deleteTriggerMessages}
                onChange={(next) => update({ deleteTriggerMessages: next })}
                label="Delete trigger messages"
              />
            </div>
          </div>
        </section>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-xs text-mist-500">
          {dirty
            ? "You have unsaved changes."
            : "All changes saved — this dashboard stores them in your browser."}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void resetDemoData()}
            className="btn-ghost"
            title="Restore the sample guild data"
          >
            <RefreshIcon size={15} />
            Reset demo data
          </button>
          <button
            type="button"
            disabled={!dirty}
            onClick={() => void saveSettings(draft)}
            className="btn-primary"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
