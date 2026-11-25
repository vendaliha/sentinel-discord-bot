import { useEffect, useState } from "react";
import {
  Cell,
  ErrorNote,
  Field,
  Input,
  Loading,
  Notice,
  Row,
  Section,
  Stat,
  Table,
  Textarea,
} from "../components/Section";
import { Badge } from "../components/ui";
import { formatDateTime } from "../lib/format";
import { sectionsApi } from "../lib/sections";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";

const placeholders = "{user} mentions the member, {server} the server name, {memberCount} the member count.";

export default function CommunityPage() {
  const { notify } = useDashboard();
  const { data, loading, error, saving, reload, save } = useSection(sectionsApi.community);
  const [form, setForm] = useState({
    welcomeChannelId: "",
    welcomeMessage: "",
    goodbyeChannelId: "",
    goodbyeMessage: "",
    autoroleId: "",
    suggestionChannelId: "",
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      welcomeChannelId: data.welcome.channelId ?? "",
      welcomeMessage: data.welcome.message,
      goodbyeChannelId: data.goodbye.channelId ?? "",
      goodbyeMessage: data.goodbye.message,
      autoroleId: data.autoroleId ?? "",
      suggestionChannelId: data.suggestionChannelId ?? "",
    });
  }, [data]);

  if (loading && !data) return <Loading label="Loading community settings…" />;
  if (!data) return <ErrorNote message={error || "Could not load community settings."} onRetry={() => void reload()} />;

  async function persist() {
    const result = await save(
      () =>
        sectionsApi.updateCommunity({
          welcomeChannelId: form.welcomeChannelId.trim(),
          welcomeMessage: form.welcomeMessage.trim(),
          goodbyeChannelId: form.goodbyeChannelId.trim(),
          goodbyeMessage: form.goodbyeMessage.trim(),
          autoroleId: form.autoroleId.trim(),
          suggestionChannelId: form.suggestionChannelId.trim(),
        }),
      "Community settings saved",
    );
    notify(result.ok ? "Community settings saved" : result.message || "Could not save community settings");
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Welcome" value={data.welcome.channelName ? `#${data.welcome.channelName}` : "Not set"} tone={data.welcome.channelId ? "good" : "warn"} />
        <Stat label="Goodbye" value={data.goodbye.channelName ? `#${data.goodbye.channelName}` : "Not set"} tone={data.goodbye.channelId ? "good" : "warn"} />
        <Stat label="Auto role" value={data.autoroleName || data.autoroleId || "Not set"} />
        <Stat
          label="Auto ping"
          value={data.autoPing.enabled ? "On" : "Off"}
          hint={data.autoPing.channelName ? `#${data.autoPing.channelName}` : "No channel"}
          tone={data.autoPing.enabled ? "good" : "neutral"}
        />
      </div>

      <Section
        title="Welcome and goodbye"
        description="Written to community_settings — the same table /welcome-setup and /goodbye-setup use."
        actions={
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void persist()}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-line bg-ink-850 p-4">
            <p className="text-sm font-medium text-mist-100">Welcome message</p>
            <Field label="Channel ID" hint={data.welcome.channelName ? `Currently #${data.welcome.channelName}` : "Where new members are greeted"}>
              <Input
                value={form.welcomeChannelId}
                onChange={(event) => setForm({ ...form, welcomeChannelId: event.target.value })}
                placeholder="123456789012345678"
              />
            </Field>
            <Field label="Message" hint={placeholders}>
              <Textarea
                rows={4}
                value={form.welcomeMessage}
                onChange={(event) => setForm({ ...form, welcomeMessage: event.target.value })}
              />
            </Field>
            <div className="rounded-lg bg-ink-900 p-3">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-mist-600">Preview</p>
              <p className="whitespace-pre-wrap text-xs text-mist-300">
                {(form.welcomeMessage || "Welcome {user} to {server}!")
                  .replace(/\{user\}/g, "@newmember")
                  .replace(/\{server\}/g, "this server")
                  .replace(/\{memberCount\}/g, "128")}
              </p>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-line bg-ink-850 p-4">
            <p className="text-sm font-medium text-mist-100">Goodbye message</p>
            <Field label="Channel ID" hint={data.goodbye.channelName ? `Currently #${data.goodbye.channelName}` : "Where departures are announced"}>
              <Input
                value={form.goodbyeChannelId}
                onChange={(event) => setForm({ ...form, goodbyeChannelId: event.target.value })}
                placeholder="123456789012345678"
              />
            </Field>
            <Field label="Message" hint={placeholders}>
              <Textarea
                rows={4}
                value={form.goodbyeMessage}
                onChange={(event) => setForm({ ...form, goodbyeMessage: event.target.value })}
              />
            </Field>
            <div className="rounded-lg bg-ink-900 p-3">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-mist-600">Preview</p>
              <p className="whitespace-pre-wrap text-xs text-mist-300">
                {(form.goodbyeMessage || "Goodbye {user}.")
                  .replace(/\{user\}/g, "@member")
                  .replace(/\{server\}/g, "this server")
                  .replace(/\{memberCount\}/g, "128")}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Autorole ID" hint={data.autoroleName ? `Currently ${data.autoroleName}` : "Role given to every new member"}>
            <Input value={form.autoroleId} onChange={(event) => setForm({ ...form, autoroleId: event.target.value })} />
          </Field>
          <Field
            label="Suggestion channel ID"
            hint={data.suggestionChannelName ? `Currently #${data.suggestionChannelName}` : "Where /suggest posts"}
          >
            <Input
              value={form.suggestionChannelId}
              onChange={(event) => setForm({ ...form, suggestionChannelId: event.target.value })}
            />
          </Field>
        </div>
      </Section>

      <Section title="Suggestions" description="Submitted with /suggest and stored in the suggestions table.">
        <Table head={["Suggestion", "Status", "Member", "Submitted"]} empty="No suggestions yet.">
          {data.suggestions.map((suggestion) => (
            <Row key={suggestion.id}>
              <Cell className="max-w-[24rem] truncate text-mist-100" title={suggestion.content}>
                {suggestion.content}
              </Cell>
              <Cell>
                <Badge tone={suggestion.status === "approved" ? "good" : suggestion.status === "denied" ? "bad" : "warn"}>
                  {suggestion.status}
                </Badge>
              </Cell>
              <Cell className="mono text-[11px]">{suggestion.userId}</Cell>
              <Cell className="whitespace-nowrap text-[11px]">{formatDateTime(suggestion.createdAt)}</Cell>
            </Row>
          ))}
        </Table>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Polls" description="Created with /poll.">
          <Table head={["Question", "Options", "Channel"]} empty="No polls recorded.">
            {data.polls.map((poll) => (
              <Row key={poll.id}>
                <Cell className="max-w-[16rem] truncate text-mist-100" title={poll.question}>
                  {poll.question}
                </Cell>
                <Cell className="text-[11px]">{poll.options.length}</Cell>
                <Cell className="text-[11px]">{poll.channelName ? `#${poll.channelName}` : "—"}</Cell>
              </Row>
            ))}
          </Table>
        </Section>

        <Section title="Reminders" description="Scheduled with /remind.">
          <Table head={["Message", "Member", "Due"]} empty="No reminders scheduled.">
            {data.reminders.map((reminder) => (
              <Row key={reminder.id}>
                <Cell className="max-w-[18rem] truncate text-mist-100" title={reminder.message}>
                  {reminder.message}
                </Cell>
                <Cell className="mono text-[11px]">{reminder.userId}</Cell>
                <Cell className="whitespace-nowrap text-[11px]">{formatDateTime(reminder.remindAt)}</Cell>
              </Row>
            ))}
          </Table>
        </Section>
      </div>

      <Notice tone="neutral">
        Reaction-role panels are listed on the Role Management page and are created in Discord with{" "}
        <span className="mono">/reactionrole</span>. Polls and reminders are created with their slash commands; this page
        shows what the bot has stored.
      </Notice>
    </div>
  );
}
