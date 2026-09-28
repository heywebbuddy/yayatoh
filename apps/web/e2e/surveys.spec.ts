import { type Browser, expect, type Page, test } from '@playwright/test';
import { ageSession, confirmStepUp, expectAccessible, newUser, personaCode, signIn } from './helpers.ts';

/**
 * M3.9a surveys: build a post-event survey, send it (with a reminder), answer from the guest link
 * (once), see the reminder skip the responder, read the results and NPS, export the answers, close
 * the survey; session feedback; permissions.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';
const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

interface Captured {
  subject: string;
  text: string;
  html: string;
}

async function drain(page: Page, scheduled = false) {
  const form: Record<string, string> = { org: 'lakeside-events' };
  if (scheduled) form.scheduled = '1';
  const res = await page.request.post('/api/dev/outbox/drain', { form });
  expect(res.ok()).toBe(true);
}

async function mailbox(page: Page, to: string): Promise<Captured[]> {
  const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`);
  return res.json();
}

/** A finished event (last March, in Chicago) with nobody on its list yet. */
async function pastEvent(page: Page, name: string) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Starts', { exact: true }).fill('2026-03-01T18:00');
  await page.getByLabel('Ends', { exact: true }).fill('2026-03-01T22:00');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  return new URL(page.url()).pathname;
}

async function addGuests(page: Page, base: string, people: readonly { name: string; email: string }[]) {
  await page.goto(`${base}/attendees`);
  await page
    .getByText(/^Add (attendee|guest)/i)
    .first()
    .click();
  for (const p of people) {
    await page.getByLabel('Full name').fill(p.name);
    await page.getByLabel('Email', { exact: true }).fill(p.email);
    await page.getByRole('button', { name: 'Add to the list' }).click();
    await expect(page.getByRole('row').filter({ hasText: p.name })).toBeVisible();
  }
}

async function surveyLink(page: Page, email: string, subject: string): Promise<string> {
  let link = '';
  await expect
    .poll(async () => {
      const mail = (await mailbox(page, email)).find((m) => m.subject === subject);
      link = /href="(https?:\/\/[^"]+\/survey\/[^"]+)"/.exec(mail?.html ?? '')?.[1] ?? '';
      return link;
    })
    .toMatch(/\/survey\/[0-9a-f-]{36}~/);
  return new URL(link).pathname;
}

const guestPage = async (browser: Browser) => (await browser.newContext()).newPage();

test.describe('surveys (M3.9a)', () => {
  test('build, send with a reminder, answer once, remind only non-responders, read NPS, export and close', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const s = stamp();
    const eventName = `Supper ${s}`;
    const title = `How was ${eventName}?`;
    const people = ['Uma', 'Vic', 'Wes'].map((n) => ({
      name: `${n} ${s}`,
      email: `${n.toLowerCase()}.${s}@example.test`,
    }));
    const [uma, vic, wes] = people as [(typeof people)[0], (typeof people)[0], (typeof people)[0]];
    await signIn(page);
    const base = await pastEvent(page, eventName);

    // Marketing → Surveys: empty list, nothing to give feedback on yet.
    await page.goto(`${base}/marketing`);
    await page.getByRole('link', { name: 'Open surveys' }).click();
    await expect(page.getByRole('heading', { name: 'Surveys', level: 1 })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Your surveys' })).toContainText('No surveys yet.');
    await expect(
      page.getByText('Add sessions to the program to collect feedback on each one.'),
    ).toBeVisible();
    await expectAccessible(page);

    // Create the post-event survey (keyboard): it starts with NPS, a rating and an open question.
    await page.getByRole('button', { name: 'Create the post-event survey' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/marketing\/surveys\/[0-9a-f-]{36}$/);
    const surveyUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    const questions = page.getByRole('list', { name: 'Questions' });
    await expect(questions.getByRole('listitem')).toHaveCount(3);
    await expect(questions.getByRole('listitem').first()).toContainText(
      `How likely are you to recommend ${eventName} to a friend or colleague?`,
    );
    await expect(page.getByText('No answers yet')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Sent' })).toContainText('Not sent yet.');
    await expectAccessible(page);

    // Add a question: every validation message, then a choice question.
    const add = page.getByRole('form', { name: 'Add a question' });
    await add.getByRole('button', { name: 'Add question' }).click();
    await expect(add.getByText('Write the question.')).toBeVisible();
    await expect(add.getByLabel('Question', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await add.getByLabel('Question', { exact: true }).fill('Best part');
    await add.getByLabel('Type', { exact: true }).selectOption({ label: 'One choice' });
    await add.getByRole('button', { name: 'Add question' }).click();
    await expect(add.getByText('Add at least one option, one per line.')).toBeVisible();
    await expectAccessible(page);
    await add.getByLabel('Options', { exact: true }).fill('Music\nFood');
    await add.getByRole('button', { name: 'Add question' }).click();
    await expect(add.getByText('Question added.')).toBeVisible();
    await expect(questions.getByRole('listitem')).toHaveCount(4);
    // Reorder from the keyboard (the accessible alternative to dragging), then remove one.
    await page.getByRole('button', { name: 'Move “Best part” up' }).focus();
    await page.keyboard.press('Enter');
    await expect(questions.getByRole('listitem').nth(2)).toContainText('Best part');
    await add.getByLabel('Question', { exact: true }).fill('Temporary');
    await add.getByRole('button', { name: 'Add question' }).click();
    await expect(questions.getByRole('listitem')).toHaveCount(5);
    await page.getByRole('button', { name: 'Remove “Temporary”' }).click();
    await expect(questions.getByRole('listitem')).toHaveCount(4);
    await page.reload();
    await expect(questions.getByRole('listitem').nth(2)).toContainText('Best part');

    // Title: required; saved.
    const details = page.getByRole('form', { name: 'Title and introduction' });
    await details.getByLabel('Title', { exact: true }).fill('');
    await details.getByRole('button', { name: 'Save' }).click();
    await expect(details.getByText('Add a title.')).toBeVisible();
    await details.getByLabel('Title', { exact: true }).fill(title);
    await details.getByLabel('Introduction (optional)').fill('Two minutes, promise.');
    await details.getByRole('button', { name: 'Save' }).click();
    await expect(details.getByText('Saved.')).toBeVisible();

    // Send: every validation message, and nobody to ask yet.
    const send = page.getByRole('form', { name: 'Send' });
    await send.getByLabel('Reminder after (days, optional)').fill('31');
    await send.getByLabel('Links work for (days)').fill('');
    await send.getByRole('button', { name: 'Send survey' }).click();
    await expect(send.getByText('Choose from 1 to 30 days, or leave it empty.')).toBeVisible();
    await expect(send.getByText('Choose from 1 to 90 days.')).toBeVisible();
    await expectAccessible(page);
    await send.getByLabel('Reminder after (days, optional)').fill('');
    await send.getByLabel('Links work for (days)').fill('30');
    await send.getByRole('button', { name: 'Send survey' }).click();
    await expect(send.getByText('Nobody is attending this event, so there is no one to ask.')).toBeVisible();

    await addGuests(page, base, people);
    await page.goto(surveyUrl);
    await send.getByLabel('Only people who checked in').check();
    await send.getByRole('button', { name: 'Send survey' }).click();
    await expect(send.getByText('Nobody has checked in yet.')).toBeVisible();

    // Everyone attending, with a reminder after 2 days, from the keyboard.
    await page.reload();
    await send.getByLabel('Everyone attending').check();
    await send.getByLabel('Reminder after (days, optional)').fill('2');
    await send.getByLabel('Reminder after (days, optional)').press('Enter');
    await expect(send.getByText('Sent to 3 people.')).toBeVisible();
    const sends = page.getByRole('table', { name: 'Sent' });
    await expect(sends.getByRole('row').filter({ hasText: 'After 2 days' })).toContainText('3');
    await page.reload();
    await expect(sends.getByRole('row').filter({ hasText: 'After 2 days' })).toBeVisible();
    // Sending again reaches nobody new.
    await send.getByRole('button', { name: 'Send survey' }).click();
    await expect(send.getByText('Everyone attending has already been asked.')).toBeVisible();

    // Each guest gets their own link.
    await drain(page);
    const umaLink = await surveyLink(page, uma.email, title);
    const vicLink = await surveyLink(page, vic.email, title);
    const wesLink = await surveyLink(page, wes.email, title);

    // Uma answers (no account); a missing required answer is named first.
    const guest = await guestPage(browser);
    await guest.goto(umaLink);
    await expect(guest.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await expect(guest.getByText('Survey from Lakeside Events')).toBeVisible();
    await expect(guest.getByText('Two minutes, promise.')).toBeVisible();
    await expectAccessible(guest);
    await guest.getByRole('button', { name: 'Send my answers' }).click();
    await expect(guest.getByText('This question needs an answer.')).toBeVisible();
    await expectAccessible(guest);
    const nps = guest.getByRole('group', {
      name: `How likely are you to recommend ${eventName} to a friend or colleague?`,
    });
    // Keyboard: the score radios are one group; arrows move between them.
    await nps.getByRole('radio', { name: '8', exact: true }).focus();
    await guest.keyboard.press('ArrowRight');
    await expect(nps.getByRole('radio', { name: '9', exact: true })).toBeChecked();
    await guest
      .getByRole('group', { name: 'How would you rate it overall? (optional)' })
      .getByRole('radio', { name: '4 of 5' })
      // The pill (its label) covers the visually hidden radio.
      .check({ force: true });
    await guest.getByRole('group', { name: 'Best part (optional)' }).getByLabel('Music').check();
    await guest.getByLabel('What could we do better? (optional)').fill('More dessert');
    await guest.getByRole('button', { name: 'Send my answers' }).click();
    await expect(guest.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
    await expect(guest.getByText('Your answers were sent to Lakeside Events.')).toBeVisible();
    await expectAccessible(guest);
    // Single use: the link now says it was answered.
    await guest.goto(umaLink);
    await expect(guest.getByRole('heading', { name: 'Already answered' })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Send my answers' })).toHaveCount(0);
    await expectAccessible(guest);

    // Vic has the survey open twice: the second submission is refused.
    const vicA = await guestPage(browser);
    const vicB = await guestPage(browser);
    await vicA.goto(vicLink);
    await vicB.goto(vicLink);
    for (const p of [vicA, vicB])
      await p
        .getByRole('group', {
          name: `How likely are you to recommend ${eventName} to a friend or colleague?`,
        })
        .getByRole('radio', { name: '3', exact: true })
        .check({ force: true });
    await vicA.getByRole('button', { name: 'Send my answers' }).click();
    await expect(vicA.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
    await vicB.getByRole('button', { name: 'Send my answers' }).click();
    await expect(vicB.getByRole('form', { name: 'Your answers' }).getByRole('alert')).toContainText(
      "You've already answered this survey.",
    );
    await expectAccessible(vicB);

    // Arabic, right to left (Wes has not answered).
    const arabic = await guestPage(browser);
    await arabic.goto(`/ar${wesLink}`);
    await expect(arabic.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(arabic.getByRole('button', { name: 'إرسال إجاباتي' })).toBeVisible();
    await expect(arabic.getByText('0 = غير محتمل إطلاقًا، 10 = محتمل جدًا')).toBeVisible();
    await expectAccessible(arabic);

    // Two days later: only Wes is reminded.
    await drain(page, true);
    const reminder = `Reminder: ${title}`;
    await expect
      .poll(async () => (await mailbox(page, wes.email)).some((m) => m.subject === reminder))
      .toBe(true);
    for (const p of [uma, vic])
      expect((await mailbox(page, p.email)).some((m) => m.subject === reminder)).toBe(false);

    // Results: 2 of 3 answered, NPS 0 (one promoter, one detractor), per-question summaries.
    await page.goto(surveyUrl);
    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByRole('definition').first()).toHaveText('3');
    await expect(results).toContainText('67%');
    await expect(results.getByLabel('NPS breakdown')).toContainText('Promoters (9–10)1 · 50%');
    await expect(results.getByLabel('NPS breakdown')).toContainText('Detractors (0–6)1 · 50%');
    await expect(results).toContainText('NPS 0 from 2 answers');
    await expect(results).toContainText('Average 4 out of 5 from 1 answer');
    await expect(
      results.getByRole('list', { name: 'Latest answers: What could we do better?' }),
    ).toContainText('More dessert');
    await expect(results.getByRole('img', { name: /^Answers by score: How likely/ })).toBeVisible();
    await results.getByText('Show the data').first().click();
    await expect(results.getByRole('table', { name: /^Answers by score: How likely/ })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Sent' })).toBeVisible();
    await expectAccessible(page);

    // Export (a recent step-up): the CSV has one row per answer.
    await ageSession(page);
    await page.getByRole('button', { name: 'Download answers (CSV)' }).click();
    await confirmStepUp(page, personaCode());
    const exportPanel = page.getByRole('region', { name: 'Answers export' });
    await expect(exportPanel.getByText('Ready: 2 rows exported.')).toBeVisible({ timeout: 20_000 });
    const href = (await exportPanel.getByRole('link', { name: 'Download CSV' }).getAttribute('href')) ?? '';
    const csv = await page.request.get(href);
    expect(csv.status()).toBe(200);
    const lines = (await csv.text())
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\r\n');
    expect(lines[0]).toBe(
      `Name,Email,Answered,How likely are you to recommend ${eventName} to a friend or colleague?,How would you rate it overall?,Best part,What could we do better?`,
    );
    expect(lines.find((l) => l.startsWith(uma.name))).toMatch(
      new RegExp(
        `^${uma.name},${uma.email.replace(/\./g, '\\.')},\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d,9,4,Music,More dessert$`,
      ),
    );
    expect(lines).toHaveLength(3);
    await expectAccessible(page);

    // Close: open links say so; reopen.
    await page.getByRole('button', { name: 'Close survey' }).click();
    await expect(page.getByText('Survey closed.')).toBeVisible();
    await expect(
      page.getByText('This survey is closed: its links say it no longer takes answers.'),
    ).toBeVisible();
    const wesPage = await guestPage(browser);
    await wesPage.goto(wesLink);
    await expect(wesPage.getByRole('heading', { name: 'This survey is closed' })).toBeVisible();
    await expect(wesPage.getByRole('button', { name: 'Send my answers' })).toHaveCount(0);
    await expectAccessible(wesPage);
    await page.getByRole('button', { name: 'Reopen survey' }).click();
    await expect(page.getByText('Survey reopened.')).toBeVisible();

    // The list shows the survey with its response rate, after a reload.
    await page.goto(`${base}/marketing/surveys`);
    const row = page.getByRole('table', { name: 'Your surveys' }).getByRole('row').filter({ hasText: title });
    await expect(row).toContainText('67%');
    await expect(row).toContainText('Open');
    await expect(page.getByText('This event already has its post-event survey.')).toBeVisible();
  });

  test('session feedback: pick a session; it can be sent once the session is over', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const s = stamp();
    await signIn(page);
    await page.goto(`${ORG}/events/new`);
    await page.getByLabel('Event name', { exact: true }).fill(`Forum ${s}`);
    await page.getByLabel('Event type').selectOption('conference');
    await page.getByLabel('Time zone').selectOption('America/Chicago');
    await page.getByLabel('Starts', { exact: true }).fill('2031-05-01T09:00');
    await page.getByLabel('Ends', { exact: true }).fill('2031-05-01T18:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
    const base = new URL(page.url()).pathname;
    await page.goto(`${base}/sessions`);
    const add = page.getByRole('region', { name: 'Add session' });
    await add.getByLabel('Session title').fill(`Keynote ${s}`);
    await add.getByLabel('Session starts').fill('2031-05-01T10:00');
    await add.getByLabel('Session ends').fill('2031-05-01T11:00');
    await add.getByRole('button', { name: 'Add session' }).click();
    await expect(add.getByText('Session added.')).toBeVisible();

    await page.goto(`${base}/marketing/surveys`);
    await page.getByRole('button', { name: 'Create session feedback' }).click();
    await expect(page.getByText('Choose a session.')).toBeVisible();
    await expect(page.getByLabel('Session', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);
    await page.getByLabel('Session', { exact: true }).selectOption({ label: `Keynote ${s}` });
    await page.getByRole('button', { name: 'Create session feedback' }).click();
    await expect(page.getByRole('heading', { name: `Feedback: Keynote ${s}`, level: 1 })).toBeVisible();
    await expect(page.getByText(`Session feedback: Keynote ${s}`)).toBeVisible();
    // Not over yet: no send form, a date instead.
    await expect(page.getByText(/^You can send this survey once Keynote \d+ is over \(/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send survey' })).toHaveCount(0);
    await expectAccessible(page);
    // The console in Arabic, right to left (its own context: the locale cookie would stick).
    const arabic = await (await browser.newContext()).newPage();
    await signIn(arabic);
    await arabic.goto(`/ar${new URL(page.url()).pathname}`);
    await expect(arabic.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(arabic.getByRole('heading', { name: 'الأسئلة' })).toBeVisible();
    await expectAccessible(arabic);
    await page.goto(`${base}/marketing/surveys`);
    await expect(page.getByText('Every session already has a feedback survey.')).toBeVisible();
    await expect(
      page
        .getByRole('table', { name: 'Your surveys' })
        .getByRole('row')
        .filter({ hasText: `Keynote ${s}` }),
    ).toContainText('Session feedback');
  });

  test('permissions: a viewer gets no survey pages; box office reads results without controls', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const s = stamp();
    await signIn(page);
    const base = await pastEvent(page, `Tea ${s}`);
    await page.goto(`${base}/marketing/surveys`);
    await page.getByRole('button', { name: 'Create the post-event survey' }).click();
    await expect(page).toHaveURL(/\/marketing\/surveys\/[0-9a-f-]{36}$/);
    const surveyPath = new URL(page.url()).pathname;

    // Viewer: no Marketing section, and both survey URLs are refused.
    const viewer = await guestPage(browser);
    await signIn(viewer, VIEWER);
    await viewer.goto(base);
    await expect(viewer.getByRole('link', { name: 'Marketing' })).toHaveCount(0);
    for (const url of [`${base}/marketing/surveys`, surveyPath]) {
      const res = await viewer.goto(url);
      expect(res?.status()).toBe(404);
    }

    // Box office: reads the survey, but nothing to build, send, export or close.
    const office = await guestPage(browser);
    await newUser(office, { join: ['lakeside-events:box_office'] });
    await office.goto(surveyPath);
    await expect(office.getByRole('heading', { name: `How was Tea ${s}?`, level: 1 })).toBeVisible();
    await expect(office.getByRole('list', { name: 'Questions' }).getByRole('listitem')).toHaveCount(3);
    for (const name of ['Send survey', 'Add question', 'Close survey', 'Save'])
      await expect(office.getByRole('button', { name })).toHaveCount(0);
    await expect(office.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
    await office.goto(`${base}/marketing/surveys`);
    await expect(office.getByRole('button', { name: 'Create the post-event survey' })).toHaveCount(0);
    await expect(office.getByRole('heading', { name: 'Create a survey' })).toHaveCount(0);
    await expectAccessible(office);
  });
});
