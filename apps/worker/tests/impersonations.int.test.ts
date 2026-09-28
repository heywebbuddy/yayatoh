import { randomBytes } from 'node:crypto';
import {
  createAuth,
  getImpersonation,
  IMPERSONATION_MAX_MS,
  memoryMailer,
  startImpersonation,
} from '@yayatoh/auth';
import { closePools } from '@yayatoh/db/testing';
import { executeQuery, uuidv7 } from '@yayatoh/kernel';
import { auditLogQuery } from '@yayatoh/platform';
import { ports, twoOrgs } from '@yayatoh/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { endExpiredImpersonations } from '../src/impersonations.ts';

afterAll(closePools);

const auth = createAuth({
  baseURL: 'http://localhost:3997',
  secret: randomBytes(32).toString('hex'),
  mailer: memoryMailer().mailer,
});
const person = async (label: string) =>
  (
    await auth.api.signUpEmail({
      body: {
        email: `${label}-${randomBytes(4).toString('hex')}@example.test`,
        password: 'pass-word-123',
        name: label,
      },
    })
  ).user.id;

describe('impersonation expiry (M1.2e)', () => {
  it('ends impersonations whose hour has passed and records the end in the org’s audit log once', async () => {
    const { a } = await twoOrgs();
    const staff = await person('staff');
    const member = await person('member');
    const started = new Date(Date.now() - IMPERSONATION_MAX_MS - 5_000);
    const { impersonation } = await startImpersonation({
      id: uuidv7(),
      staffUserId: staff,
      userId: member,
      orgId: a.org.id,
      reason: 'Expiry test',
      returnUrl: 'http://localhost:3001/',
      appHost: 'localhost:3997',
      returnPath: '/o/x',
      now: started,
    });
    const open = await startImpersonation({
      id: uuidv7(),
      staffUserId: staff,
      userId: member,
      orgId: a.org.id,
      reason: 'Still open',
      returnUrl: 'http://localhost:3001/',
      appHost: 'localhost:3997',
      returnPath: '/o/x',
    });
    expect(await endExpiredImpersonations()).toBeGreaterThanOrEqual(1);
    expect(await getImpersonation(impersonation.id)).toMatchObject({ endedReason: 'expired' });
    expect((await getImpersonation(open.impersonation.id))?.endedAt).toBeNull();
    // A second run finds nothing more to end for it.
    await endExpiredImpersonations();
    const log = await executeQuery(
      auditLogQuery,
      { filter: { action: 'impersonation.end' } },
      a.ctx(),
      ports,
    );
    const mine = log.entries.filter((e) => e.targetId === member);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      actor: 'system:auth.impersonation-expiry',
      details: { reason: 'expired' },
    });
  });
});
