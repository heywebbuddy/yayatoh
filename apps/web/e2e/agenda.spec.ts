import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectPicked, pickOption, signIn } from './helpers.ts';

/**
 * M5.2a — agenda model v2: session types, included vs optional, pick-one groups, the room
 * warning, the bulk CSV import (dry run, then an idempotent import) and agenda publishing.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';
const TZ = 'America/Chicago';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

/** `YYYY-MM-DD` in Chicago, `days` from today. */
function chicagoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}
const at = (days: number, hhmm: string) => `${chicagoDate(days)}T${hhmm}`;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** A conference from day 40 09:00 to day 42 18:00 in Chicago. */
async function createEvent(page: Page, name: string, opts: { publish?: boolean } = {}) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Event type'), 'conference');
  await pickOption(page.getByLabel('Time zone'), TZ);
  await page.getByLabel('Starts', { exact: true }).fill(at(40, '09:00'));
  await page.getByLabel('Ends', { exact: true }).fill(at(42, '18:00'));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  if (opts.publish) {
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
  }
  return { base, slug: base.split('/').pop() ?? '' };
}

async function addSession(
  page: Page,
  s: { title: string; from: string; to: string; room?: string; capacity?: string },
) {
  const add = page.getByRole('region', { name: 'Add session' });
  await add.getByLabel('Session title').fill(s.title);
  await add.getByLabel('Session starts').fill(s.from);
  await add.getByLabel('Session ends').fill(s.to);
  if (s.room) await pickOption(add.getByLabel('Room', { exact: true }), { label: s.room });
  if (s.capacity) await add.getByLabel('Capacity').fill(s.capacity);
  await add.getByRole('button', { name: 'Add session' }).click();
  await expect(add.getByText('Session added.')).toBeVisible();
}

/** Open a session's editor and return its agenda settings form (type, admission, group). */
async function agendaForm(page: Page, title: string) {
  const card = page.locator(`[data-session="${title}"]`);
  const summary = card.getByText(`Edit ${title}`);
  await summary.focus();
  await page.keyboard.press('Enter');
  return card.getByRole('region', { name: `Type, admission and group for ${title}` });
}

/** Press Enter on a button (keyboard-only operation). */
async function pressButton(page: Page, scope: Page | ReturnType<Page['locator']>, name: string) {
  await scope.getByRole('button', { name, exact: true }).focus();
  await page.keyboard.press('Enter');
}

async function guestPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}

test.describe('agenda v2 (M5.2a)', () => {
  test('session types, included vs optional, a pick-one group and the room warning, by keyboard', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base } = await createEvent(page, `Agenda Types ${s}`);
    await page.goto(`${base}/sessions`);
    const publishing = page.getByRole('region', { name: 'Public agenda' });
    await expect(publishing.getByText('Live', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Session types' }).getByText('No session types yet.'),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Pick-one groups' }).getByText('No groups yet.'),
    ).toBeVisible();
    await expectAccessible(page);

    // Session types: the standard set in one press, then a custom one with its validation.
    const types = page.getByRole('region', { name: 'Session types' });
    await pressButton(page, types, 'Add the standard types');
    for (const name of ['Keynote', 'Talk', 'Workshop', 'Panel', 'Break'])
      await expect(types.getByRole('listitem').filter({ hasText: name })).toHaveCount(1);
    await expect(types.getByRole('button', { name: 'Add the standard types' })).toHaveCount(0);
    await pressButton(page, types, 'Add type');
    await expect(types.getByText('Enter a name.')).toBeVisible();
    await types.getByLabel('Type name').fill('workshop');
    await pressButton(page, types, 'Add type');
    await expect(types.getByText('That name is already used for this event.')).toBeVisible();
    await types.getByLabel('Type name').fill('Lab');
    await pressButton(page, types, 'Add type');
    await expect(types.getByText('Type added.')).toBeVisible();

    // A room of 40, a 60-seat workshop in it (warned, not blocked) and a parallel one.
    const rooms = page.getByRole('region', { name: 'Rooms' });
    await rooms.getByLabel('Room name').fill('Seminar room');
    await rooms.getByLabel('Capacity').fill('40');
    await rooms.getByRole('button', { name: 'Add room' }).click();
    await expect(rooms.getByText('Room added.')).toBeVisible();
    await addSession(page, {
      title: 'Workshop A',
      from: at(40, '10:00'),
      to: at(40, '11:00'),
      room: 'Seminar room',
      capacity: '60',
    });
    await addSession(page, { title: 'Workshop B', from: at(40, '10:00'), to: at(40, '11:00') });
    await page.reload();
    await expect(page.getByRole('heading', { name: '1 agenda warning' })).toBeVisible();
    await expect(page.getByText('Seminar room holds 40 people, but “Workshop A” allows 60.')).toBeVisible();
    await expect(page.locator('[data-session="Workshop A"]').getByText('Room too small')).toBeVisible();
    await expect(page.locator('[data-session="Workshop B"]').getByText('Room too small')).toHaveCount(0);

    // A pick-one group.
    const groups = page.getByRole('region', { name: 'Pick-one groups' });
    await pressButton(page, groups, 'Add group');
    await expect(groups.getByText('Enter a name.')).toBeVisible();
    await groups.getByLabel('Group name').fill('Morning pick');
    await pressButton(page, groups, 'Add group');
    await expect(groups.getByText('Group added.')).toBeVisible();
    await page.reload();

    // Included sessions can't join a group; optional ones can.
    let form = await agendaForm(page, 'Workshop A');
    await pickOption(form.getByLabel('Session type'), { label: 'Workshop' });
    await pickOption(form.getByLabel('Pick-one group'), { label: 'Morning pick' });
    await pressButton(page, form, 'Save agenda settings');
    await expect(form.getByText('Only optional sessions can join a pick-one group.')).toBeVisible();
    await expect(form.getByLabel('Pick-one group')).toHaveAttribute('aria-invalid', 'true');
    await pickOption(form.getByLabel('Admission'), 'optional');
    await pressButton(page, form, 'Save agenda settings');
    await expect(form.getByText('Agenda settings saved.')).toBeVisible();
    // The room warning comes back with the save (the write still happened).
    await expect(form.getByText('Seminar room holds 40 people, but “Workshop A” allows 60.')).toBeVisible();
    await expectAccessible(page);

    await page.reload();
    form = await agendaForm(page, 'Workshop B');
    await pickOption(form.getByLabel('Admission'), 'optional');
    await pickOption(form.getByLabel('Pick-one group'), { label: 'Morning pick' });
    await pickOption(form.getByLabel('Enrollment'), 'closed');
    await pressButton(page, form, 'Save agenda settings');
    await expect(form.getByText('Agenda settings saved.')).toBeVisible();

    // Persisted after a reload: the cards, the group and the form values.
    await page.reload();
    await expect(page.locator('[data-session="Workshop A"] [data-agenda-line]')).toHaveText(
      'Workshop · Optional · Morning pick · 0 of 60 places taken',
    );
    await expect(page.locator('[data-session="Workshop B"] [data-agenda-line]')).toHaveText(
      'Optional · Morning pick · Enrollment closed',
    );
    await expect(page.locator('[data-group="Morning pick"]')).toContainText(
      '2 sessions: Workshop A, Workshop B',
    );
    form = await agendaForm(page, 'Workshop B');
    await expectPicked(form.getByLabel('Admission'), 'optional');
    await expectPicked(form.getByLabel('Enrollment'), 'closed');
    await expectAccessible(page);
    await noHorizontalScroll(page);

    // Deleting a type keeps its sessions (they just lose the type).
    await page
      .getByRole('region', { name: 'Session types' })
      .getByRole('button', { name: 'Delete Workshop' })
      .click();
    await expect(page.locator('[data-session="Workshop A"] [data-agenda-line]')).toHaveText(
      'Optional · Morning pick · 0 of 60 places taken',
    );
  });

  test('a CSV with one bad row: the dry run shows it, the import adds the rest, a rerun changes nothing', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base } = await createEvent(page, `Agenda Import ${s}`);
    await page.goto(`${base}/sessions`);
    await page.getByRole('link', { name: 'Import agenda (CSV)' }).click();
    await expect(page).toHaveURL(/\/sessions\/import$/);
    await expect(page.getByRole('heading', { name: 'Import agenda', level: 1 })).toBeVisible();
    await expect(
      page.getByText("Write times as YYYY-MM-DD HH:MM in the event's timezone (America/Chicago)."),
    ).toBeVisible();
    await expectAccessible(page);

    // No file, then a file without the required columns.
    await pressButton(page, page, 'Check file');
    await expect(page.getByRole('alert').filter({ hasText: 'Choose a CSV file.' })).toBeVisible();
    await page.getByLabel('CSV file').setInputFiles({
      name: 'wrong.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('name,when\nA,B\n'),
    });
    await pressButton(page, page, 'Check file');
    await expect(page.getByText('The file needs the columns title, starts and ends.')).toBeVisible();

    const d = chicagoDate(40);
    const csv = [
      'key,title,starts,ends,type,admission,capacity,room,track,group,speakers,description',
      `K-1,CSV keynote ${s},${d} 09:00,${d} 10:00,Keynote,included,,Main hall,,,Ada Lovelace <ada-${s}@import.test>,Welcome.`,
      `,=HYPERLINK("http://evil.test"),${d} 10:00,${d} 11:00,,,,,,,,`,
      `W-1,CSV workshop A ${s},${d} 10:30,${d} 12:00,Workshop,optional,40,Room B,Build,Morning pick,ada-${s}@import.test,`,
      `W-2,CSV workshop B ${s},${d} 10:30,${d} 12:00,Workshop,optional,40,Room C,Build,Morning pick,,`,
    ].join('\n');
    const upload = async () => {
      await page.getByLabel('CSV file').setInputFiles({
        name: 'agenda.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });
      await pressButton(page, page, 'Check file');
    };
    await upload();
    await expect(
      page.getByRole('status').filter({ hasText: '3 to add, 0 to update, 0 unchanged, 1 with problems.' }),
    ).toBeVisible();
    const table = page.getByRole('region', { name: 'Rows in the file' });
    const bad = table.getByRole('row').filter({ has: page.getByRole('cell', { name: '3', exact: true }) });
    await expect(bad).toContainText(
      "Can't be imported: A cell starts with =, +, - or @ (a spreadsheet formula).",
    );
    await expect(table.getByRole('row').filter({ hasText: `CSV keynote ${s}` })).toContainText(
      'Will be added',
    );
    await expectAccessible(page);
    // Nothing was written by the dry run.
    await page.goto(`${base}/sessions`);
    await expect(page.getByText('No sessions yet')).toBeVisible();

    await page.goto(`${base}/sessions/import`);
    await upload();
    await pressButton(page, page, 'Import 3 rows');
    await expect(page.getByText('Import done: 3 added, 0 updated, 0 unchanged, 1 skipped.')).toBeVisible();
    await expect(table.getByRole('row').filter({ hasText: `CSV keynote ${s}` })).toContainText('Added');
    await expectAccessible(page);

    // Re-running the same file changes nothing.
    await upload();
    await expect(
      page.getByRole('status').filter({ hasText: '0 to add, 0 to update, 3 unchanged, 1 with problems.' }),
    ).toBeVisible();
    await expect(page.getByText('Nothing to import: every row is unchanged or has a problem.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Import \d/ })).toHaveCount(0);

    // The sessions, at the file's wall-clock times in the event's timezone, with their names.
    await page.getByRole('link', { name: 'Back to sessions' }).click();
    const keynote = page.locator(`[data-session="CSV keynote ${s}"]`);
    await expect(keynote).toContainText('9:00');
    await expect(keynote).toContainText('Main hall');
    await expect(keynote).toContainText(`Ada Lovelace`);
    await expect(page.locator(`[data-session="CSV workshop A ${s}"] [data-agenda-line]`)).toHaveText(
      'Workshop · Optional · Morning pick · 0 of 40 places taken',
    );
    await expect(page.locator('[data-group="Morning pick"]')).toContainText('2 sessions');
  });

  test('publishing: a draft hides the agenda, the snapshot is public, a change waits for the next publish', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `Agenda Publish ${s}`, { publish: true });
    await page.goto(`${base}/sessions`);
    await addSession(page, { title: 'Opening', from: at(40, '09:00'), to: at(40, '10:00') });
    const types = page.getByRole('region', { name: 'Session types' });
    await pressButton(page, types, 'Add the standard types');
    await expect(types.getByRole('listitem').filter({ hasText: 'Keynote' })).toHaveCount(1);
    const form = await agendaForm(page, 'Opening');
    await pickOption(form.getByLabel('Session type'), { label: 'Keynote' });
    await pickOption(form.getByLabel('Admission'), 'optional');
    await pressButton(page, form, 'Save agenda settings');
    await expect(form.getByText('Agenda settings saved.')).toBeVisible();

    // Live (never published): the guest sees changes at once.
    const guest = await guestPage(browser);
    await guest.goto(`/events/${slug}`);
    const agenda = guest.getByRole('region', { name: 'Agenda' });
    await expect(agenda.getByText('Opening')).toBeVisible();
    await expect(agenda.getByText('Keynote · Optional')).toBeVisible();

    // Draft: nothing public.
    await page.reload();
    const publishing = page.getByRole('region', { name: 'Public agenda' });
    await pressButton(page, publishing, 'Switch to draft');
    await expect(
      publishing.getByText('The public page shows no sessions until you publish the agenda.'),
    ).toBeVisible();
    await expect(publishing.getByText('Draft', { exact: true })).toBeVisible();
    await guest.reload();
    await expect(guest.getByRole('region', { name: 'Agenda' })).toHaveCount(0);

    // Published: the guest sees the snapshot.
    await pressButton(page, publishing, 'Publish agenda');
    await expect(publishing.getByText(/^Version 1, published /)).toBeVisible();
    await expect(publishing.getByText('Published', { exact: true })).toBeVisible();
    await guest.reload();
    await expect(agenda.getByText('Opening')).toBeVisible();
    await expectAccessible(guest);

    // A change after publishing: the console says so; the public keeps the snapshot.
    const card = page.locator('[data-session="Opening"]');
    await card.getByText('Edit Opening').click();
    await card.getByLabel('Session title').fill('Opening keynote');
    await card.getByRole('button', { name: 'Save session' }).click();
    // The card now carries the new title.
    await expect(page.locator('[data-session="Opening keynote"]').getByText('Session saved.')).toBeVisible();
    await page.reload();
    await expect(publishing.getByText('Changed since publish', { exact: true })).toBeVisible();
    await expect(publishing.getByText(/You changed the agenda after publishing version 1/)).toBeVisible();
    await expectAccessible(page);
    await guest.reload();
    await expect(agenda.getByText('Opening', { exact: true })).toBeVisible();
    await expect(agenda.getByText('Opening keynote')).toHaveCount(0);

    // Publish the changes: version 2 is public.
    await pressButton(page, publishing, 'Publish changes');
    await expect(publishing.getByText(/^Version 2, published /)).toBeVisible();
    await guest.reload();
    await expect(agenda.getByText('Opening keynote')).toBeVisible();

    // Unpublish: back to draft, nothing public.
    await pressButton(page, publishing, 'Unpublish agenda');
    await expect(publishing.getByText('Draft', { exact: true })).toBeVisible();
    await guest.reload();
    await expect(guest.getByRole('region', { name: 'Agenda' })).toHaveCount(0);
  });

  test('a viewer sees the agenda but every write is refused (hidden controls, refused import page)', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    const owner = await (await browser.newContext()).newPage();
    await signIn(owner);
    const { base } = await createEvent(owner, `Agenda Viewer ${s}`);
    await owner.goto(`${base}/sessions`);
    await addSession(owner, { title: 'Read-only talk', from: at(40, '09:00'), to: at(40, '10:00') });
    const groups = owner.getByRole('region', { name: 'Pick-one groups' });
    await groups.getByLabel('Group name').fill('Viewer group');
    await groups.getByRole('button', { name: 'Add group' }).click();
    await expect(groups.getByText('Group added.')).toBeVisible();

    await signIn(page, VIEWER);
    await page.goto(`${base}/sessions`);
    await expect(
      page.getByText('You can view the program. Only organizers with edit rights can change it.'),
    ).toBeVisible();
    const publishing = page.getByRole('region', { name: 'Public agenda' });
    await expect(publishing.getByText('Live', { exact: true })).toBeVisible();
    await expect(publishing.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Import agenda (CSV)' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add the standard types' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add type' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add group' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete Viewer group' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save agenda settings' })).toHaveCount(0);
    await expect(page.locator('[data-group="Viewer group"]')).toBeVisible();
    await expectAccessible(page);
    // The import page refuses them.
    await page.goto(`${base}/sessions/import`);
    await expect(page.getByText("You can't import the agenda")).toBeVisible();
    await expect(page.getByLabel('CSV file')).toHaveCount(0);
    await expectAccessible(page);
  });

  test('Arabic: the agenda console and the import page render right to left', async ({ page }) => {
    const s = stamp();
    await signIn(page);
    const { base } = await createEvent(page, `Agenda RTL ${s}`);
    await page.goto(`/ar${base}/sessions`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'البرنامج العام' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'أنواع الجلسات' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'مجموعات الاختيار الواحد' })).toBeVisible();
    await page.getByRole('button', { name: 'إضافة الأنواع القياسية' }).click();
    await expect(page.getByRole('region', { name: 'أنواع الجلسات' }).getByText('ورشة عمل')).toBeVisible();
    await expectAccessible(page);
    await noHorizontalScroll(page);
    await page.goto(`/ar${base}/sessions/import`);
    await expect(page.getByRole('heading', { name: 'استيراد البرنامج', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'فحص الملف' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'اختر ملف CSV.' })).toBeVisible();
    await expectAccessible(page);
    await noHorizontalScroll(page);
  });
});
