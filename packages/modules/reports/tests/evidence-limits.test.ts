import { describe, expect, it } from 'vitest';
import {
  type EvidenceDocument,
  estimatePages,
  fitEvidenceDocument,
  PACKET_LIMITS,
  packetWithinLimits,
} from '../src/dispute-evidence.ts';

const rows = (n: number, cells = 4) =>
  Array.from({ length: n }, (_, i) => Array.from({ length: cells }, (_, j) => `r${i}c${j}`));
const doc = (over: Partial<Record<'tickets' | 'accessLog' | 'messages', number>> = {}): EvidenceDocument => ({
  lang: 'en',
  title: 'Dispute',
  subtitle: 'Seller',
  footer: 'Footer',
  sections: [
    { id: 'statement', title: 'Statement', text: 'Checked in twice at the north gate.' },
    { id: 'dispute', title: 'Dispute', rows: [['Reason', 'fraudulent']] },
    { id: 'tickets', title: 'Tickets', table: { head: ['#'], body: rows(over.tickets ?? 4, 5) } },
    { id: 'accessLog', title: 'Access log', table: { head: ['t'], body: rows(over.accessLog ?? 6) } },
    { id: 'messages', title: 'Messages', table: { head: ['t'], body: rows(over.messages ?? 3) } },
  ],
});
const note = (n: number) => `${n} more rows left out to stay within 19 pages.`;

describe('evidence packet limits (4.5 MB / 19 pages, M1.6e)', () => {
  it('a normal packet fits on a page or two and is left as it is', () => {
    const d = doc();
    expect(estimatePages(d)).toBeLessThanOrEqual(2);
    expect(fitEvidenceDocument(d, note)).toEqual(d);
  });

  it('a huge access log is cut first, with a note saying how many rows were left out', () => {
    const d = doc({ accessLog: 2_000, messages: 50, tickets: 60 });
    expect(estimatePages(d)).toBeGreaterThan(PACKET_LIMITS.maxPages);
    const fit = fitEvidenceDocument(d, note);
    expect(estimatePages(fit)).toBeLessThanOrEqual(PACKET_LIMITS.maxPages);
    const log = fit.sections.find((s) => s.id === 'accessLog');
    const kept = log?.table?.body.length ?? 0;
    expect(kept).toBeLessThan(2_000);
    expect(log?.note).toBe(note(2_000 - kept));
    // Tickets and messages were short enough to survive whole.
    expect(fit.sections.find((s) => s.id === 'tickets')?.table?.body).toHaveLength(60);
    expect(fit.sections.find((s) => s.id === 'messages')?.table?.body).toHaveLength(50);
  });

  it('when one table is not enough, the next is cut too; the statement and the dispute never are', () => {
    const d = doc({ accessLog: 1_500, messages: 1_500, tickets: 1_500 });
    const fit = fitEvidenceDocument(d, note, 3);
    expect(estimatePages(fit)).toBeLessThanOrEqual(3);
    expect(fit.sections.map((s) => s.id)).toEqual([
      'statement',
      'dispute',
      'tickets',
      'accessLog',
      'messages',
    ]);
    expect(fit.sections[0]?.text).toBe('Checked in twice at the north gate.');
  });

  it('wrapped text counts: a very long statement is trimmed only as a last resort', () => {
    const long = 'word '.repeat(40_000);
    const d: EvidenceDocument = { ...doc(), sections: [{ id: 'statement', title: 'S', text: long }] };
    expect(estimatePages(d)).toBeGreaterThan(19);
    const fit = fitEvidenceDocument(d, note);
    expect(fit.sections[0]?.text?.length).toBeLessThan(long.length);
  });

  it('a rendered PDF is checked for size and page count before it is submitted', () => {
    const pdf = (pages: number, padding = 0) =>
      new TextEncoder().encode(
        `%PDF-1.7\n1 0 obj <</Type /Pages /Count ${pages}>>\n${'3 0 obj <</Type /Page /Parent 1 0 R>>\n'.repeat(pages)}${' '.repeat(padding)}%%EOF`,
      );
    expect(packetWithinLimits(pdf(3))).toMatchObject({ ok: true, pages: 3 });
    expect(packetWithinLimits(pdf(19))).toMatchObject({ ok: true, pages: 19 });
    expect(packetWithinLimits(pdf(20))).toMatchObject({ ok: false, pages: 20 });
    expect(packetWithinLimits(pdf(1, 4_500_001))).toMatchObject({ ok: false, pages: 1 });
    expect(packetWithinLimits(new Uint8Array(10))).toMatchObject({ ok: false, pages: 0 });
  });
});
