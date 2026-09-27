import { uuidv7 } from '@yayatoh/kernel';
import type { Item, Seat } from './document.ts';

/** Seat spacing defaults, centimetres (a theatre seat is ~50 cm wide). */
export const SEAT_PITCH_CM = 55;

/** A straight row of numbered seats, left to right from its origin. */
export function buildRow(opts: {
  label: string;
  count: number;
  x: number;
  y: number;
  start?: number;
  pitch?: number;
  rotation?: number;
  sectionId?: string | null;
}): Extract<Item, { kind: 'row' }> {
  const pitch = opts.pitch ?? SEAT_PITCH_CM;
  const start = opts.start ?? 1;
  const seats: Seat[] = Array.from({ length: opts.count }, (_, i) => ({
    id: uuidv7(),
    label: String(start + i),
    x: i * pitch,
    y: 0,
    accessible: false,
  }));
  return {
    kind: 'row',
    id: uuidv7(),
    label: opts.label,
    sectionId: opts.sectionId ?? null,
    x: opts.x,
    y: opts.y,
    rotation: opts.rotation ?? 0,
    seats,
  };
}

/** A round table with seats evenly around it (seat 1 at the top, clockwise). */
export function buildRoundTable(opts: {
  label: string;
  seats: number;
  x: number;
  y: number;
  diameter?: number;
  sectionId?: string | null;
}): Extract<Item, { kind: 'table' }> {
  const d = opts.diameter ?? 180;
  const r = d / 2 + 35;
  const seats: Seat[] = Array.from({ length: opts.seats }, (_, i) => {
    const a = (2 * Math.PI * i) / opts.seats - Math.PI / 2;
    return {
      id: uuidv7(),
      label: String(i + 1),
      x: Math.round(r * Math.cos(a)),
      y: Math.round(r * Math.sin(a)),
      accessible: false,
    };
  });
  return {
    kind: 'table',
    id: uuidv7(),
    label: opts.label,
    sectionId: opts.sectionId ?? null,
    shape: 'round',
    x: opts.x,
    y: opts.y,
    width: d,
    height: d,
    rotation: 0,
    seats,
  };
}
