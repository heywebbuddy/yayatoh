import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

/**
 * M5.7a — live polls and moderated Q&A per session: the moderator console, the participant page
 * (phone first), the presenter view and the big screen behind a signed link, all over the M3.1b
 * realtime publisher.
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
const at = (days: number, hhmm: string) => `${chicagoDate(days)}T${hhmm}`;

interface Live {
  readonly base: string;
  readonly slug: string;
  readonly title: string;
  readonly live: string;
  readonly participant: string;
}

/** A published conference with one session, its polls and Q&A turned on (moderator page open). */
async function liveSession(page: Page, label: string, opts: { enable?: boolean } = {}): Promise<Live> {
  const s = stamp();
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(`${label} ${s}`);
  await page.getByLabel('Event type').selectOption('conference');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(at(40, '09:00'));
  await page.getByLabel('Ends', { exact: true }).fill(at(40, '18:00'));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/sessions`);
  const title = `Keynote ${s}`;
  const add = page.getByRole('region', { name: 'Add session' });
  await add.getByLabel('Session title').fill(title);
  await add.getByLabel('Session starts').fill(at(40, '10:00'));
  await add.getByLabel('Session ends').fill(at(40, '11:00'));
  await add.getByRole('button', { name: 'Add session' }).click();
  await expect(add.getByText('Session added.')).toBeVisible();
  await page.getByRole('link', { name: `Polls and Q&A for ${title}` }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}\/live$/);
  const live = new URL(page.url()).pathname;
  if (opts.enable !== false) {
    await page.getByRole('button', { name: 'Turn on polls and Q&A' }).click();
    await expect(page.getByRole('heading', { name: 'Questions', exact: true })).toBeVisible();
  }
  const sessionId = live.split('/').at(-2) ?? '';
  return {
    base,
    slug: base.split('/').pop() ?? '',
    title,
    live,
    participant: `/events/${base.split('/').pop()}/live/${sessionId}`,
  };
}

async function guest(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function addPoll(page: Page, kind: string, question: string, options: string[] = []) {
  const form = page.getByRole('region', { name: 'New poll' });
  await form.getByLabel('Type').selectOption({ label: kind });
  await form.getByLabel('Question', { exact: true }).fill(question);
  if (options.length) await form.getByLabel('Options').fill(options.join('\n'));
  await form.getByRole('button', { name: 'Add poll' }).click();
  await expect(form.getByText('Poll added as a draft.')).toBeVisible();
}

const modPoll = (page: Page, q: string) => page.locator(`li[data-poll="${q}"]`);
const status = (page: Page, text: string) =>
  page.locator('[data-moderator] > div > p[role="status"]').filter({ hasText: text });

async function ask(p: Page, body: string, opts: { name?: string; anonymous?: boolean } = {}) {
  await p.getByLabel('Your question').fill(body);
  if (opts.anonymous) await p.getByRole('checkbox', { name: 'Ask anonymously' }).check();
  else await p.getByLabel('Your name').fill(opts.name ?? 'Robin');
  await p.getByRole('button', { name: 'Send question' }).click();
  await expect(p.getByText('Thanks! Your question will appear once a moderator approves it.')).toBeVisible();
}

test.describe('live polls and Q&A (M5.7a)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('create and open a poll, vote from two phones, results update live', async ({ page, browser }) => {
    await signIn(page);
    const s = await liveSession(page, 'Live Polls', { enable: false });
    // Off until turned on: the empty state says what to do next.
    await expect(page.getByText('Polls and Q&A are off for this session')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Turn on polls and Q&A' }).click();
    await expect(page.getByText('No polls yet')).toBeVisible();
    await expect(page.getByText('No questions waiting.')).toBeVisible();
    await expect(page.locator('[data-stream-state="live"]').first()).toBeVisible({ timeout: 15_000 });
    await expectAccessible(page);

    // Inline validation of a new poll.
    const form = page.getByRole('region', { name: 'New poll' });
    await form.getByRole('button', { name: 'Add poll' }).click();
    await expect(form.getByText('Enter the question.')).toBeVisible();
    await expect(form.getByText('Enter at least two options, one per line.')).toBeVisible();
    await form.getByLabel('Question', { exact: true }).fill('Which track next?');
    await form.getByLabel('Options').fill('Design\ndesign');
    await form.getByRole('button', { name: 'Add poll' }).click();
    await expect(form.getByText('Each option must be different.')).toBeVisible();
    await form.getByLabel('Options').fill('Design\nData\nOps');
    await form.getByRole('button', { name: 'Add poll' }).click();
    await expect(form.getByText('Poll added as a draft.')).toBeVisible();
    const poll = modPoll(page, 'Which track next?');
    await expect(poll.getByText('Draft')).toBeVisible();

    // A draft is invisible to the audience.
    const phone1 = await guest(browser);
    await phone1.goto(s.participant);
    await expect(phone1.getByRole('heading', { name: s.title })).toBeVisible();
    await expect(phone1.getByText('No poll right now')).toBeVisible();
    await expectAccessible(phone1);

    await poll.getByRole('button', { name: 'Open voting' }).click();
    await expect(status(page, 'Poll open for votes.')).toBeVisible();
    await expect(poll.getByText('On stage')).toBeVisible();
    // Opening reaches the phone live (no reload).
    const card1 = phone1.locator('article[data-poll="Which track next?"]');
    await expect(card1).toBeVisible({ timeout: 10_000 });
    // Server-side and inline validation: nothing chosen.
    await card1.getByRole('button', { name: 'Vote' }).click();
    await expect(card1.getByText('Choose an option.')).toBeVisible();
    await card1.getByRole('radio', { name: 'Data' }).check();
    await card1.getByRole('button', { name: 'Vote' }).click();
    await expect(card1.getByText('Thanks, your vote is in.')).toBeVisible();
    await expect(card1.getByText('Results appear here when the host shows them.')).toBeVisible();
    // The moderator's results move live.
    await expect(poll.locator('[data-result="Data"]')).toHaveAttribute('data-count', '1', {
      timeout: 10_000,
    });

    // A second phone (found from the public agenda), after the host shows the results.
    await poll.getByRole('button', { name: 'Show results' }).click();
    await expect(status(page, 'Results shown.')).toBeVisible();
    const phone2 = await guest(browser);
    await phone2.goto(`/events/${s.slug}`);
    await phone2.getByRole('link', { name: 'Polls and Q&A' }).click();
    await expect(phone2).toHaveURL(new RegExp(`${s.participant}$`));
    const card2 = phone2.locator('article[data-poll="Which track next?"]');
    await card2.getByRole('radio', { name: 'Design' }).check();
    await card2.getByRole('button', { name: 'Vote' }).click();
    await expect(card2.getByText('Thanks, your vote is in.')).toBeVisible();
    // Phone 1 sees the shown results update live: 1 Design, 1 Data.
    await expect(card1.locator('[data-result="Design"]')).toHaveAttribute('data-count', '1', {
      timeout: 10_000,
    });
    await expect(card1.locator('[data-result="Data"]')).toHaveAttribute('data-count', '1');
    await expect(poll.getByText('2 votes')).toBeVisible();
    // One vote per person: after a reload the phone still has voted, no form.
    await phone1.reload();
    await expect(card1.getByText('Thanks, your vote is in.')).toBeVisible();
    await expect(card1.getByRole('button', { name: 'Vote' })).toHaveCount(0);
    // Closing stops the votes everywhere.
    await poll.getByRole('button', { name: 'Close voting' }).click();
    await expect(status(page, 'Voting closed.')).toBeVisible();
    await expect(card2.getByText('Closed')).toBeVisible({ timeout: 10_000 });
    await expectAccessible(phone2);
    await Promise.all([phone1.context().close(), phone2.context().close()]);
  });

  test('a question is moderated onto the big screen, which recovers after a dropped connection', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const s = await liveSession(page, 'Live QA');
    const displayPath = (await page.getByTestId('display-link').getAttribute('href')) ?? '';
    expect(displayPath).toMatch(/^\/display\/.+~.+~1~/);
    // The big screen: no sign-in, a fresh browser.
    const screenContext = await browser.newContext();
    const screen = await screenContext.newPage();
    await screen.goto(displayPath);
    await expect(screen.getByRole('heading', { name: s.title })).toBeVisible();
    await expect(screen.locator('[data-stream-state="live"]')).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByText('Scan the code to ask a question or vote.')).toBeVisible();
    await expect(screen.getByRole('img', { name: /QR code for/ })).toBeVisible();
    await expectAccessible(screen);

    const phone = await guest(browser);
    await phone.goto(s.participant);
    // Validation: empty question, then no name.
    await phone.getByRole('button', { name: 'Send question' }).click();
    await expect(phone.getByText('Write your question.')).toBeVisible();
    await phone.getByLabel('Your question').fill('Will the slides be shared?');
    await phone.getByLabel('Your name').fill('');
    await phone.getByRole('button', { name: 'Send question' }).click();
    await expect(phone.getByText('Enter your name or ask anonymously.')).toBeVisible();
    await ask(phone, 'Will the slides be shared?', { name: 'Robin' });
    // Pending: the moderator sees it live; the audience and the big screen never do.
    const pending = page.locator('[data-queue="pending"] [data-question="Will the slides be shared?"]');
    await expect(pending).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Waiting for review (1)' })).toBeVisible();
    await expect(phone.getByText('No questions yet')).toBeVisible();
    await expect(screen.getByText('Will the slides be shared?')).toHaveCount(0);
    await pending.getByRole('button', { name: 'Approve' }).click();
    await expect(status(page, 'Question approved.')).toBeVisible();
    // Approved: on the phone and the big screen's list, live.
    await expect(
      phone.locator('[data-question="Will the slides be shared?"]').getByText('Robin'),
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(screen.locator('[data-stage-next="Will the slides be shared?"]')).toBeVisible({
      timeout: 10_000,
    });
    // Upvote once.
    const upvote = phone.getByRole('button', { name: 'Upvote (0)' });
    await upvote.click();
    await expect(phone.getByRole('button', { name: 'Upvote (1)' })).toBeDisabled({ timeout: 10_000 });
    await expect(phone.getByRole('button', { name: 'Upvote (1)' })).toHaveAttribute('aria-pressed', 'true');
    const approved = page.locator('[data-queue="approved"] [data-question="Will the slides be shared?"]');
    await expect(approved.getByText('1 upvote')).toBeVisible({ timeout: 10_000 });
    // On stage: the big screen's current question.
    await approved.getByRole('button', { name: 'Put on stage' }).click();
    await expect(status(page, 'Question on stage.')).toBeVisible();
    await expect(screen.locator('[data-stage-question="Will the slides be shared?"]')).toBeVisible({
      timeout: 10_000,
    });

    // A dropped connection: the screen goes offline, the server drops every stream, and a
    // question is approved meanwhile. Back online, the screen catches up with nothing missed.
    await ask(phone, 'Is there a recording?', { name: 'Sam' });
    const second = page.locator('[data-queue="pending"] [data-question="Is there a recording?"]');
    await expect(second).toBeVisible({ timeout: 10_000 });
    await screenContext.setOffline(true);
    expect((await page.request.post('/api/dev/seat-streams')).ok()).toBe(true);
    await expect(screen.locator('[data-stream-state="live"]')).toHaveCount(0, { timeout: 15_000 });
    await second.getByRole('button', { name: 'Approve' }).click();
    await expect(status(page, 'Question approved.')).toBeVisible();
    await screenContext.setOffline(false);
    await expect(screen.locator('[data-stream-state="live"]')).toBeVisible({ timeout: 45_000 });
    await expect(screen.locator('[data-stage-next="Is there a recording?"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(screen.locator('[data-stage-question="Will the slides be shared?"]')).toBeVisible();

    // High contrast and reduced motion, by keyboard, and still accessible.
    const contrast = screen.getByRole('button', { name: 'High contrast' });
    await contrast.focus();
    await screen.keyboard.press('Enter');
    await expect(contrast).toHaveAttribute('aria-pressed', 'true');
    await expect(screen.locator('main[data-contrast="high"]')).toBeVisible();
    const motion = screen.getByRole('button', { name: 'Reduced motion' });
    await motion.focus();
    await screen.keyboard.press('Space');
    await expect(screen.locator('main[data-motion="reduced"]')).toBeVisible();
    await expectAccessible(screen);
    // The modes can also start from the link (a projector without a keyboard).
    await screen.goto(`${displayPath}?contrast=high&motion=reduced`);
    await expect(screen.locator('main[data-contrast="high"][data-motion="reduced"]')).toBeVisible();

    // Replacing the link revokes the old one.
    await page.getByRole('button', { name: 'Replace the link' }).click();
    await page.getByRole('button', { name: 'Replace it (old links stop working)' }).click();
    await expect(status(page, 'New big-screen link ready. Old links stopped working.')).toBeVisible();
    await expect(page.getByTestId('display-link')).not.toHaveAttribute('href', displayPath);
    expect((await screen.goto(displayPath))?.status()).toBe(404);
    await Promise.all([screenContext.close(), phone.context().close()]);
  });

  test('anonymous questions never show a name to the audience; moderators only by policy', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const s = await liveSession(page, 'Live Anon');
    const phone = await guest(browser);
    await phone.goto(s.participant);
    await phone.getByLabel('Your question').fill('Is the budget final?');
    await phone.getByRole('checkbox', { name: 'Ask anonymously' }).check();
    await expect(phone.getByLabel('Your name')).toHaveCount(0);
    // (The default policy keeps no name behind an anonymous question, so none is asked for.)
    await expect(phone.getByText("Your name won't be shown to the audience.")).toBeVisible();
    await phone.getByRole('button', { name: 'Send question' }).click();
    await expect(
      phone.getByText('Thanks! Your question will appear once a moderator approves it.'),
    ).toBeVisible();
    const q = page.locator('[data-queue="pending"] [data-question="Is the budget final?"]');
    await expect(q).toBeVisible({ timeout: 10_000 });
    await expect(q.getByText('Anonymous to the audience')).toBeVisible();
    await expect(q.getByText(/^Anonymous ·/)).toBeVisible();
    await q.getByRole('button', { name: 'Approve' }).click();
    const pub = phone.locator('[data-question="Is the budget final?"]');
    await expect(pub.getByText('Anonymous', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Policy "moderators can see them": the moderator sees the name, the audience still doesn't.
    const settings = page.getByRole('region', { name: 'Settings' });
    await settings
      .getByLabel('Names behind anonymous questions')
      .selectOption({ label: 'Moderators can see them' });
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings.getByText('Settings saved.')).toBeVisible();
    await phone.reload();
    await phone.getByLabel('Your question').fill('Who chose the venue?');
    await phone.getByRole('checkbox', { name: 'Ask anonymously' }).check();
    // Askers are told the moderators will see their name.
    await expect(phone.getByText("The audience won't see your name; the moderators will.")).toBeVisible();
    await phone.getByLabel('Your name').fill('Quinn Private');
    await phone.getByRole('button', { name: 'Send question' }).click();
    await expect(
      phone.getByText('Thanks! Your question will appear once a moderator approves it.'),
    ).toBeVisible();
    const named = page.locator('[data-queue="pending"] [data-question="Who chose the venue?"]');
    await expect(named.getByText(/Quinn Private/)).toBeVisible({ timeout: 10_000 });
    await named.getByRole('button', { name: 'Approve' }).click();
    await expect(phone.locator('[data-question="Who chose the venue?"]')).toBeVisible({ timeout: 10_000 });
    await expect(phone.getByText('Quinn Private')).toHaveCount(0);
    // Anonymous questions turned off: the checkbox goes away for new visitors.
    await settings.getByRole('checkbox', { name: 'Allow anonymous questions' }).uncheck();
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings.getByText('Settings saved.')).toBeVisible();
    await expect(phone.getByRole('checkbox', { name: 'Ask anonymously' })).toHaveCount(0, {
      timeout: 10_000,
    });
    await phone.context().close();
  });

  test('keyboard only: a rating poll, a question, moderation; axe and Arabic RTL', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const s = await liveSession(page, 'Live Keys');
    await addPoll(page, 'Rating', 'How useful was this?');
    const poll = modPoll(page, 'How useful was this?');
    const open = poll.getByRole('button', { name: 'Open voting' });
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(status(page, 'Poll open for votes.')).toBeVisible();

    const phone = await guest(browser);
    await phone.goto(s.participant);
    const card = phone.locator('article[data-poll="How useful was this?"]');
    await expect(card).toBeVisible();
    await card.getByRole('radio', { name: '4' }).focus();
    await phone.keyboard.press('Space');
    await expect(card.getByRole('radio', { name: '4' })).toBeChecked();
    await card.getByRole('button', { name: 'Vote' }).focus();
    await phone.keyboard.press('Enter');
    await expect(card.getByText('Thanks, your vote is in.')).toBeVisible();
    await expect(poll.locator('[data-result="4"]')).toHaveAttribute('data-count', '1', { timeout: 10_000 });
    await expect(poll.getByText('Average 4.0')).toBeVisible();
    // A question typed and sent by keyboard.
    await phone.getByLabel('Your question').focus();
    await phone.keyboard.type('Keyboard question?');
    await phone.keyboard.press('Tab');
    await phone.keyboard.type('Kai');
    await phone.getByRole('button', { name: 'Send question' }).focus();
    await phone.keyboard.press('Enter');
    await expect(
      phone.getByText('Thanks! Your question will appear once a moderator approves it.'),
    ).toBeVisible();
    const q = page.locator('[data-queue="pending"] [data-question="Keyboard question?"]');
    await expect(q).toBeVisible({ timeout: 10_000 });
    await q.getByRole('button', { name: 'Approve' }).focus();
    await page.keyboard.press('Enter');
    await expect(status(page, 'Question approved.')).toBeVisible();
    const a = page.locator('[data-queue="approved"] [data-question="Keyboard question?"]');
    await a.getByRole('button', { name: 'Mark answered' }).focus();
    await page.keyboard.press('Enter');
    await expect(status(page, 'Marked answered.')).toBeVisible();
    await expect(phone.locator('[data-question="Keyboard question?"]').getByText('Answered')).toBeVisible({
      timeout: 10_000,
    });
    // The presenter view: the poll on stage with its results (hidden from the audience).
    await page.getByRole('link', { name: 'Presenter view' }).click();
    await expect(
      page.locator('[data-stage="presenter"] [data-stage-poll="How useful was this?"]'),
    ).toBeVisible();
    await expect(page.getByText('Results are hidden from the audience.')).toBeVisible();
    await expectAccessible(page);

    // Arabic, right to left: the participant page, the console and the big screen.
    await phone.goto(`/ar${s.participant}`);
    await expect(phone.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(phone.getByRole('heading', { name: 'الاستطلاعات' })).toBeVisible();
    await expectAccessible(phone);
    await page.goto(`/ar${s.live}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الأسئلة', exact: true })).toBeVisible();
    await expectAccessible(page);
    const display = (await page.getByTestId('display-link').getAttribute('href')) ?? '';
    await phone.goto(display.startsWith('/ar/') ? display : `/ar${display}`);
    await expect(phone.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(phone.getByRole('button', { name: 'تباين عالٍ' })).toBeVisible();
    await expectAccessible(phone);
    await phone.context().close();
  });

  test('a viewer can follow but not moderate; other orgs and the public cannot attach', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const s = await liveSession(page, 'Live Viewer');
    const stream = (await page.locator('[data-moderator]').getAttribute('data-stream')) ?? '';
    expect(stream).toMatch(/^\/api\/realtime\/org/);
    const phone = await guest(browser);
    await phone.goto(s.participant);
    await ask(phone, 'Viewer can see this?', { name: 'Vee' });

    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(s.live);
    await expect(viewer.getByText('You can follow along. Only editors can moderate.')).toBeVisible();
    await expect(viewer.locator('[data-question="Viewer can see this?"]')).toBeVisible();
    // No moderation controls, no poll form, no big-screen link, settings read-only.
    await expect(viewer.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(viewer.getByRole('region', { name: 'New poll' })).toHaveCount(0);
    await expect(viewer.getByTestId('display-link')).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Save settings' })).toHaveCount(0);
    await expect(viewer.getByRole('checkbox', { name: 'Take questions' })).toBeDisabled();
    await expectAccessible(viewer);
    // The viewer's own stream works (members who read events), live.
    await expect(viewer.locator('[data-stream-state="live"]')).toBeVisible({ timeout: 15_000 });
    // Their sessions page has no "Turn on" for a session that is off either.
    await viewer.goto(`${s.base}/sessions`);
    await expect(viewer.getByRole('link', { name: `Polls and Q&A for ${s.title}` })).toBeVisible();

    // The moderation channel: 401 for the public, 403 for another org's member; the public
    // channel of the same session is open to anyone (approved questions only).
    const anon = await guest(browser);
    await anon.goto('/');
    const peek = (p: Page, url: string) =>
      p.evaluate(async (u) => {
        const ctrl = new AbortController();
        const res = await fetch(u, { signal: ctrl.signal });
        let text = '';
        if (res.ok && res.body) {
          const reader = res.body.getReader();
          const deadline = Date.now() + 5_000;
          while (!text.includes('event: ') && Date.now() < deadline) {
            const { value, done } = await reader.read();
            if (done) break;
            text += new TextDecoder().decode(value);
          }
        }
        ctrl.abort();
        return { status: res.status, text };
      }, url);
    expect((await peek(anon, stream)).status).toBe(401);
    const publicStream = stream.replace(/moderation$/, 'live');
    const open = await peek(anon, publicStream);
    expect(open.status).toBe(200);
    expect(open.text).toContain('event: snapshot');
    expect(open.text).not.toContain('Viewer can see this?');
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await signIn(other, 'lee@harbor.test');
    await other.goto('/o/harbor-arts');
    expect((await peek(other, stream)).status).toBe(403);
    // A forged big-screen link is a 404, page and stream alike.
    const forged = `${s.participant.split('/').at(-1)}~x`;
    expect((await anon.goto(`/display/${forged}`))?.status()).toBe(404);
    expect((await peek(anon, `/api/engagement/display/${forged}`)).status).toBe(404);
    await Promise.all([
      viewerContext.close(),
      otherContext.close(),
      anon.context().close(),
      phone.context().close(),
    ]);
  });
});
