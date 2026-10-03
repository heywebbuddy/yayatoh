import { expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessible, pickOption, signIn, stepOption } from './helpers.ts';

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';
const TZ = 'America/Chicago';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

function chicagoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}

/** A wedding in Chicago, 60 days out, via the one-page form; returns its console path. */
async function createWedding(page: Page, name: string): Promise<string> {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Event type'), 'wedding');
  await pickOption(page.getByLabel('Time zone'), TZ);
  await page.getByLabel('Starts', { exact: true }).fill(`${chicagoDate(60)}T16:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${chicagoDate(60)}T23:00`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  return new URL(page.url()).pathname;
}

const addPartyForm = (page: Page) => page.getByRole('region', { name: 'Add party' });
const party = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function addParty(
  page: Page,
  p: { name: string; envelope?: string; side?: string; vip?: boolean; tags?: string; paper?: boolean },
) {
  const add = addPartyForm(page);
  await add.getByLabel('Party name').fill(p.name);
  if (p.envelope) await add.getByLabel('Envelope name').fill(p.envelope);
  if (p.side) await add.getByLabel('Side').fill(p.side);
  if (p.vip) await add.getByRole('checkbox', { name: 'VIP' }).check();
  if (p.tags) await add.getByLabel('Tags').fill(p.tags);
  if (p.paper)
    await pickOption(add.getByLabel('Entered from'), { label: 'Paper reply (entered for the guest)' });
  await add.getByRole('button', { name: 'Add party' }).click();
  await expect(add.getByText('Party added.')).toBeVisible();
  await expect(party(page, p.name)).toBeVisible();
}

/** Opens a disclosure (by its summary text) inside `scope` and returns its region. */
async function open(scope: Locator, page: Page, summary: string): Promise<Locator> {
  const region = page.getByRole('region', { name: summary, exact: true });
  if (!(await region.isVisible())) await scope.getByText(summary, { exact: true }).click();
  await expect(region).toBeVisible();
  return region;
}

async function addGuest(
  page: Page,
  partyName: string,
  g: { first: string; last?: string; age?: string; meal?: string; dietary?: string; paper?: boolean },
) {
  const p = party(page, partyName);
  const form = await open(p, page, `Add a guest to ${partyName}`);
  await form.getByLabel('First name').fill(g.first);
  if (g.last) await form.getByLabel('Last name').fill(g.last);
  if (g.age) await pickOption(form.getByLabel('Age'), { label: g.age });
  if (g.meal) await form.getByLabel('Meal').fill(g.meal);
  if (g.dietary) await form.getByLabel('Dietary needs').fill(g.dietary);
  if (g.paper)
    await pickOption(form.getByLabel('Entered from'), { label: 'Paper reply (entered for the guest)' });
  await form.getByRole('button', { name: 'Add guest' }).click();
  await expect(form.getByText('Guest added.')).toBeVisible();
  await expect(p.getByText([g.first, g.last].filter(Boolean).join(' '), { exact: true })).toBeVisible();
}

async function expectCounts(page: Page, want: Record<string, string>) {
  const summary = page.getByRole('region', { name: 'Summary' });
  for (const [label, value] of Object.entries(want))
    await expect(
      summary.locator('div', { has: page.getByText(label, { exact: true }) }).locator('dd'),
    ).toHaveText(value);
}

test.describe('guests: parties, guests and plus-ones (M4.1a)', () => {
  test('a host builds the list: parties, a child, a plus-one; edits, moves, history and persistence', async ({
    page,
  }) => {
    // About 25 page loads and Server Actions in one flow. Merged with batch 3b/3c, every console
    // render also reads the status-page banner, the freeze banner and the setup checklist, so
    // under the parallel suite this runs past the default 30 s (batch 3c merge; measured 26-29 s
    // with two workers on the same test).
    test.setTimeout(90_000);
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `Garcia Kim Wedding ${s}`);
    if (test.info().project.name === 'desktop-1280')
      await expect(
        page
          .getByRole('navigation', { name: 'Main navigation' })
          .first()
          .getByRole('link', { name: 'Guests' }),
      ).toBeVisible();

    await page.goto(`${base}/guests`);
    await expect(page.getByRole('heading', { name: 'Guests', level: 1 })).toBeVisible();
    await expect(page.getByText('No guests yet')).toBeVisible();
    await expect(page.getByRole('search', { name: 'Filter parties' })).toHaveCount(0);
    await expectCounts(page, { Parties: '0', Guests: '0' });
    await expectAccessible(page);

    // Validation: a party needs a name; typed values survive the rejected submit.
    const add = addPartyForm(page);
    await add.getByLabel('Envelope name').fill('Mr. and Mrs. Luis Garcia');
    await add.getByRole('button', { name: 'Add party' }).click();
    await expect(add.getByText('Enter a party name (up to 120 characters).')).toBeVisible();
    await expect(add.getByLabel('Party name')).toHaveAttribute('aria-invalid', 'true');
    await expect(add.getByLabel('Envelope name')).toHaveValue('Mr. and Mrs. Luis Garcia');
    await add.getByLabel('Tags').fill(`${'x'.repeat(41)}`);
    await add.getByLabel('Party name').fill('Too long a tag');
    await add.getByRole('button', { name: 'Add party' }).click();
    await expect(add.getByText('Use up to 20 tags, each up to 40 characters.')).toBeVisible();
    await expectAccessible(page);
    await add.getByLabel('Tags').fill('');
    await add.getByLabel('Envelope name').fill('');

    const garcias = `The Garcias ${s}`;
    const kims = `The Kims ${s}`;
    await addParty(page, {
      name: garcias,
      envelope: 'Mr. and Mrs. Luis Garcia',
      side: 'Bride',
      vip: true,
      tags: 'Family, Out of town',
      paper: true,
    });
    await addParty(page, { name: kims, side: 'Groom', tags: 'Work' });

    // A guest needs a first name.
    const g = party(page, garcias);
    const addForm = await open(g, page, `Add a guest to ${garcias}`);
    await addForm.getByLabel('Last name').fill('Garcia');
    await addForm.getByRole('button', { name: 'Add guest' }).click();
    await expect(addForm.getByText('Enter a first name (up to 80 characters).')).toBeVisible();
    await expect(addForm.getByLabel('First name')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);

    await addGuest(page, garcias, { first: 'Luis', last: 'Garcia', meal: 'Beef', dietary: 'No nuts' });
    await addGuest(page, garcias, { first: 'Sofi', last: 'Garcia', age: 'Child', paper: true });
    await expect(g.locator('span', { hasText: /^Primary contact$/ })).toHaveCount(1);
    await expect(g.locator('span', { hasText: /^Child$/ })).toBeVisible();
    await expect(g.locator('dd', { hasText: 'No nuts' })).toBeVisible();

    // A placeholder plus-one, named later.
    const luis = await open(g, page, 'Edit Luis Garcia');
    await luis.getByRole('button', { name: 'Add a plus-one for Luis Garcia' }).click();
    await expect(g.getByText('Guest of Luis Garcia', { exact: true })).toBeVisible();
    await expect(g.getByText('Plus-one to name', { exact: true })).toBeVisible();
    await expectCounts(page, {
      Parties: '2',
      Guests: '3',
      Adults: '2',
      Children: '1',
      'Plus-ones to name': '1',
    });
    await expect(page.getByText('1 VIP party')).toBeVisible();
    await expectAccessible(page);

    const plus = await open(g, page, 'Edit Guest of Luis Garcia');
    await expect(plus.getByRole('checkbox', { name: 'Primary contact' })).toHaveCount(0);
    await plus.getByLabel('First name').fill('Ana');
    await plus.getByLabel('Last name').fill('Ruiz');
    await plus.getByRole('button', { name: 'Save' }).click();
    await expect(g.getByText('Ana Ruiz', { exact: true })).toBeVisible();
    await expect(g.getByText('Guest of Luis Garcia', { exact: true })).toHaveCount(0);
    await expectCounts(page, { 'Plus-ones to name': '0' });

    // Move a guest between parties.
    await addGuest(page, kims, { first: 'Min', last: 'Kim' });
    const k = party(page, kims);
    const min = await open(k, page, 'Edit Min Kim');
    await min.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(min.getByText('Choose another party to move them to.')).toBeVisible();
    await pickOption(min.getByLabel('Move Min Kim to'), { label: garcias });
    await min.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(g.getByText('Min Kim', { exact: true })).toBeVisible();
    await expect(k.getByText('No guests in this party yet.')).toBeVisible();

    // Everything is still there after a reload.
    await page.reload();
    await expect(party(page, garcias).getByText('Ana Ruiz', { exact: true })).toBeVisible();
    await expect(party(page, garcias).getByText('Min Kim', { exact: true })).toBeVisible();
    await expect(party(page, garcias).getByText('Envelope: Mr. and Mrs. Luis Garcia')).toBeVisible();
    await expect(party(page, garcias).getByRole('list', { name: 'Tags' })).toContainText('Out of town');
    await expect(party(page, garcias).getByText('Side: Bride')).toBeVisible();
    await expectCounts(page, { Parties: '2', Guests: '4', Adults: '3', Children: '1' });

    // The history names each change's source.
    await party(page, garcias)
      .getByRole('link', { name: `Show history of ${garcias}` })
      .click();
    const history = page.getByRole('region', { name: `History of ${garcias}` });
    await expect(history).toBeVisible();
    await expect(
      history.getByText(/^Party added · Paper reply \(entered for the guest\) · by you/),
    ).toBeVisible();
    await expect(history.getByText(/^Guest added · Sofi Garcia · Paper reply/)).toBeVisible();
    await expect(history.getByText(/^Plus-one named · Ana Ruiz · Typed in by the team/)).toBeVisible();
    await expect(history.getByText(/^Guest moved · Min Kim/)).toBeVisible();
    await expectAccessible(page);
    await history.getByRole('link', { name: 'Hide history' }).click();
    await expect(history).toHaveCount(0);

    // Edit the party.
    const editParty = await open(party(page, garcias), page, `Edit ${garcias}`);
    await editParty.getByLabel('Notes').fill('Seat near the family table.');
    await editParty.getByRole('button', { name: 'Save' }).click();
    await expect(party(page, garcias).locator('p', { hasText: 'Seat near the family table.' })).toBeVisible();

    // Remove a guest, then a party with its guest count in the button.
    const sofi = await open(party(page, garcias), page, 'Edit Sofi Garcia');
    await sofi.getByRole('button', { name: 'Remove Sofi Garcia' }).click();
    await expect(party(page, garcias).getByText('Sofi Garcia', { exact: true })).toHaveCount(0);
    const editKims = await open(party(page, kims), page, `Edit ${kims}`);
    await editKims.getByRole('button', { name: `Remove ${kims}` }).click();
    await expect(party(page, kims)).toHaveCount(0);
    await page.reload();
    await expectCounts(page, { Parties: '1', Guests: '3', Children: '0' });
  });

  test('search and filters by side, tag and VIP; no-match state', async ({ page }) => {
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `Filters Wedding ${s}`);
    await page.goto(`${base}/guests`);
    await addParty(page, { name: `Adams ${s}`, side: 'Bride', vip: true, tags: 'Family' });
    await addParty(page, { name: `Baker ${s}`, side: 'Groom', tags: 'Work' });
    await addGuest(page, `Baker ${s}`, { first: 'Zoe', last: 'Quinn' });
    await page.reload();

    const search = page.getByRole('search', { name: 'Filter parties' });
    await pickOption(search.getByLabel('Side'), 'Groom');
    await search.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('1 party matches')).toBeVisible();
    await expect(party(page, `Baker ${s}`)).toBeVisible();
    await expect(party(page, `Adams ${s}`)).toHaveCount(0);
    await expectAccessible(page);

    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page.getByText('2 parties', { exact: true })).toBeVisible();
    await pickOption(page.getByRole('search', { name: 'Filter parties' }).getByLabel('Tag'), 'Family');
    await page.getByRole('search', { name: 'Filter parties' }).getByRole('button', { name: 'Apply' }).click();
    await expect(party(page, `Adams ${s}`)).toBeVisible();
    await expect(party(page, `Baker ${s}`)).toHaveCount(0);

    await page.goto(`${base}/guests?vip=yes`);
    await expect(party(page, `Adams ${s}`)).toBeVisible();
    await expect(party(page, `Baker ${s}`)).toHaveCount(0);
    await page.goto(`${base}/guests?vip=no`);
    await expect(party(page, `Baker ${s}`)).toBeVisible();

    // Search matches guests' names as well as parties'.
    await page.goto(`${base}/guests`);
    await page.getByRole('search', { name: 'Filter parties' }).getByLabel('Search by name').fill('zoe quinn');
    await page.keyboard.press('Enter');
    await expect(party(page, `Baker ${s}`)).toBeVisible();
    await expect(party(page, `Adams ${s}`)).toHaveCount(0);
    await page
      .getByRole('search', { name: 'Filter parties' })
      .getByLabel('Search by name')
      .fill('nobody-like-this');
    await page.keyboard.press('Enter');
    await expect(page.getByText('No parties match', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Try another name, or clear the filters.')).toBeVisible();
    // Counts cover the whole event whatever the filters.
    await expectCounts(page, { Parties: '2', Guests: '1' });
    await expectAccessible(page);
  });

  test('keyboard only: add a party, a guest and a plus-one, then move the guest', async ({ page }) => {
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `Keyboard Wedding ${s}`);
    await page.goto(`${base}/guests`);
    const add = addPartyForm(page);
    for (const name of [`Keys ${s}`, `Locks ${s}`]) {
      await add.getByLabel('Party name').focus();
      await page.keyboard.type(name);
      await page.keyboard.press('Enter');
      await expect(party(page, name)).toBeVisible();
    }
    // Open "Add a guest" with the keyboard, type, submit with Enter.
    const keys = party(page, `Keys ${s}`);
    await keys.getByText(`Add a guest to Keys ${s}`).focus();
    await page.keyboard.press('Enter');
    const form = page.getByRole('region', { name: `Add a guest to Keys ${s}` });
    await expect(form).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(form.getByLabel('First name')).toBeFocused();
    await page.keyboard.type('Kay');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Board');
    await page.keyboard.press('Enter');
    await expect(keys.getByText('Kay Board', { exact: true })).toBeVisible();

    // The plus-one button and the move form, by keyboard.
    await keys.getByText('Edit Kay Board', { exact: true }).focus();
    await page.keyboard.press('Enter');
    const kay = page.getByRole('region', { name: 'Edit Kay Board' });
    await kay.getByRole('button', { name: 'Add a plus-one for Kay Board' }).focus();
    await page.keyboard.press('Enter');
    await expect(keys.getByText('Guest of Kay Board', { exact: true })).toBeVisible();
    const kay2 = await open(keys, page, 'Edit Kay Board');
    await stepOption(kay2.getByLabel('Move Kay Board to'));
    await expect(kay2.getByLabel('Move Kay Board to')).not.toHaveAttribute('data-value', '');
    await page.keyboard.press('Tab');
    await expect(kay2.getByRole('button', { name: 'Move', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    // The plus-one moved with them.
    const locks = party(page, `Locks ${s}`);
    await expect(locks.getByText('Kay Board', { exact: true })).toBeVisible();
    await expect(locks.getByText('Guest of Kay Board', { exact: true })).toBeVisible();
    await expect(keys.getByText('No guests in this party yet.')).toBeVisible();
    await expectAccessible(page);
  });

  test('a viewer sees the list read-only and is refused on direct actions', async ({ page, browser }) => {
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `Viewer Wedding ${s}`);
    await page.goto(`${base}/guests`);
    await addParty(page, { name: `Visible ${s}` });
    await addGuest(page, `Visible ${s}`, { first: 'Vera', last: 'View', dietary: 'Vegan' });

    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/guests`);
    await expect(
      viewer.getByText('You can view the guest list. Only organizers with edit rights can change it.'),
    ).toBeVisible();
    await expect(party(viewer, `Visible ${s}`).getByText('Vera View', { exact: true })).toBeVisible();
    await expect(viewer.getByRole('region', { name: 'Add party' })).toHaveCount(0);
    await expect(viewer.getByText(/^Edit /)).toHaveCount(0);
    await expect(viewer.getByText(/^Add a guest to /)).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^Remove / })).toHaveCount(0);
    await expectAccessible(viewer);
    await viewerContext.close();

    // The owner's open forms, submitted as the viewer: refused by the server.
    const add = addPartyForm(page);
    await add.getByLabel('Party name').fill('Sneaky party');
    const guestForm = await open(party(page, `Visible ${s}`), page, `Add a guest to Visible ${s}`);
    await guestForm.getByLabel('First name').fill('Sneaky');
    await signIn(page, VIEWER);
    await add.getByRole('button', { name: 'Add party' }).click();
    await expect(add.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();
    await guestForm.getByRole('button', { name: 'Add guest' }).click();
    await expect(
      guestForm.getByRole('alert').filter({ hasText: "You don't have access to this." }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText('Sneaky', { exact: false })).toHaveCount(0);
  });

  test('Arabic: the guests page renders right to left', async ({ page }) => {
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `RTL Wedding ${s}`);
    await page.goto(`/ar${base}/guests`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الضيوف', level: 1 })).toBeVisible();
    await expect(page.getByText('لا يوجد ضيوف بعد')).toBeVisible();
    await expectAccessible(page);
    const add = page.getByRole('region', { name: 'إضافة مجموعة' });
    await add.getByRole('button', { name: 'إضافة مجموعة' }).click();
    await expect(add.getByText('أدخل اسم المجموعة (حتى 120 حرفًا).')).toBeVisible();
    await add.getByLabel('اسم المجموعة').fill(`عائلة ${s}`);
    await add.getByRole('button', { name: 'إضافة مجموعة' }).click();
    await expect(add.getByText('تمت إضافة المجموعة.')).toBeVisible();
    const p = page.getByRole('region', { name: `عائلة ${s}`, exact: true });
    await p.getByText(`إضافة ضيف إلى عائلة ${s}`).click();
    const form = page.getByRole('region', { name: `إضافة ضيف إلى عائلة ${s}` });
    await form.getByLabel('الاسم الأول').fill('ليلى');
    await form.getByRole('button', { name: 'إضافة ضيف' }).click();
    await expect(p.getByText('ليلى', { exact: true })).toBeVisible();
    await expect(page.getByText('مجموعة واحدة', { exact: true })).toBeVisible();
    await expectAccessible(page);
  });

  test('profiles decide: a conference has no guests page', async ({ page }) => {
    await signIn(page);
    const res = await page.goto('/o/lakeside-events/e/midwest-leadership-summit-2027/guests');
    expect(res?.status()).toBe(404);
  });
});
