import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  lastEmailedCode,
  ownClientIp,
  signIn,
} from './helpers.ts';
import { addGuests } from './seating-helpers.ts';

/**
 * M5.8b — networking chat (P5-3): 1:1 chat only between connections (or meeting partners), live
 * over the realtime port; a blocked person's messages never deliver; reports reach the
 * organizer's console with an excerpt (remove a message, hide, suspend, lift); booth chat between
 * attendees and an exhibitor's portal people; the inbox streams refuse anyone else's channel and
 * the generic realtime route refuses chat channels (cross-org attach denied). Phone first,
 * keyboard only, axe in light and dark, Arabic RTL.
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

interface Conf {
  readonly base: string;
  readonly slug: string;
  readonly console: string;
  readonly network: string;
  readonly tag: string;
}

/** A published conference with networking on (as the Lakeside owner), and exhibitors if named. */
async function conference(page: Page, label: string, exhibitors: string[] = []): Promise<Conf> {
  const tag = stamp();
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(`${label} ${tag}`);
  await page.getByLabel('Event type').selectOption('conference');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(at(40, '09:00'));
  await page.getByLabel('Ends', { exact: true }).fill(at(40, '18:00'));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  const slug = base.split('/').pop() ?? '';
  const conf = { base, slug, console: `${base}/networking`, network: `/events/${slug}/network`, tag };
  await page.goto(conf.console);
  await page.getByRole('button', { name: 'Turn on networking' }).click();
  await expect(page.getByText('People in the directory')).toBeVisible();
  if (exhibitors.length) {
    await page.goto(`${base}/exhibitors`);
    for (const x of exhibitors) {
      const add = page.getByRole('region', { name: 'Add exhibitor' });
      await add.getByLabel('Exhibitor name').fill(x);
      await add.getByRole('button', { name: 'Add exhibitor' }).click();
      await expect(add.getByText('Exhibitor added.')).toBeVisible();
    }
    // Each exhibitor at its own booth.
    await page.goto(`${base}/exhibitors`);
    await page.getByRole('link', { name: 'Booths and floor plan' }).click();
    for (const [i, x] of exhibitors.entries()) {
      const add = page.getByRole('region', { name: 'Add booth' });
      await add.getByLabel('Booth number').fill(`C${i + 1}`);
      await add.getByLabel('From the left wall (m)').fill(String(i * 5));
      await add.getByRole('button', { name: 'Add booth' }).click();
      await expect(add.getByText('Booth added.')).toBeVisible();
      const assign = page.getByRole('region', { name: 'Assign a booth' });
      await assign.getByLabel('Booth', { exact: true }).selectOption({ label: `C${i + 1}` });
      await assign.getByLabel('Exhibitor', { exact: true }).selectOption({ label: x });
      await assign.getByRole('button', { name: 'Assign' }).click();
      await expect(assign.getByText('Assigned.')).toBeVisible();
    }
  }
  return conf;
}

const emailOf = (name: string) => `${name.toLowerCase().replace(/\W+/g, '.')}@example.test`;

/** A fresh browser (its own client IP) signed in to the event's networking with the emailed code. */
async function attendee(browser: Browser, conf: Conf, email: string): Promise<Page> {
  const context = await browser.newContext();
  await ownClientIp(context);
  const p = await context.newPage();
  await p.goto(conf.network);
  await p.getByLabel('Your email', { exact: true }).fill(email);
  await p.getByRole('button', { name: 'Email me a code' }).click();
  await p.getByLabel('Verification code', { exact: true }).fill(await lastEmailedCode(p, email));
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  return p;
}

async function optIn(p: Page, name: string) {
  await expect(p.getByRole('heading', { name: 'Create your networking profile' })).toBeVisible();
  await p.getByLabel('Name shown to others').fill(name);
  await p.getByRole('checkbox', { name: /^Show my profile to other attendees/ }).check();
  await p.getByRole('button', { name: 'Join networking' }).click();
  await expect(p.getByRole('navigation', { name: 'Networking sections' })).toBeVisible();
}

const tab = (p: Page, name: string) =>
  p
    .getByRole('navigation', { name: 'Networking sections' })
    .getByRole('link', { name: new RegExp(`^${name}`) });

const people = (p: Page) => p.getByRole('list', { name: 'People' });

/** Ask to connect from the directory and accept on the other side. */
async function connect(a: Page, b: Page, aName: string, bName: string) {
  await a.reload();
  await people(a).getByRole('link', { name: bName }).click();
  await a.getByRole('button', { name: 'Send connection request' }).click();
  await expect(a.getByText(`Request sent to ${bName}.`)).toBeVisible();
  await tab(b, 'Connections').click();
  await b.getByRole('button', { name: `Accept the request from ${aName}` }).click();
  await expect(b.getByText(`You're now connected with ${aName}.`)).toBeVisible();
}

const log = (p: Page, name: string) => p.getByRole('log', { name: `Messages with ${name}` });

/** Wait until a chat page follows its inbox stream. */
const live = (p: Page) =>
  expect(p.getByText('New messages appear here as they arrive.')).toBeVisible({ timeout: 15_000 });

/** Status and content type of a stream URL, without waiting for the stream to end. */
async function streamHead(p: Page, url: string): Promise<[number, string]> {
  return p.evaluate(async (u) => {
    const ctrl = new AbortController();
    const r = await fetch(u, { signal: ctrl.signal });
    const out: [number, string] = [r.status, r.headers.get('content-type') ?? ''];
    ctrl.abort();
    return out;
  }, url);
}

test.describe('networking chat (M5.8b)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('chat between unconnected people is refused; connections chat live, by keyboard; axe; RTL', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const conf = await conference(page, 'Chat Direct');
    const names = ['Ana', 'Ben', 'Cleo'].map((n) => `${n} ${conf.tag}`);
    const [ana = '', ben = '', cleo = ''] = names;
    await addGuests(page, conf.base, names);
    const [a, b, c] = await Promise.all(names.map((n) => attendee(browser, conf, emailOf(n))));
    if (!a || !b || !c) throw new Error('attendees');
    for (const [p, n] of [
      [a, ana],
      [b, ben],
      [c, cleo],
    ] as const)
      await optIn(p, n);

    // The Chats tab: nothing yet, with what to do next.
    await tab(a, 'Chats').click();
    await expect(a.getByRole('heading', { name: 'Chats', level: 1 })).toBeVisible();
    await expect(a.getByText('No chats yet')).toBeVisible();
    await expect(a.getByRole('link', { name: 'Go to your connections' })).toBeVisible();
    await expect(a.getByText('No exhibitor is taking chats right now.')).toBeVisible();
    await expectAccessibleBothModes(a);

    // Unconnected: the chat page says why and offers no message box.
    await a.goto(conf.network);
    const benHref = (await people(a).getByRole('link', { name: ben }).getAttribute('href')) ?? '';
    const benId = benHref.split('/').pop() ?? '';
    await a.goto(`${conf.network}/chat/${benId}`);
    await expect(a.getByRole('heading', { name: `Chat with ${ben}`, level: 1 })).toBeVisible();
    await expect(
      a.getByText(`You can message ${ben} once you're connected or have agreed a meeting.`),
    ).toBeVisible();
    await expect(a.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
    await expectAccessible(a);

    // Connected: Ben opens the chat from Ana's profile, Ana from her connections.
    await connect(a, b, ana, ben);
    await b.goto(conf.network);
    await people(b).getByRole('link', { name: ana }).click();
    await b.getByRole('link', { name: `Send ${ana} a message` }).click();
    await expect(b.getByRole('heading', { name: `Chat with ${ana}`, level: 1 })).toBeVisible();
    await expect(b.getByText(`No messages yet. Say hello to ${ana}.`)).toBeVisible();
    await live(b);
    await tab(a, 'Connections').click();
    await a.getByRole('link', { name: `Message ${ben}` }).click();
    await expect(a.getByRole('heading', { name: `Chat with ${ben}`, level: 1 })).toBeVisible();
    await live(a);
    await expectAccessibleBothModes(a);

    // Inline validation: nothing to send.
    const box = b.getByRole('textbox', { name: 'Message' });
    await box.focus();
    await b.keyboard.press('Enter');
    await expect(b.getByText('Write a message first.')).toBeVisible();
    // Keyboard only: type and press Enter. Ana's open page gets it without a reload.
    await b.keyboard.type('Hi Ana, coffee at the break?');
    await b.keyboard.press('Enter');
    await expect(log(b, ana).getByText('Hi Ana, coffee at the break?')).toBeVisible();
    await expect(box).toHaveValue('');
    await expect(log(a, ben).getByText('Hi Ana, coffee at the break?')).toBeVisible();
    // Shift+Enter starts a new line; the reply arrives live on Ben's side.
    const reply = a.getByRole('textbox', { name: 'Message' });
    await reply.focus();
    await a.keyboard.type('Sure!');
    await a.keyboard.press('Shift+Enter');
    await a.keyboard.type('See you at 10:30.');
    await a.getByRole('button', { name: 'Send' }).click();
    await expect(log(b, ana).getByText(/Sure!\s+See you at 10:30\./)).toBeVisible();
    await expect(log(a, ben).locator('[data-chat-message="mine"]')).toHaveCount(1);
    await expect(log(a, ben).locator('[data-chat-message="theirs"]')).toHaveCount(1);
    // Persisted: a reload shows both, in order.
    await a.reload();
    await expect(log(a, ben).getByRole('listitem')).toHaveCount(2);
    await expect(log(a, ben).getByRole('listitem').first()).toContainText('Hi Ana, coffee at the break?');

    // Unread: Ben's chat list counts Ana's chat once she writes, live.
    await b.goto(`${conf.network}/chat`);
    await expect(b.getByRole('link', { name: ana })).toBeVisible();
    await a.getByRole('textbox', { name: 'Message' }).fill('One more thing');
    await a.getByRole('button', { name: 'Send' }).click();
    await expect(log(a, ben).getByText('One more thing')).toBeVisible();
    await expect(b.getByText('1 unread message')).toBeVisible({ timeout: 15_000 });
    await expect(tab(b, 'Chats')).toContainText('1');
    await expect(b.getByText('One more thing')).toBeVisible();
    await expectAccessibleBothModes(b);
    await b.getByRole('link', { name: ana }).click();
    await expect(log(b, ana).getByText('One more thing')).toBeVisible();
    await b.goto(`${conf.network}/chat`);
    await expect(b.getByText('1 unread message')).toHaveCount(0);

    // Cleo, connected to no one, still can't write to Ben.
    await c.goto(`${conf.network}/chat/${benId}`);
    await expect(c.getByText(`You can message ${ben} once you're connected`, { exact: false })).toBeVisible();
    await expect(c.getByRole('textbox', { name: 'Message' })).toHaveCount(0);

    // Arabic, right to left.
    await a.goto(`/ar${conf.network}/chat/${benId}`);
    await expect(a.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(a.getByRole('textbox')).toBeVisible();
    await expectAccessible(a);
    await a.goto(`/ar${conf.network}/chat`);
    await expect(a.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(a);
  });

  test("a blocked person's messages never deliver; a report reaches the organizer, who hides; viewers read only", async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const conf = await conference(page, 'Chat Safety');
    const names = ['Ana', 'Ben'].map((n) => `${n} ${conf.tag}`);
    const [ana = '', ben = ''] = names;
    await addGuests(page, conf.base, names);
    const [a, b] = await Promise.all(names.map((n) => attendee(browser, conf, emailOf(n))));
    if (!a || !b) throw new Error('attendees');
    await optIn(a, ana);
    await optIn(b, ben);
    await connect(a, b, ana, ben);
    await tab(a, 'Connections').click();
    await a.getByRole('link', { name: `Message ${ben}` }).click();
    await a.getByRole('textbox', { name: 'Message' }).fill('Buy my course today');
    await a.getByRole('button', { name: 'Send' }).click();
    await expect(log(a, ben).getByText('Buy my course today')).toBeVisible();
    await tab(b, 'Chats').click();
    await b.getByRole('link', { name: ana }).click();
    await expect(log(b, ana).getByText('Buy my course today')).toBeVisible();

    // Ben reports the chat: a reason is needed, then it blocks Ana too.
    await b.getByText(`Block or report ${ana}`).click();
    await b.getByRole('button', { name: `Report ${ana}` }).click();
    await expect(b.getByText('Choose a reason.')).toBeVisible();
    await b.getByLabel('Reason').selectOption({ label: 'Spam or unwanted selling' });
    await b.getByLabel('What happened').fill('Selling in every message.');
    await expectAccessible(b);
    await b.getByRole('button', { name: `Report ${ana}` }).click();
    await expect(b).toHaveURL(/\/network\/chat\?notice=reported$/);
    await expect(b.getByText('Thanks for telling us.', { exact: false })).toBeVisible();
    await expect(b.getByRole('link', { name: ana })).toHaveCount(0);

    // Ana's open page: her next message is refused, and nothing reaches Ben.
    await a.getByRole('textbox', { name: 'Message' }).fill('Hello??');
    await a.getByRole('button', { name: 'Send' }).click();
    await expect(
      a.getByRole('alert').filter({ hasText: "This person isn't available for chat any more." }),
    ).toBeVisible();
    await a.goto(`${conf.network}/chat`);
    await expect(a.getByText('No chats yet')).toBeVisible();

    // The organizer's console: the report with the latest messages; viewers can't act.
    await page.goto(conf.console);
    const chat = page.getByRole('region', { name: 'Chat', exact: true });
    const reports = chat.getByRole('list', { name: 'Open chat reports' });
    await expect(reports.getByText(`${ben} reported their chat with ${ana}`)).toBeVisible();
    await expect(reports.getByText('Selling in every message.')).toBeVisible();
    await expect(reports.getByText('Buy my course today')).toBeVisible();
    await expect(chat.getByText('Open chat reports', { exact: true })).toBeVisible();
    await expectAccessibleBothModes(page);
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(conf.console);
    const vchat = viewer.getByRole('region', { name: 'Chat', exact: true });
    await expect(vchat.getByText('Buy my course today')).toBeVisible();
    await expect(vchat.getByRole('button')).toHaveCount(0);
    await expectAccessible(viewer);

    // Remove the message (keyboard), then hide Ana.
    await chat.getByRole('button', { name: /^Remove the message from / }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Message removed. Neither side sees it any more.')).toBeVisible();
    await expect(chat.getByText('Message removed', { exact: true })).toBeVisible();
    await page.reload();
    await expect(chat.getByText('Buy my course today')).toHaveCount(0);
    await chat.getByRole('button', { name: `Hide ${ana} from networking` }).click();
    await expect(page.getByText(`${ana} is hidden from networking.`)).toBeVisible();
    await expect(chat.getByText('No chat reports to review.')).toBeVisible();
    await chat.getByText('1 handled chat report').click();
    await expect(chat.getByText('Acted on')).toBeVisible();
    await a.goto(conf.network);
    await expect(a.getByText('Your profile was hidden by the organizer')).toBeVisible();

    // The organizer can switch chat off: attendees are told, and the chat list says so.
    await page.getByRole('checkbox', { name: /^Chat between connections/ }).uncheck();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expect(chat.getByText('Chat is off. Turn it on in the settings above.')).toBeVisible();
    await b.goto(`${conf.network}/chat`);
    await expect(b.getByText('The organizer has turned chat off for this event.')).toBeVisible();
  });

  test('booth chat: the exhibitor takes chats in the portal, answers live, blocks; the organizer suspends and lifts', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await signIn(page);
    const tag = stamp();
    const acme = `Acme ${tag}`;
    const conf = await conference(page, 'Chat Booth', [acme]);
    const ana = `Ana ${conf.tag}`;
    await addGuests(page, conf.base, [ana]);

    // The organizer invites Acme's admin and staff; the admin signs in with the emailed code.
    await page.goto(`${conf.base}/exhibitors`);
    await page.getByRole('link', { name: 'Portal and staff' }).click();
    const admin = `admin-${tag}@acme.test`;
    await page.getByText(`Invite someone to ${acme}`).click();
    const invite = page
      .locator('form')
      .filter({ has: page.getByRole('combobox', { name: 'Role' }) })
      .first();
    await invite.getByLabel('Email').fill(admin);
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    await expect(invite.getByText('Invitation sent.')).toBeVisible();
    const link = await portalLink(page, admin);
    const x = await (await browser.newContext()).newPage();
    await ownClientIp(x.context());
    await x.goto(link);
    await x.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await x.getByLabel('Verification code', { exact: true }).fill(await lastEmailedCode(x, admin));
    await x.getByLabel('Verification code', { exact: true }).press('Enter');
    await expect(x).toHaveURL(/\/event-portal$/);

    // Off by default: the portal says so; the attendee sees no booth to chat with.
    const boothChat = x.getByRole('region', { name: 'Booth chat' });
    await expect(boothChat.getByText('Not taking chats')).toBeVisible();
    const a = await attendee(browser, conf, emailOf(ana));
    await optIn(a, ana);
    await tab(a, 'Chats').click();
    await expect(a.getByText('No exhibitor is taking chats right now.')).toBeVisible();

    // The admin turns it on from the keyboard.
    await boothChat.getByRole('link', { name: 'Open booth chat' }).click();
    await expect(x.getByRole('heading', { name: 'Booth chat', level: 1 })).toBeVisible();
    await expect(x.getByText('Turn booth chat on so visitors can write to you.')).toBeVisible();
    await expectAccessibleBothModes(x);
    await x.getByRole('button', { name: 'Take chats at our booth' }).focus();
    await x.keyboard.press('Enter');
    await expect(x.getByText('Taking chats')).toBeVisible();
    await expect(x.getByText('When visitors write to your booth, their messages appear here.')).toBeVisible();

    // Ana finds the booth and writes; the booth's open inbox shows her at once.
    await a.reload();
    await a.getByRole('link', { name: `Chat with ${acme}` }).click();
    await expect(a.getByRole('heading', { name: `Chat with ${acme}`, level: 1 })).toBeVisible();
    await expect(a.getByText('Booth C1')).toBeVisible();
    await live(a);
    await expectAccessibleBothModes(a);
    await a.getByRole('textbox', { name: 'Message' }).fill('Do you ship to Canada?');
    await a.getByRole('textbox', { name: 'Message' }).press('Enter');
    await expect(log(a, acme).getByText('Do you ship to Canada?')).toBeVisible();
    await expect(x.getByRole('link', { name: ana })).toBeVisible({ timeout: 15_000 });
    await expect(x.getByText('1 unread message')).toBeVisible();
    await x.getByRole('link', { name: ana }).click();
    await expect(x.getByRole('heading', { name: ana, level: 1 })).toBeVisible();
    await live(x);
    await expectAccessible(x);
    await x.getByRole('textbox', { name: 'Message' }).fill('We do, in 3 days.');
    await x.getByRole('button', { name: 'Send' }).click();
    await expect(log(a, acme).getByText('We do, in 3 days.')).toBeVisible();

    // The booth blocks Ana: her messages stop; unblocking lets her write again.
    await x.getByText(`Block or report ${ana}`).click();
    await x.getByRole('button', { name: `Block ${ana}` }).click();
    await expect(x.getByText(`You blocked ${ana}. Unblock them below to answer.`)).toBeVisible();
    await a.getByRole('textbox', { name: 'Message' }).fill('Hello?');
    await a.getByRole('button', { name: 'Send' }).click();
    await expect(a.getByRole('alert').filter({ hasText: 'This chat is blocked.' })).toBeVisible();
    await a.reload();
    await expect(a.getByText('This chat is blocked.')).toBeVisible();
    await expect(a.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
    // The disclosure may still be open after the page re-read.
    const unblock = x.getByRole('button', { name: `Unblock ${ana}` });
    if (!(await unblock.isVisible())) await x.getByText(`Block or report ${ana}`).click();
    await unblock.click();
    await expect(x.getByRole('textbox', { name: 'Message' })).toBeVisible();

    // Ana reports the booth's chat; the organizer removes the message and suspends the booth.
    await a.reload();
    await a.getByText(`Block or report ${acme}`).click();
    await a.getByLabel('Reason').selectOption({ label: 'Inappropriate content' });
    await a.getByRole('button', { name: `Report and block ${acme}` }).click();
    await expect(a).toHaveURL(/\/network\/chat\?notice=reported$/);
    await page.goto(conf.console);
    const chat = page.getByRole('region', { name: 'Chat', exact: true });
    await expect(chat.getByText(`${ana} reported their booth chat with ${acme}`)).toBeVisible();
    await chat
      .getByRole('button', { name: /^Remove the message from / })
      .last()
      .click();
    await expect(page.getByText('Message removed. Neither side sees it any more.')).toBeVisible();
    await chat.getByRole('button', { name: `Suspend ${acme}'s booth chat` }).click();
    await expect(page.getByText(`${acme}'s booth chat is suspended.`)).toBeVisible();
    await expect(chat.getByText(acme, { exact: true })).toBeVisible();
    // Both sides see the removed message as removed.
    await a.goto(`${conf.network}/chat`);
    await a.getByRole('link', { name: acme }).click();
    await expect(log(a, acme).getByText('Message removed by the organizer')).toBeVisible();
    await expect(log(a, acme).getByText('We do, in 3 days.')).toHaveCount(0);
    await x.goto('/event-portal/chat');
    await expect(x.getByText('The organizer suspended your booth chat after a report.')).toBeVisible();
    await expect(x.getByText('Not taking chats')).toBeVisible();
    // Lifted: the booth takes chats again.
    await chat.getByRole('button', { name: `Lift the suspension of ${acme}'s booth chat` }).click();
    await expect(page.getByText(`${acme} can take chats again.`)).toBeVisible();
    await x.reload();
    await expect(x.getByText('Taking chats')).toBeVisible();

    // Arabic, right to left (the portal's booth chat).
    await x.goto('/ar/event-portal/chat');
    await expect(x.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(x);
  });

  test('inbox streams: only your own inbox; another org’s chat channel is never attached', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const conf = await conference(page, 'Chat Streams');
    const ana = `Ana ${conf.tag}`;
    await addGuests(page, conf.base, [ana]);
    const a = await attendee(browser, conf, emailOf(ana));
    await optIn(a, ana);
    const stream = `${conf.network}/chat/stream`;
    // Signed in and opted in: her own inbox streams.
    const [ok, type] = await streamHead(a, stream);
    expect(ok).toBe(200);
    expect(type).toContain('text/event-stream');
    // Naming any other channel is refused: another org's, another person's, garbage.
    const other = '0190f000-0000-7000-8000-00000000000f';
    const foreign = `org:${other}:event:${other}:inbox:${other}:chat`;
    expect((await streamHead(a, `${stream}?channel=${encodeURIComponent(foreign)}`))[0]).toBe(403);
    expect((await streamHead(a, `${stream}?channel=nope`))[0]).toBe(403);
    // Someone with no session there has no inbox.
    const anon = await (await browser.newContext()).newPage();
    await anon.goto('/');
    expect((await streamHead(anon, stream))[0]).toBe(404);
    // The generic realtime route never attaches a chat inbox: not for the org's own owner, not
    // for anyone signed out (another org's channel included).
    expect((await streamHead(page, `/api/realtime/${encodeURIComponent(foreign)}`))[0]).toBe(403);
    expect((await streamHead(anon, `/api/realtime/${encodeURIComponent(foreign)}`))[0]).toBe(401);
    // The exhibitor portal's booth stream needs a portal session.
    expect((await streamHead(anon, '/event-portal/chat/stream'))[0]).toBe(404);
    expect((await streamHead(a, '/event-portal/chat/stream'))[0]).toBe(404);
  });
});

async function drain(page: Page) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org: 'lakeside-events' } });
  expect(res.status()).toBe(200);
}

type Mail = { subject: string; text: string };
async function invitations(page: Page, email: string): Promise<Mail[]> {
  const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
  return ((await res.json()) as Mail[]).filter((m) => /portal/.test(m.subject) && /invite/.test(m.text));
}

/** The invitation link in the newest portal invitation to an address (as M5.4a's spec). */
async function portalLink(page: Page, email: string) {
  let link = '';
  await expect
    .poll(
      async () => {
        if ((await invitations(page, email)).length === 0) await drain(page);
        const list = await invitations(page, email);
        link =
          (list[0]?.text.match(/https?:\/\/[^\s]+/g) ?? []).find((u) => /\/event-portal\/invite\//.test(u)) ??
          '';
        return link !== '';
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return new URL(link).pathname;
}
