import { attendeeLabelBulk } from '@yayatoh/attendees';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { ports, twoOrgs } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDueBulkOperations } from '../src/bulk.ts';

const audited: string[] = [];
beforeAll(() => setPlatformAuditSink(async ({ actor }) => void audited.push(actor)));
afterAll(closePools);

describe('bulk runner (worker)', () => {
  it('finds unfinished operations across orgs and finishes each under its own org', async () => {
    const { a, b } = await twoOrgs();
    const ops = [];
    for (const f of [a, b])
      ops.push({
        f,
        op: await executeCommand(
          attendeeLabelBulk.start,
          { eventId: f.event.id, selection: { filter: {} }, params: { add: ['Worker'] } },
          f.ctx(),
          ports,
        ),
      });
    expect(await runDueBulkOperations(5_000, new Set([a.org.id, b.org.id]))).toBe(2);
    for (const { f, op } of ops)
      expect(
        (await executeQuery(attendeeLabelBulk.status, { operationId: op.operationId }, f.ctx(), ports))
          .status,
      ).toBe('done');
    expect(await runDueBulkOperations(5_000, new Set([a.org.id, b.org.id]))).toBe(0);
    // Cross-org discovery used the audited platform reader.
    expect(audited).toContain('system:bulk-runner');
  });
});
