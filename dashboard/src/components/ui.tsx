import { useId, type ReactNode } from "react";
import { initials } from "../lib/format";

export type Tone = "brand" | "good" | "warn" | "bad" | "neutral";

const toneClasses: Record<Tone, string> = {
  brand: "bg-brand-500/12 text-brand-400 ring-brand-500/25",
  good: "bg-good/12 text-good ring-good/25",
  warn: "bg-warn/12 text-warn ring-warn/25",
  bad: "bg-bad/12 text-bad ring-bad/25",
  neutral: "bg-ink-700/70 text-mist-300 ring-line",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Avatar({
  name,
  hue = 245,
  size = 36,
  src,
}: {
  name: string;
  hue?: number;
  size?: number;
  src?: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="inline-flex shrink-0 rounded-full object-cover ring-1 ring-white/10"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-1 ring-white/10"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background: `linear-gradient(140deg, hsl(${hue} 72% 52%), hsl(${hue + 28} 62% 38%))`,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-mist-100">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-mist-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent = "brand",
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
  accent?: Tone;
}) {
  const accentBg: Record<Tone, string> = {
    brand: "bg-brand-500/12 text-brand-400",
    good: "bg-good/12 text-good",
    warn: "bg-warn/12 text-warn",
    bad: "bg-bad/12 text-bad",
    neutral: "bg-ink-700 text-mist-300",
  };

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-mist-500">{label}</p>
        <span className={`grid size-8 place-items-center rounded-lg ${accentBg[accent]}`}>
          {icon}
        </span>
      </div>
      <p className="mono mt-3 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-mist-500">{hint}</p>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-brand-500" : "bg-ink-600"
      }`}
    >
      <span
        className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export function AreaChart({
  series,
  labels,
  showLabels = true,
}: {
  series: Array<{ name: string; color: string; values: number[] }>;
  labels: string[];
  showLabels?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const width = 640;
  const height = 200;
  const pad = 10;
  const max = Math.max(1, ...series.flatMap((s) => s.values));

  const toX = (index: number, length: number) =>
    length <= 1 ? 0 : (index / (length - 1)) * width;
  const toY = (value: number) => height - pad - (value / max) * (height - pad * 2);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 pb-2">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-xs text-mist-400">
            <span className="size-2 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-48 w-full overflow-visible"
        role="img"
        aria-label={`Activity chart: ${series.map((s) => s.name).join(", ")}`}
      >
        <defs>
          {series.map((s, index) => (
            <linearGradient key={s.name} id={`${uid}-${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2={width}
            y1={toY(max * fraction)}
            y2={toY(max * fraction)}
            stroke="var(--color-line)"
            strokeDasharray="3 5"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {series.map((s, index) => {
          const line = s.values
            .map((value, i) => `${i === 0 ? "M" : "L"}${toX(i, s.values.length)},${toY(value)}`)
            .join(" ");
          const area = `${line} L${width},${height - pad} L0,${height - pad} Z`;
          return (
            <g key={s.name}>
              <path d={area} fill={`url(#${uid}-${index})`} />
              <path
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </svg>
      {showLabels ? (
        <div className="mt-2 flex justify-between text-[10px] text-mist-600">
          {labels.map((label, index) => (
            <span
              key={`${label}-${index}`}
              className={index % 2 === 0 ? "" : "hidden sm:inline"}
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Sparkline({
  values,
  className = "text-brand-400",
}: {
  values: number[];
  className?: string;
}) {
  const width = 120;
  const height = 34;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`h-8 w-28 ${className}`}
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-ink-700 text-mist-400">
        {icon}
      </span>
      <p className="text-sm font-medium text-mist-200">{title}</p>
      <p className="max-w-sm text-xs text-mist-500">{hint}</p>
    </div>
  );
}
