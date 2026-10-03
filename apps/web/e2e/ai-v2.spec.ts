import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  lastEmailedCode,
  ownClientIp,
  pickOption,
  pickWithKeyboard,
  signIn,
  WEDDING_OWNER,
} from './helpers.ts';
import { addGuests } from './seating-helpers.ts';

/**
 * M6.12b — AI v2: brand kits; "Draft with AI" for campaigns, site pages and agendas with a tone
 * and a brand kit (previews only: nothing is saved, sent or published by AI); audience
 * suggestions reviewed in the builder before saving; matchmaking suggestions for opted-in
 * networking profiles. Keyboard only, axe in light and dark, Arabic RTL. The AI provider is the
 * deterministic fake (dev/CI).
 */
const VIEWER = 'jordan@lakeside.test';
const FINANCE = 'fran@lakeside.test';
const ORG = '/o/lakeside-events';
const TZ = 'America/Chicago';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;
const chicagoDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
const at = (days: number, hhmm: string) => `${chicagoDate(days)}T${hhmm}`;

/** Dev/CI only: set an org's AI credit balance (an audited adjustment). */
async function setCredits(request: APIRequestContext, org: string, balance: number) {
  const res = await request.post('/api/dev/ai-credits', { form: { org, balance: String(balance) } });
  expect(res.status()).toBe(200);
}

const aiRegion = (page: Page, name: string | RegExp) => page.getByRole('region', { name });
const aiPreview = (page: Page) => page.getByRole('region', { name: 'AI draft' });

/** Add a brand kit from the Brand kits page (keyboard only); returns its name. */
async function addKit(page: Page, name: string, keywords: string) {
  await page.goto(`${ORG}/brand-kits`);
  const form = aiRegion(page, 'New brand kit');
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Brand voice').fill('Warm, local, never pushy.');
  await pickWithKeyboard(form.getByLabel('Default tone'), { label: 'Playful' });
  await form.getByLabel('Words to use').fill(keywords);
  await form.getByLabel('Words to avoid').fill('cheap');
  await form.getByRole('button', { name: 'Add brand kit' }).press('Enter');
  await expect(form.getByText('Brand kit added.')).toBeVisible();
  return name;
}

test.describe('AI v2 (M6.12b)', () => {
  test.describe.configure({ timeout: 300_000 });
  test.beforeEach(async ({ request }) => {
    // Reruns and parallel projects share the org: start every test with plenty of credits.
    await setCredits(request, 'lakeside-events', 500);
  });

  test('brand kits: add with validation, edit, default, persistence; read-only for viewers; axe; RTL', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    // Reached from the grouped navigation (Site → Brand kits).
    await page.goto(ORG);
    // Below 1024 px the sidebar is a drawer behind the menu button.
    const drawer = page.locator('header details').first();
    if (
      (page.viewportSize()?.width ?? 1280) < 1024 &&
      !(await drawer.evaluate((d: HTMLDetailsElement) => d.open))
    )
      await drawer.locator('> summary').click();
    const nav = page
      .getByRole('navigation')
      .filter({ has: page.locator('details[data-nav-section]') })
      .filter({ visible: true });
    await nav.getByRole('link', { name: 'Brand kits', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${ORG}/brand-kits$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Brand kits' })).toBeVisible();
    await expect(page.getByTestId('ai-credits')).toContainText('AI credits left this month');
    const form = aiRegion(page, 'New brand kit');
    // Validation: a name is required; more than 12 words is refused.
    await form.getByLabel('Words to use').fill(Array.from({ length: 13 }, (_, i) => `w${i}`).join(', '));
    await form.getByRole('button', { name: 'Add brand kit' }).click();
    await expect(form.getByText('Enter a name of 1 to 60 characters.')).toBeVisible();
    await expect(form.getByLabel('Name', { exact: true })).toBeFocused();
    await form.getByLabel('Name', { exact: true }).fill(`Lake voice ${s}`);
    await form.getByRole('button', { name: 'Add brand kit' }).click();
    await expect(form.getByText('Use at most 12 words of up to 40 characters each.')).toBeVisible();
    await expectAccessibleBothModes(page);
    await form.getByLabel('Words to use').fill('lakeside, together');
    await form.getByRole('checkbox', { name: 'Use this kit by default' }).check();
    await form.getByRole('button', { name: 'Add brand kit' }).click();
    await expect(form.getByText('Brand kit added.')).toBeVisible();
    const card = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: `Lake voice ${s}` }) });
    await expect(card.getByText('Default', { exact: true })).toBeVisible();
    await expect(card.getByText('Words to use: lakeside, together')).toBeVisible();
    // The same name again is refused.
    await form.getByLabel('Name', { exact: true }).fill(`LAKE VOICE ${s}`);
    await form.getByRole('button', { name: 'Add brand kit' }).click();
    await expect(form.getByText('Another brand kit already has this name.')).toBeVisible();
    // Edit (keyboard: the disclosure opens with Enter).
    await card.getByText(`Edit Lake voice ${s}`).focus();
    await page.keyboard.press('Enter');
    await card.getByLabel('Brand voice').fill('Calm and clear.');
    await card.getByRole('button', { name: 'Save changes' }).click();
    await expect(card.getByText('Brand kit saved.')).toBeVisible();
    await page.reload();
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: `Lake voice ${s}` })
        .locator('p', { hasText: 'Calm and clear.' }),
    ).toBeVisible();
    await expectAccessible(page);

    // Arabic, right to left.
    await page.goto(`/ar${ORG}/brand-kits`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'هويات العلامة' })).toBeVisible();
    await expectAccessible(page);

    // A viewer reads but can't change; nothing to submit.
    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${ORG}/brand-kits`);
    await expect(viewer.getByText('You can see brand kits; ask an owner')).toBeVisible();
    await expect(viewer.getByRole('region', { name: 'New brand kit' })).toHaveCount(0);
    await expect(viewer.getByText(`Edit Lake voice ${s}`)).toHaveCount(0);
    await ctx.close();
  });

  test('campaign: draft with a brand kit and a tone, use it, save; nothing sent; out of credits; finance refused', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const kit = await addKit(page, `Gala kit ${s}`, `sparkling${s.slice(-4)}, evening`);
    await page.goto(`${ORG}/campaigns`);
    const field = page.getByLabel('Name', { exact: true });
    await field.fill(`AI spring ${s}`);
    await field.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: `AI spring ${s}` })).toBeVisible();
    const ai = aiRegion(page, 'Draft with AI');
    await expect(ai.getByText('nothing is sent until you send it', { exact: false })).toBeVisible();
    await expectAccessibleBothModes(page);

    // Keyboard only: tone, kit, brief, then Enter on the draft button.
    await pickWithKeyboard(ai.getByLabel('Brand kit'), { label: kit });
    await pickWithKeyboard(ai.getByLabel('Tone', { exact: true }), { label: 'Urgent' });
    await ai.getByLabel('What is this email about?').focus();
    await page.keyboard.type('Early-bird tickets end Friday');
    await ai.getByRole('button', { name: 'Draft with AI' }).focus();
    await page.keyboard.press('Enter');
    const preview = aiPreview(page);
    await expect(preview).toBeFocused();
    await expect(preview.getByTestId('ai-subject')).toHaveText('Last chance: Lakeside Events');
    await expect(preview.getByTestId('ai-heading')).toHaveText(`Lakeside Events, sparkling${s.slice(-4)}`);
    await expect(preview.getByText('About this message: Early-bird tickets end Friday')).toBeVisible();
    await expectAccessible(page);
    await preview.getByRole('button', { name: 'Use this draft' }).press('Enter');
    await expect(ai.getByText('Draft placed in the editor. Review it, then save.')).toBeVisible();
    const editor = page.getByRole('form', { name: 'Campaign content' });
    await expect(editor.getByLabel('Subject', { exact: true })).toHaveValue('Last chance: Lakeside Events');
    // Still editable: the organizer changes the subject and saves; nothing was sent.
    await editor.getByLabel('Subject', { exact: true }).fill(`Last chance, friends ${s}`);
    await editor
      .getByRole('group', { name: /Footer$/ })
      .getByLabel('Postal address')
      .fill('1 Lake St, Chicago IL');
    await editor.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved.')).toBeVisible();
    await page.reload();
    await expect(editor.getByLabel('Subject', { exact: true })).toHaveValue(`Last chance, friends ${s}`);
    await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();

    // Discard leaves the editor untouched.
    await ai.getByLabel('What is this email about?').fill('Another idea');
    await ai.getByRole('button', { name: 'Draft with AI' }).click();
    await aiPreview(page).getByRole('button', { name: 'Discard' }).click();
    await expect(ai.getByText('Draft discarded. Nothing changed.')).toBeVisible();
    await expect(editor.getByLabel('Subject', { exact: true })).toHaveValue(`Last chance, friends ${s}`);

    // Arabic, right to left.
    await page.goto(`/ar${new URL(page.url()).pathname}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('region', { name: 'صياغة بالذكاء الاصطناعي' })).toBeVisible();
    await expectAccessible(page);

    // Finance can read campaigns but never gets the AI panel.
    const campaign = new URL(page.url()).pathname.replace(/^\/ar/, '');
    const ctx = await browser.newContext();
    const fin = await ctx.newPage();
    await signIn(fin, FINANCE);
    await fin.goto(campaign);
    await expect(fin.getByRole('region', { name: 'Draft with AI' })).toHaveCount(0);
    await ctx.close();
  });

  test('audience: suggestion reviewed in the builder, then saved; validation; viewers get no panel; RTL', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    await page.goto(`${ORG}/audiences`);
    const ai = aiRegion(page, 'Suggest an audience with AI');
    await expect(ai.getByRole('combobox', { name: 'Tone' })).toHaveCount(0);
    // A brief is required.
    await ai.getByRole('button', { name: 'Suggest an audience' }).click();
    await expect(ai.getByText('Describe what you want in a few words.')).toBeVisible();
    await expect(ai.getByLabel('Who do you want to reach?')).toBeFocused();
    await expectAccessibleBothModes(page);
    await page.keyboard.type(
      'People who registered for the Midwest Leadership Summit 2027 and get our email',
    );
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const preview = aiPreview(page);
    await expect(preview).toBeFocused();
    await expect(preview.getByTestId('ai-audience-explanation')).toContainText('People who registered for');
    await expect(preview.getByTestId('ai-audience-count')).toHaveText(
      /people match|person matches|No one matches/,
    );
    await expect(preview.getByText('2 rules — review them in the builder.')).toBeVisible();
    await expectAccessible(page);
    await preview.getByRole('link', { name: 'Review in the builder' }).press('Enter');
    await expect(page).toHaveURL(/\/audiences\/new\?suggestion=/);
    await expect(
      page.getByText('Suggested by AI: check every rule before you save this audience.'),
    ).toBeVisible();
    await expect(page.getByTestId('audience-count')).toBeVisible();
    await expectAccessible(page);
    // Accept: name it and save it in the builder.
    await page.getByLabel('Audience name').fill(`AI summit fans ${s}`);
    await page.getByRole('button', { name: 'Save audience' }).click();
    await expect(page.getByText('Audience saved.')).toBeVisible();
    await page.goto(`${ORG}/audiences`);
    await expect(page.getByRole('row', { name: new RegExp(`AI summit fans ${s}`) })).toBeVisible();

    // A tampered suggestion is refused, never applied.
    await page.goto(`${ORG}/audiences/new?suggestion=not-a-definition`);
    await expect(
      page.getByRole('alert').filter({ hasText: 'This suggestion could not be opened.' }),
    ).toBeVisible();

    // Arabic, right to left.
    await page.goto(`/ar${ORG}/audiences`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('region', { name: 'اقتراح جمهور بالذكاء الاصطناعي' })).toBeVisible();
    await expectAccessible(page);

    // A viewer (no messages:read) never reaches audiences, nor their AI suggestions.
    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${ORG}/audiences`);
    await expect(viewer.getByText('Page not found')).toBeVisible();
    await expect(viewer.getByRole('region', { name: 'Suggest an audience with AI' })).toHaveCount(0);
    await ctx.close();
  });

  test('site page: draft with AI becomes an unpublished draft entry; agenda: pick proposed sessions; RTL', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    await page.goto(`${ORG}/content/new?kind=page`);
    const ai = aiRegion(page, 'Draft with AI');
    await ai.getByLabel('What should the page cover?').fill(`Visiting the lake ${s}`);
    await ai.getByRole('button', { name: 'Draft with AI' }).click();
    const preview = aiPreview(page);
    await expect(preview).toBeFocused();
    await expect(preview.getByTestId('ai-page-title')).toHaveText(`Visiting the lake ${s}`);
    await expectAccessibleBothModes(page);
    await preview.getByRole('button', { name: 'Create draft from this' }).click();
    await expect(page).toHaveURL(/\/content\/[0-9a-f-]{36}\?created=1$/);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(`Visiting the lake ${s}`);
    await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();

    // Agenda: a fresh event; the proposals land inside its dates, in its time zone.
    await page.goto(`${ORG}/events/new`);
    await page.getByLabel('Event name', { exact: true }).fill(`AI agenda ${s}`);
    await pickOption(page.getByLabel('Event type'), 'conference');
    await pickOption(page.getByLabel('Time zone'), TZ);
    await page.getByLabel('Starts', { exact: true }).fill(at(45, '09:00'));
    await page.getByLabel('Ends', { exact: true }).fill(at(45, '17:00'));
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
    const base = new URL(page.url()).pathname;
    await page.goto(`${base}/sessions`);
    const agenda = aiRegion(page, 'Draft an agenda with AI');
    await agenda.getByLabel('Topics or session ideas').fill('Welcome, Keynote, Workshops');
    await pickWithKeyboard(agenda.getByLabel('How many sessions'), '3');
    await agenda.getByRole('button', { name: 'Draft with AI' }).click();
    const list = aiPreview(page).getByTestId('ai-agenda');
    await expect(list.getByRole('checkbox')).toHaveCount(3);
    await expect(list.getByRole('checkbox', { name: /^Welcome — .*9:00/ })).toBeChecked();
    await expectAccessibleBothModes(page);
    // Keep two of three (keyboard: Space toggles).
    await list.getByRole('checkbox', { name: /^Workshops/ }).focus();
    await page.keyboard.press('Space');
    await expect(list.getByRole('checkbox', { name: /^Workshops/ })).not.toBeChecked();
    await aiPreview(page).getByRole('button', { name: 'Add 2 sessions' }).click();
    await expect(agenda.getByText('2 sessions added to the agenda.')).toBeVisible();
    await page.reload();
    const sessions = page.getByRole('region', { name: 'Agenda' });
    await expect(sessions.getByText('Welcome', { exact: true })).toBeVisible();
    await expect(sessions.getByText('Keynote', { exact: true })).toBeVisible();
    await expect(sessions.getByText('Workshops', { exact: true })).toHaveCount(0);
    await page.goto(`/ar${base}/sessions`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('region', { name: 'صياغة برنامج بالذكاء الاصطناعي' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar${ORG}/content/new?kind=page`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
  });

  test('out of credits: a clear state and the draft button is off (an org kept at zero)', async ({
    page,
    request,
  }) => {
    // Rosewood stays at zero for the M1.4f spec too: no race with the specs that top Lakeside up.
    await setCredits(request, 'rosewood-weddings', 0);
    await signIn(page, WEDDING_OWNER);
    await page.goto('/o/rosewood-weddings/content/new?kind=page');
    const ai = aiRegion(page, 'Draft with AI');
    await expect(ai.getByText("You're out of AI credits")).toBeVisible();
    await expect(ai.getByTestId('ai-credits')).toHaveText(
      'No AI credits left this month (free allowance: 20).',
    );
    await expect(ai.getByRole('button', { name: 'Draft with AI' })).toBeDisabled();
    await expectAccessibleBothModes(page);
  });

  test('matchmaking: suggestions for opted-in people only; opting out drops them; keyboard; axe; RTL', async ({
    page,
    browser,
  }) => {
    const tag = stamp();
    await signIn(page);
    await page.goto(`${ORG}/events/new`);
    await page.getByLabel('Event name', { exact: true }).fill(`Match ${tag}`);
    await pickOption(page.getByLabel('Event type'), 'conference');
    await pickOption(page.getByLabel('Time zone'), TZ);
    await page.getByLabel('Starts', { exact: true }).fill(at(40, '09:00'));
    await page.getByLabel('Ends', { exact: true }).fill(at(40, '18:00'));
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
    const base = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    const slug = base.split('/').pop() ?? '';
    const network = `/events/${slug}/network`;
    await page.goto(`${base}/networking`);
    await page.getByRole('button', { name: 'Turn on networking' }).click();
    await expect(page.getByText('People in the directory', { exact: true })).toBeVisible();
    const [ana, ben, cy, dee] = ['Ana', 'Ben', 'Cy', 'Dee'].map((n) => `${n} Match ${tag}`) as [
      string,
      string,
      string,
      string,
    ];
    await addGuests(page, base, [ana, ben, cy, dee]);
    const emailOf = (name: string) => `${name.toLowerCase().replace(/\W+/g, '.')}@example.test`;

    async function attendee(b: Browser, name: string, interests: string | null): Promise<Page> {
      const context = await b.newContext();
      await ownClientIp(context);
      const p = await context.newPage();
      await p.goto(network);
      await p.getByLabel('Your email', { exact: true }).fill(emailOf(name));
      await p.getByRole('button', { name: 'Email me a code' }).click();
      await p.getByLabel('Verification code', { exact: true }).fill(await lastEmailedCode(p, emailOf(name)));
      await p.getByRole('button', { name: 'Sign in', exact: true }).click();
      if (interests !== null) {
        await expect(p.getByRole('heading', { name: 'Create your networking profile' })).toBeVisible();
        await p.getByLabel('Name shown to others').fill(name);
        await p.getByLabel('Interests').fill(interests);
        await p.getByRole('checkbox', { name: /^Show my profile to other attendees/ }).check();
        await p.getByRole('button', { name: 'Join networking' }).click();
        await expect(p.getByRole('navigation', { name: 'Networking sections' })).toBeVisible();
      }
      return p;
    }
    const a = await attendee(browser, ana, 'Data, AI, Analytics');
    const b = await attendee(browser, ben, 'AI, Data science');
    const c = await attendee(browser, cy, 'Pottery, Ceramics');
    // Dee signs in but never opts in.
    const d = await attendee(browser, dee, null);
    await expect(d.getByRole('heading', { name: 'Create your networking profile' })).toBeVisible();
    // Before the organizer updates suggestions, none are shown.
    await a.reload();
    await expect(a.getByRole('region', { name: 'Suggested for you' })).toHaveCount(0);

    // The organizer prepares suggestions (keyboard).
    await page.goto(`${base}/networking`);
    const card = page.getByRole('region', { name: 'Match suggestions' });
    await expect(card.getByTestId('matchmaking-status')).toHaveText(
      'Suggestions ready for 0 of 3 listed people.',
    );
    await expectAccessibleBothModes(page);
    await card.getByRole('button', { name: 'Update suggestions (3 people waiting)' }).focus();
    await page.keyboard.press('Enter');
    await expect(card.getByText('Suggestions ready for 3 more people.')).toBeVisible();
    await expect(card.getByTestId('matchmaking-status')).toHaveText(
      'Suggestions ready for 3 of 3 listed people.',
    );
    await expect(card.getByRole('button', { name: 'Suggestions are up to date' })).toBeDisabled();

    // Ana sees Ben first (shared interests), and never Dee (not opted in).
    await a.reload();
    const suggested = a.getByRole('list', { name: 'Suggested matches' });
    await expect(suggested.getByRole('listitem').first()).toContainText(ben);
    await expect(suggested.getByRole('listitem').first()).toContainText('You both like: AI');
    await expect(suggested).not.toContainText(dee);
    await expectAccessibleBothModes(a);
    // Keyboard: the suggestion links to the person.
    await suggested.getByRole('link', { name: ben }).focus();
    await a.keyboard.press('Enter');
    await expect(a).toHaveURL(new RegExp(`${network}/people/[0-9a-f-]{36}$`));
    await expect(a.getByRole('heading', { name: ben }).first()).toBeVisible();

    // Cy opts out: gone from Ana's suggestions at once.
    await c.goto(`${network}/profile`);
    await c.getByRole('button', { name: 'Leave networking' }).click();
    await expect(c.getByText("You're not in the directory")).toBeVisible();
    await a.goto(network);
    await expect(a.getByRole('list', { name: 'Suggested matches' })).not.toContainText(cy);
    await page.reload();
    await expect(card.getByTestId('matchmaking-status')).toHaveText(
      'Suggestions ready for 2 of 2 listed people.',
    );

    // Arabic, right to left (attendee and console).
    await a.goto(`/ar${network}`);
    await expect(a.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(a.getByRole('heading', { name: 'مقترحون لك' })).toBeVisible();
    await expectAccessible(a);
    await page.goto(`/ar${base}/networking`);
    await expect(page.getByRole('region', { name: 'اقتراحات التعارف' })).toBeVisible();
    await expectAccessible(page);

    // A viewer sees the status but can't update.
    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/networking`);
    const vcard = viewer.getByRole('region', { name: 'Match suggestions' });
    await expect(vcard.getByTestId('matchmaking-status')).toBeVisible();
    await expect(vcard.getByRole('button')).toHaveCount(0);
    for (const p of [a, b, c, d]) await p.context().close();
    await ctx.close();
  });
});
