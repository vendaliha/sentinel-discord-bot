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
  Textarea,
} from "../components/Section";
import { Badge } from "../components/ui";
import { formatDateTime } from "../lib/format";
import { sectionsApi } from "../lib/sections";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";

const DEFAULT_COLOUR = 0x5865f2;

function hexToInt(hex: string) {
  const clean = hex.replace("#", "").trim();
  const value = Number.parseInt(clean, 16);
  return Number.isFinite(value) ? value : DEFAULT_COLOUR;
}

function intToHex(value: number) {
  return `#${Math.max(0, Math.min(0xffffff, value)).toString(16).padStart(6, "0")}`;
}

export default function TicketsPage() {
  const { notify } = useDashboard();
  const { data, loading, error, saving, reload, save } = useSection(sectionsApi.tickets);
  const [form, setForm] = useState({
    title: "",
    description: "",
    colour: intToHex(DEFAULT_COLOUR),
    footer: "",
    panelChannelId: "",
    categoryId: "",
    supportRoleId: "",
    openLimit: "1",
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      title: data.design.title,
      description: data.design.description,
      colour: intToHex(data.design.colour),
      footer: data.design.footer,
      panelChannelId: data.settings?.panelChannelId ?? "",
      categoryId: data.settings?.categoryId ?? "",
      supportRoleId: data.settings?.supportRoleId ?? "",
      openLimit: String(data.settings?.openLimit ?? 1),
    });
  }, [data]);

  if (loading && !data) return <Loading label="Loading ticket system…" />;
  if (!data) return <ErrorNote message={error || "Could not load the ticket system."} onRetry={() => void reload()} />;

  async function saveSettings() {
    const result = await save(
      () =>
        sectionsApi.updateTicketSettings({
          ...(form.categoryId.trim() ? { categoryId: form.categoryId.trim() } : {}),
          ...(form.supportRoleId.trim() ? { supportRoleId: form.supportRoleId.trim() } : {}),
          openLimit: Math.max(1, Number(form.openLimit) || 1),
        }),
      "Ticket settings saved",
    );
    notify(result.ok ? "Ticket settings saved" : result.message || "Could not save ticket settings");
  }

  async function publish() {
    try {
      await sectionsApi.publishTicketPanel({
        title: form.title.trim(),
        description: form.description.trim(),
        colour: hexToInt(form.colour),
        footer: form.footer.trim(),
        ...(form.panelChannelId.trim() ? { panelChannelId: form.panelChannelId.trim() } : {}),
        ...(form.categoryId.trim() ? { categoryId: form.categoryId.trim() } : {}),
        ...(form.supportRoleId.trim() ? { supportRoleId: form.supportRoleId.trim() } : {}),
        openLimit: Math.max(1, Number(form.openLimit) || 1),
      });
      notify("Ticket panel published to Discord");
      await reload();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Discord rejected the panel.");
    }
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Open tickets" value={data.counts.open} hint="Awaiting staff" tone="warn" />
        <Stat label="Closed tickets" value={data.counts.closed} hint="Kept for history" />
        <Stat
          label="Panel channel"
          value={data.settings?.panelChannelName || data.settings?.panelChannelId || "Not set"}
          hint={data.settings?.panelMessageId ? "Panel posted" : "Not published yet"}
          tone={data.settings?.panelMessageId ? "good" : "neutral"}
        />
        <Stat label="Open limit" value={data.settings?.openLimit ?? 1} hint="Tickets per member" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Section
          title="Panel configuration"
          description="Saved to the dashboard panel table and pushed to Discord when you publish."
          actions={
            <ConfirmButton
              title="Publish this panel to Discord?"
              message="The bot posts a new panel message with the Create Ticket button, or edits the existing one. Everyone in the channel sees it."
              confirmLabel="Publish"
              disabled={saving || !form.title.trim() || !form.description.trim()}
              onConfirm={publish}
            >
              Publish to Discord
            </ConfirmButton>
          }
        >
          <div className="space-y-3">
            <Field label="Panel title">
              <Input value={form.title} maxLength={256} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </Field>
            <Field label="Panel description" hint="Supports Discord markdown. Blank lines are kept.">
              <Textarea
                rows={5}
                value={form.description}
                maxLength={4000}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Embed colour">
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={form.colour}
                    onChange={(event) => setForm({ ...form, colour: event.target.value })}
                    className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-ink-850 p-1"
                    aria-label="Embed colour"
                  />
                  <Input value={form.colour} onChange={(event) => setForm({ ...form, colour: event.target.value })} />
                </div>
              </Field>
              <Field label="Footer">
                <Input value={form.footer} maxLength={2048} onChange={(event) => setForm({ ...form, footer: event.target.value })} />
              </Field>
              <Field label="Panel channel ID" hint={data.settings?.panelChannelName ? `Currently #${data.settings.panelChannelName}` : "Where the panel is sent"}>
                <Input value={form.panelChannelId} onChange={(event) => setForm({ ...form, panelChannelId: event.target.value })} />
              </Field>
              <Field label="Ticket category ID" hint="Channel category new tickets are created in">
                <Input value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} />
              </Field>
              <Field label="Support role ID" hint={data.settings?.supportRoleName ? `Currently ${data.settings.supportRoleName}` : "Role pinged on new tickets"}>
                <Input value={form.supportRoleId} onChange={(event) => setForm({ ...form, supportRoleId: event.target.value })} />
              </Field>
              <Field label="Open ticket limit per member">
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={form.openLimit}
                  onChange={(event) => setForm({ ...form, openLimit: event.target.value })}
                />
              </Field>
            </div>
            <button type="button" className="btn-ghost" disabled={saving} onClick={() => void saveSettings()}>
              {saving ? "Saving…" : "Save settings without publishing"}
            </button>
          </div>
        </Section>

        <Section title="Live preview" description="Exactly how the bot renders this panel in Discord.">
          <div className="rounded-lg bg-[#313338] p-4">
            <div className="flex gap-3">
              <span className="size-10 shrink-0 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-center text-sm font-semibold leading-10 text-white">
                S
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">
                  Sentinel <span className="ml-1 rounded bg-[#5865f2] px-1 py-0.5 text-[10px] text-white">BOT</span>
                  <span className="ml-1.5 text-[11px] text-[#949ba4]">Today</span>
                </p>
                <div
                  className="mt-1 overflow-hidden rounded border-l-4 bg-[#2b2d31]"
                  style={{ borderColor: form.colour }}
                >
                  <div className="space-y-2 p-3.5">
                    <p className="text-[15px] font-semibold text-white">{form.title || "Panel title"}</p>
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[#dbdee1]">
                      {form.description || "Panel description"}
                    </p>
                    {form.footer ? <p className="text-[11px] text-[#949ba4]">{form.footer}</p> : null}
                  </div>
                </div>
                <div className="mt-2 inline-flex items-center gap-2 rounded bg-[#4e5058] px-3 py-1.5 text-[13px] font-medium text-white">
                  🎫 Create Ticket
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Notice tone="neutral">
              The bot's ticket panel is a single button panel. Dropdown categories, per-category descriptions and ticket
              question forms are not part of its panel renderer, so they are not editable here.
            </Notice>
          </div>
        </Section>
      </div>

      <Section title="Tickets" description="Every ticket row stored by the bot.">
        <Table head={["#", "Member", "Status", "Claimed by", "Channel", "Opened", "Closed"]} empty="No tickets yet.">
          {data.tickets.map((ticket) => (
            <Row key={ticket.id}>
              <Cell className="mono text-mist-400">#{ticket.number}</Cell>
              <Cell>
                <span className="text-mist-100">{ticket.user}</span>
                <span className="mono ml-1.5 text-[11px] text-mist-600">{ticket.userId}</span>
              </Cell>
              <Cell>
                <Badge tone={ticket.status === "open" ? "warn" : "good"}>{ticket.status}</Badge>
              </Cell>
              <Cell className="mono text-[11px]">{ticket.claimedBy || "—"}</Cell>
              <Cell>{ticket.channelName ? `#${ticket.channelName}` : ticket.channelId}</Cell>
              <Cell className="whitespace-nowrap text-[11px]">{formatDateTime(ticket.createdAt)}</Cell>
              <Cell className="whitespace-nowrap text-[11px]">{ticket.closedAt ? formatDateTime(ticket.closedAt) : "—"}</Cell>
            </Row>
          ))}
        </Table>
      </Section>

      {data.limitations.length ? (
        <Section title="What this dashboard does not control" description="Honest limits of the bot's ticket module.">
          <ul className="list-disc space-y-1.5 pl-5 text-xs text-mist-400">
            {data.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
