import { type TenantTx, withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  addChecklistItemCommand,
  addSectionCommand,
  deleteChecklistItemCommand,
  eventChecklistQuery,
  eventSectionsQuery,
  setChecklistItemDoneCommand,
} from '@yayatoh/events';
import { currentFormTx } from '@yayatoh/forms';
import { type Command, executeCommand, executeQuery } from '@yayatoh/kernel';
import { eventSeatingQuery } from '@yayatoh/seating';
import {
  addTemplateChecklistItemCommand,
  addTemplateSectionCommand,
  addTemplateTicketTypeCommand,
  copyStarterCommand,
  createEventTemplateCommand,
  createFromTemplateCommand,
  duplicateEventCommand,
  duplicateTemplateCommand,
  getTemplateQuery,
  listTemplatesQuery,
  moveTemplateSectionCommand,
  removeTemplateChecklistItemCommand,
  removeTemplateSectionCommand,
  removeTemplateTicketTypeCommand,
  saveTemplateCommand,
  setTemplateArchivedCommand,
  updateTemplateCommand,
} from '@yayatoh/templates';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const run = <I, O, R>(cmd: Command<I, O, R, TenantTx>, input: unknown, f: OrgFixture = a): Promise<O> =>
  executeCommand(cmd, input, f.ctx(), ports);

/** A from-scratch conference template with two ticket types, three sections and two to-dos. */
async function scratchTemplate(name: string) {
  const t = await run(createEventTemplateCommand, {
    name,
    description: 'Built from scratch',
    profile: 'conference',
    timezone: 'Europe/Paris',
    currency: 'EUR',
    durationMinutes: 8 * 60,
  });
  await run(addTemplateTicketTypeCommand, {
    templateId: t.id,
    name: 'Standard',
    priceMinor: 12_000,
    quantityTotal: 300,
  });
  await run(addTemplateTicketTypeCommand, {
    templateId: t.id,
    name: 'Student',
    description: 'With a valid student card',
    priceMinor: 4_000,
    quantityTotal: 50,
  });
  await run(addTemplateSectionCommand, {
    templateId: t.id,
    title: 'About',
    kind: 'text',
    content: { markdown: 'A day of **talks**.' },
  });
  await run(addTemplateSectionCommand, {
    templateId: t.id,
    title: 'FAQ',
    kind: 'faq',
    content: { items: [{ question: 'Is lunch included?', answer: 'Yes.' }] },
  });
  await run(addTemplateSectionCommand, {
    templateId: t.id,
    title: 'Schedule',
    kind: 'schedule',
    content: { items: [{ time: '09:00', title: 'Doors', detail: null }] },
  });
  await run(addTemplateChecklistItemCommand, { templateId: t.id, title: 'Book the AV crew' });
  await run(addTemplateChecklistItemCommand, { templateId: t.id, title: 'Print the badges' });
  return run(updateTemplateCommand, {
    templateId: t.id,
    name,
    description: 'Built from scratch',
    visibility: 'unlisted',
    timezone: 'Europe/Paris',
    currency: 'EUR',
    durationMinutes: 9 * 60,
    tagline: 'The yearly meetup',
    venueName: 'Main hall',
    city: 'Paris',
  });
}

describe('template builder', () => {
  it('a template made from scratch creates an event with exactly its tickets, sections, content and checklist', async () => {
    const t = await scratchTemplate(`Scratch conf ${a.org.slug}`);
    expect(t).toMatchObject({
      profile: 'conference',
      origin: 'scratch',
      ticketTypes: 2,
      sections: 3,
      checklist: 2,
      questions: 0,
      seats: 0,
      durationMinutes: 540,
      timezone: 'Europe/Paris',
      archivedAt: null,
    });
    const e = await run(createFromTemplateCommand, {
      templateId: t.id,
      name: `From scratch ${a.org.slug}`,
      startsAt: '2029-05-04T07:00:00Z',
    });
    expect(e).toMatchObject({
      status: 'draft',
      profile: 'conference',
      visibility: 'unlisted',
      timezone: 'Europe/Paris',
      currency: 'EUR',
      tagline: 'The yearly meetup',
      venueName: 'Main hall',
      city: 'Paris',
    });
    expect(e.endsAt.getTime() - e.startsAt.getTime()).toBe(9 * 3_600_000);
    const types = await executeQuery(listTicketTypesQuery, { eventId: e.id }, a.ctx(), ports);
    expect(types.map((x) => [x.name, x.description, x.priceMinor, x.quantityTotal, x.quantitySold])).toEqual([
      ['Standard', null, 12_000, 300, 0],
      ['Student', 'With a valid student card', 4_000, 50, 0],
    ]);
    expect(types.every((x) => x.currency === 'EUR')).toBe(true);
    const sections = await executeQuery(eventSectionsQuery, { eventId: e.id }, a.ctx(), ports);
    expect(sections.map((s) => [s.position, s.kind, s.title, s.visible, s.content])).toEqual([
      [0, 'text', 'About', true, { markdown: 'A day of **talks**.' }],
      [1, 'faq', 'FAQ', true, { items: [{ question: 'Is lunch included?', answer: 'Yes.' }] }],
      [2, 'schedule', 'Schedule', true, { items: [{ time: '09:00', title: 'Doors', detail: null }] }],
    ]);
    const checklist = await executeQuery(eventChecklistQuery, { eventId: e.id }, a.ctx(), ports);
    expect(checklist.map((c) => [c.position, c.title, c.done])).toEqual([
      [0, 'Book the AV crew', false],
      [1, 'Print the badges', false],
    ]);
    // No questions, no floor plan: nothing the template does not hold.
    const form = await withTenant(a.ctx(), (tx) =>
      currentFormTx(tx, { kind: 'checkout_questions', subjectType: 'event', subjectId: e.id }),
    );
    expect(form).toBeNull();
    expect(await executeQuery(eventSeatingQuery, { eventId: e.id }, a.ctx(), ports)).toBeNull();
    // template → events
    const detail = await executeQuery(getTemplateQuery, { templateId: t.id }, a.ctx(), ports);
    expect(detail.events.map((x) => x.id)).toEqual([e.id]);
    expect(detail.ticketTypeList.map((x) => x.name)).toEqual(['Standard', 'Student']);
    expect(detail.checklistItems).toEqual(['Book the AV crew', 'Print the badges']);
  });

  it('edits: remove and reorder sections, remove tickets and checklist items, validation', async () => {
    const t = await scratchTemplate(`Edit me ${a.org.slug}`);
    await run(moveTemplateSectionCommand, { templateId: t.id, index: 2, direction: 'up' });
    // Moving past either end is a no-op.
    await run(moveTemplateSectionCommand, { templateId: t.id, index: 0, direction: 'up' });
    let d = await executeQuery(getTemplateQuery, { templateId: t.id }, a.ctx(), ports);
    expect(d.sectionList.map((s) => s.title)).toEqual(['About', 'Schedule', 'FAQ']);
    await run(removeTemplateSectionCommand, { templateId: t.id, index: 0 });
    const [student] = d.ticketTypeList.filter((x) => x.name === 'Student');
    if (!student) throw new Error('no student ticket');
    await run(removeTemplateTicketTypeCommand, { templateId: t.id, key: student.key });
    await run(removeTemplateChecklistItemCommand, { templateId: t.id, index: 1 });
    d = await executeQuery(getTemplateQuery, { templateId: t.id }, a.ctx(), ports);
    expect(d.sectionList.map((s) => s.title)).toEqual(['Schedule', 'FAQ']);
    expect(d.ticketTypeList.map((x) => x.name)).toEqual(['Standard']);
    expect(d.checklistItems).toEqual(['Book the AV crew']);
    await expect(run(removeTemplateSectionCommand, { templateId: t.id, index: 9 })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      run(removeTemplateTicketTypeCommand, { templateId: t.id, key: 'nope' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      run(addTemplateTicketTypeCommand, { templateId: t.id, name: 'Free', priceMinor: -1, quantityTotal: 1 }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run(addTemplateSectionCommand, {
        templateId: t.id,
        title: 'Links',
        kind: 'links',
        content: { items: [{ label: 'Bad', url: 'javascript:alert(1)' }] },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run(createEventTemplateCommand, {
        name: `Edit me ${a.org.slug}`,
        description: null,
        profile: 'concert',
        timezone: 'UTC',
        currency: 'USD',
        durationMinutes: 60,
      }),
    ).rejects.toMatchObject({ code: 'conflict', details: { field: 'name' } });
    await expect(
      run(createEventTemplateCommand, {
        name: `Too short ${a.org.slug}`,
        description: null,
        profile: 'concert',
        timezone: 'UTC',
        currency: 'USD',
        durationMinutes: 5,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run(createEventTemplateCommand, {
        name: `Bad zone ${a.org.slug}`,
        description: null,
        profile: 'concert',
        timezone: 'Mars/Olympus',
        currency: 'USD',
        durationMinutes: 60,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('a wedding template starts private; a ticket type a saved floor plan uses cannot be removed', async () => {
    const w = await run(createEventTemplateCommand, {
      name: `Wedding kit ${a.org.slug}`,
      description: null,
      profile: 'wedding',
      timezone: 'UTC',
      currency: 'USD',
      durationMinutes: 360,
    });
    expect((await executeQuery(getTemplateQuery, { templateId: w.id }, a.ctx(), ports)).visibility).toBe(
      'private',
    );
    const saved = await run(saveTemplateCommand, { eventId: a.event.id, name: `Seated kit ${a.org.slug}` });
    expect((await executeQuery(getTemplateQuery, { templateId: saved.id }, a.ctx(), ports)).origin).toBe(
      'event',
    );
    // A plan whose seats are priced by the first ticket type.
    const t = await scratchTemplate(`Seated scratch ${a.org.slug}`);
    const [first] = (await executeQuery(getTemplateQuery, { templateId: t.id }, a.ctx(), ports))
      .ticketTypeList;
    if (!first) throw new Error('no ticket type');
    const seating = { doc: {}, seats: [{ seatUuid: 's-1', ticketTypeKey: first.key, blockReason: null }] };
    await withTenant(a.ctx(), (tx) =>
      tx.execute(
        sql`update templates.event_templates set snapshot = jsonb_set(snapshot, '{seating}', ${JSON.stringify(seating)}::jsonb) where id = ${t.id}`,
      ),
    );
    const d = await executeQuery(getTemplateQuery, { templateId: t.id }, a.ctx(), ports);
    expect(d.seatingKeys).toEqual([first.key]);
    await expect(
      run(removeTemplateTicketTypeCommand, { templateId: t.id, key: first.key }),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'used_by_seating' } });
  });

  it('archived templates leave the pickers and refuse new events; events made from them stay', async () => {
    const t = await scratchTemplate(`Archive me ${a.org.slug}`);
    const e = await run(createFromTemplateCommand, {
      templateId: t.id,
      name: `Before archive ${a.org.slug}`,
      startsAt: '2029-06-01T08:00:00Z',
    });
    const archived = await run(setTemplateArchivedCommand, { templateId: t.id, archived: true });
    expect(archived.archivedAt).not.toBeNull();
    const active = await executeQuery(listTemplatesQuery, {}, a.ctx(), ports);
    expect(active.some((x) => x.id === t.id)).toBe(false);
    const gone = await executeQuery(listTemplatesQuery, { archived: true }, a.ctx(), ports);
    expect(gone.map((x) => x.id)).toContain(t.id);
    await expect(
      run(createFromTemplateCommand, { templateId: t.id, name: 'After', startsAt: '2029-07-01T08:00:00Z' }),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'archived' } });
    await expect(
      run(addTemplateChecklistItemCommand, { templateId: t.id, title: 'Too late' }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    // The event made before is untouched.
    expect((await executeQuery(listTicketTypesQuery, { eventId: e.id }, a.ctx(), ports)).length).toBe(2);
    expect((await executeQuery(eventSectionsQuery, { eventId: e.id }, a.ctx(), ports)).length).toBe(3);
    expect((await executeQuery(eventChecklistQuery, { eventId: e.id }, a.ctx(), ports)).length).toBe(2);
    // Restore: back in the pickers and usable.
    await run(setTemplateArchivedCommand, { templateId: t.id, archived: false });
    expect((await executeQuery(listTemplatesQuery, {}, a.ctx(), ports)).map((x) => x.id)).toContain(t.id);
  });

  it('duplicates a template and copies a starter into "Your templates"', async () => {
    const t = await scratchTemplate(`Original ${a.org.slug}`);
    const copy = await run(duplicateTemplateCommand, {
      templateId: t.id,
      name: `Original copy ${a.org.slug}`,
    });
    expect(copy).toMatchObject({ ticketTypes: 2, sections: 3, checklist: 2, origin: 'scratch' });
    expect(copy.id).not.toBe(t.id);
    const gala = await run(copyStarterCommand, {
      starter: 'gala',
      name: `Our gala ${a.org.slug}`,
      timezone: 'America/Chicago',
      currency: 'USD',
    });
    expect(gala).toMatchObject({ profile: 'gala', durationMinutes: 300, ticketTypes: 0, origin: 'scratch' });
    await expect(
      run(copyStarterCommand, { starter: 'rodeo', name: 'Nope', timezone: 'UTC', currency: 'USD' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('saving an event as a template carries its page sections and checklist; duplicate copies them', async () => {
    const before = await executeQuery(eventSectionsQuery, { eventId: a.event.id }, a.ctx(), ports);
    if (before.length === 0)
      await run(addSectionCommand, {
        eventId: a.event.id,
        title: 'About',
        kind: 'text',
        content: { markdown: 'Hello' },
      });
    const sections = await executeQuery(eventSectionsQuery, { eventId: a.event.id }, a.ctx(), ports);
    const checklist = await executeQuery(eventChecklistQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(checklist.length).toBeGreaterThan(0);
    const t = await run(saveTemplateCommand, { eventId: a.event.id, name: `With content ${a.org.slug}` });
    expect(t).toMatchObject({ sections: sections.length, checklist: checklist.length });
    const copy = await run(duplicateEventCommand, {
      eventId: a.event.id,
      name: `Content copy ${a.org.slug}`,
    });
    expect(
      (await executeQuery(eventSectionsQuery, { eventId: copy.id }, a.ctx(), ports)).map((s) => s.title),
    ).toEqual(sections.map((s) => s.title));
    const copied = await executeQuery(eventChecklistQuery, { eventId: copy.id }, a.ctx(), ports);
    expect(copied.map((c) => [c.title, c.done])).toEqual(checklist.map((c) => [c.title, false]));
  });

  it('a version 1 snapshot still reads and instantiates (no sections, no checklist)', async () => {
    const t = await run(saveTemplateCommand, { eventId: a.event.id, name: `Legacy v1 ${a.org.slug}` });
    await withTenant(a.ctx(), (tx) =>
      tx.execute(
        sql`update templates.event_templates set snapshot = (snapshot - 'sections' - 'checklist') || '{"version":1}'::jsonb where id = ${t.id}`,
      ),
    );
    const d = await executeQuery(getTemplateQuery, { templateId: t.id }, a.ctx(), ports);
    expect(d).toMatchObject({ sections: 0, checklist: 0 });
    const e = await run(createFromTemplateCommand, {
      templateId: t.id,
      name: `From v1 ${a.org.slug}`,
      startsAt: '2029-08-01T08:00:00Z',
    });
    expect(await executeQuery(eventSectionsQuery, { eventId: e.id }, a.ctx(), ports)).toEqual([]);
  });

  it('permissions and isolation: viewers read only; other orgs see nothing', async () => {
    const t = await scratchTemplate(`Private kit ${a.org.slug}`);
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(getTemplateQuery, { templateId: t.id }, viewer, ports)).name).toBe(t.name);
    for (const [cmd, input] of [
      [addTemplateChecklistItemCommand, { templateId: t.id, title: 'x' }],
      [setTemplateArchivedCommand, { templateId: t.id, archived: true }],
      [duplicateTemplateCommand, { templateId: t.id, name: 'Viewer copy' }],
      [
        createEventTemplateCommand,
        {
          name: 'Viewer kit',
          description: null,
          profile: 'other',
          timezone: 'UTC',
          currency: 'USD',
          durationMinutes: 60,
        },
      ],
      [addChecklistItemCommand, { eventId: a.event.id, title: 'Viewer to-do' }],
    ] as const)
      await expect(
        executeCommand(cmd as Parameters<typeof executeCommand>[0], input, viewer, ports),
      ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeQuery(getTemplateQuery, { templateId: t.id }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      run(addTemplateTicketTypeCommand, { templateId: t.id, name: 'X', priceMinor: 0, quantityTotal: 1 }, b),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      run(setTemplateArchivedCommand, { templateId: t.id, archived: true }, b),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await executeQuery(eventChecklistQuery, { eventId: a.event.id }, b.ctx(), ports)).toEqual([]);
  });
});

describe('event checklist', () => {
  it("adds, ticks, unticks and deletes the organizer's own items", async () => {
    const item = await run(addChecklistItemCommand, { eventId: a.event.id, title: 'Confirm caterer' });
    expect(item).toMatchObject({ done: false, doneAt: null });
    const done = await run(setChecklistItemDoneCommand, { eventId: a.event.id, itemId: item.id, done: true });
    expect(done.done).toBe(true);
    const open = await run(setChecklistItemDoneCommand, {
      eventId: a.event.id,
      itemId: item.id,
      done: false,
    });
    expect(open).toMatchObject({ done: false, doneAt: null });
    await run(deleteChecklistItemCommand, { eventId: a.event.id, itemId: item.id });
    const list = await executeQuery(eventChecklistQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(list.some((x) => x.id === item.id)).toBe(false);
    await expect(run(addChecklistItemCommand, { eventId: a.event.id, title: '   ' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(
      run(setChecklistItemDoneCommand, { eventId: a.event.id, itemId: item.id, done: true }),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Another org cannot touch it.
    const mine = await run(addChecklistItemCommand, { eventId: a.event.id, title: 'Mine' });
    await expect(
      run(deleteChecklistItemCommand, { eventId: a.event.id, itemId: mine.id }, b),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      run(addChecklistItemCommand, { eventId: a.event.id, title: 'Theirs' }, b),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
