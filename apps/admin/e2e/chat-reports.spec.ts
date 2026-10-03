import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, signInStaff, WEB, webPage } from './helpers.ts';

/**
 * M5.8b: networking chat reports reach Yayatoh's review (M1.10d). On the web, two attendees
 * connect and chat, and one reports the chat; staff then see it in the console's reports page
 * (an excerpt labelled by side, never names or addresses), a note is required, they resolve it
 * from the keyboard, it moves to the closed list, and the cross-org read is in the access log.
 */
const OWNER = 'pani@lakeside.test';
const TZ = 'America/Chicago';

function chicagoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}

async function lastEmailedCode(page: Page, email: string): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(async () => {
      const res = await page.request.get(`${WEB}/api/dev/last-code?to=${encodeURIComponent(email)}`);
      code = ((await res.json()) as { code: string | null }).code;
      return code;
    })
    .toMatch(/^\d{6}$/);
  return code ?? '';
}

/** An attendee's own browser on the web app, signed in to networking and opted in. */
async function attendee(browser: Browser, network: string, email: string, name: string): Promise<Page> {
  const p = await webPage(browser);
  await p.goto(network);
  await p.getByLabel('Your email', { exact: true }).fill(email);
  await p.getByRole('button', { name: 'Email me a code' }).click();
  await p.getByLabel('Verification code', { exact: true }).fill(await lastEmailedCode(p, email));
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.getByLabel('Name shown to others').fill(name);
  await p.getByRole('checkbox', { name: /^Show my profile to other attendees/ }).check();
  await p.getByRole('button', { name: 'Join networking' }).click();
  await expect(p.getByRole('navigation', { name: 'Networking sections' })).toBeVisible();
  return p;
}

test('staff review a networking chat report: excerpt by side, a note is required, resolve, closed list, access log', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
  const [ana, ben] = [`Ana ${stamp}`, `Ben ${stamp}`];
  const mail = (n: string) => `${n.toLowerCase().replace(/\W+/g, '.')}@example.test`;

  // On the web: the organizer runs a conference with networking on and two attendees.
  const web = await webPage(browser);
  const login = await web.request.post('/api/dev/login', {
    form: { email: OWNER, locale: 'en' },
    maxRedirects: 0,
  });
  expect(login.status()).toBe(303);
  await web.goto('/o/lakeside-events/events/new');
  await web.getByLabel('Event name', { exact: true }).fill(`Chat review ${stamp}`);
  await web.getByLabel('Event type').selectOption('conference');
  await web.getByLabel('Time zone').selectOption(TZ);
  await web.getByLabel('Starts', { exact: true }).fill(`${chicagoDate(40)}T09:00`);
  await web.getByLabel('Ends', { exact: true }).fill(`${chicagoDate(40)}T18:00`);
  await web.getByRole('button', { name: 'Create draft' }).click();
  await expect(web).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(web.url()).pathname;
  await web.getByRole('button', { name: 'Publish' }).click();
  await expect(web.getByText('Published ·')).toBeVisible();
  await web.goto(`${base}/networking`);
  await web.getByRole('button', { name: 'Turn on networking' }).click();
  await expect(web.getByText('People in the directory')).toBeVisible();
  await web.goto(`${base}/attendees`);
  await web
    .getByText(/^Add (attendee|guest)/i)
    .first()
    .click();
  for (const n of [ana, ben]) {
    await web.getByLabel('Full name').fill(n);
    await web.getByLabel('Email', { exact: true }).fill(mail(n));
    await web.getByRole('button', { name: 'Add to the list' }).click();
    await expect(web.getByRole('row').filter({ hasText: n })).toBeVisible();
  }
  const network = `/events/${base.split('/').pop()}/network`;
  const a = await attendee(browser, network, mail(ana), ana);
  const b = await attendee(browser, network, mail(ben), ben);

  // They connect, Ana writes, and Ben reports the chat.
  await a.reload();
  await a.getByRole('list', { name: 'People' }).getByRole('link', { name: ben }).click();
  await a.getByRole('button', { name: 'Send connection request' }).click();
  await expect(a.getByText(`Request sent to ${ben}.`)).toBeVisible();
  await b.goto(`${network}/connections`);
  await b.getByRole('button', { name: `Accept the request from ${ana}` }).click();
  await expect(b.getByText(`You're now connected with ${ana}.`)).toBeVisible();
  await a.goto(`${network}/connections`);
  await a.getByRole('link', { name: `Message ${ben}` }).click();
  await a.getByRole('textbox', { name: 'Message' }).fill(`Buy my course ${stamp}`);
  await a.getByRole('button', { name: 'Send' }).click();
  await expect(a.getByRole('log').getByText(`Buy my course ${stamp}`)).toBeVisible();
  await b.goto(`${network}/connections`);
  await b.getByRole('link', { name: `Message ${ana}` }).click();
  await expect(b.getByRole('log').getByText(`Buy my course ${stamp}`)).toBeVisible();
  await b.getByText(`Block or report ${ana}`).click();
  await b.getByLabel('Reason').selectOption({ label: 'Spam or unwanted selling' });
  await b.getByLabel('What happened').fill(`Selling ${stamp}`);
  await b.getByRole('button', { name: `Report ${ana}` }).click();
  await expect(b).toHaveURL(/\/network\/chat\?notice=reported$/);

  // Staff: the chat report with its excerpt labelled by side; no names or addresses.
  await signInStaff(page);
  await page.goto('/reports');
  const section = page.getByRole('region', { name: 'Networking chat reports' });
  const card = section.getByRole('article').filter({ hasText: `Selling ${stamp}` });
  await expect(
    card.getByRole('heading', { name: 'Lakeside Events · Attendee chat · Spam or unwanted selling' }),
  ).toBeVisible();
  await expect(card).toContainText('Reported by the attendee');
  await expect(card).toContainText('Organizer: not handled yet');
  const excerpt = card.getByRole('region', { name: 'Conversation excerpt' });
  await expect(excerpt).toContainText('Reported side');
  await expect(excerpt).toContainText(`Buy my course ${stamp}`);
  await expect(card).not.toContainText(ana);
  await expect(card).not.toContainText(ben);
  await expect(card).not.toContainText('@example.test');
  await expectAccessible(page);

  // A note is required; then resolve from the keyboard.
  await card.getByRole('button', { name: 'Resolve' }).click();
  const again = section.getByRole('article').filter({ hasText: `Selling ${stamp}` });
  await expect(again.getByText('Add a note before resolving or dismissing a report.')).toBeVisible();
  await expect(again.getByLabel('Note (kept in the audit log)')).toHaveAttribute('aria-invalid', 'true');
  await again.getByLabel('Note (kept in the audit log)').fill(`Warned the attendee ${stamp}`);
  await page.keyboard.press('Tab');
  await expect(again.getByRole('button', { name: 'Resolve' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Report resolved.')).toBeVisible();
  await expect(section.getByRole('article').filter({ hasText: `Selling ${stamp}` })).toHaveCount(0);

  await page.getByRole('link', { name: 'Closed' }).click();
  const closed = page
    .getByRole('region', { name: 'Networking chat reports' })
    .getByRole('article')
    .filter({ hasText: `Selling ${stamp}` });
  await expect(closed).toContainText('Resolved');
  await expect(closed).toContainText(`Warned the attendee ${stamp}`);
  await expect(closed.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
  await expectAccessible(page);

  await page.getByRole('link', { name: 'Access log' }).click();
  await expect(
    page.getByRole('cell', { name: 'staff console: networking chat reports (open)' }).first(),
  ).toBeVisible();
});
