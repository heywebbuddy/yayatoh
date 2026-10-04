import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  checkFromName,
  checkReplyTo,
  createNotifier,
  dispatchDue,
  emailIdentityQuery,
  memoryTransports,
  PLATFORM_SENDER,
  sesEmailTransport,
  setEmailIdentityCommand,
} from '@yayatoh/notifications';
import { addMemberCommand } from '@yayatoh/tenancy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

const ORIGIN = 'https://app.yayatoh.test';
let a: OrgFixture;
let b: OrgFixture;
let managerId: string;
const notifier = createNotifier();

/** Queue one transactional email to `to` and send the org's due mail; the email that went to `to`. */
async function sendOne(f: OrgFixture, to: string) {
  await withTenant(systemCtx(f.org.id), (tx) =>
    notifier.enqueue(tx, {
      kind: 'orders.refund-declined',
      to: { email: to, name: 'Rae' },
      params: { url: `${ORIGIN}/orders/x`, name: 'Rae', eventName: 'Harbor Nights', reason: 'Too late' },
      dedupeKey: `identity-test:${uuidv7()}`,
    }),
  );
  const { transports, emails } = memoryTransports();
  await dispatchDue(f.org.id, { transports, appOrigin: ORIGIN });
  return emails.filter((e) => e.to === to);
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  managerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);
});
afterAll(closePools);

describe('U10 email sending: From name and Reply-To', () => {
  it('validates the From name: no addresses or domains, at most 80 characters', () => {
    expect(checkFromName('  Harbor   Arts  Box Office ')).toEqual({
      value: 'Harbor Arts Box Office',
      problem: null,
    });
    expect(checkFromName('')).toEqual({ value: null, problem: null });
    expect(checkFromName('support@paypal.com').problem).toBe('has_address');
    expect(checkFromName('PayPal <service@paypal.com>').problem).toBe('has_address');
    expect(checkFromName('paypal.com security').problem).toBe('has_domain');
    expect(checkFromName('www.bank').problem).toBe('has_domain');
    expect(checkFromName('Tickets\r\nBcc: x').value).toBe('Tickets Bcc: x');
    expect(checkFromName('x'.repeat(81)).problem).toBe('too_long');
    expect(checkFromName('مهرجان الموسيقى').problem).toBeNull();
  });

  it('validates the Reply-To: a real address, never a platform one', () => {
    expect(checkReplyTo(' Box.Office@Harbor-Arts.org ')).toEqual({
      value: 'box.office@harbor-arts.org',
      problem: null,
    });
    expect(checkReplyTo('')).toEqual({ value: null, problem: null });
    expect(checkReplyTo('not an email').problem).toBe('invalid_email');
    expect(checkReplyTo('a@b').problem).toBe('invalid_email');
    expect(checkReplyTo('a..b@example.org').problem).toBe('invalid_email');
    expect(checkReplyTo('help@yayatoh.com').problem).toBe('platform_address');
    expect(checkReplyTo('help@mail.yayatoh.com').problem).toBe('platform_address');
  });

  it('owners set it; every org email carries the From name and Reply-To; clearing goes back to the org name', async () => {
    const set = await executeCommand(
      setEmailIdentityCommand,
      { fromName: 'Alpha Box Office', replyTo: 'Tickets@Alpha-Events.example' },
      a.ctx(),
      ports,
    );
    expect(set).toMatchObject({
      fromName: 'Alpha Box Office',
      replyTo: 'tickets@alpha-events.example',
      effectiveFromName: 'Alpha Box Office',
      // The fixture's verified sending domain is the address; the name never changes it.
      ownDomain: true,
    });
    expect(set.fromAddress).toMatch(/^notifications@mail\./);
    const [mail] = await sendOne(a, `rae-${uuidv7().slice(-6)}@example.test`);
    expect(mail).toMatchObject({
      from: { name: 'Alpha Box Office', address: PLATFORM_SENDER },
      replyTo: 'tickets@alpha-events.example',
    });

    const cleared = await executeCommand(
      setEmailIdentityCommand,
      { fromName: '', replyTo: '' },
      a.ctx(),
      ports,
    );
    expect(cleared).toMatchObject({ fromName: null, replyTo: null, effectiveFromName: a.org.name });
    const [plain] = await sendOne(a, `rae-${uuidv7().slice(-6)}@example.test`);
    expect(plain?.from.name).toBe(a.org.name);
    expect(plain?.replyTo).toBeUndefined();
    // Org B's mail keeps its own settings (the fixture's).
    const [other] = await sendOne(b, `rae-${uuidv7().slice(-6)}@example.test`);
    expect(other?.replyTo).toBe(`team@${b.org.slug}.example`);
  });

  it('refuses spoofing names and platform addresses, with the field and reason', async () => {
    await expect(
      executeCommand(
        setEmailIdentityCommand,
        { fromName: 'service@paypal.com', replyTo: 'x@yayatoh.com' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: {
        fields: ['fromName', 'replyTo'],
        reasons: { fromName: 'has_address', replyTo: 'platform_address' },
      },
    });
  });

  it('only people who can change the org settings may set it; every member reads it', async () => {
    const manager = userCtx(managerId, a.org.id);
    await expect(
      executeCommand(setEmailIdentityCommand, { fromName: 'Team', replyTo: null }, manager, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        setEmailIdentityCommand,
        { fromName: 'Team', replyTo: null },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const seen = await executeQuery(emailIdentityQuery, {}, userCtx(a.viewerId, a.org.id), ports);
    expect(seen.fromAddress).toMatch(/^notifications@/);
  });

  it('SES gets the Reply-To as ReplyToAddresses (and none when unset)', async () => {
    const bodies: unknown[] = [];
    const t = sesEmailTransport({
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
      configurationSet: 'yayatoh-events',
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(JSON.stringify({ MessageId: 'm-1' }), { status: 200 });
      },
    });
    const base = {
      from: { name: 'Alpha', address: PLATFORM_SENDER },
      to: 'a@example.test',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
      headers: {},
      idempotencyKey: uuidv7(),
    };
    await t.send({ ...base, replyTo: 'tickets@alpha-events.example' });
    await t.send(base);
    expect(bodies[0]).toMatchObject({ ReplyToAddresses: ['tickets@alpha-events.example'] });
    expect(bodies[1]).not.toHaveProperty('ReplyToAddresses');
  });
});
