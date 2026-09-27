import { z } from 'zod';

/**
 * Floor plan document v1 (ADR 0012). Everything is in **centimetres** in the room's frame
 * (origin top-left, x right, y down); rotations are degrees clockwise around an item's own origin.
 * Seats have stable UUIDs that never change once the layout is sold against.
 */
export const MAX_SEATS = 20_000;
export const MAX_ITEMS = 5_000;

const cm = z.number().int().min(-100_000).max(100_000);
const size = z.number().int().min(1).max(100_000);
const label = z.string().trim().min(1).max(40);
const rotation = z.number().min(-360).max(360).default(0);

export const Seat = z.object({
  id: z.uuid(),
  label,
  /** Relative to the parent item's origin, before its rotation. */
  x: cm,
  y: cm,
  accessible: z.boolean().default(false),
});
export type Seat = z.infer<typeof Seat>;

export const OBJECT_TYPES = ['stage', 'booth', 'entrance', 'exit', 'dance_floor', 'bar', 'custom'] as const;

export const Row = z.object({
  kind: z.literal('row'),
  id: z.uuid(),
  label,
  sectionId: z.uuid().nullable().default(null),
  x: cm,
  y: cm,
  rotation,
  seats: z.array(Seat).min(1).max(500),
});

export const Table = z.object({
  kind: z.literal('table'),
  id: z.uuid(),
  label,
  sectionId: z.uuid().nullable().default(null),
  shape: z.enum(['round', 'rect']),
  x: cm,
  y: cm,
  width: size,
  height: size,
  rotation,
  seats: z.array(Seat).min(1).max(40),
});

export const FloorObject = z.object({
  kind: z.literal('object'),
  id: z.uuid(),
  objectType: z.enum(OBJECT_TYPES),
  label: z.string().trim().max(40).default(''),
  x: cm,
  y: cm,
  width: size,
  height: size,
  rotation,
});

export const Item = z.discriminatedUnion('kind', [Row, Table, FloorObject]);
export type Item = z.infer<typeof Item>;

export const Section = z.object({
  id: z.uuid(),
  label,
  /** VIP sections are highlighted in pickers and maps. */
  vip: z.boolean().default(false),
});

export const FloorplanDoc = z.object({
  version: z.literal(1),
  width: size,
  height: size,
  /** A legacy chart image drawn under the plan (layout_v1 migration). */
  underlay: z
    .object({ url: z.string().max(500), x: cm, y: cm, width: size, height: size })
    .nullable()
    .default(null),
  sections: z.array(Section).max(200).default([]),
  items: z.array(Item).max(MAX_ITEMS),
});
export type FloorplanDoc = z.infer<typeof FloorplanDoc>;
