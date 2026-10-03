import 'server-only';
import { type ConferenceSources, connectedConferenceSources } from '@yayatoh/alerts';
import { devAuthEnabled } from './dev.ts';

/**
 * M5.9a: the conference pack's facts from modules behind ports — leads (M5.6b, not built yet), sponsor
 * deliverables (M5.4b) and badge printers (M5.5b; both connected since the batch 3j merge). With the
 * dev shortcuts on (dev and CI only), a fake holds per-event values that e2e sets through
 * `/api/dev/conference`; for an event it never heard of the connected source answers (leads: null).
 */
export interface DevConferenceFakes {
  readonly leads: Map<string, Map<string, number>>;
  readonly deliverables: Map<string, number>;
  readonly printers: Map<string, number>;
}

const KEY = Symbol.for('yayatoh.devConferenceFakes');

/** The dev fake's state (one per server process, shared by route handlers and pages). */
export function devConferenceFakes(): DevConferenceFakes {
  const g = globalThis as { [KEY]?: DevConferenceFakes };
  g[KEY] ??= { leads: new Map(), deliverables: new Map(), printers: new Map() };
  return g[KEY];
}

/**
 * The sources the alert engine and the Command Center read. Deliverables (M5.4b) and printers
 * (M5.5b) are connected (batch 3j merge); leads (M5.6b) are not built yet. With the dev shortcuts
 * on, the fake answers first for an event e2e told it about, else the connected source.
 */
export function conferenceSources(): ConferenceSources {
  const real = connectedConferenceSources;
  if (!devAuthEnabled()) return real;
  const s = devConferenceFakes();
  return {
    exhibitorLeads: async (_tx, eventId) => s.leads.get(eventId) ?? null,
    overdueDeliverables: async (tx, eventId, now) =>
      s.deliverables.get(eventId) ?? (await real.overdueDeliverables?.(tx, eventId, now)) ?? null,
    printersOffline: async (tx, eventId, now) =>
      s.printers.get(eventId) ?? (await real.printersOffline?.(tx, eventId, now)) ?? null,
  };
}
