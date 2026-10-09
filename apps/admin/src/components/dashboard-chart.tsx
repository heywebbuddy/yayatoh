import { Card } from '@yayatoh/ui';
import type { DashboardDay, DashboardGroup } from '@/server/dashboard.ts';

/** Server-rendered charts with an accessible data table and no charting runtime. */
export function TrendChart({
  title,
  rows,
  metric,
  tableLabel,
}: {
  title: string;
  rows: DashboardDay[];
  metric: 'organizations' | 'orders';
  tableLabel: string;
}) {
  const max = Math.max(2, ...rows.map((r) => r[metric]));
  const tick = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const points = rows
    .map((r, i) => `${30 + (i * 540) / Math.max(1, rows.length - 1)},${160 - (r[metric] * 130) / max}`)
    .join(' ');
  const date = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (
    <Card className="min-w-0">
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="relative mt-4 ps-9">
        <div
          aria-hidden="true"
          className="absolute inset-y-0 start-0 flex w-8 flex-col justify-between py-3 text-end text-caption text-ink-2"
        >
          {[1, 0.5, 0].map((fraction) => (
            <span key={fraction}>{tick.format(Math.round(max * fraction))}</span>
          ))}
        </div>
        <svg role="img" aria-label={title} viewBox="20 20 560 150" className="w-full text-primary">
          <title>{title}</title>
          {[0, 0.5, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1="30"
                x2="570"
                y1={160 - fraction * 130}
                y2={160 - fraction * 130}
                className="stroke-line"
              />
            </g>
          ))}
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          {rows.map((row, i) => (
            <circle
              key={row.day}
              cx={30 + (i * 540) / Math.max(1, rows.length - 1)}
              cy={160 - (row[metric] * 130) / max}
              r="2"
              fill="currentColor"
            >
              <title>
                {row.day}: {row[metric]}
              </title>
            </circle>
          ))}
        </svg>
      </div>
      <div className="mt-2 flex justify-between gap-3 ps-9 text-caption text-ink-2">
        <span>{rows[0] ? date.format(new Date(`${rows[0].day}T00:00:00Z`)) : ''}</span>
        <span>{rows.at(-1) ? date.format(new Date(`${rows.at(-1)?.day}T00:00:00Z`)) : ''}</span>
      </div>
      <details className="mt-3 text-caption">
        <summary className="cursor-pointer text-ink-2">{tableLabel}</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-start">
                  UTC
                </th>
                <th scope="col" className="text-end">
                  {title}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day}>
                  <td className="py-1">{r.day}</td>
                  <td className="text-end tabular-nums">{r[metric]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

export function DistributionChart({
  title,
  rows,
  empty,
  label,
}: {
  title: string;
  rows: DashboardGroup[];
  empty: string;
  label?: (key: string) => string;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <Card className="min-w-0">
      <h2 className="text-xl font-bold">{title}</h2>
      <ul className="mt-4 flex flex-col gap-4">
        {rows.map((row) => (
          <li key={row.label}>
            <div className="mb-1.5 flex items-start justify-between gap-3 text-body">
              <span className="min-w-0 break-words">{label ? label(row.label) : row.label}</span>
              <span className="shrink-0 tabular-nums">{row.count.toLocaleString('en')}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-solid">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${total ? (row.count / total) * 100 : 0}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? <p className="mt-4 text-body text-ink-2">{empty}</p> : null}
    </Card>
  );
}
