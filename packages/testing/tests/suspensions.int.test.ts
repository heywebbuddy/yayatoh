import { attendeeEmailBulk } from '@yayatoh/attendees';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import { payoutAccountQuery, setPayoutHoldCommand } from '@yayatoh/payments';
import {
  publicOrgProfile,
  setSuspensionCommand,
  suspensionHistoryQuery,
  suspensionsQuery,
} from '@yayatoh/tenancy';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;

const pause = (
  o: OrgFixture,
  kind: 'pause_checkout' | 'pause_publishing' | 'pause_messaging',
  paused = true,
) =>
  executeCommand(
    setSuspensionCommand,
    { kind, paused, reason: 'test: chargeback spike' },
    systemCtx(o.org.id),
    ports,
  );

const buy = async (o: OrgFixture) => {
  const [t] = await executeQuery(listTicketTypesQuery, { eventId: o.event.id }, o.ctx(), ports);
  if (!t) throw new Error('no ticket type');
  return executeCommand(
    startCheckoutCommand,
    {
      eventId: o.event.id,
      items: [{ ticketTypeId: t.id, quantity: 1 }],
      buyer: { email: 'paused@example.test', name: 'Paused Buyer' },
    },
    createCtx({ orgId: o.org.id }),
    ports,
  );
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('kill switches (M1.3e)', () => {
  it('only staff (a platform actor) can pause, never an org owner', async () => {
    await expect(
      executeCommand(
        setSuspensionCommand,
        { kind: 'pause_checkout', paused: true, reason: 'self-serve' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('pause checkout: the very next checkout is refused, other orgs keep selling, lifting restores it', async () => {
    expect(await pause(a, 'pause_checkout')).toEqual({ kind: 'pause_checkout', paused: true, changed: true });
    expect((await pause(a, 'pause_checkout')).changed).toBe(false);
    await expect(buy(a)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'checkout_paused' },
    });
    expect((await publicOrgProfile(a.org.id))?.checkoutPaused).toBe(true);
    expect((await buy(b)).order.status).toBe('reserved');
    // The organizer sees what is paused, never the staff note.
    const seen = await executeQuery(suspensionsQuery, {}, a.ctx(), ports);
    expect(seen.map((s) => s.kind)).toEqual(['pause_checkout']);
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(['kind', 'since']);
    await pause(a, 'pause_checkout', false);
    expect((await buy(a)).order.status).toBe('reserved');
    expect((await publicOrgProfile(a.org.id))?.checkoutPaused).toBe(false);
  });

  it('pause publishing blocks going live', async () => {
    const e = await executeCommand(
      createEventCommand,
      {
        name: 'Paused launch',
        timezone: 'UTC',
        startsAt: '2028-01-01T18:00:00Z',
        endsAt: '2028-01-01T20:00:00Z',
      },
      a.ctx(),
      ports,
    );
    await pause(a, 'pause_publishing');
    await expect(
      executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports),
    ).rejects.toMatchObject({ details: { reason: 'publishing_paused' } });
    await pause(a, 'pause_publishing', false);
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
  });

  it('pause messaging blocks starting a bulk email', async () => {
    await pause(a, 'pause_messaging');
    await expect(
      executeCommand(
        attendeeEmailBulk.start,
        {
          eventId: a.event.id,
          selection: { filter: {} },
          params: { subject: 'Hello', body: 'World' },
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'messaging_paused' } });
    await pause(a, 'pause_messaging', false);
  });

  it('staff see the history with notes; the organizer cannot read it', async () => {
    const history = await executeQuery(suspensionHistoryQuery, {}, systemCtx(a.org.id), ports);
    expect(history.filter((h) => h.kind === 'pause_checkout')).toMatchObject([
      { reason: 'test: chargeback spike', createdBy: 'system:fixture', liftedBy: 'system:fixture' },
    ]);
    await expect(executeQuery(suspensionHistoryQuery, {}, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('payout holds (M1.3e)', () => {
  it('staff hold and release payouts; the organizer sees the hold, not the note', async () => {
    await expect(
      executeCommand(setPayoutHoldCommand, { held: true, reason: 'self' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(
      await executeCommand(
        setPayoutHoldCommand,
        { held: true, reason: 'KYC review' },
        systemCtx(a.org.id),
        ports,
      ),
    ).toEqual({ held: true, changed: true });
    const seen = await executeQuery(payoutAccountQuery, {}, a.ctx(), ports);
    expect(seen.onHold).toBe(true);
    expect(JSON.stringify(seen)).not.toContain('KYC review');
    expect((await executeQuery(payoutAccountQuery, {}, b.ctx(), ports)).onHold).toBe(false);
    await executeCommand(
      setPayoutHoldCommand,
      { held: false, reason: 'cleared' },
      systemCtx(a.org.id),
      ports,
    );
    expect((await executeQuery(payoutAccountQuery, {}, a.ctx(), ports)).onHold).toBe(false);
  });
});
