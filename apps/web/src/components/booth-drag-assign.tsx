'use client';

import { boothPlan } from '@yayatoh/floorplan';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MapBooth } from './booth-map.tsx';

/**
 * The booth map with drag-to-assign (M5.4a): drag an exhibitor's name onto a booth. A pointer
 * shortcut only; the assign form below does the same by keyboard (the map itself is a picture).
 */
export function BoothDragAssign({
  booths,
  exhibitors,
  action,
  labels,
}: {
  booths: readonly MapBooth[];
  exhibitors: readonly { id: string; name: string }[];
  action: (boothId: string, exhibitorId: string) => Promise<{ ok: boolean }>;
  labels: { map: string; drag: string; chips: string; assigned: string; failed: string };
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const doc = boothPlan(booths);
  const drop = async (boothId: string, exhibitorId: string) => {
    setOver(null);
    if (!exhibitorId) return;
    const r = await action(boothId, exhibitorId);
    setMessage(r.ok ? labels.assigned : labels.failed);
    router.refresh();
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption text-ink-2">{labels.drag}</p>
      <ul aria-label={labels.chips} className="flex list-none flex-wrap gap-2 p-0">
        {exhibitors.map((x) => (
          <li
            key={x.id}
            draggable
            data-exhibitor={x.id}
            onDragStart={(e) => e.dataTransfer.setData('text/plain', x.id)}
            className="inline-flex min-h-6 cursor-grab items-center rounded-pill border border-line bg-surface px-3 text-caption font-bold text-ink hover:border-line-strong"
          >
            {x.name}
          </li>
        ))}
      </ul>
      <svg
        viewBox={`0 0 ${doc.width} ${doc.height}`}
        role="img"
        aria-label={labels.map}
        // Floor plans are drawn on light "paper" in both modes, like a printed plan (ADR 0022).
        data-theme="light"
        className="h-auto w-full rounded-card border border-line bg-surface-2"
        preserveAspectRatio="xMidYMid meet"
      >
        {booths.map((b) => {
          const size = Math.max(40, Math.min(b.width, b.height) / 3);
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: a drop target for the pointer shortcut; the Assign form is the keyboard way
            <g
              key={b.id}
              data-booth={b.number}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(b.id);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                void drop(b.id, e.dataTransfer.getData('text/plain'));
              }}
            >
              <rect
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                rx={12}
                strokeWidth={over === b.id ? 14 : 6}
                className={b.taken ? 'fill-primary-soft stroke-primary' : 'fill-surface stroke-line-strong'}
              />
              <text
                x={b.x + b.width / 2}
                y={b.y + b.height / 2}
                fontSize={size}
                textAnchor="middle"
                dominantBaseline="central"
                className="pointer-events-none fill-ink font-extrabold"
              >
                {b.number}
              </text>
            </g>
          );
        })}
      </svg>
      <p role="status" aria-live="polite" className="text-caption text-ink-2">
        {message}
      </p>
    </div>
  );
}
