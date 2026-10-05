import { expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { campaignScenario } from '@yayatoh/testing';
import { expectAccessible, expectHtmlAccessible, newUser, pickOption } from './helpers.ts';

/**
 * M3.6b campaigns: build a campaign from blocks with the keyboard, pick an audience (the count
 * and who is left out, before sending), test send, schedule, send and see the results; pause,
 * resume and cancel; viewers read only; Arabic RTL; axe on every screen.
 */
const kms = process.env.LOCAL_KMS_KEY;
if (kms) setKeyVault(localKeyVault(kms));

test.afterAll(async () => {
  await closePools();
});

interface Captured {
  subject: string;
  text: string;
  html: string;
}

const stampOf = () => `${Date.now()}${test.info().project.name.slice(0, 1)}`;

async function mailbox(page: Page, to: string): Promise<Captured[]> {
  return (await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`)).json();
}
async function drain(page: Page, org: string) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org } });
  expect(res.ok()).toBe(true);
}
async function runCampaigns(page: Page, org: string) {
  const res = await page.request.post('/api/dev/campaigns/run', { form: { org } });
  expect(res.ok()).toBe(true);
}

/** A fresh org (owner signed in) with two subscribers, one contact without consent and an audience. */
async function orgWithSubscribers(page: Page) {
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  const slug = owner.orgSlug as string;
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`no org ${slug}`);
  const stamp = stampOf();
  const people = {
    amina: `amina+${stamp}@fans.test`,
    bo: `bo+${stamp}@fans.test`,
    cy: `cy+${stamp}@fans.test`,
  };
  await campaignScenario(org.orgId, [
    { email: people.amina, name: 'Amina Diallo', consent: 'granted' },
    { email: people.bo, name: 'Bo Chen', consent: 'granted' },
    { email: people.cy, name: 'Cy Park', consent: null },
  ]);
  return { slug, people, stamp };
}

/** Create a draft from the list page with the keyboard; lands on its page. */
async function createDraft(page: Page, slug: string, name: string) {
  await page.goto(`/o/${slug}/campaigns`);
  const field = page.getByLabel('Name', { exact: true });
  await field.fill(name);
  await field.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText('Draft created. Build it below, then pick an audience.')).toBeVisible();
}

/** Fill the minimum content (subject, text, postal address) and save. */
async function fillAndSave(page: Page) {
  const editor = page.getByRole('form', { name: 'Campaign content' });
  await editor.getByLabel('Subject', { exact: true }).fill('Spring season for {{first_name|you}}');
  await editor
    .getByRole('group', { name: 'Block 2: Text' })
    .getByLabel('Text', { exact: true })
    .fill('Our spring season opens soon.');
  await editor
    .getByRole('group', { name: /Footer$/ })
    .getByLabel('Postal address')
    .fill('1 Lake St, Chicago IL');
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
}

async function chooseEveryone(page: Page) {
  const form = page.getByRole('form', { name: 'Audience' });
  await form.getByLabel('A saved audience', { exact: true }).check();
  await pickOption(form.getByLabel('Saved audience', { exact: true }), { label: 'Everyone' });
  await form.getByRole('button', { name: 'Use this audience' }).click();
  await expect(page.getByText('Audience saved.')).toBeVisible();
}

test.describe('campaigns (M3.6b)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('build with blocks by keyboard, pick an audience, test send, send and see the results', async ({
    page,
  }) => {
    const { slug, people, stamp } = await orgWithSubscribers(page);
    await page.goto(`/o/${slug}`);
    await expect(page.locator(`nav a[href$="/${slug}/campaigns"]`).first()).toBeAttached();
    await page.goto(`/o/${slug}/campaigns`);
    await expect(page.getByRole('heading', { level: 1, name: 'Campaigns' })).toBeVisible();
    await expect(page.getByText('No campaigns yet')).toBeVisible();
    await expectAccessible(page);

    // Validation: a name is required.
    await page.getByRole('button', { name: 'Create campaign' }).click();
    await expect(page.getByText('This is required.')).toBeVisible();

    const name = `Spring news ${stamp}`;
    await createDraft(page, slug, name);
    await expectAccessible(page);
    const editor = page.getByRole('form', { name: 'Campaign content' });

    // Validation: an empty subject, empty text and an unknown merge field are refused by field.
    await editor.getByLabel('Subject', { exact: true }).fill('');
    await editor
      .getByRole('group', { name: 'Block 2: Text' })
      .getByLabel('Text', { exact: true })
      .fill('Hi {{nickname}}');
    await editor.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Fix the highlighted fields and save again.')).toBeVisible();
    await expect(editor.getByLabel('Subject', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Unknown merge field. Use one from the list above.')).toBeVisible();
    await expect(page.getByText('This is required.').first()).toBeVisible();
    await expectAccessible(page);

    // Keyboard only: add a button block (inserted before the footer), focus lands on it.
    const type = editor.getByLabel('Block type');
    await type.focus();
    await pickOption(type, 'button');
    await page.keyboard.press('Tab');
    await expect(editor.getByRole('button', { name: 'Add block' })).toBeFocused();
    await page.keyboard.press('Enter');
    const button = editor.getByRole('group', { name: 'Block 3: Button' });
    await expect(button).toBeVisible();
    await button.getByLabel('Button text').fill('Get tickets');
    // Move it above the text with the keyboard; the focus follows the block.
    await button.getByRole('button', { name: 'Move Block 3: Button up' }).focus();
    await page.keyboard.press('Enter');
    await expect(editor.getByRole('group', { name: 'Block 2: Button' })).toBeVisible();
    await expect(editor.getByRole('group', { name: 'Block 3: Text' })).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Move Block 2: Button up' })).toBeFocused();
    // An event card, then remove a divider again.
    await pickOption(type, 'eventCard');
    await editor.getByRole('button', { name: 'Add block' }).click();
    await expect(editor.getByRole('group', { name: 'Block 4: Event card' })).toBeVisible();
    await pickOption(type, 'divider');
    await editor.getByRole('button', { name: 'Add block' }).click();
    await editor.getByRole('button', { name: 'Remove Block 5: Divider' }).click();
    await expect(editor.getByRole('group', { name: 'Block 5: Footer' })).toBeVisible();

    await editor.getByLabel('Subject', { exact: true }).fill('Spring season for {{first_name|you}}');
    await editor
      .getByRole('group', { name: 'Block 3: Text' })
      .getByLabel('Text', { exact: true })
      .fill('Our spring season opens soon.');
    await editor
      .getByRole('group', { name: 'Block 5: Footer' })
      .getByLabel('Postal address')
      .fill('1 Lake St, Chicago IL');
    await editor.getByRole('button', { name: 'Save draft' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Draft saved.')).toBeVisible();

    // Persisted after a reload.
    await page.reload();
    await expect(
      editor.getByRole('group', { name: 'Block 2: Button' }).getByLabel('Button text'),
    ).toHaveValue('Get tickets');
    await expect(editor.getByLabel('Subject', { exact: true })).toHaveValue(
      'Spring season for {{first_name|you}}',
    );

    // Preview: desktop and mobile frames of the email.
    await page.getByRole('button', { name: 'Update preview' }).click();
    await expect(page.getByText('Subject: Spring season for you')).toBeVisible();
    await expect(page.locator('iframe[title="Email preview (Desktop)"]')).toBeVisible();
    await page.getByRole('button', { name: 'Mobile' }).click();
    await expect(page.getByRole('button', { name: 'Mobile' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('iframe[title="Email preview (Mobile)"]')).toHaveAttribute(
      'data-frame',
      'mobile',
    );

    // Audience: the count and who is left out are shown before sending.
    await chooseEveryone(page);
    await expect(page.getByTestId('reach')).toContainText('2 people of 3 contacts would get it now.');
    await expect(page.getByRole('row', { name: /No marketing consent\s*1/ })).toBeVisible();
    await expectAccessible(page);

    // Test send: marked, merge fields show their fallbacks, not counted.
    const tester = `qa+${stamp}@team.test`;
    await page.getByLabel('Email addresses').fill(tester);
    await page.getByRole('button', { name: 'Send test' }).click();
    await expect(page.getByText('Test sent to 1 address.')).toBeVisible();
    await drain(page, slug);
    const [test1] = await mailbox(page, tester);
    expect(test1?.subject).toBe('[Test] Spring season for you');
    expect(test1?.html).toContain('data-test-banner');
    expect(test1?.html).toContain('1 Lake St, Chicago IL');
    await expectHtmlAccessible(page, test1?.html ?? '');

    // Send now, after confirming the count.
    await page.getByRole('button', { name: 'Send now…' }).click();
    await expect(page.getByText('Send it now to 2 people?')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, send now' }).click();
    await expect(page.getByText('Sending', { exact: true }).first()).toBeVisible();
    await runCampaigns(page, slug);
    await drain(page, slug);
    await runCampaigns(page, slug);
    const [mail] = await mailbox(page, people.amina);
    expect(mail?.subject).toBe('Spring season for Amina');
    expect(mail?.html).toMatch(/\/r\/[a-z0-9]{8}/);
    expect(mail?.html).toContain('/unsubscribe/');
    expect(await mailbox(page, people.cy)).toHaveLength(0);
    await page.reload();
    await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible();
    const results = page.getByTestId('results');
    await expect(results.getByText('Recipients').locator('xpath=..')).toContainText('2');
    await expect(results.getByText('Sent', { exact: true }).locator('xpath=..')).toContainText('2');
    await expect(results.getByText('Opened').locator('xpath=..')).toContainText('Not tracked');
    await expectAccessible(page);
    // The list shows it as sent with its recipients.
    await page.goto(`/o/${slug}/campaigns`);
    await expect(page.getByRole('row', { name: new RegExp(`${name}.*Sent.*2`) })).toBeVisible();
  });

  test('schedule in the org timezone, unschedule; pause, resume and cancel a send', async ({ page }) => {
    const { slug, stamp } = await orgWithSubscribers(page);
    await createDraft(page, slug, `Autumn ${stamp}`);
    await fillAndSave(page);
    await chooseEveryone(page);
    const schedule = page.getByRole('form', { name: 'Schedule' });
    await expect(schedule.getByText(/Date and time in America\//)).toBeVisible();
    // Validation: nothing picked, then a time in the past.
    await schedule.getByRole('button', { name: 'Schedule' }).click();
    await expect(page.getByText('Pick a date and time.')).toBeVisible();
    await schedule.getByLabel('Send at').fill('2020-01-01T09:00');
    await schedule.getByRole('button', { name: 'Schedule' }).click();
    await expect(page.getByText('Pick a time in the future.')).toBeVisible();
    const next = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await schedule.getByLabel('Send at').fill(`${next}T09:30`);
    await schedule.getByRole('button', { name: 'Schedule' }).click();
    await expect(page.getByText(/^Scheduled for /)).toBeVisible();
    await expect(page.getByRole('form', { name: 'Campaign content' })).toHaveCount(0);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Unschedule' }).click();
    await expect(page.getByText('Back to draft.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('form', { name: 'Campaign content' })).toBeVisible();

    // Send now, then pause and resume before the scheduler releases anyone; then cancel.
    await page.getByRole('button', { name: 'Send now…' }).click();
    await page.getByRole('button', { name: 'Yes, send now' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Paused. Nothing more is sent until you resume.')).toBeVisible();
    await runCampaigns(page, slug); // paused: nothing is released
    await page.reload();
    await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('results').getByText('Waiting').locator('xpath=..')).toContainText('2');
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByText('Resumed.')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel campaign…' }).click();
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(page.getByText('Cancelled. No one else will get it.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
    await expectAccessible(page);
  });

  test('a viewer reads campaigns and results but has no controls', async ({ page, browser }) => {
    const { slug, stamp } = await orgWithSubscribers(page);
    await createDraft(page, slug, `Viewer view ${stamp}`);
    await fillAndSave(page);
    const url = page.url();
    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await newUser(viewer, { join: [`${slug}:viewer`] });
    await viewer.goto(`/o/${slug}/campaigns`);
    await expect(viewer.getByRole('heading', { level: 1, name: 'Campaigns' })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Create campaign' })).toHaveCount(0);
    await viewer.getByRole('link', { name: `Viewer view ${stamp}` }).click();
    await expect(viewer.getByText('You can view this campaign but not change or send it.')).toBeVisible();
    await expect(viewer.getByRole('form', { name: 'Campaign content' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Send now…' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Send test' })).toHaveCount(0);
    await expect(viewer.locator('iframe[title="Email preview (Desktop)"]')).toBeVisible();
    await viewer.goto(new URL(url).pathname);
    await expect(viewer.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
    await expectAccessible(viewer);
    await ctx.close();
  });

  test('Arabic: the campaign pages render right to left', async ({ page }) => {
    const { slug, stamp } = await orgWithSubscribers(page);
    await createDraft(page, slug, `RTL ${stamp}`);
    const path = new URL(page.url()).pathname.replace(/^\/(?:[a-z]{2}\/)?/, '/');
    await page.goto(`/ar${path}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('form', { name: 'محتوى الحملة' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'الكتلة 1: عنوان' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar/o/${slug}/campaigns`);
    await expect(page.getByRole('heading', { level: 1, name: 'الحملات' })).toBeVisible();
    await expectAccessible(page);
  });
});
