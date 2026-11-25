import { Link } from "react-router-dom";
import { BoltIcon } from "../components/icons";
import { Badge, SectionHeader, Toggle, type Tone } from "../components/ui";
import { timeAgo } from "../lib/format";
import { useDashboard } from "../lib/store";
import { ACTION_LABEL, type AutomodAction } from "../lib/types";

const actionTone: Record<AutomodAction, Tone> = {
  warn: "warn",
  timeout: "brand",
  kick: "bad",
};

const actions: AutomodAction[] = ["warn", "timeout", "kick"];

export default function AutomodPage() {
  const { data, setRuleEnabled, setRuleThreshold, setRuleAction } = useDashboard();
  const enabled = data.rules.filter((rule) => rule.enabled).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Automod</h1>
        <p className="mt-1 text-sm text-mist-400">
          {enabled} of {data.rules.length} rules active · changes apply on the next event
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {data.rules.map((rule) => (
          <section key={rule.id} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-mist-100">{rule.name}</h2>
                  <Badge tone={actionTone[rule.action]}>{ACTION_LABEL[rule.action]}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-mist-500">{rule.description}</p>
              </div>
              <Toggle
                checked={rule.enabled}
                onChange={(next) => setRuleEnabled(rule.id, next)}
                label={`${rule.name} enabled`}
              />
            </div>

            <div className={`mt-4 space-y-4 ${rule.enabled ? "" : "opacity-50"}`}>
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-mist-400">Threshold</span>
                  <span className="mono text-mist-100">
                    {rule.binary ? "binary" : `${rule.threshold} ${rule.unit}`}
                  </span>
                </div>
                {rule.binary ? (
                  <p className="mt-2 rounded-lg border border-line-soft bg-ink-800 px-2.5 py-1.5 text-[11px] text-mist-500">
                    On/off rule — use the toggle above to control it.
                  </p>
                ) : (
                  <>
                    <input
                      type="range"
                      min={rule.min}
                      max={rule.max}
                      step={rule.step}
                      value={rule.threshold}
                      disabled={!rule.enabled}
                      onChange={(event) => setRuleThreshold(rule.id, Number(event.target.value))}
                      className="mt-2 w-full cursor-pointer disabled:cursor-not-allowed"
                      aria-label={`${rule.name} threshold`}
                    />
                    <div className="mono mt-1 flex justify-between text-[10px] text-mist-600">
                      <span>{rule.min}</span>
                      <span>{rule.max}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-end justify-between gap-3">
                <label className="text-xs">
                  <span className="mb-1 block text-mist-500">Action</span>
                  <select
                    value={rule.action}
                    disabled={!rule.enabled}
                    onChange={(event) =>
                      setRuleAction(rule.id, event.target.value as AutomodAction)
                    }
                    className="input w-auto py-1.5 disabled:cursor-not-allowed"
                  >
                    {actions.map((action) => (
                      <option key={action} value={action}>
                        {ACTION_LABEL[action]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="text-right">
                  <p className="mono text-sm font-semibold text-mist-100">{rule.hitsToday}</p>
                  <p className="text-[10px] uppercase tracking-wide text-mist-600">hits today</p>
                </div>
              </div>

              <p className="border-t border-line-soft pt-3 text-[11px] text-mist-600">
                Scope · {rule.scope}
              </p>
            </div>
          </section>
        ))}
      </div>

      <section className="card">
        <div className="border-b border-line-soft p-5 pb-4">
          <SectionHeader
            title="Execution log"
            subtitle="Most recent automod decisions across the server"
            action={
              <Link to="/settings" className="text-xs font-medium text-brand-400 hover:text-brand-400/80">
                Configure logging
              </Link>
            }
          />
        </div>
        <ul className="divide-y divide-line-soft">
          {data.log.map((entry) => {
            const rule = data.rules.find((item) => item.id === entry.ruleId);
            return (
              <li key={entry.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink-800 text-brand-400">
                  <BoltIcon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-mist-100">
                    {rule?.name ?? "Rule removed"}
                    <span className="text-mist-600"> → </span>
                    <span className="text-mist-400">{entry.user}</span>
                  </p>
                  <p className="text-[11px] text-mist-600">{timeAgo(entry.at)}</p>
                </div>
                <Badge tone={actionTone[entry.action]}>{ACTION_LABEL[entry.action]}</Badge>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
