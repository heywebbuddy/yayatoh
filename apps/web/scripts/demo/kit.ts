import { sql, type TenantTx, withTenant } from '@yayatoh/db';
import {
  type Command,
  type CommandPorts,
  type Ctx,
  createCtx,
  executeCommand,
  executeQuery,
  type Query,
} from '@yayatoh/kernel';
import { emitEvents } from '@yayatoh/platform';
import sharp from 'sharp';
import { ports } from '../../src/server/ports.ts';

/**
 * Demo data for an existing organization (client testing). Every write goes through the platform's
 * own commands, so validation, permissions, audit and projections behave as in the console. The
 * outbox marks every event `replayed`: projections (reports, listings, analytics, participation)
 * apply it, but mailers, reminders, journeys and webhooks never fire, so no demo email or text is
 * ever sent to the demo addresses.
 */
export const quietPorts: CommandPorts<TenantTx> = {
  ...ports,
  outbox: { emit: (tx, ctx, events) => emitEvents(tx, ctx, events, { replayed: true }) },
};

export interface Demo {
  readonly orgId: string;
  readonly ownerId: string;
  readonly timezone: string;
  readonly currency: string;
  /** `local+tag-n@domain` aliases of the attendee address the client chose. */
  readonly attendeeEmail: (tag: string, n: number) => string;
}

/** The owner acting now (or at `now`), with a fresh step-up. */
export const owner = (d: Demo, now = new Date()): Ctx =>
  createCtx({ orgId: d.orgId, actor: { type: 'user', userId: d.ownerId }, now, stepUpAt: now });
/** The owner for an idempotent command (money): the key makes a re-run a no-op. */
export const createCtxWithKey = (d: Demo, idempotencyKey: string, now = new Date()): Ctx =>
  createCtx({
    orgId: d.orgId,
    actor: { type: 'user', userId: d.ownerId },
    now,
    stepUpAt: now,
    idempotencyKey,
  });
/** The platform acting (system actor): allowed everything except portal permissions. */
export const system = (d: Demo, now = new Date()): Ctx =>
  createCtx({ orgId: d.orgId, actor: { type: 'system', name: 'demo-seed' }, now, stepUpAt: now });
/** An anonymous visitor (public commands: opt-ins, assistance requests, reviews). */
export const visitor = (d: Demo, now = new Date()): Ctx => createCtx({ orgId: d.orgId, now });

// The seed passes plain objects (checked by each command's own schema at run time).
// biome-ignore lint/suspicious/noExplicitAny: any command, whatever its input and result types
type AnyCommand = Command<any, any, any, TenantTx>;
// biome-ignore lint/suspicious/noExplicitAny: any query, whatever its input and result types
type AnyQuery = Query<any, any, any, TenantTx>;
export function run<_I = unknown, O = unknown>(command: AnyCommand, input: unknown, ctx: Ctx): Promise<O> {
  return executeCommand(command, input, ctx, quietPorts) as Promise<O>;
}
export function ask<_I = unknown, O = unknown>(query: AnyQuery, input: unknown, ctx: Ctx): Promise<O> {
  return executeQuery(query, input, ctx, quietPorts) as Promise<O>;
}

/** Raw reads inside the org's tenant transaction (ids the commands don't return). */
export function read<T extends Record<string, unknown>>(
  d: Demo,
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  return withTenant(owner(d), (tx) => tx.execute<T>(query)) as Promise<T[]>;
}

export interface TicketRow {
  readonly ticket_id: string;
  readonly short_code: string;
  readonly attendee_id: string;
  readonly email: string;
  readonly name: string;
  readonly ticket_type_id: string;
  readonly order_id: string;
}
export function ticketsOf(d: Demo, eventId: string): Promise<TicketRow[]> {
  return read<TicketRow & Record<string, unknown>>(
    d,
    sql`select t.id as ticket_id, t.short_code, a.id as attendee_id, a.email, a.name,
               t.ticket_type_id, t.order_id
          from ticketing.tickets t join attendees.attendees a on a.ticket_id = t.id
         where t.event_id = ${eventId} and t.status = 'active'
         order by t.created_at, t.serial`,
  );
}

/* --------------------------------------------------------------------------------- dates ---- */

const DAY = 86_400_000;
/** A UTC instant for a wall-clock time in `timeZone` (whole-minute offsets only). */
export function at(date: string, time: string, timeZone: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess.getTime() - (shown - guess.getTime()));
}
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const addMinutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);
/** `YYYY-MM-DD` of an instant in a timezone. */
export const dayOf = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/* -------------------------------------------------------------------------------- people ---- */

const FIRST = [
  'Aarav',
  'Priya',
  'Rohan',
  'Ananya',
  'Vikram',
  'Meera',
  'Arjun',
  'Kavya',
  'Ishaan',
  'Diya',
  'Kabir',
  'Saanvi',
  'Aditya',
  'Neha',
  'Rahul',
  'Pooja',
  'Siddharth',
  'Riya',
  'Karan',
  'Tara',
  'Daniel',
  'Sofia',
  'Liam',
  'Emma',
  'Noah',
  'Olivia',
  'Lucas',
  'Mia',
  'Ethan',
  'Zara',
  'Omar',
  'Leila',
  'Mateo',
  'Chloe',
  'Hiro',
  'Yuna',
  'Kwame',
  'Amara',
  'Nikhil',
  'Sneha',
];
const LAST = [
  'Sharma',
  'Patel',
  'Iyer',
  'Reddy',
  'Nair',
  'Mehta',
  'Kapoor',
  'Gupta',
  'Singh',
  'Desai',
  'Fernandes',
  'Rao',
  'Bose',
  'Joshi',
  'Malhotra',
  'Chen',
  'Garcia',
  'Okafor',
  'Haddad',
  'Silva',
];
export interface Person {
  readonly first: string;
  readonly last: string;
  readonly name: string;
  readonly email: string;
}
/** `count` distinct demo people for one event, all on aliases of the client's address. */
export function people(d: Demo, tag: string, count: number, offset = 0): Person[] {
  return Array.from({ length: count }, (_, i) => {
    const k = i + offset;
    const first = FIRST[(k * 7 + tag.length) % FIRST.length] as string;
    const last = LAST[(k * 3 + tag.length * 5) % LAST.length] as string;
    return { first, last, name: `${first} ${last}`, email: d.attendeeEmail(tag, k + 1) };
  });
}

/* -------------------------------------------------------------------------------- images ---- */

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * An original abstract image (gradient, soft light and shapes in the event's palette), so the demo
 * uses nothing copied from elsewhere. No text: the server image may have no fonts.
 */
export async function demoImage(
  seed: string,
  palette: readonly string[],
  w = 1600,
  h = 900,
): Promise<Uint8Array> {
  const r = rng(seed);
  const pick = () => palette[Math.floor(r() * palette.length)] as string;
  const shapes = Array.from({ length: 14 }, (_, i) => {
    const cx = Math.round(r() * w);
    const cy = Math.round(r() * h);
    const rad = Math.round((0.05 + r() * 0.22) * w);
    const op = (0.12 + r() * 0.35).toFixed(2);
    return i % 3 === 2
      ? `<rect x="${cx - rad}" y="${cy - rad / 3}" width="${rad * 2}" height="${Math.round(rad / 1.5)}" rx="${Math.round(rad / 3)}" fill="${pick()}" opacity="${op}" transform="rotate(${Math.round(r() * 60 - 30)} ${cx} ${cy})"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${pick()}" opacity="${op}"/>`;
  }).join('');
  const lights = Array.from({ length: 40 }, () => {
    const x = Math.round(r() * w);
    const y = Math.round(r() * h * 0.7);
    return `<circle cx="${x}" cy="${y}" r="${(1 + r() * 4).toFixed(1)}" fill="#ffffff" opacity="${(0.3 + r() * 0.6).toFixed(2)}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[palette.length - 1]}"/>
    </linearGradient>
    <radialGradient id="l" cx="${(0.2 + r() * 0.6).toFixed(2)}" cy="0.25" r="0.7">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="b"><feGaussianBlur stdDeviation="${Math.round(w / 90)}"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <g filter="url(#b)">${shapes}</g>
  <rect width="100%" height="100%" fill="url(#l)"/>
  ${lights}
</svg>`;
  const out = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
  return new Uint8Array(out);
}

export const PALETTES = {
  wedding: ['#f6d6d1', '#e8b4b8', '#c9a27e', '#7d5a50', '#fdf6ec'],
  gala: ['#0f1b3d', '#1f3a68', '#c9a227', '#e8d18a', '#4b1d3f'],
  concert: ['#120f2b', '#5b21b6', '#db2777', '#f59e0b', '#06b6d4'],
  conference: ['#0b2545', '#13315c', '#1d70a2', '#8da9c4', '#eef4ed'],
  community: ['#1b4332', '#2d6a4f', '#95d5b2', '#f4a261', '#fefae0'],
  agency: ['#111827', '#374151', '#10b981', '#a7f3d0', '#f9fafb'],
  other: ['#3d405b', '#81b29a', '#f2cc8f', '#e07a5f', '#f4f1de'],
} as const;

export const log = (msg: string) => console.info(`demo: ${msg}`);

/** Run a step; a failure is reported and the seed goes on with the next feature. */
export async function step<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { code?: string; message?: string; details?: unknown };
    console.warn(
      `demo: FAILED ${label}: ${e.code ?? ''} ${e.message ?? String(err)} ${e.details ? JSON.stringify(e.details) : ''}`,
    );
    failures.push(label);
    return null;
  }
}
export const failures: string[] = [];
