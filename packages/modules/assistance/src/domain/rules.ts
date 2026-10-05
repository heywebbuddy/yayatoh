import { defineStateMachine } from '@yayatoh/kernel';

/**
 * Guest assistance (M3.3b), pure and browser-safe: who can ask for what, how urgent each reason
 * is, how long it may wait for someone to take it (the SLA), and the request's lifecycle.
 * Priorities and SLA times are defaults pending the owner (docs/owner-inbox.md → "Assistance").
 */

/** A guest with a ticket link (seat finder) or door staff on a Scan PWA device. */
export const REQUEST_SOURCES = ['guest', 'staff'] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

/** What a guest can ask for. Medical shows the emergency guidance first. */
export const GUEST_REASONS = ['seat', 'accessibility', 'medical', 'lost_item', 'other'] as const;
export type GuestReason = (typeof GUEST_REASONS)[number];

/** What door staff can ask for from the scanner. */
export const STAFF_REASONS = ['backup', 'supervisor', 'medical', 'security', 'device'] as const;
export type StaffReason = (typeof STAFF_REASONS)[number];

export const REASONS = [...new Set([...GUEST_REASONS, ...STAFF_REASONS])] as readonly (
  | GuestReason
  | StaffReason
)[];
export type Reason = GuestReason | StaffReason;

export const PRIORITIES = ['urgent', 'high', 'normal'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const REQUEST_STATES = ['new', 'assigned', 'in_progress', 'resolved', 'cancelled'] as const;
export type RequestState = (typeof REQUEST_STATES)[number];
/** Requests someone still has to deal with. */
export const OPEN_STATES = ['new', 'assigned', 'in_progress'] as const satisfies readonly RequestState[];
export const CLOSED_STATES = ['resolved', 'cancelled'] as const satisfies readonly RequestState[];

/** What the activity log records (notes carry text; the rest only who and when). */
export const ACTIVITY_KINDS = ['created', 'assigned', 'started', 'resolved', 'cancelled', 'note'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const isGuestReason = (v: string): v is GuestReason =>
  (GUEST_REASONS as readonly string[]).includes(v);
export const isStaffReason = (v: string): v is StaffReason =>
  (STAFF_REASONS as readonly string[]).includes(v);

/**
 * How urgent a request is, from who asked and why: medical and security are urgent; a guest's
 * accessibility need and staff asking for backup or a supervisor are high; the rest normal.
 */
export function priorityFor(source: RequestSource, reason: Reason): Priority {
  if (reason === 'medical' || reason === 'security') return 'urgent';
  if (source === 'guest') return reason === 'accessibility' ? 'high' : 'normal';
  return reason === 'backup' || reason === 'supervisor' ? 'high' : 'normal';
}

/** How long a request may wait for someone to take it (roadmap default, pending the owner). */
export const SLA_MS: Readonly<Record<Priority, number>> = {
  urgent: 2 * 60_000,
  high: 5 * 60_000,
  normal: 10 * 60_000,
};

/** Urgent and high requests are pushed to on-duty staff at once (web push to their devices). */
export const PUSH_PRIORITIES: readonly Priority[] = ['urgent', 'high'];
export const pushes = (p: Priority) => PUSH_PRIORITIES.includes(p);

export const dueAt = (createdAt: Date, priority: Priority) =>
  new Date(createdAt.getTime() + SLA_MS[priority]);

/** Sort order in the queue: most urgent first, then oldest first. */
export const PRIORITY_RANK: Readonly<Record<Priority, number>> = { urgent: 0, high: 1, normal: 2 };

export interface SlaView {
  /** The SLA applies while nobody has taken the request. */
  readonly running: boolean;
  readonly dueAt: Date;
  /** Milliseconds left (negative once overdue). */
  readonly remainingMs: number;
  readonly overdue: boolean;
}

/** The SLA timer of a request right now. */
export function slaStatus(r: { state: RequestState; dueAt: Date }, now: Date): SlaView {
  const running = r.state === 'new';
  const remainingMs = r.dueAt.getTime() - now.getTime();
  return { running, dueAt: r.dueAt, remainingMs, overdue: running && remainingMs < 0 };
}

/**
 * Requests that are past their SLA and still unassigned (the alert engine's
 * `assistanceOverdue` rule counts them).
 */
export function overdue<T extends { state: RequestState; dueAt: Date }>(rows: readonly T[], now: Date): T[] {
  return rows.filter((r) => slaStatus(r, now).overdue);
}

/**
 * new → assigned (someone takes it or is given it) → in progress → resolved; cancelled from any
 * open state. Starting a new request assigns it to whoever starts it; a request may be given to
 * someone else while open (it goes back to assigned).
 */
export const requestLifecycle = defineStateMachine({
  name: 'assistance request',
  states: REQUEST_STATES,
  initial: 'new',
  events: {
    assign: { from: ['new', 'assigned', 'in_progress'], to: 'assigned' },
    start: { from: ['new', 'assigned'], to: 'in_progress' },
    resolve: { from: ['new', 'assigned', 'in_progress'], to: 'resolved' },
    cancel: { from: ['new', 'assigned', 'in_progress'], to: 'cancelled' },
  },
});
export type RequestEvent = keyof typeof requestLifecycle.events;

/** Limits on what people type (also CHECKs in the table). */
export const NOTE_MAX = 500;
export const LOCATION_MAX = 120;
/** A ticket can have this many open requests at once (spam guard beside the rate limit). */
export const MAX_OPEN_PER_TICKET = 3;
