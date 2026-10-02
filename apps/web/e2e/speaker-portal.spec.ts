import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, lastEmailedCode, signIn } from './helpers.ts';

/**
 * M5.3a speaker portal: an organizer invites a speaker, the speaker signs in with the emailed
 * magic link (or code), proposes a new bio and photo, the organizer approves; tasks with a file
 * answer and an agreement; "remind whoever is missing the slides"; a speaker can't open another
 * speaker's session or the console; the viewer can't do any organizer action.
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

/** A 1×1 PNG and a tiny PDF (the server sniffs the bytes, never the name). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n% slides\n%%EOF\n');

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function createEvent(page: Page, name: string) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Event type').selectOption('conference');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(at(40, '09:00'));
  await page.getByLabel('Ends', { exact: true }).fill(at(42, '18:00'));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  return new URL(page.url()).pathname;
}

async function addSpeaker(page: Page, base: string, name: string) {
  await page.goto(`${base}/speakers`);
  const add = page.getByRole('region', { name: 'Add speaker' });
  await add.getByLabel('Speaker name').fill(name);
  await add.getByLabel('Bio').fill(`${name} original bio`);
  await add.getByRole('button', { name: 'Add speaker' }).click();
  await expect(add.getByText('Speaker added.')).toBeVisible();
}

async function addSession(page: Page, base: string, title: string, speaker: string, hour: string) {
  await page.goto(`${base}/sessions`);
  const add = page.getByRole('region', { name: 'Add session' });
  await add.getByLabel('Session title').fill(title);
  await add.getByLabel('Session starts').fill(at(40, `${hour}:00`));
  await add.getByLabel('Session ends').fill(at(40, `${hour}:45`));
  await add.getByRole('checkbox', { name: speaker }).check();
  await add.getByRole('button', { name: 'Add session' }).click();
  await expect(add.getByText('Session added.')).toBeVisible();
}

/** A conference with two speakers, one session each; returns its console path and the names. */
async function conference(page: Page, what: string) {
  const s = stamp();
  await signIn(page);
  const base = await createEvent(page, `${what} ${s}`);
  const ana = `Ana ${s}`;
  const ben = `Ben ${s}`;
  await addSpeaker(page, base, ana);
  await addSpeaker(page, base, ben);
  await addSession(page, base, `Ana keynote ${s}`, ana, '10');
  await addSession(page, base, `Ben workshop ${s}`, ben, '11');
  return { base, ana, ben, s };
}

/** The organizer invites a speaker from the speakers page (keyboard: fill, then Enter). */
async function invite(page: Page, base: string, name: string, email: string) {
  await page.goto(`${base}/speakers`);
  const field = page.getByLabel(`Email for ${name}`);
  await field.fill(email);
  await field.press('Enter');
  const panel = page.getByRole('region', { name: `Portal access for ${name}` });
  await expect(panel.getByText('Invitation sent.')).toBeVisible();
}

async function drain(page: Page) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org: 'lakeside-events' } });
  expect(res.status()).toBe(200);
}

async function mailbox(page: Page, email: string) {
  const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
  return (await res.json()) as { subject: string; text: string }[];
}

async function mailTo(page: Page, email: string, subject: RegExp, drainFirst = false) {
  let found: { subject: string; text: string } | undefined;
  await expect
    .poll(
      async () => {
        if (drainFirst) await drain(page);
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

/** The invitation link emailed to a speaker. */
async function invitationLink(page: Page, email: string) {
  const mail = await mailTo(page, email, /portal/, true);
  const url = firstUrl(mail.text, /\/event-portal\/invite\//);
  expect(url).not.toBe('');
  return new URL(url).pathname;
}

/** Sign a speaker in by the emailed code (keyboard only), from their invitation link. */
async function signInByCode(speaker: Page, link: string, email: string) {
  await speaker.goto(link);
  await speaker.getByRole('button', { name: 'Email me a sign-in code' }).focus();
  await speaker.keyboard.press('Enter');
  const code = speaker.getByLabel('Verification code', { exact: true });
  await expect(code).toBeFocused();
  await code.fill(await lastEmailedCode(speaker, email));
  await code.press('Enter');
  await expect(speaker).toHaveURL(/\/event-portal$/);
}

test.describe('speaker portal (M5.3a)', () => {
  test('invite, magic-link sign-in, bio and photo for approval, organizer approves (keyboard, axe)', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const { base, ana, s } = await conference(page, 'Portal Summit');
    const email = emailFor('ana');
    // Validation first: a bad address is refused with its message.
    await page.goto(`${base}/speakers`);
    await page.getByLabel(`Email for ${ana}`).fill('not-an-email');
    await page.getByLabel(`Email for ${ana}`).press('Enter');
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await invite(page, base, ana, email);
    await page.reload();
    const panel = page.getByRole('region', { name: `Portal access for ${ana}` });
    await expect(panel.getByText(email, { exact: true })).toBeVisible();
    await expect(panel.getByText('Invited', { exact: true })).toBeVisible();
    await expectAccessible(page);

    // The speaker opens the invitation and asks for a code: the email carries a magic link.
    const speaker = await newPage(browser);
    const link = await invitationLink(page, email);
    await speaker.goto(link);
    await expect(speaker.getByRole('heading', { name: 'Sign in to the portal' })).toBeVisible();
    await expect(speaker.getByText("You're invited as a speaker.")).toBeVisible();
    await expectAccessible(speaker);
    await speaker.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await expect(speaker.getByLabel('Verification code', { exact: true })).toBeFocused();
    await expectAccessible(speaker);
    const signInMail = await mailTo(page, email, /sign-in code/);
    const magic = firstUrl(signInMail.text, /\/event-portal\/verify\//);
    // Opened in another browser, the link asks for the code instead (and spends nothing).
    const other = await newPage(browser);
    await other.goto(new URL(magic).pathname);
    await expect(other.getByText('This link was asked for in another browser.')).toBeVisible();
    await expectAccessible(other);
    // In the browser that asked, Continue signs in.
    await speaker.goto(new URL(magic).pathname);
    await speaker.getByRole('button', { name: 'Continue to the portal' }).press('Enter');
    await expect(speaker).toHaveURL(/\/event-portal$/);
    await expect(speaker.getByRole('heading', { name: `Welcome, ${ana}` })).toBeVisible();
    await expect(speaker.getByText(`Ana keynote ${s}`)).toBeVisible();
    await expect(speaker.getByText(`Ben workshop ${s}`)).toHaveCount(0);
    await expect(speaker.getByText(/times in America\/Chicago/)).toBeVisible();
    await expectAccessible(speaker);
    // The used link is dead.
    await other.goto(new URL(magic).pathname);
    await expect(other.getByText("This sign-in link doesn't work")).toBeVisible();

    // Propose a new bio (keyboard: the form submits with Enter from the name field).
    await speaker.getByRole('link', { name: 'Profile' }).click();
    await expect(speaker.getByText(`${ana} original bio`).first()).toBeVisible();
    await speaker.getByRole('button', { name: 'Send for approval' }).click();
    await expect(speaker.getByText('Nothing changed: edit a field first.')).toBeVisible();
    await speaker.getByLabel('Bio').fill(`New bio from the portal ${s}`);
    await speaker.getByRole('button', { name: 'Send for approval' }).click();
    await expect(speaker.getByText('Sent for approval.')).toBeVisible();
    // A document is not a photo; a PNG is.
    await speaker
      .getByLabel('Choose a photo')
      .setInputFiles({ name: 'me.pdf', mimeType: 'application/pdf', buffer: PDF });
    await speaker.getByRole('button', { name: 'Send photo for approval' }).click();
    await expect(speaker.getByText('Use a JPEG, PNG or WebP image.')).toBeVisible();
    await speaker
      .getByLabel('Choose a photo')
      .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
    await speaker.getByRole('button', { name: 'Send photo for approval' }).click();
    await expect(speaker.getByText('Photo sent for approval.')).toBeVisible();
    await speaker.reload();
    await expect(speaker.getByText("Your changes are waiting for the organizer's approval.")).toBeVisible();
    await expect(speaker.getByText('A new photo is waiting for approval.')).toBeVisible();
    await expectAccessible(speaker);

    // Nothing public changed yet: the organizer's list still shows the approved bio.
    await page.goto(`${base}/speakers`);
    await expect(page.getByText(`${ana} original bio`).first()).toBeVisible();
    await page.getByRole('link', { name: 'Proposed changes (1)' }).click();
    await expect(page.getByRole('heading', { name: 'Proposed changes' })).toBeVisible();
    const card = page.getByRole('listitem').filter({ hasText: `${ana}: profile` });
    await expect(card.getByText(`${ana} original bio`)).toBeVisible();
    await expect(card.getByText(`New bio from the portal ${s}`)).toBeVisible();
    await expect(card.getByRole('link', { name: `View the photo ${ana} sent` })).toBeVisible();
    await expectAccessible(page);
    await card.getByLabel('Note to the speaker (optional)').fill('Thanks!');
    await card.getByRole('button', { name: 'Approve' }).focus();
    await page.keyboard.press('Enter');
    // Decided: it leaves the review list (and stays so after a reload).
    await expect(page.getByText('Nothing to review')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Nothing to review')).toBeVisible();
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: `${ana}: profile` })
        .getByText('Approved'),
    ).toBeVisible();

    // Approved: the speaker list and the speaker's own portal show the new bio.
    await page.goto(`${base}/speakers`);
    await expect(page.getByText(`New bio from the portal ${s}`).first()).toBeVisible();
    await expect(page.getByText(`${ana} original bio`)).toHaveCount(0);
    await speaker.reload();
    await expect(speaker.getByText('The organizer approved your latest changes.')).toBeVisible();
    await expect(speaker.getByText('Note from the organizer: Thanks!')).toBeVisible();
    await expect(speaker.getByText(`New bio from the portal ${s}`).first()).toBeVisible();
  });

  test('tasks: upload slides, accept the release, remind only who is missing them; viewer refused', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const { base, ana, ben, s } = await conference(page, 'Portal Tasks');
    const anaMail = emailFor('ana-task');
    const benMail = emailFor('ben-task');
    await invite(page, base, ana, anaMail);
    await invite(page, base, ben, benMail);

    // The board: validation, then a slides task and a release.
    await page.goto(`${base}/speakers/tasks`);
    await expect(page.getByText('No tasks yet')).toBeVisible();
    await expectAccessible(page);
    const form = page.getByRole('region', { name: 'New task' });
    await form.getByRole('button', { name: 'Create task' }).click();
    await expect(form.getByText('Enter a title (up to 120 characters).')).toBeVisible();
    await form.getByLabel('Title').fill(`Upload slides ${s}`);
    await form.getByLabel(/^Due/).fill(at(-2, '09:00'));
    await form.getByRole('button', { name: 'Create task' }).click();
    await expect(form.getByText('The due date must be in the future.')).toBeVisible();
    await form.getByLabel(/^Due/).fill(at(20, '17:00'));
    await form.getByRole('button', { name: 'Create task' }).click();
    await expect(form.getByText('Task created. Every speaker has it.')).toBeVisible();
    await form.getByLabel('Type').selectOption('agreement');
    await form.getByLabel('Title').fill(`Speaker release ${s}`);
    await form.getByLabel(/^Due/).fill(at(20, '17:00'));
    await expect(form.getByLabel(/^Agreement text/)).toHaveValue(/Placeholder/);
    await form.getByRole('button', { name: 'Create task' }).click();
    await expect(form.getByText('Task created. Every speaker has it.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: `Upload slides ${s}` })).toBeVisible();
    await expect(page.getByText('0 of 2 done').first()).toBeVisible();

    // Ana signs in by code and answers both tasks.
    const speaker = await newPage(browser);
    await signInByCode(speaker, await invitationLink(page, anaMail), anaMail);
    await speaker.getByRole('link', { name: 'Tasks' }).click();
    const slides = speaker.getByRole('listitem').filter({ hasText: `Upload slides ${s}` });
    await expect(slides.getByText('To do')).toBeVisible();
    await expectAccessible(speaker);
    const file = slides.getByLabel(`File for “Upload slides ${s}”`);
    await slides.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(slides.getByText('Choose a file first.')).toBeVisible();
    await file.setInputFiles({
      name: 'notes.txt',
      mimeType: 'application/pdf',
      buffer: Buffer.from('plain text'),
    });
    await slides.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(
      slides.getByText('Use a PDF, PowerPoint (.pptx), Word (.docx), JPEG, PNG or WebP file.'),
    ).toBeVisible();
    await file.setInputFiles({ name: 'My slides.pdf', mimeType: 'application/pdf', buffer: PDF });
    await slides.getByRole('button', { name: 'Upload', exact: true }).click();
    // Done: the task shows the file and its status (the upload form goes away).
    await expect(slides.getByText('Your file: My slides.pdf')).toBeVisible();
    await expect(slides.getByText('Done', { exact: true })).toBeVisible();
    const release = speaker.getByRole('listitem').filter({ hasText: `Speaker release ${s}` });
    await expect(release.getByText(/Placeholder/)).toBeVisible();
    await release.getByRole('button', { name: 'Accept' }).click();
    await expect(release.getByText('Tick the box to confirm.')).toBeVisible();
    await release.getByRole('checkbox', { name: `I have read and accept “Speaker release ${s}”` }).check();
    await release.getByRole('button', { name: 'Accept' }).click();
    await expect(release.getByText('Done', { exact: true })).toBeVisible();
    await speaker.reload();
    await expect(speaker.getByText('Done', { exact: true })).toHaveCount(2);

    // The organizer sees Ana done with her file, and reminds only who is missing the slides.
    await page.reload();
    const board = page.getByRole('listitem').filter({ hasText: `Upload slides ${s}` });
    await expect(board.getByText('1 of 2 done')).toBeVisible();
    await expect(board.getByRole('link', { name: 'Download My slides.pdf' })).toBeVisible();
    const download = await page.request.get(
      (await board.getByRole('link', { name: 'Download My slides.pdf' }).getAttribute('href')) ?? '',
    );
    expect(download.status()).toBe(200);
    expect((await download.body()).toString()).toContain('%PDF');
    await board.getByRole('button', { name: `Remind 1 speaker missing “Upload slides ${s}”` }).click();
    await expect(board.getByText('Reminder sent to 1 address.')).toBeVisible();
    const reminder = await mailTo(page, benMail, /Reminder: Upload slides/, true);
    expect(reminder.text).toContain('/event-portal/invite/');
    expect((await mailbox(page, anaMail)).some((m) => /Reminder:/.test(m.subject))).toBe(false);
    await page.reload();
    await expect(board.getByText(/Once, last/)).toBeVisible();
    await expectAccessible(page);

    // The viewer sees the board, the changes and access, but no control; a stale form is refused.
    const viewer = await newPage(browser);
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/speakers/tasks`);
    await expect(viewer.getByText('You can see the task board.', { exact: false })).toBeVisible();
    await expect(viewer.getByRole('button', { name: /Remind|Create task|Delete/ })).toHaveCount(0);
    await viewer.goto(`${base}/speakers`);
    await expect(viewer.getByRole('button', { name: /Send portal invitation|Remove access/ })).toHaveCount(0);
    await viewer.goto(`${base}/speakers/changes`);
    await expect(viewer.getByRole('button', { name: /Approve|Reject/ })).toHaveCount(0);
    await expectAccessible(viewer);
    await page.goto(`${base}/speakers/tasks`);
    const stale = page.getByRole('listitem').filter({ hasText: `Speaker release ${s}` });
    await signIn(page, VIEWER);
    await stale.getByRole('button', { name: `Delete “Speaker release ${s}”` }).click();
    await expect(
      stale.getByRole('alert').filter({ hasText: "You don't have access to this." }),
    ).toBeVisible();
  });

  test('a speaker sees only their own sessions: no other speaker’s session, no console; sign out; Arabic', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const { base, ana, ben, s } = await conference(page, 'Portal Walls');
    const email = emailFor('walls');
    await invite(page, base, ana, email);
    // Ben's session id, from the organizer's sessions page.
    await page.goto(`${base}/sessions`);
    const ids = await page
      .locator('input[id^="session-"][id$="-title"]')
      .evaluateAll(
        (els, want) => els.filter((e) => (e as HTMLInputElement).value === want).map((e) => e.id),
        `Ben workshop ${s}`,
      );
    const benSession = ids[0]?.replace(/^session-/, '').replace(/-title$/, '') ?? '';
    expect(benSession).toMatch(/^[0-9a-f-]{36}$/);

    const speaker = await newPage(browser);
    await signInByCode(speaker, await invitationLink(page, email), email);
    // Their own session opens; Ben's is a 404, and so is a guess.
    await speaker.getByRole('link', { name: `Ana keynote ${s}` }).click();
    await expect(speaker.getByRole('heading', { name: `Ana keynote ${s}` })).toBeVisible();
    await expect(
      speaker.getByText('Times and rooms are set by the organizer.', { exact: false }),
    ).toBeVisible();
    await speaker.getByLabel('Session title').fill(`Ana keynote, revised ${s}`);
    await speaker.getByRole('button', { name: 'Send for approval' }).click();
    await expect(speaker.getByText('Sent for approval.')).toBeVisible();
    await expectAccessible(speaker);
    for (const id of [benSession, '01900000-0000-7000-8000-000000000000']) {
      const res = await speaker.goto(`/event-portal/sessions/${id}`);
      expect(res?.status()).toBe(404);
      await expect(speaker.getByText(`Ben workshop ${s}`)).toHaveCount(0);
    }
    // No console: a portal session is not an organizer session.
    await speaker.goto(`${base}/speakers`);
    await expect(speaker).toHaveURL(/sign-in/);
    await speaker.goto(`${ORG}`);
    await expect(speaker).toHaveURL(/sign-in/);
    // Nor can a portal session download organizer files.
    expect((await speaker.request.get(`/api/portal-files/lakeside-events/${benSession}`)).status()).toBe(401);

    // Arabic, right-to-left.
    for (const path of ['/ar/event-portal', '/ar/event-portal/profile', '/ar/event-portal/tasks']) {
      await speaker.goto(path);
      await expect(speaker.locator('html')).toHaveAttribute('dir', 'rtl');
      await expectAccessible(speaker);
    }
    await page.goto(`/ar${base}/speakers/changes`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
    await page.goto(`/ar${base}/speakers/tasks`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
    await page.goto('/lang/en');

    await speaker.goto('/lang/en');
    // Sign out: the portal asks for the invitation again, and the old invitation link still signs in.
    await speaker.goto('/event-portal');
    await speaker.getByRole('button', { name: 'Sign out' }).click();
    await expect(speaker.getByRole('heading', { name: "You're signed out" })).toBeVisible();
    await speaker.goto('/event-portal/tasks');
    await expect(speaker.getByRole('heading', { name: 'Sign in to the portal' })).toBeVisible();
    await expectAccessible(speaker);

    // The organizer removes access: the invitation link explains, and nothing opens.
    await page.goto(`${base}/speakers`);
    const panel = page.getByRole('region', { name: `Portal access for ${ana}` });
    await panel.getByRole('button', { name: `Remove access for ${email}` }).click();
    await expect(panel.getByText('Access removed', { exact: true })).toBeVisible();
    await speaker.goto(await invitationLink(page, email));
    await expect(speaker.getByText('Your access has ended')).toBeVisible();
    await expectAccessible(speaker);
    // Ben was never invited.
    await expect(
      page
        .getByRole('region', { name: `Portal access for ${ben}` })
        .getByText('Not invited to the portal yet.'),
    ).toBeVisible();
  });
});
