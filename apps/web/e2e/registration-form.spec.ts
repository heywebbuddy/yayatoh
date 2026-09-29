import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

/**
 * M5.1b multi-page conditional registration forms: the organizer builds a three-page form (a
 * member-only page, a workshops page opened by a page-1 answer, a consent question) with buttons
 * and the keyboard; the preview per registration type; job titles; people fill it as two
 * different types, save, resume from the emailed link and submit; Arabic RTL; viewers cannot
 * edit. Until M5.1a, the event's ticket types stand in for registration types.
 */

const ORG = 'lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const stamp = () => `${Date.now().toString(36)}${test.info().project.name.replace(/\D/g, '')}`;
const emailOf = (who: string) => `${who.toLowerCase().replace(/\W+/g, '.')}@example.test`;

test.describe.configure({ mode: 'serial' });

let base = '';
let slug = '';
let eventName = '';

/** A published conference next month with three free ticket types (the stand-in types). */
async function conference(page: Page, name: string) {
  await page.goto(`/o/${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Event type').selectOption('conference');
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  const d = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Starts', { exact: true }).fill(`${d}T09:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${d}T18:00`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const path = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${path}/tickets-orders`);
  for (const type of ['Member', 'Student', 'Exhibitor']) {
    await page.getByLabel('Name', { exact: true }).fill(type);
    await page.getByLabel('Price (USD)').fill('0');
    await page.getByLabel('Quantity available').fill('50');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: type })).toBeVisible();
  }
  return path;
}

const pageCard = (page: Page, n: number, title: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: `Page ${n}: ${title}`, level: 3 }) });

/** Add a question to a page through its "Add a question" disclosure. */
async function addQuestion(
  card: ReturnType<typeof pageCard>,
  title: string,
  q: { label?: string; type: string; required?: boolean; options?: string },
) {
  const add = card.locator('details').filter({ hasText: `Add a question to ${title}` });
  if ((await add.getAttribute('open')) === null) await add.locator('summary').click();
  await add.getByLabel('Question type').selectOption({ label: q.type });
  if (q.label) await add.getByLabel('Question', { exact: true }).fill(q.label);
  if (q.options) await add.getByLabel('Choices').fill(q.options);
  if (q.required) await add.getByRole('checkbox', { name: 'Required' }).check();
  await add.getByRole('button', { name: 'Add question' }).click();
  // Wait for the new version to render (the next edit posts the version it was built from).
  const shown = q.label ?? 'Share my email with exhibitors who scan my badge';
  await expect(
    card.getByRole('list', { name: `Questions on ${title}` }).getByText(shown, { exact: true }),
  ).toBeVisible();
}

async function removeStarter(card: ReturnType<typeof pageCard>) {
  await card.getByRole('button', { name: 'Remove question First question' }).click();
  await expect(card.getByText('First question', { exact: true })).toHaveCount(0);
}

async function addPage(page: Page, title: string) {
  const add = page.getByRole('heading', { name: 'Add a page' }).locator('..');
  await add.getByLabel('Page title').fill(title);
  await add.getByRole('button', { name: 'Add page' }).click();
  await expect(
    page.getByRole('heading', { name: new RegExp(`^Page \\d+: ${title}$`), level: 3 }),
  ).toBeVisible();
}

interface Mail {
  subject: string;
  html: string;
}

/** The registration link in the newest resume email to `to`. */
async function resumeLink(page: Page, to: string): Promise<string> {
  let link = '';
  await expect
    .poll(
      async () => {
        await page.request.post('/api/dev/outbox/drain', { form: { org: ORG } });
        const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`);
        const mail = ((await res.json()) as Mail[])
          .filter((m) => m.subject.startsWith('Continue your registration'))
          .at(-1);
        link = /href="(https?:\/\/[^"]+\/registration-form\/[^"]+)"/.exec(mail?.html ?? '')?.[1] ?? '';
        return link;
      },
      { timeout: 30_000 },
    )
    .toMatch(/\/registration-form\/[0-9a-f-]{36}~/);
  return new URL(link.replace(/&amp;/g, '&')).pathname;
}

test('the organizer builds a three-page form with a type-specific page, by keyboard', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  eventName = `Summit ${stamp()}`;
  base = await conference(page, eventName);
  slug = base.split('/').pop() as string;

  // From the Registration section to the builder; the empty state first.
  await page.goto(`${base}/registration`);
  await page.getByRole('link', { name: 'Edit the registration form' }).click();
  await expect(page).toHaveURL(`${base}/registration-form`);
  await expect(page.getByRole('heading', { name: 'Registration form', level: 1 })).toBeVisible();
  await expect(page.getByText('No pages yet')).toBeVisible();
  await expectAccessible(page);

  // Page 1: company (required), job title, "Joining workshops?".
  await addPage(page, 'About you');
  const about = pageCard(page, 1, 'About you');
  await addQuestion(about, 'About you', {
    label: 'Company',
    type: 'Company (with suggestions)',
    required: true,
  });
  await addQuestion(about, 'About you', { label: 'Job title', type: 'Job title (list + other)' });
  await addQuestion(about, 'About you', { label: 'Joining workshops?', type: 'Checkbox' });
  await removeStarter(about);

  // Page 2: members only.
  await addPage(page, 'Membership');
  const member = pageCard(page, 2, 'Membership');
  await addQuestion(member, 'Membership', {
    label: 'Member number',
    type: 'Short text',
    required: true,
  });
  await removeStarter(member);
  const settings = member.locator('details').filter({ hasText: 'Page settings: Membership' });
  await settings.locator('summary').click();
  await settings.getByRole('radio', { name: 'Only some registration types' }).check();
  // No type ticked: refused with a message.
  await settings.getByRole('button', { name: 'Save page' }).click();
  await expect(
    settings.getByText('Tick at least one registration type, or choose every type.'),
  ).toBeVisible();
  await settings.getByRole('checkbox', { name: 'Member', exact: true }).check();
  await settings.getByRole('button', { name: 'Save page' }).click();
  await expect(settings.getByText('Saved as a new version.')).toBeVisible();
  await expect(member.getByText('Only for Member · Always shown')).toBeVisible();

  // Page 3: workshops, opened by the page-1 answer; a track and the consent question.
  await addPage(page, 'Workshops');
  const work = pageCard(page, 3, 'Workshops');
  await addQuestion(work, 'Workshops', {
    label: 'Track',
    type: 'One choice',
    required: true,
    options: 'Leadership\nData',
  });
  await addQuestion(work, 'Workshops', { type: 'Consent checkbox' });
  await removeStarter(work);
  const ws = work.locator('details').filter({ hasText: 'Page settings: Workshops' });
  await ws.locator('summary').click();
  // Keyboard only: the "Only when" radio, then the question, comparison and answer selects.
  await ws.getByRole('radio', { name: 'Only when an earlier answer matches' }).focus();
  await page.keyboard.press('Space');
  await ws.getByLabel('Question', { exact: true }).selectOption({ label: 'Joining workshops?' });
  await ws.getByLabel('Answer', { exact: true }).selectOption({ label: 'Yes' });
  await ws.getByRole('button', { name: 'Save page' }).focus();
  await page.keyboard.press('Enter');
  await expect(ws.getByText('Saved as a new version.')).toBeVisible();
  await expect(work.getByText('Shown when “Joining workshops?” is Yes')).toBeVisible();
  await expect(work.getByText(/Consent, wording v1/)).toBeVisible();

  // Move up/down is the keyboard alternative to dragging; a move that would put the condition
  // before its question is refused.
  const up3 = page.getByRole('button', { name: 'Move page Workshops up' });
  await up3.focus();
  await page.keyboard.press('Enter');
  await expect(pageCard(page, 2, 'Workshops')).toBeVisible();
  await page.getByRole('button', { name: 'Move page Workshops up' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText(
      'A condition can only use questions that come earlier. Move or remove the condition first.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Move page Workshops down' }).click();
  await expect(pageCard(page, 3, 'Workshops')).toBeVisible();

  // Job titles (org-wide list).
  const jobs = page.getByRole('region', { name: 'Job titles' });
  await jobs.getByLabel('Job titles offered in job title questions').fill('Engineer\nDesigner\nDirector');
  await jobs.getByRole('button', { name: 'Save job titles' }).click();
  await expect(jobs.getByText('Job titles saved.')).toBeVisible();

  // Preview per registration type.
  const preview = page.getByRole('region', { name: 'Preview by registration type' });
  await preview.getByLabel('Preview as').selectOption({ label: 'Student' });
  await expect(
    preview.getByRole('list', { name: 'Pages for Student' }).getByText('Page 2: Workshops'),
  ).toBeVisible();
  await expect(preview.getByText('Membership')).toHaveCount(0);
  await preview.getByLabel('Preview as').selectOption({ label: 'Member' });
  await expect(preview.getByText('Page 2: Membership')).toBeVisible();
  await expect(preview.getByText('Page 3: Workshops')).toBeVisible();
  await expectAccessible(page);

  // Persisted after reload, in order.
  await page.reload();
  await expect(pageCard(page, 1, 'About you')).toBeVisible();
  await expect(pageCard(page, 2, 'Membership')).toBeVisible();
  await expect(pageCard(page, 3, 'Workshops')).toBeVisible();
  await expect(page.getByText(/^Version \d+ · 0 submitted · 0 in progress$/)).toBeVisible();
});

test('a member saves, resumes from the emailed link and submits', async ({ browser }) => {
  test.setTimeout(180_000);
  const who = `Mia ${stamp()}`;
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/events/${slug}/registration-form`);
  await expect(page.getByRole('heading', { name: 'Register', level: 1 })).toBeVisible();
  await expectAccessible(page);
  // Nothing chosen: each problem is named.
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText("Choose how you're registering.")).toBeVisible();
  await page.getByRole('radio', { name: 'Member', exact: true }).focus();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Enter your name.')).toBeVisible();
  await page.getByLabel('Your name').fill(who);
  await page.getByLabel('Your email').fill('not-an-email');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await page.getByLabel('Your email').fill(emailOf(who));
  await page.getByLabel('Your email').press('Enter');
  await expect(page).toHaveURL(/\/registration-form\/[0-9a-f-]{36}~/);

  // Page 1 of 2 (the workshops page is not on the path yet).
  await expect(page.getByText('Step 1 of 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'About you', level: 2 })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert').getByText('Answer this question to continue.')).toBeVisible();
  await expect(page.getByLabel('Company (required)')).toHaveAttribute('aria-invalid', 'true');
  await expectAccessible(page);
  // Keyboard only from here: type, tick with Space, Enter submits "Continue".
  await page.getByLabel('Company (required)').fill('Acme Corp');
  await page.getByLabel('Job title', { exact: true }).selectOption('Other…');
  await page.getByLabel('Your job title').fill('Chief Happiness Officer');
  await page.getByRole('checkbox', { name: 'Joining workshops?' }).focus();
  await page.keyboard.press('Space');
  await page.getByLabel('Company (required)').press('Enter');
  // The member page; the answer opened the workshops page, so the path has three steps.
  const heading = page.getByRole('heading', { name: 'Membership', level: 2 });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByLabel('Member number (required)').fill('M-4521');
  await page.getByRole('button', { name: 'Save and email me a link' }).click();
  await expect(page.getByText('Link sent')).toBeVisible();
  const link = await resumeLink(page, emailOf(who));
  await page.close();

  // Resume in another browser from the email: same page, saved answer kept.
  const resumed = await (await browser.newContext()).newPage();
  await resumed.goto(link);
  await expect(resumed.getByRole('heading', { name: 'Membership', level: 2 })).toBeVisible();
  await expect(resumed.getByLabel('Member number (required)')).toHaveValue('M-4521');
  await resumed.getByRole('button', { name: 'Back' }).click();
  await expect(resumed.getByRole('heading', { name: 'About you', level: 2 })).toBeFocused();
  await expect(resumed.getByLabel('Company (required)')).toHaveValue('Acme Corp');
  await expect(resumed.getByLabel('Your job title')).toHaveValue('Chief Happiness Officer');
  await resumed.getByRole('button', { name: 'Continue' }).click();
  await resumed.getByRole('button', { name: 'Continue' }).click();
  await expect(resumed.getByRole('heading', { name: 'Workshops', level: 2 })).toBeVisible();
  await expect(resumed.getByText('Step 3 of 3')).toBeVisible();
  // Consent is unticked by default; the organizer's wording comes from the ledger term.
  const consent = resumed.getByRole('checkbox', {
    name: 'Exhibitors may receive my email address when I let them scan my badge.',
  });
  await expect(consent).not.toBeChecked();
  await resumed.getByRole('button', { name: 'Submit' }).click();
  await expect(resumed.getByRole('alert').getByText('Answer this question to continue.')).toBeVisible();
  await resumed.getByLabel('Track (required)').selectOption({ label: 'Data' });
  await consent.focus();
  await resumed.keyboard.press('Space');
  await expectAccessible(resumed);
  await resumed.getByRole('button', { name: 'Submit' }).click();
  await expect(
    resumed.getByRole('heading', { name: "Thank you, you're registered", level: 1 }),
  ).toBeVisible();
  await expectAccessible(resumed);
  // The link now only says it was submitted, after reload too.
  await resumed.reload();
  await expect(resumed.getByRole('heading', { name: "Thank you, you're registered" })).toBeVisible();
  await expect(resumed.getByRole('button', { name: 'Submit' })).toHaveCount(0);
});

test('a student sees another path: the member page never shows', async ({ browser }) => {
  const who = `Sam ${stamp()}`;
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/events/${slug}/registration-form`);
  await page.getByRole('radio', { name: 'Student', exact: true }).check();
  await page.getByLabel('Your name').fill(who);
  await page.getByLabel('Your email').fill(emailOf(who));
  await page.getByRole('button', { name: 'Start' }).click();
  // One page only, so the button submits.
  await expect(page.getByText('Step 1 of 1')).toBeVisible();
  await page.getByLabel('Company (required)').fill('State University');
  await page.getByRole('checkbox', { name: 'Joining workshops?' }).check();
  // Ticking the box opened the workshops page: "Submit" leads there instead of submitting.
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('heading', { name: 'Workshops', level: 2 })).toBeFocused();
  await expect(page.getByText('Step 2 of 2')).toBeVisible();
  await expect(page.getByText('Membership')).toHaveCount(0);
  await page.getByLabel('Track (required)').selectOption({ label: 'Leadership' });
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('heading', { name: "Thank you, you're registered" })).toBeVisible();
});

test('the respondent pages render right-to-left in Arabic', async ({ browser }) => {
  const who = `Amal ${stamp()}`;
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/ar/events/${slug}/registration-form`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'التسجيل', level: 1 })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('radio', { name: 'Exhibitor', exact: true }).check();
  await page.getByLabel('اسمك').fill(who);
  await page.getByLabel('بريدك الإلكتروني').fill(emailOf(who));
  await page.getByRole('button', { name: 'ابدأ' }).click();
  await expect(page).toHaveURL(/\/ar\/registration-form\//);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('الخطوة 1 من 1')).toBeVisible();
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect(page.getByRole('alert').getByText('أجب عن هذا السؤال للمتابعة.')).toBeVisible();
  await expectAccessible(page);
});

test('the builder in Arabic, and a viewer who cannot edit it', async ({ page, browser }) => {
  await signIn(page);
  await page.goto(`/ar${base}/registration-form`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'نموذج التسجيل', level: 1 })).toBeVisible();
  await expectAccessible(page);

  const viewer = await (await browser.newContext()).newPage();
  await signIn(viewer, VIEWER);
  await viewer.goto(`${base}/registration-form`);
  await expect(viewer.getByRole('heading', { name: 'Registration form', level: 1 })).toBeVisible();
  await expect(viewer.getByRole('heading', { name: 'Page 1: About you', level: 3 })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Add page' })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: /Move page/ })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Save job titles' })).toHaveCount(0);
  await expect(viewer.getByText('Director')).toBeVisible();
  await expectAccessible(viewer);
});
