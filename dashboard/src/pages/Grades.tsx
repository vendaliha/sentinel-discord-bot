import { useState } from "react";
import { Field, ErrorNote, Input, Loading, Notice, Section, Select, Stat } from "../components/Section";
import { sectionsApi } from "../lib/sections";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";

export default function GradesPage() {
  const { notify } = useDashboard();
  const { data, loading, error, saving, reload, save } = useSection(sectionsApi.grades);
  const [userId, setUserId] = useState("");
  const [grade, setGrade] = useState("");
  const [sub1, setSub1] = useState("");
  const [sub2, setSub2] = useState("");

  if (loading && !data) return <Loading label="Loading grade roles…" />;
  if (!data) return <ErrorNote message={error || "Could not load grade roles."} onRetry={() => void reload()} />;

  const gradeValue = grade || data.gradeRoles[0]?.name || "";
  const sub1Value = sub1 || data.sub1Roles[0]?.name || "";
  const sub2Value = sub2 || data.sub2Roles[0]?.name || "";

  async function assign() {
    const result = await save(
      () => sectionsApi.assignGrade({ userId: userId.trim(), grade: gradeValue, sub1: sub1Value, sub2: sub2Value }),
      "Grade roles assigned",
    );
    notify(result.ok ? "Grade roles assigned in Discord" : result.message || "Could not assign grade roles");
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Grade roles" value={data.gradeRoles.length} hint="Configured in the bot" tone="brand" />
        <Stat label="Sub-grade roles" value={data.sub1Roles.length + data.sub2Roles.length} hint="SUB1 + SUB2" />
        <Stat
          label="Grade channel"
          value={data.channelName || data.channelId || "Not set"}
          hint="Where grade changes are announced"
          tone={data.channelId ? "good" : "warn"}
        />
      </div>

      {!data.guildLoaded ? (
        <Notice tone="warn">
          The bot is not connected, so role IDs cannot be resolved. Grade names are still saved with the same values
          the bot's <span className="mono">/grade</span> command uses, and assignment will fail until the bot is online.
        </Notice>
      ) : null}

      {data.missing.length ? (
        <Notice tone="bad">
          These grade roles no longer exist in the server: {data.missing.join(", ")}. Add them back or update the bot
          configuration before assigning.
        </Notice>
      ) : null}

      <Section
        title="Assign grade roles"
        description="Applies the grade, SUB1 and SUB2 roles through the live Discord client — the same handler used by /grade."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Discord user ID">
            <Input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="123456789012345678" />
          </Field>
          <Field label="Grade">
            <Select
              value={gradeValue}
              onChange={(event) => setGrade(event.target.value)}
              options={data.gradeRoles.map((role) => ({ value: role.name, label: role.name }))}
            />
          </Field>
          <Field label="SUB1">
            <Select
              value={sub1Value}
              onChange={(event) => setSub1(event.target.value)}
              options={data.sub1Roles.map((role) => ({ value: role.name, label: role.name }))}
            />
          </Field>
          <Field label="SUB2">
            <Select
              value={sub2Value}
              onChange={(event) => setSub2(event.target.value)}
              options={data.sub2Roles.map((role) => ({ value: role.name, label: role.name }))}
            />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" className="btn-primary" disabled={saving || !userId.trim()} onClick={() => void assign()}>
            {saving ? "Assigning…" : "Assign roles"}
          </button>
          <p className="text-[11px] text-mist-500">
            The previous grade, SUB1 and SUB2 roles are removed from the member by the bot.
          </p>
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Grade roles" description="Base grades, strongest last.">
          <RoledList roles={data.gradeRoles} />
        </Section>
        <Section title="SUB1" description="Seniority within the grade.">
          <RoledList roles={data.sub1Roles} />
        </Section>
        <Section title="SUB2" description="Performance tier.">
          <RoledList roles={data.sub2Roles} />
        </Section>
      </div>
    </div>
  );
}

function RoledList({ roles }: { roles: { name: string; roleId: string | null }[] }) {
  return (
    <ul className="space-y-1.5">
      {roles.map((role) => (
        <li key={role.name} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ink-850 px-3 py-2">
          <span className="text-sm text-mist-200">{role.name}</span>
          <span className="mono text-[11px] text-mist-600">{role.roleId ?? "missing"}</span>
        </li>
      ))}
      {!roles.length ? <li className="text-xs text-mist-500">Not configured.</li> : null}
    </ul>
  );
}
