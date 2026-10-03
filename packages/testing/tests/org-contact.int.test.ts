import {
  contactPageQuery,
  orgContactMessagesQuery,
  orgContactNewCountQuery,
  orgContactNotifier,
  publicContactPage,
  setContactPageCommand,
  submitOrgContactCommand,
} from '@yayatoh/cms';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier, inboxQuery } from '@yayatoh/notifications';
import { catchUpSubscriber } from '@yayatoh/platform';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let marketerId: string;
const notifier = createNotifier();
const visitor = (f: OrgFixture = a) => createCtx({ orgId: f.org.id });

const message = (over: Record<string, unknown> = {}) => ({
  submissionKey: uuidv7(),
  name: 'Noor Haddad',
  email: `noor-${uuidv7().slice(-8)}@example.test`,
  message: 'Is there a family ticket for the Sunday matinee?',
  consent: true as const,
  locale: 'en' as const,
  ...over,
});

async function rowsFor(orgId: string, requestId: string) {
  return withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ channel: string; user_id: string | null }>(
      sql`select channel, recipient_user_id as user_id from notifications.messages where dedupe_key like ${`org-contact:${requestId}%`}`,
    ),
  );
}

async function requestIdFor(orgId: string, email: string): Promise<string> {
  const [r] = await withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ id: string }>(sql`select id from cms.contact_requests where email = ${email}`),
  );
  if (!r) throw new Error(`no request for ${email}`);
  return r.id;
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  marketerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: marketerId, role: 'marketing' }, a.ctx(), ports);
});
afterAll(closePools);

describe('U10 org contact page', () => {
  it('writers turn it on and off; the public page shows only its line of text', async () => {
    const off = await executeCommand(setContactPageCommand, { enabled: false, intro: null }, a.ctx(), ports);
    expect(off).toEqual({ enabled: false, intro: null });
    expect(await publicContactPage(a.org.id)).toBeNull();
    await expect(executeCommand(submitOrgContactCommand, message(), visitor(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    const on = await executeCommand(
      setContactPageCommand,
      { enabled: true, intro: '  We answer within two days.‮ ' },
      userCtx(marketerId, a.org.id),
      ports,
    );
    expect(on).toEqual({ enabled: true, intro: 'We answer within two days.' });
    expect(await publicContactPage(a.org.id)).toEqual({ intro: 'We answer within two days.' });
    expect(await executeQuery(contactPageQuery, {}, userCtx(a.viewerId, a.org.id), ports)).toEqual(on);
    await expect(
      executeCommand(setContactPageCommand, { enabled: false }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a message reaches the org members exactly once, even when resubmitted or replayed', async () => {
    const m = message();
    const first = await executeCommand(submitOrgContactCommand, m, visitor(), ports);
    expect(first).toEqual({ ok: true, duplicate: false });
    // The same form posted again (double click, back button) is the same message.
    expect(await executeCommand(submitOrgContactCommand, m, visitor(), ports)).toEqual({
      ok: true,
      duplicate: true,
    });
    const sub = orgContactNotifier({ notifier });
    await catchUpSubscriber(sub, a.org.id);
    await catchUpSubscriber(sub, a.org.id);
    const id = await requestIdFor(a.org.id, m.email);
    const rows = await rowsFor(a.org.id, id);
    // One email per member who hears about messages (owner and marketing); in-app items below.
    const perMember = new Map<string, string[]>();
    for (const r of rows)
      perMember.set(r.user_id ?? '', [...(perMember.get(r.user_id ?? '') ?? []), r.channel]);
    expect(perMember.get(a.ownerId)).toEqual(['email']);
    expect(perMember.get(marketerId)).toEqual(['email']);
    expect(perMember.has(a.viewerId)).toBe(false);
    const inbox = await executeQuery(inboxQuery, {}, a.ctx(), ports);
    expect(
      inbox.items.filter((i) => i.kind === 'cms.contact_message' && i.href === '/content/contact').length,
    ).toBe((await executeQuery(orgContactMessagesQuery, {}, a.ctx(), ports)).length);

    const list = await executeQuery(orgContactMessagesQuery, {}, userCtx(marketerId, a.org.id), ports);
    expect(list.filter((x) => x.email === m.email)).toEqual([
      expect.objectContaining({ name: 'Noor Haddad', status: 'new', message: m.message }),
    ]);
    expect((await executeQuery(orgContactNewCountQuery, {}, a.ctx(), ports)).count).toBeGreaterThanOrEqual(1);
    // Personal data: viewers can't read the messages.
    await expect(
      executeQuery(orgContactMessagesQuery, {}, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('validates the form: name, a real address, a message of 10+ characters and the consent', async () => {
    for (const bad of [
      { name: '' },
      { email: 'nope' },
      { message: 'hi' },
      { consent: false },
      { message: 'x'.repeat(4001) },
    ])
      await expect(
        executeCommand(submitOrgContactCommand, message(bad), visitor(), ports),
      ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('a message belongs to the org whose page it was sent from', async () => {
    await executeCommand(setContactPageCommand, { enabled: true }, b.ctx(), ports);
    const m = message();
    await executeCommand(submitOrgContactCommand, m, visitor(b), ports);
    expect(
      (await executeQuery(orgContactMessagesQuery, {}, a.ctx(), ports)).some((x) => x.email === m.email),
    ).toBe(false);
    expect(
      (await executeQuery(orgContactMessagesQuery, {}, b.ctx(), ports)).some((x) => x.email === m.email),
    ).toBe(true);
    // The marketplace's own contact requests are not the org's contact page messages.
    expect(
      (await executeQuery(orgContactMessagesQuery, {}, b.ctx(), ports)).some((x) =>
        x.email.includes('sales'),
      ),
    ).toBe(false);
  });
});
