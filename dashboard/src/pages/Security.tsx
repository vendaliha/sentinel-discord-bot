import { useEffect, useState } from "react";
import { Badge } from "../components/ui";
import {
  Cell,
  ErrorNote,
  Field,
  Input,
  Loading,
  Notice,
  Row,
  Section,
  Select,
  Stat,
  Table,
  ToggleRow,
} from "../components/Section";
import { updateSecurityRule } from "../lib/botApi";
import type { AutomodAction } from "../lib/types";
import { formatDateTime } from "../lib/format";
import { sectionsApi } from "../lib/sections";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";

const actionOptions: { value: AutomodAction; label: string }[] = [
  { value: "warn", label: "Warn" },
  { value: "timeout", label: "Timeout" },
  { value: "kick", label: "Kick" },
];

export default function SecurityPage() {
  const { notify } = useDashboard();
  const { data, loading, error, saving, reload, save } = useSection(sectionsApi.security);
  const [trustedRoles, setTrustedRoles] = useState("");
  const [trustedChannels, setTrustedChannels] = useState("");
  const [accountAge, setAccountAge] = useState("0");

  useEffect(() => {
    if (!data) return;
    setTrustedRoles(data.trustedRoles.map((role) => role.id).join(", "));
    setTrustedChannels(data.trustedChannels.map((channel) => channel.id).join(", "));
    setAccountAge(String(data.accountAgeDays));
  }, [data]);

  if (loading && !data) return <Loading label="Loading security settings…" />;
  if (!data) {
    return <ErrorNote message={error || "Could not load security settings."} onRetry={() => void reload()} />;
  }

  const parseIds = (value: string) =>
    value
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => /^\d{5,25}$/.test(entry));

  async function saveTrusted() {
    const result = await save(
      () =>
        sectionsApi.updateTrusted({
          trustedRoleIds: parseIds(trustedRoles),
          trustedChannelIds: parseIds(trustedChannels),
          accountAgeDays: Number(accountAge) || 0,
        }),
      "Security settings saved",
    );
    notify(result.ok ? "Security settings saved" : result.message || "Could not save");
  }

  async function toggleRule(ruleId: string, enabled: boolean) {
    try {
      await updateSecurityRule({ ruleId, enabled });
      notify(enabled ? "Protection enabled" : "Protection paused");
      await reload();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Could not change that rule.");
    }
  }

  async function changeThreshold(ruleId: string, threshold: number) {
    try {
      await updateSecurityRule({ ruleId, threshold });
      await reload();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Could not change the threshold.");
    }
  }

  async function changeAction(ruleId: string, action: AutomodAction) {
    try {
      await updateSecurityRule({ ruleId, action });
      notify(`Action set to ${action}`);
      await reload();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Could not change the action.");
    }
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Active protections" value={data.rules.filter((rule) => rule.enabled).length} hint="Of 6 modules" tone="good" />
        <Stat label="Events today" value={data.rules.reduce((total, rule) => total + rule.hitsToday, 0)} hint="Automod triggers" tone="warn" />
        <Stat label="Raid mode" value={data.lockdown ? "Locked" : "Off"} hint="Channel lockdown state" tone={data.lockdown ? "bad" : "neutral"} />
      </div>

      <Section
        title="Protection modules"
        description="These toggles write straight to security_settings, the same table the bot's /antispam, /antiraid and /raidmode commands use."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {data.rules.map((rule) => (
            <div key={rule.id} className="rounded-xl border border-line bg-ink-850 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-mist-100">{rule.name}</p>
                  <p className="mt-0.5 text-[11px] text-mist-500">{rule.description}</p>
                </div>
                <ToggleRow
                  checked={rule.enabled}
                  label={`Toggle ${rule.name}`}
                  onChange={(next) => void toggleRule(rule.id, next)}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={rule.enabled ? "good" : "neutral"}>{rule.enabled ? "Enabled" : "Paused"}</Badge>
                <Badge tone="neutral">{rule.scope}</Badge>
                <Badge tone={rule.hitsToday ? "warn" : "neutral"}>{rule.hitsToday} today</Badge>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {!rule.binary ? (
                  <Field label={`Threshold (${rule.unit})`}>
                    <Input
                      type="number"
                      min={rule.min}
                      max={rule.max}
                      step={rule.step}
                      defaultValue={rule.threshold}
                      onBlur={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next) && next !== rule.threshold) void changeThreshold(rule.id, next);
                      }}
                    />
                  </Field>
                ) : (
                  <Field label="Threshold">
                    <Input value="On / off" readOnly aria-label={`${rule.name} has no threshold`} />
                  </Field>
                )}
                <Field label="Action">
                  <Select
                    value={rule.action}
                    options={actionOptions}
                    onChange={(event) => void changeAction(rule.id, event.target.value as AutomodAction)}
                    aria-label={`${rule.name} action`}
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Trusted roles and channels"
        description="Members with a trusted role and messages in trusted channels bypass these protections. Paste Discord IDs separated by commas."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Trusted role IDs" hint={`Currently: ${data.trustedRoles.map((role) => role.name || role.id).join(", ") || "none"}`}>
            <Input value={trustedRoles} onChange={(event) => setTrustedRoles(event.target.value)} placeholder="123456789012345678" />
          </Field>
          <Field label="Trusted channel IDs" hint={`Currently: ${data.trustedChannels.map((channel) => channel.name || channel.id).join(", ") || "none"}`}>
            <Input value={trustedChannels} onChange={(event) => setTrustedChannels(event.target.value)} placeholder="123456789012345678" />
          </Field>
          <Field label="Minimum account age (days)" hint="Used by raid protection when anti-raid is enabled.">
            <Input type="number" min={0} max={90} value={accountAge} onChange={(event) => setAccountAge(event.target.value)} />
          </Field>
          <div className="flex items-end">
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveTrusted()}>
              {saving ? "Saving…" : "Save security settings"}
            </button>
          </div>
        </div>
        {data.whitelist.length ? (
          <p className="mt-3 text-[11px] text-mist-500">
            Anti-nuke whitelist: <span className="mono">{data.whitelist.join(", ")}</span>
          </p>
        ) : null}
        <div className="mt-4">
          <Notice tone="neutral">
            Honeypot channel: {data.honeypotChannelId ? <span className="mono">{data.honeypotChannelId}</span> : "not configured"} — change it on the Server Configuration page.
          </Notice>
        </div>
      </Section>

      <Section title="Recent security events" description="From the bot's security_events table.">
        <Table head={["Type", "Details", "Member", "When"]} empty="No security events recorded yet.">
          {data.events.map((event) => (
            <Row key={event.id}>
              <Cell className="capitalize">{event.type.replace(/_/g, " ")}</Cell>
              <Cell className="max-w-[20rem] truncate" title={event.details}>
                {event.details || "—"}
              </Cell>
              <Cell className="mono text-[11px]">{event.userId || "—"}</Cell>
              <Cell className="whitespace-nowrap text-[11px]">{formatDateTime(event.createdAt)}</Cell>
            </Row>
          ))}
        </Table>
      </Section>
    </div>
  );
}
