import { describe, expect, it } from 'vitest';
import {
  type LeadView,
  matchesLead,
  mergeLeads,
  pendingBatches,
  type QueuedLeadScan,
  withEdits,
} from '../src/scan/lead-queue.ts';

const q = (scanId: string, minute: number): QueuedLeadScan => ({
  scanId,
  code: `CODE${scanId}`,
  capturedAt: new Date(Date.UTC(2030, 9, 20, 15, minute)).toISOString(),
  offline: true,
});

const lead = (id: string, at: string, extra: Partial<LeadView> = {}): LeadView => ({
  id,
  name: `Name ${id}`,
  jobTitle: 'CTO',
  company: 'Acme',
  email: null,
  sharedFields: ['name', 'job_title', 'company'],
  emailConsentVersion: null,
  emailWithdrawnAt: null,
  rating: null,
  qualifiers: [],
  notes: '',
  capturedAt: at,
  lastScannedAt: at,
  scans: 1,
  scannedByMe: true,
  scannedBy: null,
  ...extra,
});

describe('lead queue (M5.6b)', () => {
  it('sends each scan once, oldest first, in batches', () => {
    const batches = pendingBatches([q('c', 3), q('a', 1), q('b', 2), q('a', 9)], 2);
    expect(batches.map((b) => b.map((s) => s.scanId))).toEqual([['a', 'b'], ['c']]);
  });

  it('merges answered leads over the cached list, newest first', () => {
    const list = [lead('1', '2030-10-20T15:00:00Z'), lead('2', '2030-10-20T15:05:00Z')];
    const merged = mergeLeads(list, [
      {
        scanId: 's',
        status: 'rescanned',
        reason: null,
        lead: lead('1', '2030-10-20T15:10:00Z', { scans: 2 }),
      },
      { scanId: 't', status: 'refused', reason: 'invalid', lead: null },
    ]);
    expect(merged.map((l) => [l.id, l.scans])).toEqual([
      ['1', 2],
      ['2', 1],
    ]);
  });

  it('keeps edits on a queued scan', () => {
    expect(withEdits(q('a', 1), { rating: 'hot', notes: 'Call back' })).toMatchObject({
      scanId: 'a',
      rating: 'hot',
      notes: 'Call back',
    });
  });

  it('searches the allowlisted fields only', () => {
    const l = lead('1', '2030-10-20T15:00:00Z', { email: 'pat@example.com', notes: 'Wants pricing' });
    expect(matchesLead(l, 'ACME')).toBe(true);
    expect(matchesLead(l, 'pricing')).toBe(true);
    expect(matchesLead(l, 'pat@')).toBe(true);
    expect(matchesLead(l, 'nobody')).toBe(false);
    expect(matchesLead(l, '  ')).toBe(true);
  });
});
