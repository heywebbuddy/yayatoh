import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { getFormQuery, listResponsesQuery, publicForm, publishFormCommand } from '@yayatoh/forms';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let bare: string;
let free: { id: string };

const subject = () => ({
  kind: 'checkout_questions' as const,
  subjectType: 'event' as const,
  subjectId: eventId,
});
const QUESTIONS = {
  fields: [
    { key: 'with_kids', type: 'checkbox', label: 'Bringing kids?' },
    {
      key: 'kids',
      type: 'count',
      label: 'How many kids?',
      required: true,
      max: 6,
      showIf: { '==': [{ var: 'with_kids' }, true] },
    },
    {
      key: 'seating',
      type: 'select',
      label: 'Seated or standing?',
      required: true,
      options: [
        { value: 'seated', label: 'Seated' },
        { value: 'standing', label: 'Standing' },
      ],
    },
    { key: 'medical', type: 'short_text', label: 'Medical notes', sensitive: true },
  ],
};

async function event(name: string) {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone: 'UTC', startsAt: '2027-12-01T18:00:00Z', endsAt: '2027-12-01T23:00:00Z' },
    a.ctx(),
    ports,
  );
  const t = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'Free', priceMinor: 0, quantityTotal: 100 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
  return { id: e.id, ticketTypeId: t.id };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await event('Forms');
  eventId = e.id;
  free = { id: e.ticketTypeId };
  bare = (await event('No Questions')).id;
});
afterAll(closePools);

const buy = (answers: Record<string, unknown>, onEvent = eventId, ticketTypeId = free.id) =>
  executeCommand(
    startCheckoutCommand,
    {
      eventId: onEvent,
      items: [{ ticketTypeId, quantity: 1 }],
      buyer: { email: 'f@example.test', name: 'F' },
      answers,
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );

describe('checkout questions (forms engine v1)', () => {
  it('publishing writes a new immutable version each time', async () => {
    expect(
      await executeCommand(publishFormCommand, { ...subject(), definition: QUESTIONS }, a.ctx(), ports),
    ).toEqual({
      version: 1,
    });
    const pub = await publicForm(a.org.id, subject());
    expect(pub?.fields.map((f) => f.key)).toEqual(['with_kids', 'kids', 'seating', 'medical']);
  });

  it('stores valid answers; drops questions hidden by their condition; encrypts sensitive ones', async () => {
    const r = await buy({ with_kids: 'on', kids: '2', seating: 'seated', medical: 'Nut allergy' });
    const skip = await buy({ kids: '3', seating: 'standing' });
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ answers: Record<string, unknown>; c: string | null }>(
        sql`select answers, sensitive_ciphertext as c from forms.form_responses where respondent_id = ${r.order.id}`,
      ),
    );
    expect(row?.answers).toEqual({ with_kids: true, kids: 2, seating: 'seated' });
    expect(row?.c).toMatch(/^local\.v1\./);
    expect(JSON.stringify(row)).not.toContain('Nut allergy');

    const list = await executeQuery(
      listResponsesQuery,
      { ...subject(), respondentIds: [r.order.id, skip.order.id] },
      a.ctx(),
      ports,
    );
    const by = new Map(list.responses.map((x) => [x.respondentId, x.answers]));
    expect(by.get(r.order.id)).toEqual({
      with_kids: true,
      kids: 2,
      seating: 'seated',
      medical: 'Nut allergy',
    });
    expect(by.get(skip.order.id)).toEqual({ seating: 'standing' }); // kids hidden → not stored
    expect(list.questions.kids?.label).toBe('How many kids?');
    expect(list.questions.seating?.options).toEqual({ seated: 'Seated', standing: 'Standing' });
  });

  it('rejects invalid answers, naming the question, and rolls back the order', async () => {
    for (const [answers, field] of [
      [{}, 'seating'],
      [{ seating: 'balcony' }, 'seating'],
      [{ seating: 'seated', with_kids: true }, 'kids'],
      [{ seating: 'seated', with_kids: true, kids: 7 }, 'kids'],
      [{ seating: 'seated', surprise: 1 }, 'surprise'],
    ] as const) {
      await expect(buy(answers)).rejects.toMatchObject({ details: { reason: 'form_invalid', field } });
    }
    const [n] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from orders.orders where event_id = ${eventId}`,
      ),
    );
    expect(n?.n).toBe(2);
  });

  it('old answers stay tied to the version they were given against', async () => {
    const v2 = {
      fields: [
        { key: 'seating', type: 'select', label: 'Where?', options: [{ value: 'seated', label: 'Seat' }] },
      ],
    };
    expect(
      await executeCommand(publishFormCommand, { ...subject(), definition: v2 }, a.ctx(), ports),
    ).toEqual({
      version: 2,
    });
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ versions: number[] }>(sql`
        select array_agg(distinct v.version order by v.version) as versions
        from forms.form_responses r join forms.form_versions v on v.id = r.form_version_id`),
    );
    expect(row?.versions).toEqual([1]);
    expect((await executeQuery(getFormQuery, subject(), a.ctx(), ports))?.version).toBe(2);
  });

  it('an event without questions accepts no answers', async () => {
    const t = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string }>(sql`select id from ticketing.ticket_types where event_id = ${bare}`),
    );
    const tt = t[0]?.id ?? '';
    await expect(buy({}, bare, tt)).resolves.toBeTruthy();
    await expect(buy({ kids: 1 }, bare, tt)).rejects.toMatchObject({ details: { reason: 'form_invalid' } });
  });

  it('rejects unsafe conditions; viewers cannot publish; org B sees nothing', async () => {
    await expect(
      executeCommand(
        publishFormCommand,
        {
          ...subject(),
          definition: {
            fields: [{ key: 'x', type: 'checkbox', label: 'X', showIf: { method: ['constructor'] } }],
          },
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        publishFormCommand,
        { ...subject(), definition: QUESTIONS },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await executeQuery(getFormQuery, subject(), b.ctx(), ports)).toBeNull();
    expect(await publicForm(b.org.id, subject())).toBeNull();
  });
});
