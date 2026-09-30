import { consoleMailer, createAuth } from '@yayatoh/auth';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setStaff } from '../src/staff.ts';

beforeAll(() => setPlatformAuditSink(databaseAuditSink));
afterAll(closePools);

const auth = createAuth({ baseURL: 'http://localhost:3001', secret: 's'.repeat(40), mailer: consoleMailer });
const createUser = async (p: { email: string; name: string }) =>
  (await auth.api.signUpEmail({ body: { ...p, password: 'correct horse battery' } })).user;

const staffRole = async (userId: string) => {
  const [r] = await withPlatformReader({ actor: 'test', reason: 'read staff' }, (tx) =>
    tx.execute<{ role: string }>(
      sql`select role from platform.staff where user_id = ${userId} and revoked_at is null`,
    ),
  );
  return r?.role ?? null;
};

describe('platform staff (M1.3e)', () => {
  it('adds, changes and revokes staff by email, and logs every platform read', async () => {
    const email = `staff-${Date.now()}@example.test`;
    const user = await createUser({ email, name: 'Sam Staff' });
    expect(await setStaff({ email: email.toUpperCase(), role: 'support', by: 'staff:test' })).toBe(user.id);
    expect(await staffRole(user.id)).toBe('support');
    await setStaff({ email, role: 'admin', by: 'staff:test' });
    expect(await staffRole(user.id)).toBe('admin');
    await setStaff({ email, role: null, by: 'staff:test' });
    expect(await staffRole(user.id)).toBeNull();
    const [log] = await withPlatformReader({ actor: 'test', reason: 'read log' }, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.access_log where reason ilike ${`%${email}`}`,
      ),
    );
    expect(log?.n).toBe(3);
  });

  it('refuses unknown people and roles', async () => {
    await expect(setStaff({ email: 'nobody@example.test', role: 'admin', by: 't' })).rejects.toThrow();
    await expect(setStaff({ email: 'nobody@example.test', role: 'owner' as never, by: 't' })).rejects.toThrow(
      /unknown role/,
    );
  });

  it('the runtime role cannot read or write staff or the access log', async () => {
    const { withoutTenant } = await import('@yayatoh/db');
    await expect(withoutTenant((tx) => tx.execute(sql`select * from platform.staff`))).rejects.toThrow();
    await expect(
      withoutTenant((tx) => tx.execute(sql`select platform.log_access('x', 'y')`)),
    ).rejects.toThrow();
  });
});
