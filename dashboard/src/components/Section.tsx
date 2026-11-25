import { useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertIcon, CheckIcon, RefreshIcon } from "./icons";

type Tone = "brand" | "good" | "warn" | "bad" | "neutral";

const toneText: Record<Tone, string> = {
  brand: "text-brand-400",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  neutral: "text-mist-300",
};

const toneSurface: Record<Tone, string> = {
  brand: "border-brand-500/30 bg-brand-500/8",
  good: "border-good/30 bg-good/8",
  warn: "border-warn/30 bg-warn/8",
  bad: "border-bad/30 bg-bad/8",
  neutral: "border-line bg-ink-850",
};

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card mb-5 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-mist-100">{title}</h2>
          {description ? <p className="mt-1 max-w-2xl text-xs text-mist-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className={`rounded-xl border p-4 ${toneSurface[tone]}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">{label}</p>
      <p className={`mono mt-2 break-words text-xl font-semibold leading-tight ${toneText[tone]}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-mist-500">{hint}</p> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-mist-600">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input {...rest} className={`input ${className}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea {...rest} className={`input ${className}`} />;
}

export function Select({
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  const { className = "", ...rest } = props;
  return (
    <select {...rest} className={`input ${className}`}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Table({
  head,
  children,
  empty,
}: {
  head: string[];
  children: ReactNode;
  empty?: string | null;
}) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children;
  const isEmpty = Array.isArray(rows) ? rows.length === 0 : !rows;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map((cell) => (
              <th
                key={cell}
                className="border-b border-line px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-mist-500"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr>
              <td colSpan={head.length} className="px-3 py-8 text-center text-xs text-mist-500">
                {empty || "Nothing recorded yet."}
              </td>
            </tr>
          ) : (
            rows
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <tr className="border-b border-line-soft transition-colors hover:bg-ink-800/40 last:border-0">{children}</tr>;
}

export function Cell({
  children,
  className = "",
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td title={title} className={`px-3 py-2.5 align-middle text-mist-300 ${className}`}>
      {children}
    </td>
  );
}

export function Notice({ tone = "brand", children }: { tone?: Tone; children: ReactNode }) {
  const icon = tone === "good" ? <CheckIcon size={14} /> : <AlertIcon size={14} />;
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${toneSurface[tone]} ${toneText[tone]}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="text-mist-300">{children}</div>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-1 py-8 text-sm text-mist-400">
      <span className="size-3.5 animate-spin rounded-full border-2 border-ink-600 border-t-brand-400" />
      {label}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/8 px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <AlertIcon size={16} className="mt-0.5 shrink-0 text-bad" />
        <p className="text-xs text-mist-300">{message}</p>
      </div>
      {onRetry ? (
        <button type="button" className="btn-ghost text-xs" onClick={onRetry}>
          <RefreshIcon size={13} />
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function ConfirmButton({
  children,
  title,
  message,
  confirmLabel = "Confirm",
  onConfirm,
  disabled = false,
  className = "btn-ghost",
}: {
  children: ReactNode;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => Promise<unknown>;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <div className="card w-full max-w-md p-5">
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-mist-400">{message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onConfirm();
                    setOpen(false);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Working…" : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function BarChart({
  points,
  series,
  height = 150,
}: {
  points: { date: string; cases?: number; warnings?: number }[];
  series: { key: "cases" | "warnings"; label: string; className: string }[];
  height?: number;
}) {
  const max = Math.max(1, ...points.flatMap((point) => series.map((entry) => point[entry.key] || 0)));
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {points.map((point) => (
          <div key={point.date} className="group flex h-full flex-1 items-end justify-center gap-0.5">
            {series.map((entry) => {
              const value = point[entry.key] || 0;
              return (
                <span
                  key={entry.key}
                  title={`${entry.label}: ${value}`}
                  className={`w-full max-w-[9px] rounded-t-sm transition-all ${entry.className}`}
                  style={{ height: `${Math.max(value ? 6 : 2, (value / max) * 100)}%` }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-mist-500">
        <span>{new Date(points[0]?.date || Date.now()).toLocaleDateString()}</span>
        <div className="flex items-center gap-3">
          {series.map((entry) => (
            <span key={entry.key} className="flex items-center gap-1.5">
              <span className={`size-2 rounded-sm ${entry.className}`} />
              {entry.label}
            </span>
          ))}
        </div>
        <span>Today</span>
      </div>
    </div>
  );
}

export function ToggleRow({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
        checked ? "border-brand-500/50 bg-brand-500/80" : "border-line bg-ink-700"
      }`}
    >
      <span
        className={`absolute top-0.5 size-4.5 rounded-full bg-white shadow transition-all ${
          checked ? "left-[1.45rem]" : "left-0.5"
        }`}
        style={{ width: "1.05rem", height: "1.05rem" }}
      />
    </button>
  );
}
