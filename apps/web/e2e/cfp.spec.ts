import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  expectPicked,
  lastEmailedCode,
  pickOption,
  signIn,
} from './helpers.ts';

/**
 * M5.3b call for papers: the organizer opens a call (validation) with an extra question; a guest
 * sends a proposal with a co-speaker on the public form (validation, keyboard); reviewers invited
 * to the portal see only the proposals assigned to them (blind option), score and comment; the
 * organizer accepts (one draft session, placed on the agenda later) or declines, and every speaker
 * is emailed. Viewers read everything and change nothing.
 */
const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';
const TZ = 'America/Chicago';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;
const emailFor = (tag: string) => `${tag}.${stamp()}@example.test`.toLowerCase();

function chicagoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}
const at = (days: number, hhmm: string) => `${chicagoDate(days)}T${hhmm}`;

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

/** A published conference (day 40–42 in Chicago); returns its console path and slug. */
async function createEvent(page: Page, name: string) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Event type'), 'conference');
  await pickOption(page.getByLabel('Time zone'), TZ);
  await page.getByLabel('Starts', { exact: true }).fill(at(40, '09:00'));
  await page.getByLabel('Ends', { exact: true }).fill(at(42, '18:00'));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  return { base, slug: base.split('/').pop() ?? '' };
}

/** Open the call: 30 and 45 minutes, 2 co-speakers, optionally blind. */
async function openCall(page: Page, base: string, opts: { blind?: boolean } = {}) {
  await page.goto(`${base}/speakers/cfp/settings`);
  const form = page.getByRole('region', { name: 'The call' });
  await pickOption(form.getByLabel('Status'), 'open');
  for (const m of ['15 min', '20 min', '60 min', '90 min'])
    await form.getByRole('checkbox', { name: m, exact: true }).uncheck();
  await form.getByRole('checkbox', { name: '30 min', exact: true }).check();
  await form.getByRole('checkbox', { name: '45 min', exact: true }).check();
  await pickOption(form.getByLabel('Co-speakers allowed per proposal'), '2');
  const blind = form.getByRole('checkbox', { name: /Hide who submitted/ });
  if (opts.blind) await blind.check();
  else await blind.uncheck();
  await form.getByLabel('Introduction on the public form').fill('We want talks about running events.');
  await form.getByRole('button', { name: 'Save the call' }).click();
  await expect(form.getByText('Call saved.')).toBeVisible();
}

/** A guest sends a proposal on the public form; returns the address used. */
async function propose(
  guest: Page,
  slug: string,
  p: { title: string; name: string; email: string; co?: { name: string; email: string } },
) {
  await guest.goto(`/events/${slug}/cfp`);
  await guest.getByLabel('Title', { exact: true }).fill(p.title);
  await guest.getByLabel('Abstract', { exact: true }).fill(`Why ${p.title} matters.`);
  await pickOption(guest.getByLabel('Length'), '45');
  await guest.getByLabel('Your name').fill(p.name);
  await guest.getByLabel('Your email').fill(p.email);
  if (p.co) {
    await guest.getByLabel('Co-speaker 1: name').fill(p.co.name);
    await guest.getByLabel('Co-speaker 1: email').fill(p.co.email);
  }
  await guest.getByRole('button', { name: 'Send my proposal' }).click();
  await expect(guest.getByRole('heading', { name: 'Thank you, your proposal was sent' })).toBeVisible();
}

async function drain(page: Page) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org: 'lakeside-events' } });
  expect(res.status()).toBe(200);
}

async function mailbox(page: Page, email: string) {
  const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
  return (await res.json()) as { subject: string; text: string }[];
}

async function mailTo(page: Page, email: string, subject: RegExp) {
  let found: { subject: string; text: string } | undefined;
  await expect
    .poll(
      async () => {
        await drain(page);
        found = (await mailbox(page, email)).find((m) => subject.test(m.subject));
        return Boolean(found);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return found as { subject: string; text: string };
}
const firstUrl = (text: string, path: RegExp) =>
  (text.match(/https?:\/\/[^\s]+/g) ?? []).find((u) => path.test(new URL(u).pathname)) ?? '';

/** Sign a reviewer in by the emailed code (keyboard only), from their invitation email. */
async function reviewerSignIn(page: Page, reviewer: Page, email: string) {
  const mail = await mailTo(page, email, /portal/);
  const link = new URL(firstUrl(mail.text, /\/event-portal\/invite\//)).pathname;
  await reviewer.goto(link);
  await expect(reviewer.getByText("You're invited as a proposal reviewer.")).toBeVisible();
  await reviewer.getByRole('button', { name: 'Email me a sign-in code' }).focus();
  await reviewer.keyboard.press('Enter');
  const code = reviewer.getByLabel('Verification code', { exact: true });
  await expect(code).toBeFocused();
  await code.fill(await lastEmailedCode(reviewer, email));
  await code.press('Enter');
  await expect(reviewer).toHaveURL(/\/event-portal$/);
}

/** A submission's id, from its link on the organizer's submissions list. */
async function submissionId(page: Page, base: string, title: string) {
  await page.goto(`${base}/speakers/cfp`);
  const href = (await page.getByRole('link', { name: title, exact: true }).getAttribute('href')) ?? '';
  const id = href.split('/').pop() ?? '';
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return id;
}

test.describe('call for papers (M5.3b)', () => {
  test('open a call (validation), a guest proposes with a co-speaker (validation, keyboard), received email, axe', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `CFP Summit ${s}`);
    // From the speakers page; the empty state says what to do next.
    await page.goto(`${base}/speakers`);
    await page.getByRole('link', { name: 'Call for papers' }).click();
    await expect(page.getByRole('heading', { name: 'Call for papers', level: 1 })).toBeVisible();
    await expect(page.getByText('No proposals yet')).toBeVisible();
    await expect(page.getByText('Open the call in Settings', { exact: false })).toBeVisible();
    await expectAccessibleBothModes(page);
    // A draft call has no public page.
    const guest = await newPage(browser);
    expect((await guest.goto(`/events/${slug}/cfp`))?.status()).toBe(404);

    // Settings: validation errors, then a saved call that survives a reload.
    await page.getByRole('link', { name: 'Set up the call' }).click();
    const form = page.getByRole('region', { name: 'The call' });
    for (const m of ['30 min', '45 min'])
      await form.getByRole('checkbox', { name: m, exact: true }).uncheck();
    await form.getByRole('button', { name: 'Save the call' }).click();
    await expect(form.getByText('Choose at least one session length.')).toBeVisible();
    await form.getByRole('checkbox', { name: '30 min', exact: true }).check();
    await pickOption(form.getByLabel('Status'), 'open');
    await form.getByLabel('Deadline (optional)').fill(at(-1, '12:00'));
    await form.getByRole('button', { name: 'Save the call' }).click();
    await expect(form.getByText('The deadline has passed', { exact: false })).toBeVisible();
    await form.getByLabel('Deadline (optional)').fill(at(20, '17:00'));
    await form.getByRole('checkbox', { name: '45 min', exact: true }).check();
    await pickOption(form.getByLabel('Co-speakers allowed per proposal'), '2');
    await form.getByLabel('Introduction on the public form').fill(`Tell us about events ${s}.`);
    await form.getByRole('button', { name: 'Save the call' }).click();
    await expect(form.getByText('Call saved.')).toBeVisible();
    await page.reload();
    await expectPicked(page.getByLabel('Status'), 'open');
    await expect(page.getByRole('checkbox', { name: '45 min', exact: true })).toBeChecked();
    await expect(page.getByText('Open', { exact: true }).first()).toBeVisible();

    // An extra question (forms engine): a choice question needs two choices.
    const add = page.getByRole('region', { name: 'Extra questions' });
    await expect(add.getByText('No extra questions')).toBeVisible();
    await pickOption(add.getByLabel('Answer type'), 'select');
    await add.getByLabel('Question', { exact: true }).fill('Level');
    await add.getByLabel('Choices').fill('Intro');
    await add.getByRole('button', { name: 'Add a question' }).click();
    await expect(add.getByText('Give at least two choices, one per line.')).toBeVisible();
    await pickOption(add.getByLabel('Answer type'), 'short_text');
    await add.getByLabel('Question', { exact: true }).fill('Your city');
    await add.getByLabel('Choices').fill('');
    await add.getByRole('checkbox', { name: 'Required' }).check();
    await add.getByRole('button', { name: 'Add a question' }).click();
    await expect(add.getByText('Question added.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Short answer · Required')).toBeVisible();
    await expectAccessibleBothModes(page);

    // The public form: each validation error marks and focuses its field.
    await guest.goto(`/events/${slug}/cfp`);
    await expect(guest.getByRole('heading', { name: 'Call for papers', level: 1 })).toBeVisible();
    await expect(guest.getByText(`Tell us about events ${s}.`)).toBeVisible();
    await expect(guest.getByText(/Send your proposal by .* \(America\/Chicago\)/)).toBeVisible();
    await expectAccessibleBothModes(guest);
    const send = guest.getByRole('button', { name: 'Send my proposal' });
    await send.click();
    await expect(guest.getByText('Give your talk a title.')).toBeVisible();
    await expect(guest.getByLabel('Title', { exact: true })).toBeFocused();
    await guest.getByLabel('Title', { exact: true }).fill(`Crowds at scale ${s}`);
    await guest.getByLabel('Abstract', { exact: true }).fill('How we move 10,000 people.');
    await guest.getByLabel('Your name').fill('Lea Lead');
    await guest.getByLabel('Your email').fill('not-an-email');
    await send.click();
    await expect(guest.getByText('Enter a valid email address.')).toBeVisible();
    await expect(guest.getByLabel('Your email')).toBeFocused();
    const lead = emailFor('cfp-lead');
    const co = emailFor('cfp-co');
    await guest.getByLabel('Your email').fill(lead);
    await guest.getByLabel('Co-speaker 1: name').fill('Cora Co');
    await send.click();
    await expect(guest.getByText("Enter the co-speaker's email address.")).toBeVisible();
    await guest.getByLabel('Co-speaker 1: email').fill(lead);
    await send.click();
    await expect(guest.getByText('Each speaker needs their own email address.')).toBeVisible();
    await guest.getByLabel('Co-speaker 1: email').fill(co);
    await send.click();
    await expect(guest.getByText('Please answer this question.')).toBeVisible();
    await expect(guest.getByLabel('Your city')).toBeFocused();
    await expectAccessible(guest);
    // Keyboard only: type the answer and press Enter to send.
    await guest.getByLabel('Your city').fill('Lisbon');
    await guest.getByLabel('Your city').press('Enter');
    await expect(guest.getByRole('heading', { name: 'Thank you, your proposal was sent' })).toBeVisible();
    await expectAccessible(guest);
    const received = await mailTo(page, lead, /We received your proposal/);
    expect(received.text).toContain(`Crowds at scale ${s}`);
    expect((await mailbox(page, co)).some((m) => /We received/.test(m.subject))).toBe(false);
    // The same proposal twice is refused.
    await guest.goto(`/events/${slug}/cfp`);
    await guest.getByLabel('Title', { exact: true }).fill(`Crowds at scale ${s}`);
    await guest.getByLabel('Abstract', { exact: true }).fill('Again.');
    await guest.getByLabel('Your name').fill('Lea Lead');
    await guest.getByLabel('Your email').fill(lead);
    await guest.getByLabel('Your city').fill('Porto');
    await send.click();
    await expect(guest.getByText('You already sent a proposal with this title.')).toBeVisible();

    // The organizer's list: the proposal, the speaker and no reviews yet; the detail has it all.
    await page.goto(`${base}/speakers/cfp`);
    const row = page.getByRole('row').filter({ hasText: `Crowds at scale ${s}` });
    await expect(row.getByText('Lea Lead')).toBeVisible();
    await expect(row.getByText('Waiting for a decision')).toBeVisible();
    await row.getByRole('link', { name: `Crowds at scale ${s}` }).click();
    await expect(page.getByText('With Cora Co', { exact: false })).toBeVisible();
    await expect(page.getByText('Lisbon')).toBeVisible();
    await expect(page.getByText('No reviewers assigned')).toBeVisible();
    await expectAccessibleBothModes(page);
    // Arabic, right to left: the public form and the console pages.
    for (const path of [
      `/ar/events/${slug}/cfp`,
      `/ar${base}/speakers/cfp`,
      `/ar${base}/speakers/cfp/settings`,
    ]) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expectAccessible(page);
    }
    await page.goto('/lang/en');
  });

  test('reviewers see only assigned proposals (blind option), score; accept makes one draft session; decision emails', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `CFP Review ${s}`);
    await openCall(page, base);
    const guest = await newPage(browser);
    const one = {
      title: `Talk one ${s}`,
      name: 'Lea Lead',
      email: emailFor('one'),
      co: { name: 'Cora Co', email: emailFor('cora') },
    };
    const two = { title: `Talk two ${s}`, name: 'Tom Two', email: emailFor('two') };
    await propose(guest, slug, one);
    await propose(guest, slug, two);
    const oneId = await submissionId(page, base, one.title);
    const twoId = await submissionId(page, base, two.title);

    // Reviewers: validation, invitations, the access column.
    await page.getByRole('link', { name: /Reviewers/ }).click();
    const invite = page.getByRole('region', { name: 'Invite a reviewer' });
    await invite.getByLabel('Name').fill('Rita Reviewer');
    await invite.getByLabel('Email').fill('nope');
    await invite.getByRole('button', { name: 'Send the invitation' }).click();
    await expect(invite.getByText('Enter a valid email address.')).toBeVisible();
    const rita = emailFor('rita');
    await invite.getByLabel('Email').fill(rita);
    await invite.getByRole('button', { name: 'Send the invitation' }).click();
    await expect(invite.getByText('Invitation sent.')).toBeVisible();
    const raj = emailFor('raj');
    await invite.getByLabel('Name').fill('Raj Reviewer');
    await invite.getByLabel('Email').fill(raj);
    await invite.getByRole('button', { name: 'Send the invitation' }).click();
    await expect(invite.getByText('Invitation sent.')).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('row').filter({ hasText: 'Rita Reviewer' }).getByText('Invited'),
    ).toBeVisible();
    await expectAccessibleBothModes(page);

    // Assign Rita to proposal one only (keyboard: choose, then Enter on the button).
    await page.goto(`${base}/speakers/cfp/${oneId}`);
    const assign = page.getByLabel('Reviewer', { exact: true });
    await pickOption(assign, { label: 'Rita Reviewer' });
    await page.getByRole('button', { name: 'Assign', exact: true }).press('Enter');
    await expect(page.getByText('Reviewer assigned.')).toBeVisible();
    await expect(page.getByText('not reviewed yet')).toBeVisible();

    // Rita signs in: she sees proposal one, not proposal two (and two's URL is a 404).
    const reviewer = await newPage(browser);
    await reviewerSignIn(page, reviewer, rita);
    await expect(reviewer.getByRole('heading', { name: 'Hello, Rita Reviewer' })).toBeVisible();
    await expect(reviewer.getByRole('link', { name: one.title })).toBeVisible();
    await expect(reviewer.getByText(two.title)).toHaveCount(0);
    await expectAccessibleBothModes(reviewer);
    for (const id of [twoId, '01900000-0000-7000-8000-000000000000'])
      expect((await reviewer.goto(`/event-portal/reviews/${id}`))?.status()).toBe(404);
    // No console for a reviewer.
    await reviewer.goto(`${base}/speakers/cfp`);
    await expect(reviewer).toHaveURL(/sign-in/);

    // Score with the keyboard: a missing score is refused, then arrows choose 4.
    await reviewer.goto('/event-portal');
    await reviewer.getByRole('link', { name: one.title }).click();
    await expect(reviewer.getByText('Lea Lead')).toBeVisible();
    await expect(reviewer.getByText('With Cora Co')).toBeVisible();
    await reviewer.getByRole('button', { name: 'Save my review' }).click();
    await expect(reviewer.getByText('Choose a score from 1 to 5.')).toBeVisible();
    await reviewer.getByRole('radio', { name: '3 of 5' }).focus();
    await reviewer.keyboard.press('Space');
    await reviewer.keyboard.press('ArrowRight');
    await expect(reviewer.getByRole('radio', { name: '4 of 5' })).toBeChecked();
    await reviewer.getByLabel('Comment (optional)').fill(`Timely and clear ${s}`);
    await reviewer.getByRole('button', { name: 'Save my review' }).press('Enter');
    await expect(reviewer.getByText('Review saved.')).toBeVisible();
    await reviewer.reload();
    await expect(reviewer.getByRole('radio', { name: '4 of 5' })).toBeChecked();
    await expect(reviewer.getByRole('button', { name: 'Update my review' })).toBeVisible();
    await expectAccessibleBothModes(reviewer);
    await reviewer.goto(`/ar/event-portal/reviews/${oneId}`);
    await expect(reviewer.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(reviewer);
    await reviewer.goto('/ar/event-portal');
    await expect(reviewer.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(reviewer);
    await reviewer.goto('/lang/en');

    // Blind review: Rita no longer sees who submitted.
    await openCall(page, base, { blind: true });
    await reviewer.goto(`/event-portal/reviews/${oneId}`);
    await expect(reviewer.getByText('Blind review: the speakers', { exact: false })).toBeVisible();
    await expect(reviewer.getByText('Lea Lead')).toHaveCount(0);
    await expect(reviewer.getByText('Cora Co')).toHaveCount(0);
    await expect(reviewer.getByText(one.title).first()).toBeVisible();

    // The organizer sees the score and comment; accepts with a note (keyboard).
    await page.goto(`${base}/speakers/cfp/${oneId}`);
    await expect(page.getByText('Reviews (average 4.0)')).toBeVisible();
    await expect(page.getByText(`Timely and clear ${s}`)).toBeVisible();
    await page.getByLabel('Note to the speakers', { exact: false }).fill('See you on stage.');
    await page.getByRole('button', { name: 'Accept', exact: true }).press('Enter');
    await expect(page.getByText('Every speaker on the proposal was emailed the decision.')).toBeVisible();
    await page.reload();
    await expect(page.getByText(/^Accepted /)).toBeVisible();
    await expect(page.getByText('Note sent: See you on stage.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
    await expectAccessible(page);
    const accepted = await mailTo(page, one.email, /was accepted/);
    expect(accepted.text).toContain('See you on stage.');
    await mailTo(page, one.co.email, /was accepted/);

    // Exactly one draft session: on the sessions page, not on the public agenda, until placed.
    await page.goto(`${base}/sessions`);
    const draft = page.locator('[data-session]').filter({ hasText: one.title });
    await expect(draft).toHaveCount(1);
    await expect(draft.getByText('Draft', { exact: true })).toBeVisible();
    await expectAccessible(page);
    await guest.goto(`/events/${slug}`);
    await expect(guest.getByText(one.title)).toHaveCount(0);
    await expect(guest.getByText('Lea Lead')).toHaveCount(0);
    await draft.getByRole('button', { name: `Add “${one.title}” to the agenda` }).click();
    // Placed: the draft badge and its button are gone, and it stays that way after a reload.
    await expect(draft.getByText('Draft', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(draft.getByText('Draft', { exact: true })).toHaveCount(0);
    await expect(draft).toHaveCount(1);
    await guest.reload();
    await expect(guest.getByText(one.title).first()).toBeVisible();

    // Decline proposal two: its speaker is emailed; Rita's list shows one as decided.
    await page.goto(`${base}/speakers/cfp/${twoId}`);
    await page.getByRole('button', { name: 'Decline', exact: true }).click();
    await expect(page.getByText(/^Declined /)).toBeVisible();
    await expect(page.getByText('Every speaker on the proposal was emailed the decision.')).toBeVisible();
    await mailTo(page, two.email, /About your proposal/);
    await page.goto(`${base}/speakers/cfp`);
    await expect(page.getByRole('row').filter({ hasText: one.title }).getByText('Accepted')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: two.title }).getByText('Declined')).toBeVisible();
    await reviewer.goto('/event-portal');
    await expect(reviewer.getByText('Decided')).toBeVisible();
    await reviewer.getByRole('link', { name: one.title }).click();
    await expect(reviewer.getByText('The organizers have decided; your score was 4 of 5.')).toBeVisible();

    // Ending Rita's access: the portal opens nothing.
    await page.goto(`${base}/speakers/cfp/reviewers`);
    await page.getByRole('button', { name: 'End access for Rita Reviewer' }).click();
    const ritaRow = page.getByRole('row').filter({ hasText: 'Rita Reviewer' });
    await expect(ritaRow.getByText('Access ended', { exact: true })).toBeVisible();
    await expect(ritaRow.getByRole('button')).toHaveCount(0);
    await reviewer.goto('/event-portal');
    await expect(reviewer.getByRole('link', { name: one.title })).toHaveCount(0);
  });

  test('viewers read the call but change nothing; a stale form is refused', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `CFP Viewer ${s}`);
    await openCall(page, base);
    const guest = await newPage(browser);
    await propose(guest, slug, { title: `Viewer talk ${s}`, name: 'Vic Viewer', email: emailFor('vic') });
    const id = await submissionId(page, base, `Viewer talk ${s}`);

    const viewer = await newPage(browser);
    await signIn(viewer, VIEWER);
    for (const path of ['', '/settings', '/reviewers', `/${id}`]) {
      await viewer.goto(`${base}/speakers/cfp${path}`);
      await expect(viewer.getByText('You can read the call for papers', { exact: false })).toBeVisible();
      await expect(
        viewer.getByRole('button', {
          name: /Save the call|Add a question|Send the invitation|Assign|Accept|Decline|Remove|End access/,
        }),
      ).toHaveCount(0);
    }
    await expect(viewer.getByText(`Viewer talk ${s}`).first()).toBeVisible();
    await expectAccessible(viewer);
    await viewer.goto(`${base}/sessions`);
    await expect(viewer.getByRole('button', { name: /to the agenda/ })).toHaveCount(0);

    // The owner's open page, then signed in as the viewer: deciding is refused.
    const owner = page;
    await owner.goto(`${base}/speakers/cfp/${id}`);
    const decide = owner.getByRole('button', { name: 'Accept', exact: true });
    await expect(decide).toBeVisible();
    await signIn(owner, VIEWER);
    await decide.click();
    await expect(
      owner.getByRole('alert').filter({ hasText: "You don't have access to this." }),
    ).toBeVisible();
  });
});
