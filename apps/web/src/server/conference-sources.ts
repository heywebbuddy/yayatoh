import 'server-only';
import type { ConferenceSources } from '@yayatoh/alerts';
import { devAuthEnabled } from './dev.ts';

/**
 * M5.9a: the conference pack's facts from modules not on this build yet — leads (M5.6b), sponsor
 * deliverables (M5.4b) and badge printers (M5.5b). In production there is no source yet, so their
 * rules stay quiet and their tiles say the source isn't connected. With the dev shortcuts on (dev
 * and CI only), a fake holds per-event values that e2e sets through `/api/dev/conference`; an
 * event it never heard of is "not served" (null), so other suites' events are unaffected.
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

/** The sources the alert engine and the Command Center read (undefined: none connected). */
export function conferenceSources(): ConferenceSources | undefined {
  if (!devAuthEnabled()) return undefined;
  const s = devConferenceFakes();
  return {
    exhibitorLeads: async (_tx, eventId) => s.leads.get(eventId) ?? null,
    overdueDeliverables: async (_tx, eventId) => s.deliverables.get(eventId) ?? null,
    printersOffline: async (_tx, eventId) => s.printers.get(eventId) ?? null,
  };
}
