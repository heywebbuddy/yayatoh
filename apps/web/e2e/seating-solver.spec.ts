import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, signIn } from './helpers.ts';
import { quickPlan } from './seating-helpers.ts';

/**
 * M6.12a seating rules and solver: build rules (keyboard only, every validation message), run
 * the solver, review and edit the proposal as a list, accept one table then all; 400 guests in
 * at most 5 s with no hard-rule break; a manual placement made meanwhile is never overwritten;
 * the read-only viewer; empty states; axe in both themes; Arabic RTL.
 */

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

async function createWedding(page: Page, name: string): Promise<string> {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Event type').selectOption('wedding');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(`${chicagoDate(60)}T16:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${chicagoDate(60)}T23:00`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  return new URL(page.url()).pathname;
}

const partyRegion = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function addParty(page: Page, p: { name: string; side?: string; vip?: boolean }, guests: string[]) {
  const add = page.getByRole('region', { name: 'Add party' });
  await add.getByLabel('Party name').fill(p.name);
  if (p.side) await add.getByLabel('Side').fill(p.side);
  if (p.vip) await add.getByRole('checkbox', { name: 'VIP' }).check();
  await add.getByRole('button', { name: 'Add party' }).click();
  await expect(add.getByText('Party added.')).toBeVisible();
  const region = partyRegion(page, p.name);
  await expect(region).toBeVisible();
  for (const first of guests) {
    const summary = `Add a guest to ${p.name}`;
    const form = page.getByRole('region', { name: summary, exact: true });
    if (!(await form.isVisible())) await region.getByText(summary, { exact: true }).click();
    await form.getByLabel('First name').fill(first);
    await form.getByLabel('Last name').fill('X');
    await form.getByRole('button', { name: 'Add guest' }).click();
    await expect(form.getByText('Guest added.')).toBeVisible();
    await expect(region.getByText(`${first} X`, { exact: true })).toBeVisible();
  }
}

/** A wedding with three tables of four, a stage, and Garcia (VIP, Bride), Patel (Bride), Chen (Groom). */
async function smallWedding(page: Page, name: string) {
  const base = await createWedding(page, name);
  await quickPlan(page, base, { tables: 3, seatsPerTable: 4, stage: true });
  await page.goto(`${base}/guests`);
  await addParty(page, { name: 'Garcia', side: 'Bride', vip: true }, ['Luis', 'Ana']);
  await addParty(page, { name: 'Patel', side: 'Bride' }, ['Raj']);
  await addParty(page, { name: 'Chen', side: 'Groom' }, ['Mei', 'Jun', 'Kai']);
  return base;
}

const rules = (page: Page) => page.getByRole('list', { name: 'Seating rules' });
const addForm = (page: Page) => page.getByRole('form', { name: 'Add a rule' });

/** Choose an option of a select by keyboard: focus it, then pick (Playwright's selectOption). */
async function choose(page: Page, label: string, option: string, scope = addForm(page)) {
  const select = scope.getByLabel(label, { exact: true });
  await select.focus();
  await select.selectOption({ label: option });
}

async function submitRule(page: Page) {
  await addForm(page).getByRole('button', { name: 'Add rule' }).focus();
  await page.keyboard.press('Enter');
}

/** Choose a proposed table for a guest by its label ("Table 2"), whatever its free count. */
async function pickTable(page: Page, guest: string, table: string) {
  const select = page.getByLabel(`Table for ${guest}`);
  await select.focus();
  const value = await select.locator('option', { hasText: `${table} (` }).getAttribute('value');
  await select.selectOption(value ?? '');
}

async function openSolver(page: Page, base: string) {
  await page.goto(`${base}/seating/solver`);
  await expect(page.getByRole('heading', { name: 'Seating rules and solver', level: 1 })).toBeVisible();
}

test.describe('seating rules and solver (M6.12a)', () => {
  test('keyboard only: build rules, run, review, accept one table then all', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page);
    const base = await smallWedding(page, `Solver Keys ${stamp()}`);

    // The tab sits with the other seating views.
    await page.goto(`${base}/seating/guests`);
    await page
      .getByRole('navigation', { name: 'Seating views' })
      .getByRole('link', { name: 'Auto-seat' })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Seating rules and solver', level: 1 })).toBeVisible();
    await expect(page.getByText('No rules yet.', { exact: false })).toBeVisible();
    await expect(page.getByText('6 guests still to seat. Nobody is seated yet.')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Keep each party together (the default rule, hard).
    await submitRule(page);
    await expect(page.getByText('Rule added.')).toBeVisible();
    await expect(rules(page).getByText('Keep each party together')).toBeVisible();
    await expect(rules(page).getByText('Hard · weight 5')).toBeVisible();

    // The same rule again: refused.
    await submitRule(page);
    await expect(page.getByText('This event already has that rule.')).toBeVisible();

    // Keep apart: nothing chosen, then the same group twice, then Bride vs Groom.
    await choose(page, 'Rule', 'Keep apart');
    await submitRule(page);
    await expect(addForm(page).getByText('Choose who the rule is about.')).toHaveCount(2);
    const first = addForm(page).getByRole('group', { name: 'First group' });
    const second = addForm(page).getByRole('group', { name: 'Second group' });
    await choose(page, 'Who', 'Everyone on a side', first);
    await first.getByLabel('Side').fill('Bride');
    await choose(page, 'Who', 'Everyone on a side', second);
    await second.getByLabel('Side').fill('bride');
    await submitRule(page);
    await expect(addForm(page).getByText('Choose two different groups.')).toBeVisible();
    await second.getByLabel('Side').fill('Groom');
    await submitRule(page);
    await expect(page.getByText('Rule added.')).toBeVisible();
    await expect(rules(page).getByText('Keep the Bride side apart from the Groom side')).toBeVisible();

    // VIP nearest the stage, soft, weight 8; a weight out of range first.
    await choose(page, 'Rule', 'VIP nearest the stage');
    await addForm(page).getByRole('radio', { name: 'Soft' }).focus();
    await page.keyboard.press('Space');
    await addForm(page).getByLabel('Weight').fill('11');
    await submitRule(page);
    await expect(addForm(page).getByText('Enter a weight from 1 to 10.')).toBeVisible();
    await addForm(page).getByLabel('Weight').fill('8');
    await submitRule(page);
    await expect(page.getByText('Rule added.')).toBeVisible();
    await expect(rules(page).getByText('Soft · weight 8')).toBeVisible();

    // Change a rule: the party rule becomes weight 3; a bad weight is caught inline.
    const edit = page.getByRole('form', { name: 'Change rule: Keep each party together' });
    await edit.getByLabel('Weight').fill('0');
    await edit.getByRole('button', { name: 'Save' }).focus();
    await page.keyboard.press('Enter');
    await expect(edit.getByText('Enter a weight from 1 to 10.')).toBeVisible();
    await edit.getByLabel('Weight').fill('3');
    await edit.getByRole('button', { name: 'Save' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Rule saved.')).toBeVisible();
    await expect(rules(page).getByText('Hard · weight 3')).toBeVisible();
    await expectAccessible(page);

    // A bad arrangement number, then run.
    await page.getByLabel('Arrangement number').fill('0');
    await page.getByRole('button', { name: 'Propose seating' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Enter a whole number from 1 to 1,000,000.')).toBeVisible();
    await page.getByLabel('Arrangement number').fill('1');
    await page.getByRole('button', { name: 'Propose seating' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Proposal ready in', { exact: false })).toBeVisible();
    await expect(page.getByText('No hard rule is broken.')).toBeVisible();
    await expect(page.getByText(/^6 guests at [23] tables; nobody left in the queue\.$/)).toBeVisible();
    await expect(page.getByText('Keep each party together: kept')).toBeVisible();
    await expect(page.getByText('Keep the Bride side apart from the Groom side: kept')).toBeVisible();

    // Chen (Groom) sits apart from Garcia and Patel (Bride).
    const regions = page.getByRole('region', { name: /^Table \d$/ });
    const garcia = regions.filter({ hasText: 'Luis X (Garcia)' });
    const chen = regions.filter({ hasText: 'Mei X (Chen)' });
    await expect(garcia).toContainText('Ana X (Garcia)');
    await expect(chen).toContainText('Jun X (Chen)');
    await expect(chen).not.toContainText('(Garcia)');
    await expect(chen).not.toContainText('(Patel)');
    const brideLabel = ((await garcia.getByRole('heading').textContent()) ?? '').trim();
    const chenLabel = ((await chen.getByRole('heading').textContent()) ?? '').trim();
    await expectAccessibleBothModes(page);

    // Edit by list: Raj back to the queue, by keyboard.
    const raj = page.getByLabel('Table for Raj X');
    await raj.focus();
    await raj.selectOption({ label: 'Leave in the queue' });
    await expect(page.getByRole('region', { name: 'Left in the queue' })).toContainText('Raj X (Patel)');
    await expect(page.getByText('5 guests at 2 tables; 1 guest left in the queue.')).toBeVisible();

    // Moving Mei alone to the Garcia table breaks two hard rules: shown, accepting blocked.
    await pickTable(page, 'Mei X', brideLabel);
    await expect(page.getByText('2 hard rules are broken.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept all tables' })).toBeDisabled();
    await expect(page.getByRole('button', { name: `Accept ${brideLabel.toLowerCase()}` })).toBeDisabled();
    await expect(page.getByText('Fix the tables marked with a warning first.')).toBeVisible();
    // Back with her party.
    await pickTable(page, 'Mei X', chenLabel);
    await expect(page.getByText('No hard rule is broken.')).toBeVisible();

    // Accept the Bride table alone, then all the rest.
    const acceptBride = page.getByRole('button', { name: `Accept ${brideLabel.toLowerCase()}` });
    await expect(acceptBride).toBeEnabled();
    await acceptBride.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(`${brideLabel} accepted: 2 guests seated.`)).toBeVisible();
    const all = page.getByRole('button', { name: 'Accept all tables' });
    await expect(all).toBeEnabled();
    await all.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Proposal accepted: 3 guests seated.')).toBeVisible();

    // It persisted: only Raj (left in the queue) is still to seat; the rest stay where they are.
    await page.reload();
    await expect(
      page.getByText('1 guest still to seat. 5 guests seated by hand stay where they are.'),
    ).toBeVisible();
    await page.goto(`${base}/seating/guests`);
    await expect(page.getByText('5 seated · 1 to seat')).toBeVisible();
  });

  test('a manual placement made after the proposal is never overwritten', async ({ page, context }) => {
    test.setTimeout(180_000);
    await signIn(page);
    const base = await smallWedding(page, `Solver Manual ${stamp()}`);
    await openSolver(page, base);
    await page.getByRole('button', { name: 'Propose seating' }).click();
    await expect(page.getByText('No hard rule is broken.')).toBeVisible();
    const chen = page.getByRole('region', { name: /^Table \d$/ }).filter({ hasText: 'Mei X (Chen)' });
    const chenLabel = ((await chen.getByRole('heading').textContent()) ?? '').trim();

    // Meanwhile, another tab seats Chen by hand at a different table.
    const other = await context.newPage();
    await other.goto(`${base}/seating/guests`);
    await other.getByRole('checkbox', { name: 'Select everyone in Chen' }).check();
    const target = chenLabel === 'Table 3' ? 'Table 2' : 'Table 3';
    await other
      .getByLabel('Table or row', { exact: true })
      .first()
      .selectOption({ label: `${target} — 4 of 4 free` });
    await other.getByRole('button', { name: 'Seat selected guests' }).click();
    await expect(other.getByText(`Seated 3 guests at ${target}.`)).toBeVisible();
    await other.close();

    // Accepting the stale table is refused; nothing moved.
    await chen.getByRole('button', { name: `Accept ${chenLabel.toLowerCase()}` }).click();
    await expect(
      page.getByText('Someone in this proposal was seated by hand meanwhile. Propose again.'),
    ).toBeVisible();
    await page.goto(`${base}/seating/guests`);
    await page.getByLabel('Table to show').selectOption({ label: `${target} — 1 of 4 free` });
    await expect(page.getByRole('region', { name: target, exact: true })).toContainText('Mei X');
  });

  test('400 guests seated in at most 5 seconds with no hard-rule break', async ({ page }) => {
    test.setTimeout(300_000);
    await signIn(page);
    const base = await createWedding(page, `Solver Ballroom ${stamp()}`);
    const event = base.split('/').at(-1) ?? '';
    const res = await page.request.post('/api/dev/seating-solver', {
      form: { org: 'lakeside-events', event, guests: '400' },
      timeout: 240_000,
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ guests: 400 });
    await openSolver(page, base);
    await expect(page.getByText('400 guests still to seat.', { exact: false })).toBeVisible();
    // Parties together and Acme apart from Globex (hard), VIPs near the stage (soft).
    await submitRule(page);
    await expect(rules(page).getByText('Keep each party together')).toBeVisible();
    await choose(page, 'Rule', 'Keep apart');
    const first = addForm(page).getByRole('group', { name: 'First group' });
    const second = addForm(page).getByRole('group', { name: 'Second group' });
    await choose(page, 'Who', 'Everyone with a tag', first);
    await first.getByLabel('Tag').fill('Acme');
    await choose(page, 'Who', 'Everyone with a tag', second);
    await second.getByLabel('Tag').fill('Globex');
    await submitRule(page);
    await expect(
      rules(page).getByText('Keep everyone tagged “Acme” apart from everyone tagged “Globex”'),
    ).toBeVisible();
    await choose(page, 'Rule', 'VIP nearest the stage');
    await addForm(page).getByRole('radio', { name: 'Soft' }).check();
    await submitRule(page);
    await expect(rules(page).getByText('VIP parties nearest the stage')).toBeVisible();

    const started = Date.now();
    await page.getByRole('button', { name: 'Propose seating' }).click();
    await expect(page.getByText('Proposal ready in', { exact: false })).toBeVisible({ timeout: 5_000 });
    const wall = Date.now() - started;
    const ms = Number(await page.getByTestId('solver-time').getAttribute('data-ms'));
    test
      .info()
      .annotations.push({ type: 'solver', description: `worker ${ms} ms, click to summary ${wall} ms` });
    expect(ms).toBeLessThanOrEqual(5_000);
    expect(wall).toBeLessThanOrEqual(5_000);
    await expect(page.getByText('No hard rule is broken.')).toBeVisible();
    await expect(page.getByText(/^400 guests at \d+ tables; nobody left in the queue\.$/)).toBeVisible();
    await expect(page.getByText(/^Soft rules: penalty \d+ \(0 is best\)\.$/)).toBeVisible();

    await page.getByRole('button', { name: 'Accept all tables' }).click();
    await expect(page.getByText('Proposal accepted: 400 guests seated.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Everyone is seated. There is nothing to propose.')).toBeVisible();
  });

  test('the viewer reads rules and proposals but cannot change or accept', async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page);
    const base = await smallWedding(page, `Solver Viewer ${stamp()}`);
    await openSolver(page, base);
    await submitRule(page);
    await expect(rules(page).getByText('Keep each party together')).toBeVisible();

    await signIn(page, VIEWER);
    await openSolver(page, base);
    await expect(rules(page).getByText('Keep each party together')).toBeVisible();
    await expect(page.getByRole('form', { name: 'Add a rule' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Propose seating' }).click();
    await expect(page.getByText('No hard rule is broken.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
    await expect(page.getByLabel('Table for Luis X')).toHaveCount(0);
    await expectAccessible(page);
  });

  test('empty states: no plan, then no guests', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const base = await createWedding(page, `Solver Empty ${stamp()}`);
    await openSolver(page, base);
    await expect(page.getByText('Whole event has no seating plan yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to the plan' })).toBeVisible();
    await expectAccessible(page);
    await quickPlan(page, base, { tables: 2, seatsPerTable: 4, stage: true });
    await openSolver(page, base);
    await expect(page.getByText('No guests to seat yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Guests' })).toBeVisible();
    await expectAccessible(page);
  });

  test('Arabic: right to left, accessible', async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page);
    const base = await smallWedding(page, `Solver RTL ${stamp()}`);
    await page.goto(`/ar${base}/seating/solver`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'قواعد الجلوس والمخطِّط', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'اقتراح الجلوس' }).click();
    await expect(page.getByText('لا تُخالَف أي قاعدة إلزامية.')).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});
