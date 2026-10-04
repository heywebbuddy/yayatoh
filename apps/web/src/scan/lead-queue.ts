/**
 * Pure helpers of the Scan PWA's lead mode (M5.6b), unit-tested in `tests/scan-lead-queue.test.ts`.
 * The queue lives in IndexedDB (`lead-store.ts`), keyed by scan id; the server applies each scan
 * id once, so a batch can be resent until an answer arrives.
 */

export interface QueuedLeadScan {
  readonly scanId: string;
  readonly code: string;
  /** ISO time of the scan on this device. */
  readonly capturedAt: string;
  readonly offline: boolean;
  readonly rating?: 'hot' | 'warm' | 'cold' | null;
  readonly qualifiers?: readonly string[];
  readonly notes?: string;
}

/** A lead as the API returns it (dates as ISO strings). */
export interface LeadView {
  readonly id: string;
  readonly name: string;
  readonly jobTitle: string;
  readonly company: string;
  readonly email: string | null;
  readonly sharedFields: readonly string[];
  readonly emailConsentVersion: number | null;
  readonly emailWithdrawnAt: string | null;
  readonly rating: 'hot' | 'warm' | 'cold' | null;
  readonly qualifiers: readonly string[];
  readonly notes: string;
  readonly capturedAt: string;
  readonly lastScannedAt: string;
  readonly scans: number;
  readonly scannedByMe: boolean;
  readonly scannedBy: string | null;
}

export interface ScanResultView {
  readonly scanId: string;
  readonly status: 'captured' | 'rescanned' | 'refused';
  readonly reason: 'invalid' | 'wrong_event' | 'not_open' | 'closed' | null;
  readonly lead: LeadView | null;
}

/** The queue to send: each scan id once (first kept), oldest first. */
export function pendingBatches(queue: readonly QueuedLeadScan[], size: number): QueuedLeadScan[][] {
  const seen = new Set<string>();
  const items = queue
    .filter((s) => {
      if (seen.has(s.scanId)) return false;
      seen.add(s.scanId);
      return true;
    })
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.scanId.localeCompare(b.scanId));
  const out: QueuedLeadScan[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Leads after a sync: answered leads replace the ones with the same id, new ones first. */
export function mergeLeads(list: readonly LeadView[], results: readonly ScanResultView[]): LeadView[] {
  const fresh = new Map<string, LeadView>();
  for (const r of results) if (r.lead) fresh.set(r.lead.id, r.lead);
  const kept = list.filter((l) => !fresh.has(l.id));
  return [...fresh.values(), ...kept].sort(
    (a, b) => b.lastScannedAt.localeCompare(a.lastScannedAt) || b.id.localeCompare(a.id),
  );
}

/** Edits made to a scan still waiting in the queue ride along with it. */
export function withEdits(
  scan: QueuedLeadScan,
  edits: Pick<QueuedLeadScan, 'rating' | 'qualifiers' | 'notes'>,
): QueuedLeadScan {
  return { ...scan, ...edits };
}

/** Case-insensitive search over the allowlisted fields of a lead. */
export function matchesLead(lead: LeadView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [lead.name, lead.company, lead.jobTitle, lead.email ?? '', lead.notes].some((v) =>
    v.toLowerCase().includes(q),
  );
}
