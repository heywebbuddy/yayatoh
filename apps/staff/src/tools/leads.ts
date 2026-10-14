/**
 * Lead retrieval for exhibitor reps (M7.4c, P5-4 and P5-8). A rep scans an attendee's badge, rates
 * the lead, ticks the exhibitor's qualifiers and writes notes. Every scan goes into an encrypted
 * outbox first and is sent to `POST /v1/portal/leads/scans` in batches of up to 200, so scanning
 * works on a show floor with no signal; the server applies each `scanId` once.
 *
 * What may be shown follows the attendee's consent (P5-8): a field of a lead appears only if the
 * attendee agreed to share it (`sharedFields`), and the email only with its consent and not
 * withdrawn. Which leads a rep may see, and whether they hold a licence (P5-4), are the server's
 * decisions; the app only displays what the routes return for the rep's own session.
 */
import { YayatohApiError } from '@yayatoh/sdk';
import type { Lead, LeadRating, LeadScan, LeadScanResult, LeadSetup, PortalApi } from './api';
import type { Vault } from './vault';

export const SYNC_BATCH_MAX = 200;
export const MAX_QUALIFIERS = 10;
export const QUALIFIER_MAX = 60;
export const NOTES_MAX = 2000;
export const RATINGS: readonly LeadRating[] = ['hot', 'warm', 'cold'];
const OUTBOX_FILE = 'lead-outbox';

/* ------------------------------------------------------------------ consent ---- */

export interface ShownLead {
  readonly id: string;
  readonly name: string | null;
  readonly jobTitle: string | null;
  readonly company: string | null;
  readonly email: string | null;
  /** The attendee agreed to share their email, then took it back. */
  readonly emailWithdrawn: boolean;
  readonly rating: LeadRating | null;
  readonly qualifiers: readonly string[];
  readonly notes: string;
  readonly capturedAt: string;
  readonly lastScannedAt: string;
  readonly scans: number;
  readonly scannedByMe: boolean;
  readonly scannedBy: string | null;
}

/**
 * A lead reduced to what the attendee agreed to share. A field they did not share is `null`
 * whatever the response holds, and the email is shown only with its consent and while it stands.
 */
export function shownLead(lead: Lead): ShownLead {
  const shared = new Set<string>(lead.sharedFields);
  const emailOk = shared.has('email') && lead.email !== null && lead.emailWithdrawnAt === null;
  return {
    id: lead.id,
    name: shared.has('name') && lead.name ? lead.name : null,
    jobTitle: shared.has('job_title') && lead.jobTitle ? lead.jobTitle : null,
    company: shared.has('company') && lead.company ? lead.company : null,
    email: emailOk ? lead.email : null,
    emailWithdrawn: shared.has('email') && lead.emailWithdrawnAt !== null,
    rating: lead.rating,
    qualifiers: lead.qualifiers,
    notes: lead.notes,
    capturedAt: lead.capturedAt,
    lastScannedAt: lead.lastScannedAt,
    scans: lead.scans,
    scannedByMe: lead.scannedByMe,
    scannedBy: lead.scannedBy,
  };
}

/** Search over what the rep may see: the shown fields and their own notes. */
export function matchesLead(lead: ShownLead, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [lead.name, lead.company, lead.jobTitle, lead.email, lead.notes].some((v) =>
    (v ?? '').toLowerCase().includes(q),
  );
}

/* ------------------------------------------------------------------- licence ---- */

export type ScanGate =
  | { readonly open: true }
  | {
      readonly open: false;
      readonly why: 'no_license' | 'over_allowance' | 'terms' | 'not_open' | 'closed';
    };

/**
 * Whether this rep can scan right now, from the setup the route returned (P5-4: a licence within
 * the allowance; the exhibitor admin has accepted the lead terms; the capture window is open at
 * the phone's time). The server decides again for every scan.
 */
export function scanGate(setup: LeadSetup, now: Date): ScanGate {
  if (setup.license === 'unlicensed') return { open: false, why: 'no_license' };
  if (setup.license === 'over_allowance') return { open: false, why: 'over_allowance' };
  if (!setup.termsAccepted) return { open: false, why: 'terms' };
  const t = now.getTime();
  if (t < Date.parse(setup.capture.opensAt)) return { open: false, why: 'not_open' };
  if (t > Date.parse(setup.capture.closesAt)) return { open: false, why: 'closed' };
  return { open: true };
}

/* -------------------------------------------------------------------- edits ---- */

export type EditProblem = 'too_many_qualifiers' | 'qualifier_too_long' | 'notes_too_long';

export function checkEdit(edit: {
  qualifiers: readonly string[];
  notes: string;
}): EditProblem | null {
  if (edit.qualifiers.length > MAX_QUALIFIERS) return 'too_many_qualifiers';
  if (edit.qualifiers.some((q) => q.length > QUALIFIER_MAX)) return 'qualifier_too_long';
  if (edit.notes.length > NOTES_MAX) return 'notes_too_long';
  return null;
}

/* ------------------------------------------------------------------- outbox ---- */

export interface QueuedLeadScan extends LeadScan {
  /** Whose queue this is, so another rep who signs in on this phone never sees or sends it. */
  readonly owner: string;
}

export type FlushFailure = 'unreachable' | 'no_license' | 'over_allowance' | 'terms' | 'ended' | 'rejected';

export interface LeadFlush {
  /** The server's answer for every scan it took. */
  readonly results: readonly LeadScanResult[];
  readonly pending: number;
  readonly failure: FlushFailure | null;
}

export interface LeadOutbox {
  pending(): Promise<readonly QueuedLeadScan[]>;
  add(input: {
    code: string;
    rating?: LeadRating | null;
    qualifiers?: readonly string[];
    notes?: string;
    offline?: boolean;
  }): Promise<QueuedLeadScan>;
  /** Edits made while the scan is still waiting ride along with it. */
  edit(
    scanId: string,
    edit: { rating?: LeadRating | null; qualifiers?: readonly string[]; notes?: string },
  ): Promise<void>;
  flush(): Promise<LeadFlush>;
  clear(): Promise<void>;
}

/** Why a sync was refused, from the problem the route returned. */
export function failureOf(err: unknown): FlushFailure {
  if (!(err instanceof YayatohApiError)) return 'unreachable';
  if (err.status === 403) {
    const reason = (err.problem as { reason?: string } | null)?.reason;
    return reason === 'over_allowance' ? 'over_allowance' : 'no_license';
  }
  if (err.status === 409) {
    const reason = (err.problem as { reason?: string } | null)?.reason;
    return reason === 'terms_not_accepted' ? 'terms' : 'ended';
  }
  if (err.status === 401 || err.status >= 500 || err.status === 429 || err.status === 408) return 'unreachable';
  return 'rejected';
}

export function createLeadOutbox(deps: {
  readonly vault: Vault;
  readonly api: PortalApi | null;
  readonly owner: string;
  readonly newId: () => string;
  readonly now?: () => Date;
}): LeadOutbox {
  const now = deps.now ?? (() => new Date());
  const readAll = async () => (await deps.vault.read<QueuedLeadScan[]>(OUTBOX_FILE)) ?? [];
  const mine = (all: readonly QueuedLeadScan[]) => all.filter((s) => s.owner === deps.owner);
  let running: Promise<LeadFlush> | null = null;

  async function run(): Promise<LeadFlush> {
    const results: LeadScanResult[] = [];
    let queue = mine(await readAll()).sort(
      (a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.scanId.localeCompare(b.scanId),
    );
    if (!deps.api) return { results, pending: queue.length, failure: queue.length ? 'unreachable' : null };
    while (queue.length > 0) {
      const batch = queue.slice(0, SYNC_BATCH_MAX);
      let answered: readonly LeadScanResult[];
      try {
        answered = await deps.api.syncScans(batch.map(({ owner: _o, ...scan }) => scan));
      } catch (err) {
        return { results, pending: queue.length, failure: failureOf(err) };
      }
      const done = new Set(answered.map((r) => r.scanId));
      results.push(...answered);
      const all = await readAll();
      await deps.vault.write(
        OUTBOX_FILE,
        all.filter((s) => !(s.owner === deps.owner && done.has(s.scanId))),
      );
      queue = queue.filter((s) => !done.has(s.scanId));
      if (done.size === 0) return { results, pending: queue.length, failure: 'unreachable' };
    }
    return { results, pending: 0, failure: null };
  }

  return {
    pending: async () => mine(await readAll()),
    async add(input) {
      const scan: QueuedLeadScan = {
        owner: deps.owner,
        scanId: deps.newId(),
        code: input.code.trim(),
        capturedAt: now().toISOString(),
        offline: input.offline ?? false,
        ...(input.rating !== undefined ? { rating: input.rating } : {}),
        ...(input.qualifiers ? { qualifiers: [...input.qualifiers] } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      };
      await deps.vault.write(OUTBOX_FILE, [...(await readAll()), scan]);
      return scan;
    },
    async edit(scanId, edit) {
      const all = await readAll();
      await deps.vault.write(
        OUTBOX_FILE,
        all.map((s) =>
          s.owner === deps.owner && s.scanId === scanId
            ? {
                ...s,
                ...(edit.rating !== undefined ? { rating: edit.rating } : {}),
                ...(edit.qualifiers ? { qualifiers: [...edit.qualifiers] } : {}),
                ...(edit.notes !== undefined ? { notes: edit.notes } : {}),
              }
            : s,
        ),
      );
    },
    flush() {
      running ??= run().finally(() => {
        running = null;
      });
      return running;
    },
    async clear() {
      const all = await readAll();
      await deps.vault.write(
        OUTBOX_FILE,
        all.filter((s) => s.owner !== deps.owner),
      );
    },
  };
}

/** What a refused scan means for the rep, as a catalog key under `leads.refused`. */
export const refusalKey = (r: LeadScanResult): string => r.reason ?? 'invalid';
