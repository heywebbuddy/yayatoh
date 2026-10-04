import { expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type RsvpQuestionsScenario, rsvpQuestionsScenario } from '@yayatoh/testing';
import {
  ageSession,
  confirmStepUp,
  expectAccessibleBothModes,
  personaCode,
  pickOption,
  signIn,
} from './helpers.ts';

// Batch 3h merge: axe runs in light and dark on every screen now (twice the checks), so these long
// journeys get more than the default 30 s.
test.describe.configure({ timeout: 120_000 });

/**
 * M4.1e: RSVP questions. The host builds questions with conditions (live preview, menu with
 * dietary notes), a household of three answers them per guest (one declines), the meal lands on
 * the guest and the meal counts update; the answers export needs a step-up; viewers can't edit;
 * keyboard only, axe and Arabic.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';

test.afterAll(async () => {
  await closePools();
});

let orgId: string | null = null;
async function wedding(opts: { questions?: boolean } = {}): Promise<RsvpQuestionsScenario> {
  orgId ??= (await resolveOrgSlug('lakeside-events'))?.orgId ?? null;
  if (!orgId) throw new Error('no lakeside-events org (seed?)');
  return rsvpQuestionsScenario(orgId, opts);
}

const link = (token: string, locale = '') => `${locale}/rsvp/${encodeURIComponent(token)}`;
const console_ = (s: RsvpQuestionsScenario) => `${ORG}/e/${s.eventSlug}/guests`;
const pair = (page: Page, name: string) => page.getByRole('group', { name, exact: true });
const answer = (page: Page, name: string, choice: 'Attending' | "Can't attend") =>
  pair(page, name).getByText(choice, { exact: true }).click();
const questionsFor = (page: Page, name: string) => page.getByRole('group', { name: `Questions for ${name}` });

/** Adds a question through the builder's form. */
async function addQuestion(
  page: Page,
  q: {
    label: string;
    type?: string;
    options?: string;
    about?: string;
    savedTo?: string;
    required?: boolean;
    attending?: boolean;
    adults?: boolean;
    plusOne?: boolean;
  },
) {
  await page.getByRole('button', { name: 'Add a question' }).click();
  const form = page.getByRole('group', { name: 'Add question' });
  await form.getByLabel('Question', { exact: true }).fill(q.label);
  if (q.type) await pickOption(form.getByLabel('Answer type'), { label: q.type });
  if (q.options) await form.getByLabel('Options', { exact: true }).fill(q.options);
  if (q.about) await pickOption(form.getByLabel('About'), { label: q.about });
  if (q.savedTo) await pickOption(form.getByLabel('Save the answer to the guest'), { label: q.savedTo });
  if (q.required) await form.getByLabel('Required', { exact: true }).check();
  if (q.attending) await form.getByLabel('Only guests who are attending').check();
  if (q.adults) await form.getByLabel('Only adults').check();
  if (q.plusOne) await form.getByLabel('Only guests bringing a named plus-one').check();
  await form.getByRole('button', { name: 'Add question' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: q.label }).first()).toBeVisible();
}

test.describe('RSVP questions (M4.1e)', () => {
  test('the host builds questions with conditions: validation, live preview, publish, persisted', async ({
    page,
  }) => {
    const s = await wedding({ questions: false });
    await signIn(page);
    await page.goto(console_(s));
    await page.getByRole('link', { name: 'RSVP questions' }).click();
    await expect(page.getByRole('heading', { name: 'RSVP questions', level: 1 })).toBeVisible();
    // Empty state, and the menu with its dietary notes.
    await expect(page.getByText('No questions yet. Add one, then publish.')).toBeVisible();
    const menu = page.getByRole('list', { name: 'Menu options' });
    await expect(menu.getByText('Contains shellfish')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish questions' })).toBeDisabled();
    await expectAccessibleBothModes(page);

    // Validation: no question text; a choice with no options.
    await page.getByRole('button', { name: 'Add a question' }).click();
    const form = page.getByRole('group', { name: 'Add question' });
    await form.getByRole('button', { name: 'Add question' }).click();
    await expect(form.getByText('Enter the question.')).toBeVisible();
    await expect(form.getByLabel('Question', { exact: true })).toBeFocused();
    await expect(form.getByLabel('Question', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await form.getByLabel('Question', { exact: true }).fill('Which table side?');
    await pickOption(form.getByLabel('Answer type'), { label: 'One choice' });
    await form.getByRole('button', { name: 'Add question' }).click();
    await expect(form.getByText('Add at least one option, one per line.')).toBeVisible();
    await expectAccessibleBothModes(page);
    await form.getByRole('button', { name: 'Cancel' }).click();

    await addQuestion(page, {
      label: 'Reception: meal choice',
      type: 'Meal choice (from the menu)',
      about: 'Reception',
      required: true,
      attending: true,
    });
    // One meal question only.
    await page.getByRole('button', { name: 'Add a question' }).click();
    await page
      .getByRole('group', { name: 'Add question' })
      .getByLabel('Question', { exact: true })
      .fill('Second meal');
    await pickOption(page.getByRole('group', { name: 'Add question' }).getByLabel('Answer type'), {
      label: 'Meal choice (from the menu)',
    });
    await page
      .getByRole('group', { name: 'Add question' })
      .getByRole('button', { name: 'Add question' })
      .click();
    await expect(page.getByText('There is already a meal question.')).toBeVisible();
    await page.getByRole('group', { name: 'Add question' }).getByRole('button', { name: 'Cancel' }).click();

    await addQuestion(page, {
      label: 'Allergies or dietary needs',
      type: 'Long text',
      savedTo: 'Saved as dietary needs',
    });
    await addQuestion(page, {
      label: 'Ceremony: song request',
      about: 'Ceremony',
      attending: true,
      adults: true,
    });
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Ceremony: song request' }).first(),
    ).toContainText('Shown only: guests attending; adults');
    await expect(page.getByText("You have changes that guests don't see yet.")).toBeVisible();

    // The live preview follows the sample guest.
    const preview = page.getByRole('region', { name: 'Preview' });
    await expect(preview.getByText('Questions shown: 3 of 3')).toBeVisible();
    await expect(preview.getByRole('group', { name: 'Reception: meal choice (required)' })).toBeVisible();
    await expect(preview.getByText('Vegan on request')).toBeVisible();
    await pickOption(preview.getByLabel('Age'), { label: 'Child' });
    await expect(preview.getByText('Questions shown: 2 of 3')).toBeVisible();
    await expect(preview.getByLabel('Ceremony: song request')).toHaveCount(0);
    await preview.getByLabel('Attending', { exact: true }).uncheck();
    await expect(preview.getByText('Questions shown: 1 of 3')).toBeVisible();
    await expect(preview.getByLabel('Allergies or dietary needs')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Reordering is by buttons; a move that breaks nothing is allowed.
    await page.getByRole('button', { name: 'Move Ceremony: song request up' }).click();
    await page.getByRole('button', { name: 'Move Ceremony: song request down' }).click();

    await page.getByRole('button', { name: 'Publish questions' }).click();
    await expect(page.getByText('Published. Guests now see version 1.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Guests see version 1.')).toBeVisible();
    const list = page.getByRole('list', { name: 'Questions' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(list.getByRole('listitem').nth(0)).toContainText('Reception: meal choice');
    await expect(list.getByRole('listitem').nth(1)).toContainText('Saved as dietary needs');
    await expect(list.getByRole('listitem').nth(1)).toContainText('Private');
  });

  test('the menu: add with notes, a duplicate is refused, an option a guest chose cannot be removed', async ({
    page,
  }) => {
    const s = await wedding();
    await signIn(page);
    await page.goto(`${console_(s)}/questions`);
    const add = page.getByRole('heading', { name: 'Add an option' }).locator('..');
    await add.getByLabel('Option', { exact: true }).fill('fish');
    await add.getByRole('button', { name: 'Add option' }).click();
    await expect(add.getByText('The menu already has this option.')).toBeVisible();
    await add.getByLabel('Option', { exact: true }).fill(`Beef ${test.info().project.name}`);
    await add.getByLabel('Dietary notes (optional)').fill('Gluten free');
    await add.getByRole('button', { name: 'Add option' }).click();
    await expect(add.getByText('Option added.')).toBeVisible();
    const menu = page.getByRole('list', { name: 'Menu options' });
    await expect(menu.getByText('Gluten free')).toBeVisible();

    // A guest chose Fish (through the RSVP page): it can't go.
    const guest = await page.context().browser()?.newContext();
    if (!guest) throw new Error('no browser');
    const phone = await guest.newPage();
    await phone.goto(link(s.garcia.token));
    for (const g of ['Luis López, Ceremony', 'Ana García, Ceremony', 'Luis López, Reception'])
      await answer(phone, g, 'Attending');
    for (const g of ["Luis's guest, Ceremony", "Luis's guest, Reception"])
      await answer(phone, g, "Can't attend");
    await questionsFor(phone, 'Luis López').getByText('Fish', { exact: true }).click();
    await phone.getByRole('button', { name: 'Send RSVP' }).click();
    await expect(phone).toHaveURL(/\?thanks=1$/);
    await guest.close();

    await page.reload();
    await page.getByRole('button', { name: 'Remove Fish' }).click();
    await expect(
      page.getByText('Guests chose this option. Rename it instead, or ask them to choose again.'),
    ).toBeVisible();
    await page.getByRole('button', { name: `Remove Beef ${test.info().project.name}` }).click();
    await expect(menu.getByText('Gluten free')).toHaveCount(0);
    await expectAccessibleBothModes(page);
  });

  test('a household of three answers, one declines: questions per guest, meal on the guest, counts update', async ({
    page,
  }) => {
    const s = await wedding();
    await page.goto(link(s.garcia.token));
    // Nothing asked before the guests say whether they come (the reception meal needs "attending").
    await expect(questionsFor(page, 'Luis López').getByText('Reception: meal choice')).toHaveCount(0);
    await answer(page, 'Luis López, Ceremony', 'Attending');
    await answer(page, 'Luis López, Reception', 'Attending');
    await answer(page, 'Ana García, Ceremony', "Can't attend");
    await page.getByLabel('First name').fill('Sam');
    await page.getByLabel('Last name (optional)').fill('Lee');
    await answer(page, "Luis's guest, Ceremony", 'Attending');
    await answer(page, "Luis's guest, Reception", 'Attending');

    const luis = questionsFor(page, 'Luis López');
    const sam = questionsFor(page, 'Sam');
    const ana = questionsFor(page, 'Ana García');
    await expect(luis.getByRole('group', { name: 'Reception: meal choice (required)' })).toBeVisible();
    await expect(luis.getByLabel('Ceremony: song request')).toBeVisible();
    await expect(sam.getByRole('group', { name: 'Reception: meal choice (required)' })).toBeVisible();
    // Ana declined: no meal, no song; the event-wide dietary question stays.
    await expect(ana.getByLabel('Allergies or dietary needs')).toBeVisible();
    await expect(ana.getByText('Reception: meal choice')).toHaveCount(0);
    await expect(ana.getByLabel('Ceremony: song request')).toHaveCount(0);
    await expect(luis.getByText('Contains shellfish')).toBeVisible();
    await expect(luis.getByText('Private: only the hosts see this.')).toBeVisible();
    await expectAccessibleBothModes(page);

    // A required meal left empty is named and focused.
    await page.getByRole('button', { name: 'Send RSVP' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Please answer this question for Luis López.' }),
    ).toBeVisible();
    await expect(luis.getByRole('group', { name: 'Reception: meal choice (required)' })).toBeFocused();
    await expectAccessibleBothModes(page);

    await luis.getByText('Fish', { exact: true }).click();
    await luis.getByLabel('Allergies or dietary needs').fill('No nuts, please');
    await luis.getByLabel('Ceremony: song request').fill('September');
    await sam.getByText('Vegetarian', { exact: true }).click();
    await page.getByRole('button', { name: 'Send RSVP' }).click();
    await expect(page).toHaveURL(/\?thanks=1$/);
    await expect(
      page.getByRole('status').filter({ hasText: 'Thank you! Your RSVP is saved.' }),
    ).toBeVisible();

    // Persisted: the meal and the song come back; the dietary answer never does.
    await page.goto(link(s.garcia.token));
    const again = questionsFor(page, 'Luis López');
    await expect(again.getByRole('radio', { name: /Fish/ })).toBeChecked();
    await expect(again.getByLabel('Ceremony: song request')).toHaveValue('September');
    await expect(again.getByLabel('Allergies or dietary needs')).toHaveValue('');
    await expect(
      again.getByText('You told the hosts before. Leave it empty to keep that answer.'),
    ).toBeVisible();
    expect(await page.content()).not.toContain('No nuts');

    // The host: the meal is on the guest, the dietary answer in the private fields; counts per sub-event.
    await signIn(page);
    await page.goto(console_(s));
    const garcia = page.getByRole('region', { name: 'Garcia', exact: true });
    await expect(garcia.getByRole('definition').filter({ hasText: /^Fish$/ })).toBeVisible();
    await expect(garcia.getByRole('definition').filter({ hasText: 'No nuts, please' })).toBeVisible();
    await page.getByRole('link', { name: 'RSVP answers' }).click();
    await expect(page.getByRole('heading', { name: 'RSVP answers', level: 1 })).toBeVisible();
    const counts = page.getByTestId(`meal-counts-${s.receptionId}`);
    await expect(counts.getByRole('row', { name: /Fish/ })).toContainText('1');
    await expect(counts.getByRole('row', { name: /Vegetarian/ })).toContainText('1');
    await expect(counts).toContainText('Reception · attending: 2');
    await expect(page.getByTestId('rsvp-responded')).toHaveText('Parties that answered: 1 of 2');
    await expectAccessibleBothModes(page);

    // Luis switches to vegetarian: the counts follow.
    const guest = await page.context().browser()?.newContext();
    if (!guest) throw new Error('no browser');
    const phone = await guest.newPage();
    await phone.goto(link(s.garcia.token));
    await questionsFor(phone, 'Luis López').getByText('Vegetarian', { exact: true }).click();
    await phone.getByRole('button', { name: 'Send RSVP' }).click();
    await expect(phone).toHaveURL(/\?thanks=1$/);
    await guest.close();
    await page.reload();
    await expect(counts.getByRole('row', { name: /Fish/ })).toContainText('0');
    await expect(counts.getByRole('row', { name: /Vegetarian/ })).toContainText('2');
  });

  test('the answers export asks for a step-up and includes private columns for the owner', async ({
    page,
  }) => {
    const s = await wedding();
    await signIn(page);
    await page.goto(`${console_(s)}/answers`);
    await expect(page.getByText(/including private ones/)).toBeVisible();
    await ageSession(page);
    await page.getByRole('button', { name: 'Export answers (CSV)' }).click();
    await confirmStepUp(page, personaCode());
    await expect(page).toHaveURL(/\?op=/);
    const download = page.getByRole('link', { name: 'Download' });
    await expect(download).toBeVisible();
    const res = await page.request.get((await download.getAttribute('href')) ?? '');
    expect(res.status()).toBe(200);
    const csv = (await res.text()).replace(/^﻿/, '');
    expect(csv.split('\r\n')[0]).toBe(
      'Party,Guest,Age,Ceremony,Reception,Meal,Ceremony: song request,Dietary needs,Accessibility needs',
    );
    expect(csv).toContain('Garcia,Luis López,Adult,No answer,No answer,,');
    await expectAccessibleBothModes(page);
  });

  test('viewers see the questions and counts but cannot edit or export', async ({ page }) => {
    const s = await wedding();
    await signIn(page, VIEWER);
    await page.goto(`${console_(s)}/questions`);
    await expect(page.getByRole('heading', { name: 'RSVP questions', level: 1 })).toBeVisible();
    await expect(page.getByText('You can see the questions but not change them.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Questions' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Add a question' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Publish questions' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add option' })).toHaveCount(0);
    // The preview still works for them.
    await expect(
      page.getByRole('region', { name: 'Preview' }).getByText('Questions shown: 3 of 3'),
    ).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.goto(`${console_(s)}/answers`);
    await expect(page.getByText('Exporting needs a role that may export guest lists.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export answers (CSV)' })).toHaveCount(0);
    // A guessed download address is refused.
    const res = await page.request.get(`${console_(s)}/answers/exports/00000000-0000-7000-8000-000000000000`);
    expect(res.status()).toBe(404);
  });

  test('keyboard only: the host adds a conditional question and publishes; a guest answers', async ({
    page,
  }) => {
    const s = await wedding({ questions: false });
    await signIn(page);
    await page.goto(`${console_(s)}/questions`);
    await page.getByRole('button', { name: 'Add a question' }).focus();
    await page.keyboard.press('Enter');
    const form = page.getByRole('group', { name: 'Add question' });
    await expect(form.getByLabel('Question', { exact: true })).toBeFocused();
    await page.keyboard.type('Need a ride from the hotel?');
    await page.keyboard.press('Tab');
    await expect(form.getByLabel('Answer type')).toBeFocused();
    await pickOption(form.getByLabel('Answer type'), { label: 'Tick box' });
    await form.getByLabel('Only guests who are attending').focus();
    await page.keyboard.press('Space');
    await expect(form.getByLabel('Only guests who are attending')).toBeChecked();
    await form.getByRole('button', { name: 'Add question' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('list', { name: 'Questions' })).toContainText('Need a ride from the hotel?');
    await page.getByRole('button', { name: 'Publish questions' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Published. Guests now see version 1.')).toBeVisible();

    await page.goto(link(s.chen.token));
    await pair(page, 'Mei Chen, Ceremony').getByRole('radio', { name: 'Attending' }).focus();
    await page.keyboard.press('Space');
    const mei = questionsFor(page, 'Mei Chen');
    await expect(mei.getByLabel('Need a ride from the hotel?')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(mei.getByLabel('Need a ride from the hotel?')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(mei.getByLabel('Need a ride from the hotel?')).toBeChecked();
    await page.getByRole('button', { name: 'Send RSVP' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?thanks=1$/);
    await page.goto(link(s.chen.token));
    await expect(questionsFor(page, 'Mei Chen').getByLabel('Need a ride from the hotel?')).toBeChecked();
  });

  test('Arabic: the questions page, the answers page and the RSVP page with questions read right to left', async ({
    page,
  }) => {
    const s = await wedding();
    await page.goto(link(s.garcia.token, '/ar'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // Luis attends the reception: his meal question appears (the choice is the pill around the radio).
    await page
      .locator('label')
      .filter({ has: page.locator(`input[name="a:${s.receptionId}:${s.luis}"][value="attending"]`) })
      .click();
    await expect(page.getByRole('group', { name: 'Reception: meal choice (مطلوب)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'بضعة أسئلة' })).toBeVisible();
    await expect(page.getByText('خاص: لا يراه إلا المضيفون.').first()).toBeVisible();
    await expectAccessibleBothModes(page);

    await signIn(page);
    await page.goto(`/ar${console_(s)}/questions`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'أسئلة تأكيد الحضور', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'معاينة' })).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.goto(`/ar${console_(s)}/answers`);
    await expect(page.getByRole('heading', { name: 'إجابات تأكيد الحضور', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'عدد الوجبات' })).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});
