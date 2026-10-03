import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, OPEN_HOUSE, pickOption, signIn } from './helpers.ts';

/**
 * U6 templates from scratch: the New template builder (profile → tickets → page sections → page
 * content → checklist), events made from it, "Save as template" on the event header, starters
 * copied into "Your templates", duplicate, archive and restore, and the setup guide's own checklist.
 */

const ORG = '/o/lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const tagOf = () => `${test.info().project.name.replace(/[^a-z0-9]/g, '')}${Date.now()}`;
const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Step 1 by keyboard: kind of event (radio arrows), name, length; lands on the builder page. */
async function newTemplate(page: Page, name: string, opts: { hours?: string } = {}) {
  await page.goto(`${ORG}/templates/new`);
  // Radios: focus the first, move with the arrow keys to Conference.
  const first = page.getByRole('radio').first();
  await first.focus();
  const conference = page.getByRole('radio', { name: /^Conference/ });
  for (let i = 0; i < 6 && !(await conference.isChecked()); i++) await page.keyboard.press('ArrowDown');
  await expect(conference).toBeChecked();
  await page.getByLabel('Template name').fill(name);
  await page.getByLabel('Hours').fill(opts.hours ?? '8');
  await page.getByLabel('Minutes').fill('0');
  await page.getByRole('button', { name: 'Create template' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}\?created=1$/);
  return new URL(page.url()).pathname.replace(/^\/en/, '');
}

test.describe('template builder (U6)', () => {
  test('build a template from scratch and create an event with exactly its contents', async ({ page }) => {
    test.setTimeout(150_000);
    const tag = tagOf();
    await signIn(page);
    await page.goto(`${ORG}/templates`);
    await expect(page.getByRole('heading', { name: 'How templates work' })).toBeVisible();
    await page.getByRole('link', { name: 'New template' }).first().click();
    await expect(page).toHaveURL(/\/templates\/new$/);
    await expect(page.getByRole('heading', { name: 'New template', level: 1 })).toBeVisible();
    await expect(
      page.getByText('Registration, sessions, speakers, exhibitors, sponsors and badges.'),
    ).toBeVisible();
    await expectAccessibleBothModes(page);

    // Validation: a name is needed, and a length of at least 15 minutes.
    await page.getByLabel('Hours').fill('0');
    await page.getByLabel('Minutes').fill('5');
    await page.getByRole('button', { name: 'Create template' }).click();
    await expect(page.getByText('Enter a name of 2 to 120 characters.')).toBeVisible();
    await page.getByLabel('Template name').fill(`Summit kit ${tag}`);
    await page.getByRole('button', { name: 'Create template' }).click();
    await expect(page.getByText('Enter a length between 15 minutes and 14 days.')).toBeVisible();
    // The typed name is kept after a refusal.
    await expect(page.getByLabel('Template name')).toHaveValue(`Summit kit ${tag}`);
    await expectAccessible(page);

    const name = `Summit kit ${tag}`;
    const tpl = await newTemplate(page, name);
    await expect(
      page.getByText('Template created. Add its ticket types, page sections and checklist below.'),
    ).toBeVisible();
    const steps = page.getByRole('navigation', { name: 'Template steps' });
    await expect(steps.locator('[aria-current="step"]')).toContainText('Ticket types');
    await expect(page.getByText('No ticket types yet. Add the first one below.')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Ticket types: a bad price explains itself; then two good ones.
    const tickets = page.getByRole('region', { name: 'Default ticket types' });
    await tickets.getByLabel('Ticket name').fill('Standard');
    await tickets.getByLabel('Price (USD)').fill('12.345');
    await tickets.getByLabel('Quantity available').fill('300');
    await tickets.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(tickets.getByText('Enter a price like 25 or 25.00.')).toBeVisible();
    await tickets.getByLabel('Price (USD)').fill('120');
    await tickets.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(tickets.getByText('Ticket type added.')).toBeVisible();
    await tickets.getByLabel('Ticket name').fill('Student');
    await tickets.getByLabel('Price (USD)').fill('40');
    await tickets.getByLabel('Quantity available').fill('50');
    await tickets.getByRole('button', { name: 'Add ticket type' }).click();
    const ticketList = tickets.getByRole('list', { name: 'Ticket types' });
    await expect(ticketList.getByRole('listitem')).toHaveCount(2);
    await expect(ticketList).toContainText('$120.00 · 300 available');
    // Remove one and add it back by keyboard.
    await tickets.getByRole('button', { name: 'Remove the ticket type Student' }).click();
    await expect(ticketList.getByRole('listitem')).toHaveCount(1);
    await tickets.getByLabel('Ticket name').fill('Student');
    await tickets.getByLabel('Price (USD)').fill('40');
    await tickets.getByLabel('Quantity available').fill('50');
    await tickets.getByLabel('Quantity available').press('Enter');
    await expect(ticketList.getByRole('listitem')).toHaveCount(2);

    // Page sections: text, then an FAQ (U1 select), then reorder with the buttons.
    const sections = page.getByRole('region', { name: 'Page sections' });
    await sections.getByLabel('Section title').fill('About');
    await sections.getByLabel('Text', { exact: true }).fill('A day of **talks**.');
    await sections.getByRole('button', { name: 'Add section' }).click();
    await expect(sections.getByText('Section added.')).toBeVisible();
    await pickOption(sections.getByRole('combobox', { name: 'Section type' }), 'faq');
    await sections.getByLabel('Section title').fill('FAQ');
    await sections.getByLabel('Questions and answers').fill('Is lunch included?');
    await sections.getByRole('button', { name: 'Add section' }).click();
    await expect(
      sections.getByText('Question 1 has no answer: add the answer on the lines below it.'),
    ).toBeVisible();
    await sections.getByLabel('Questions and answers').fill('Is lunch included?\nYes, and coffee.');
    await sections.getByRole('button', { name: 'Add section' }).click();
    const order = sections.getByRole('list', { name: 'Page sections in order' }).getByRole('listitem');
    await expect(order).toHaveCount(2);
    await sections.getByRole('button', { name: 'Move FAQ up' }).focus();
    await page.keyboard.press('Enter');
    await expect(order.first()).toContainText('FAQ');
    await expect(order.nth(1)).toContainText('About');

    // Page content and settings.
    await page.getByLabel('Tagline (optional)').fill('The yearly meetup');
    await page.getByLabel('Venue (optional)').fill('Main hall');
    await pickOption(page.getByRole('combobox', { name: 'Who can find it' }), 'unlisted');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved.')).toBeVisible();

    // Checklist: empty is refused; then two items by keyboard (Enter submits).
    const checklist = page.getByRole('region', { name: 'Checklist', exact: true });
    await expect(checklist.getByText('No checklist items yet.')).toBeVisible();
    await checklist.getByRole('button', { name: 'Add item' }).click();
    await expect(checklist.getByText('Enter 1 to 200 characters.')).toBeVisible();
    await checklist.getByLabel('New checklist item').fill('Book the AV crew');
    await checklist.getByLabel('New checklist item').press('Enter');
    await expect(checklist.getByText('Item added.')).toBeVisible();
    await checklist.getByLabel('New checklist item').fill('Print the badges');
    await checklist.getByLabel('New checklist item').press('Enter');
    const items = checklist.getByRole('list', { name: 'Checklist items' }).getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expectAccessibleBothModes(page);

    // Everything persists.
    await page.reload();
    await expect(page.getByRole('list', { name: 'Ticket types' }).getByRole('listitem')).toHaveCount(2);
    await expect(order).toHaveCount(2);
    await expect(items).toHaveCount(2);
    await expect(page.getByLabel('Tagline (optional)')).toHaveValue('The yearly meetup');
    await expect(steps.locator('[aria-current="step"]')).toHaveCount(0);
    await expect(page.getByText('No events yet. Create the first one below.')).toBeVisible();

    // Create an event from it (the header's primary action jumps to the form).
    await page.getByRole('link', { name: 'Create an event', exact: true }).click();
    const use = page.getByRole('region', { name: 'Create an event from this template' });
    await use.getByLabel('Name of the new event').fill(`From kit ${tag}`);
    await use.getByLabel('Starts', { exact: true }).fill('2028-03-01T09:00');
    await use.getByRole('button', { name: 'Create event' }).click();
    await expect(page).toHaveURL(/\/e\/from-kit-[a-z0-9-]+$/);
    const made = new URL(page.url()).pathname.replace(/^\/en/, '');
    await expect(page.getByText('Draft ·')).toBeVisible();
    await page.goto(`${made}/tickets-orders`);
    await expect(page.getByRole('row').filter({ hasText: 'Standard' })).toContainText('0 / 300');
    await expect(page.getByRole('row').filter({ hasText: 'Student' })).toContainText('0 / 50');
    await page.goto(`${made}/content`);
    const pageSections = page
      .getByRole('list', { name: 'Sections in page order' })
      .locator('li[data-section-id]');
    await expect(pageSections).toHaveCount(2);
    await expect(pageSections.first()).toContainText('FAQ');
    await page.goto(`${made}/setup-guide`);
    const own = page.getByRole('list', { name: 'Your checklist items' });
    await expect(own.getByRole('listitem')).toHaveCount(2);
    await expect(own).toContainText('Book the AV crew');
    await expect(page.getByText('0 of 2 done')).toBeVisible();

    // Template → events.
    await page.goto(tpl);
    const made_ = page.getByRole('list', { name: 'Events made from this template' });
    await expect(made_.getByRole('link', { name: `From kit ${tag}` })).toHaveAttribute(
      'href',
      new RegExp(`${made}$`),
    );
    // And the list summarises it.
    await page.goto(`${ORG}/templates`);
    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name }) });
    await expect(card.getByText('2 ticket types · 0 questions · no floor plan')).toBeVisible();
    await expect(card.getByText('2 page sections · 2 checklist items · Built from scratch')).toBeVisible();
  });

  test('the setup guide checklist: tick, untick, add and remove by keyboard', async ({ page }) => {
    const tag = tagOf();
    await signIn(page);
    await page.goto(`${OPEN_HOUSE}/setup-guide`);
    const region = page.getByRole('region', { name: 'Your checklist' });
    const title = `Call the caterer ${tag}`;
    await region.getByLabel('New item').fill(title);
    await region.getByLabel('New item').press('Enter');
    await expect(region.getByText('Item added.')).toBeVisible();
    const done = region.getByRole('button', { name: `Mark ${title} as done` });
    await done.focus();
    await page.keyboard.press('Enter');
    const undo = region.getByRole('button', { name: `Mark ${title} as not done` });
    await expect(undo).toHaveAttribute('aria-pressed', 'true');
    await expectAccessibleBothModes(page);
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect(region.getByRole('button', { name: `Mark ${title} as done` })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await region.getByRole('button', { name: `Remove ${title}` }).click();
    await expect(region.getByText(title)).toHaveCount(0);
  });

  test('save an event as a template from the event header', async ({ page }) => {
    const tag = tagOf();
    await signIn(page);
    await page.goto(OPEN_HOUSE);
    const save = page.getByRole('link', { name: 'Save as template' });
    await expect(save).toBeVisible();
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/copy#save-template$/);
    const form = page.getByRole('region', { name: 'Save as template' });
    await form.getByLabel('Template name').fill(`Open house kit ${tag}`);
    await form.getByRole('button', { name: 'Save template' }).click();
    await expect(form.getByText('Template saved.')).toBeVisible();
    await page.goto(`${ORG}/templates`);
    await expect(page.getByRole('heading', { name: `Open house kit ${tag}` })).toBeVisible();
    await expect(
      page
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: `Open house kit ${tag}` }) })
        .getByText(/Saved from an event/),
    ).toBeVisible();
  });

  test('copy a starter, duplicate, archive and restore', async ({ page }) => {
    test.setTimeout(90_000);
    const tag = tagOf();
    await signIn(page);
    await page.goto(`${ORG}/templates`);
    const gala = page.locator('[data-starter="gala"]');
    await expect(
      gala.getByText('Read-only. Copy it to your templates to change its tickets, sections or checklist.'),
    ).toBeVisible();
    await gala.getByRole('button', { name: 'Copy the Gala starter to your templates' }).click();
    await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}\?copied=1$/);
    await expect(page.getByText('Starter copied to your templates. Fill it in below.')).toBeVisible();
    await expect(
      page.getByText('Tickets, tables and sponsors, seating, donations and check-in.'),
    ).toBeVisible();
    // Rename it so this run can find it again.
    const name = `Gala kit ${tag}`;
    await page.getByLabel('Template name').fill(name);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved.')).toBeVisible();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

    // Duplicate: the copy opens.
    await page.getByRole('button', { name: `Duplicate the template ${name}` }).click();
    await expect(page).toHaveURL(/\?duplicated=1$/);
    await expect(page.getByRole('heading', { name: `${name} (copy)`, level: 1 })).toBeVisible();

    // Archive the copy: read-only, out of the list and its pickers, listed under Archived.
    await page.getByRole('button', { name: `Archive the template ${name} (copy)` }).click();
    await expect(page.getByText(/This template is archived/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add ticket type' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Create an event from this template' })).toHaveCount(0);
    await expectAccessibleBothModes(page);
    await page.goto(`${ORG}/templates`);
    await expect(page.getByRole('heading', { name: `${name} (copy)` })).toHaveCount(0);
    await expect(page.getByText(`Create an event from ${name} (copy)`)).toHaveCount(0);
    await page.getByRole('heading', { name: /^Archived templates/ }).click();
    const archived = page.getByRole('button', { name: `Restore the template ${name} (copy)` });
    await expect(archived).toBeVisible();
    await expectAccessible(page);
    await archived.click();
    await expect(page.getByRole('heading', { name: `${name} (copy)` })).toBeVisible();
    await expect(page.getByText(`Create an event from ${name} (copy)`)).toBeVisible();
  });

  test('viewers: no builder, no header button, refused direct URLs', async ({ page }) => {
    // An owner's template for the viewer to look at.
    await signIn(page);
    const tpl = await newTemplate(page, `Viewer kit ${tagOf()}`);
    await signIn(page, VIEWER);
    await page.goto(`${ORG}/templates`);
    await expect(page.getByRole('heading', { name: 'Templates', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New template' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Copy the .* starter/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Archive the template/ })).toHaveCount(0);
    await page.goto(`${ORG}/templates/new`);
    await expect(page.getByText("Copying events isn't part of your role")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create template' })).toHaveCount(0);
    await expectAccessible(page);
    // The template's page is read only.
    await page.goto(tpl);
    await expect(page.getByRole('heading', { name: 'Default ticket types' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add ticket type' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add section' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add item' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Archive the template/ })).toHaveCount(0);
    await expectAccessible(page);
    // No "Save as template" on the event header.
    await page.goto(OPEN_HOUSE);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Save as template' })).toHaveCount(0);
    // An unknown template is a 404.
    const res = await page.goto(`${ORG}/templates/00000000-0000-4000-8000-000000000000`);
    expect(res?.status()).toBe(404);
  });

  test('the builder in Arabic (RTL)', async ({ page }) => {
    const tag = tagOf();
    await signIn(page);
    const tpl = await newTemplate(page, `Rtl kit ${tag}`, { hours: '3' });
    await page.goto(`/ar${ORG}/templates/new`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'قالب جديد', level: 1 })).toBeVisible();
    await expectAccessible(page);
    expect(await noSideScroll(page)).toBe(true);
    await page.goto(`/ar${tpl}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'أنواع التذاكر الافتراضية' })).toBeVisible();
    await expectAccessible(page);
    expect(await noSideScroll(page)).toBe(true);
    await page.goto(`/ar${ORG}/templates`);
    await expect(page.getByRole('heading', { name: 'كيف تعمل القوالب' })).toBeVisible();
    await expectAccessible(page);
    expect(await noSideScroll(page)).toBe(true);
  });
});
