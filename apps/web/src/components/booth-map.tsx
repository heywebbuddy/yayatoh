import { boothPlan } from '@yayatoh/floorplan';

export interface MapBooth {
  readonly id: string;
  readonly number: string;
  readonly category: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Booths with an exhibitor are drawn filled; empty ones outlined. */
  readonly taken: boolean;
}

/**
 * An exhibit hall drawn from its booths (M5.4a): each booth a rectangle with its number. A picture
 * only (`role="img"`): the list next to it carries the same information and every action, so
 * nothing here needs a pointer. Presentation attributes and token classes only (strict CSP).
 */
export function BoothMap({ booths, label }: { booths: readonly MapBooth[]; label: string }) {
  const doc = boothPlan(booths);
  return (
    <svg
      viewBox={`0 0 ${doc.width} ${doc.height}`}
      role="img"
      aria-label={label}
      // Floor plans are drawn on light "paper" in both modes, like a printed plan (ADR 0022).
      data-theme="light"
      className="h-auto w-full rounded-card border border-line bg-surface-2"
      preserveAspectRatio="xMidYMid meet"
    >
      {booths.map((b) => {
        const size = Math.max(40, Math.min(b.width, b.height) / 3);
        return (
          <g key={b.id} data-booth={b.number}>
            <rect
              x={b.x}
              y={b.y}
              width={b.width}
              height={b.height}
              rx={12}
              strokeWidth={6}
              className={b.taken ? 'fill-primary-soft stroke-primary' : 'fill-surface stroke-line-strong'}
            />
            <text
              x={b.x + b.width / 2}
              y={b.y + b.height / 2}
              fontSize={size}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-ink font-extrabold"
            >
              {b.number}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
