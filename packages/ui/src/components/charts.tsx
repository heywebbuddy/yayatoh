import { cx } from '../cx.ts';

/** Chart sizes as static classes: the strict CSP allows no style attributes (M1.14a). */
const CHART_SIZE = { 88: 'size-[88px]', 120: 'size-[120px]', 150: 'size-[150px]' } as const;

/** Series colours are tokens only (ADR 0018 data visualisation). */
export type SeriesTone = 'accent' | 'zinc-400' | 'zinc-300' | 'green' | 'pink' | 'yellow';

const STROKE: Record<SeriesTone, string> = {
  accent: 'stroke-accent-900',
  'zinc-400': 'stroke-zinc-400',
  'zinc-300': 'stroke-zinc-300',
  green: 'stroke-green-500',
  pink: 'stroke-pink-500',
  yellow: 'stroke-yellow-500',
};
const FILL: Record<SeriesTone, string> = {
  accent: 'fill-accent-900',
  'zinc-400': 'fill-zinc-400',
  'zinc-300': 'fill-zinc-300',
  green: 'fill-green-500',
  pink: 'fill-pink-500',
  yellow: 'fill-yellow-500',
};
// Literal class names so Tailwind generates them (no string-built classes).
const SWATCH: Record<SeriesTone, string> = {
  accent: 'bg-accent-900',
  'zinc-400': 'bg-zinc-400',
  'zinc-300': 'bg-zinc-300',
  green: 'bg-green-500',
  pink: 'bg-pink-500',
  yellow: 'bg-yellow-500',
};
export const swatchClass = (tone: SeriesTone) => SWATCH[tone];

export interface Series {
  readonly label: string;
  readonly tone: SeriesTone;
  readonly points: readonly number[];
}

/**
 * Thin-line chart: 1.75 px strokes, dashed gridlines, end-point dots, mono axis labels.
 * Includes a visually hidden data table as the accessible alternative.
 */
export function LineChart({
  title,
  series,
  xLabels,
  height = 220,
  formatValue = String,
}: {
  title: string;
  series: readonly Series[];
  xLabels: readonly string[];
  height?: number;
  formatValue?: (n: number) => string;
}) {
  const width = 640;
  const pad = { top: 12, right: 12, bottom: 24, left: 44 };
  const max = Math.max(1, ...series.flatMap((s) => s.points));
  const n = Math.max(2, ...series.map((s) => s.points.length));
  const x = (i: number) => pad.left + (i * (width - pad.left - pad.right)) / (n - 1);
  const y = (v: number) => pad.top + (1 - v / max) * (height - pad.top - pad.bottom);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(t)}
              y2={y(t)}
              className="stroke-zinc-200"
              strokeDasharray="3 4"
            />
            <text
              x={pad.left - 8}
              y={y(t) + 3}
              textAnchor="end"
              className="fill-zinc-500 font-mono text-[10px]"
            >
              {formatValue(t)}
            </text>
          </g>
        ))}
        {xLabels.map((l, i) =>
          i % Math.ceil(xLabels.length / 8) === 0 ? (
            <text
              key={l}
              x={x(i)}
              y={height - 6}
              textAnchor="middle"
              className="fill-zinc-500 font-mono text-[10px]"
            >
              {l}
            </text>
          ) : null,
        )}
        {[...series].reverse().map((s) => {
          const d = s.points
            .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
            .join(' ');
          const last = s.points.length - 1;
          return (
            <g key={s.label}>
              <path d={d} fill="none" className={STROKE[s.tone]} strokeWidth={1.75} strokeLinejoin="round" />
              {last >= 0 ? (
                <circle cx={x(last)} cy={y(s.points[last] ?? 0)} r={3.5} className={FILL[s.tone]} />
              ) : null}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{title}</th>
            {series.map((s) => (
              <th key={s.label} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {xLabels.map((l, i) => (
            <tr key={l}>
              <th scope="row">{l}</th>
              {series.map((s) => (
                <td key={s.label}>{s.points[i] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export interface Segment {
  readonly label: string;
  readonly tone: SeriesTone;
  readonly value: number;
}

/** Donut with a centred total. Segments are listed as text next to it by the caller. */
export function Donut({
  title,
  segments,
  center,
  size = 150,
}: {
  title: string;
  segments: readonly Segment[];
  center?: React.ReactNode;
  size?: keyof typeof CHART_SIZE;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className={cx('relative shrink-0', CHART_SIZE[size])}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={title}>
        <circle cx="50" cy="50" r={r} fill="none" className="stroke-zinc-100" strokeWidth="10" />
        {segments.map((s) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={s.label}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              className={STROKE[s.tone]}
              strokeWidth="10"
              strokeDasharray={`${Math.max(0, len - 1)} ${c}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      {center ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center">{center}</div>
      ) : null}
    </div>
  );
}

/** Circular progress (readiness). */
export function ProgressRing({
  value,
  label,
  size = 88,
}: {
  value: number;
  label: string;
  size?: keyof typeof CHART_SIZE;
}) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={cx('relative shrink-0', CHART_SIZE[size])}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={label}>
        <circle cx="50" cy="50" r={r} fill="none" className="stroke-zinc-100" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          className="stroke-accent-900"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
        />
      </svg>
      <span
        className={cx(
          'absolute inset-0 flex items-center justify-center text-[20px] font-light tracking-[-0.04em]',
        )}
      >
        {pct}%
      </span>
    </div>
  );
}

export interface Bar {
  readonly label: string;
  readonly value: number;
}

/**
 * Vertical bars (one series), tokens only. Decorative to assistive tech beyond its label: pair it
 * with a `ChartTable` (the accessible alternative, also useful to sighted readers).
 */
export function BarChart({
  title,
  bars,
  height = 200,
  tone = 'accent',
  formatValue = String,
}: {
  title: string;
  bars: readonly Bar[];
  height?: number;
  tone?: SeriesTone;
  formatValue?: (n: number) => string;
}) {
  const width = 640;
  const pad = { top: 12, right: 12, bottom: 24, left: 56 };
  const max = Math.max(1, ...bars.map((b) => b.value));
  const inner = width - pad.left - pad.right;
  const slot = inner / Math.max(1, bars.length);
  const barW = Math.max(2, Math.min(40, slot * 0.7));
  const y = (v: number) => pad.top + (1 - v / max) * (height - pad.top - pad.bottom);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const every = Math.ceil(bars.length / 8);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label={title}
      direction="ltr"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(t)}
            y2={y(t)}
            className="stroke-zinc-200"
            strokeDasharray="3 4"
          />
          <text
            x={pad.left - 8}
            y={y(t) + 3}
            textAnchor="end"
            className="fill-zinc-500 font-mono text-[10px]"
          >
            {formatValue(t)}
          </text>
        </g>
      ))}
      {bars.map((b, i) => {
        const cx = pad.left + slot * i + slot / 2;
        return (
          <g key={b.label}>
            <rect
              x={cx - barW / 2}
              y={y(b.value)}
              width={barW}
              height={Math.max(0, height - pad.bottom - y(b.value))}
              rx={2}
              className={FILL[tone]}
            />
            {i % every === 0 ? (
              <text x={cx} y={height - 6} textAnchor="middle" className="fill-zinc-500 font-mono text-[10px]">
                {b.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The data behind a chart as a real table, behind a disclosure (keyboard: Tab to the summary,
 * Enter or Space to open). Every chart ships with one (accessible alternative, WCAG 1.1.1).
 */
export function ChartTable({
  toggle,
  caption,
  headers,
  rows,
}: {
  /** The disclosure's label, e.g. "Show the data". */
  toggle: string;
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-6 cursor-pointer items-center py-1 text-caption text-zinc-700 underline underline-offset-2">
        {toggle}
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-body">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-zinc-200">
              {headers.map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={cx(
                    'px-3 py-2 font-mono text-label font-normal uppercase text-zinc-500',
                    i === 0 ? 'text-start' : 'text-end',
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.join('|')} className="border-b border-zinc-100 last:border-0">
                {r.map((c, i) =>
                  i === 0 ? (
                    <th key={headers[i]} scope="row" className="px-3 py-2 text-start font-normal">
                      {c}
                    </th>
                  ) : (
                    <td key={headers[i]} className="px-3 py-2 text-end font-mono tabular-nums">
                      {c}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
