import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, newUser, pickOption, signIn } from './helpers.ts';

/**
 * M5.7b — the session feedback prompt at session end, engagement scores per attendee and session
 * with the org's weights, and the engagement condition in the audience builder.
 */

const VIEWER = 'jordan@lakeside.test';

interface Setup {
  readonly name: string;
  readonly slug: string;
  readonly path: string;
  readonly participant: string;
}

/** A conference running now whose "Closing panel" ended an hour ago (see /api/dev/engagement). */
async function conference(page: Page, org: string, email = ''): Promise<Setup> {
  const name = `Engagement ${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;
  const res = await page.request.post('/api/dev/engagement', { form: { org, email, name } });
  expect(res.status()).toBe(200);
  return { name, ...((await res.json()) as Omit<Setup, 'name'>) };
}

const drain = async (page: Page, org: string) =>
  expect((await page.request.post('/api/dev/outbox/drain', { form: { org } })).status()).toBe(200);

async function anonymous(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

test.describe('engagement scores and session feedback (M5.7b)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('an attendee votes and gives feedback once; the organizer sees the score; audiences use it', async ({
    page,
  }) => {
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = owner.orgSlug as string;
    const c = await conference(page, org, owner.email);

    // The participant page asks for feedback now that the session is over.
    await page.goto(c.participant);
    const prompt = page.getByTestId('feedback-prompt');
    await expect(prompt.getByRole('heading', { name: 'How was this session?' })).toBeVisible();
    await expect(prompt.getByText('How was the closing panel?')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Vote with the keyboard (signed in: it counts toward the score).
    const card = page.locator('article[data-poll="Was the panel useful?"]');
    await card.getByRole('radio', { name: 'Yes' }).focus();
    await page.keyboard.press('Space');
    await card.getByRole('button', { name: 'Vote' }).focus();
    await page.keyboard.press('Enter');
    await expect(card.getByText('Thanks, your vote is in.')).toBeVisible();

    // Give feedback with the keyboard: the survey opens on its own link.
    await prompt.getByRole('button', { name: 'Give feedback' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/survey\/[^/]+$/);
    await page.getByRole('button', { name: 'Send my answers' }).click();
    await expect(page.getByText('This question needs an answer.')).toBeVisible();
    await page
      .getByRole('group', { name: 'Your rating' })
      .getByRole('radio', { name: '4 of 5' })
      .check({ force: true });
    await page.getByRole('button', { name: 'Send my answers' }).click();
    await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();

    // One response per person: back on the session page, the prompt says thanks.
    await page.goto(c.participant);
    await expect(page.getByTestId('feedback-prompt').getByText('Thanks, your feedback is in.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Give feedback' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Thanks, your feedback is in.')).toBeVisible();

    // The organizer: from the sessions page to the scores (default weights: vote 2 + feedback 5).
    await drain(page, org);
    await page.goto(`${c.path}/sessions`);
    await page.getByRole('link', { name: 'Engagement scores' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Engagement scores' })).toBeVisible();
    await expect(page.getByTestId('engaged-count')).toContainText('1');
    const people = page.getByRole('table', { name: 'Most engaged attendees' });
    const row = people.getByRole('row').filter({ hasText: owner.email });
    await expect(row).toContainText('7');
    await expect(row).toContainText('Poll vote × 1 · Feedback × 1');
    const sessions = page.getByRole('table', { name: 'Sessions' });
    await expect(sessions.getByRole('row').filter({ hasText: 'Closing panel' })).toContainText('7');
    await expectAccessibleBothModes(page);

    // Audiences: "engagement score of at least 7 at this event" finds them; 8 finds nobody.
    await page.goto(`/o/${org}/audiences/new`);
    await pickOption(page.getByLabel('New condition').first(), 'engagement');
    await page.getByRole('button', { name: 'Add condition' }).first().click();
    const condition = page.getByRole('group', { name: 'Condition 1: Engagement score' });
    await expect(condition).toBeVisible();
    const eventSelect = condition.getByRole('combobox', { name: 'Event', exact: true });
    await pickOption(eventSelect, { label: c.name });
    await condition.getByRole('spinbutton', { name: 'Score' }).fill('7');
    await expect(page.getByTestId('audience-count')).toHaveText('1 person matches');
    await condition.getByRole('spinbutton', { name: 'Score' }).fill('8');
    await expect(page.getByTestId('audience-count')).toHaveText('0 people match');
    await expectAccessible(page);
  });

  test('weights: inline validation, save, persistence and reset, keyboard only; Arabic RTL', async ({
    page,
  }) => {
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const c = await conference(page, owner.orgSlug as string);
    await page.goto(`${c.path}/engagement`);
    // Nobody took part yet: the empty state says what counts.
    await expect(page.getByText('No engagement yet')).toBeVisible();
    await expect(page.getByTestId('weights-source')).toHaveText('Default weights');
    await expect(page.getByRole('table', { name: 'Sessions' })).toContainText('Closing panel');
    await expectAccessible(page);

    const vote = page.getByLabel('Poll vote');
    await expect(vote).toHaveValue('2');
    await vote.focus();
    await vote.fill('101');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Enter a whole number from 0 to 100.')).toBeVisible();
    await expect(vote).toHaveValue('101');
    await expectAccessible(page);
    await vote.fill('4');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Weights saved. Every score was recalculated.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Poll vote')).toHaveValue('4');
    await expect(page.getByTestId('weights-source')).toHaveText("Your organization's weights");

    const reset = page.getByRole('button', { name: 'Use default weights' });
    await reset.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Default weights restored. Every score was recalculated.')).toBeVisible();
    await expect(page.getByLabel('Poll vote')).toHaveValue('2');
    await expect(page.getByTestId('weights-source')).toHaveText('Default weights');

    await page.goto(`/ar${c.path}/engagement`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'درجات التفاعل' })).toBeVisible();
    await expectAccessible(page);
  });

  test('visitors are asked to sign in (also in Arabic); viewers read, lower roles are refused', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const c = await conference(page, 'lakeside-events');

    const guest = await anonymous(browser);
    await guest.goto(c.participant);
    const prompt = guest.getByTestId('feedback-prompt');
    await expect(
      prompt.getByText('Sign in with the email you registered with to give feedback.'),
    ).toBeVisible();
    await expect(prompt.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      new RegExp(
        `/sign-in\\?next=${encodeURIComponent(c.participant).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ),
    );
    await expect(prompt.getByRole('button', { name: 'Give feedback' })).toHaveCount(0);
    await expectAccessibleBothModes(guest);
    await guest.goto(`/ar${c.participant}`);
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.getByRole('heading', { name: 'كيف كانت هذه الجلسة؟' })).toBeVisible();
    await expectAccessible(guest);

    // A viewer sees the scores, but the weights are read-only.
    const viewer = await anonymous(browser);
    await signIn(viewer, VIEWER);
    await viewer.goto(`${c.path}/engagement`);
    await expect(viewer.getByRole('heading', { level: 1, name: 'Engagement scores' })).toBeVisible();
    await expect(viewer.getByText('Only owners and admins can change the weights.')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Save weights' })).toHaveCount(0);
    await expect(viewer.getByLabel('Poll vote')).toBeDisabled();
    await expectAccessible(viewer);

    // Someone who may not read attendees has no link and no page.
    const marketer = await anonymous(browser);
    await newUser(marketer, { join: ['lakeside-events:marketing'] });
    await marketer.goto(`${c.path}/sessions`);
    await expect(marketer.getByRole('link', { name: 'Engagement scores' })).toHaveCount(0);
    const res = await marketer.goto(`${c.path}/engagement`);
    expect(res?.status()).toBe(404);
  });
});
