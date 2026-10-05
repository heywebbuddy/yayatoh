import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, expectHtmlAccessible, newUser } from './helpers.ts';

/**
 * M6.9b — Zoom and CE credits through the real UI: an owner gives sessions credit rules (every
 * validation message), calculates (idempotent on a second run), and the attendee receives the
 * certificate (dev mailbox, PDF, order page link, public verification); a Zoom webinar is linked
 * on the stream setup page and its registrants and attendance sync through the fake Zoom; the
 * viewer is read-only; keyboard only; axe in both themes; Arabic RTL (page and certificate).
 * Attendance (door scans, watch time) is recorded at past times by `/api/dev/ce` through the real
 * commands; each test runs in an org of its own.
 */
test.describe.configure({ timeout: 150_000 });

const stamp = () => `${Date.now().toString(36)}${test.info().project.name.split('-')[0]}`;

interface Fixture {
  readonly slug: string;
  readonly orgId: string;
  readonly path: string;
  readonly sessions: { id: string; title: string }[];
  readonly people: { name: string; email: string; token: string }[];
}
interface Captured {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** A new owner (signed in on `page`) and the dev CE conference in their org. */
async function conference(page: Page): Promise<{ org: string; f: Fixture }> {
  // `event: 'published'` also accepts the terms, which publishing the CE conference needs.
  const owner = await newUser(page, {
    org: true,
    twoFactor: true,
    event: 'published',
    profile: 'conference',
  });
  const org = owner.orgSlug as string;
  const res = await page.request.post('/api/dev/ce', { form: { org, name: `CE Summit ${stamp()}` } });
  expect(res.ok()).toBe(true);
  return { org, f: (await res.json()) as Fixture };
}

const ana = (f: Fixture) => f.people[0] as Fixture['people'][number];
const ben = (f: Fixture) => f.people[1] as Fixture['people'][number];
const ruleForm = (page: Page, title: string) => page.getByRole('form', { name: `Credit rule for ${title}` });

async function saveRule(
  page: Page,
  title: string,
  rule: { credits: string; minutes: string; inPerson: boolean; online: boolean },
) {
  const form = ruleForm(page, title);
  await form.getByLabel('Credits', { exact: true }).fill(rule.credits);
  await form.getByLabel('Minimum minutes').fill(rule.minutes);
  await form.getByLabel('In person (door scans)').setChecked(rule.inPerson);
  await form.getByLabel('Online (watch time and Zoom)').setChecked(rule.online);
  await form.getByRole('button', { name: `Save the credit rule for ${title}` }).click();
}

/** Press Calculate and wait for its summary to say `expected`. */
async function calculate(page: Page, ...expected: string[]) {
  await page.getByRole('button', { name: 'Calculate credits and issue certificates' }).click();
  await expect(page.getByText('Credits calculated.')).toBeVisible();
  for (const e of expected) await expect(page.getByTestId('ce-result')).toContainText(e);
}

/** Deliver the org's pending messages (the worker's job) and read one person's certificate mail. */
async function certificateMail(page: Page, org: string, to: string): Promise<Captured> {
  let mail: Captured | undefined;
  await expect
    .poll(async () => {
      expect((await page.request.post('/api/dev/outbox/drain', { form: { org } })).ok()).toBe(true);
      const list = (await (
        await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`)
      ).json()) as Captured[];
      mail = list.find((m) => /certificate from/.test(m.subject));
      return Boolean(mail);
    })
    .toBe(true);
  return mail as Captured;
}

const linkIn = (html: string) => {
  const m = /href="https?:\/\/[^"/]+((?:\/[a-z]{2}(?:-[A-Z]{2})?)?\/certificates\/[^"]+)"/.exec(html);
  return m?.[1]?.replace(/&amp;/g, '&') ?? '';
};

async function guest(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

test('an owner sets CE rules and calculates; the attendee receives, downloads and verifies the certificate', async ({
  page,
  browser,
}) => {
  const { org, f } = await conference(page);
  await page.goto(`${f.path}/ce-credits`);
  await expect(page.getByRole('heading', { name: 'CE credits', level: 1 })).toBeVisible();
  // In the event's navigation (collapsed behind the menu on phones and tablets).
  await expect(page.locator(`a[href$="${f.path}/ce-credits"]`).first()).toBeAttached();
  // Nothing to calculate before a rule; the empty certificates state says what to do next.
  await expect(page.getByText('Give at least one session a credit rule below first.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calculate credits and issue certificates' })).toBeDisabled();
  await expect(page.getByText('No certificates yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to Issue certificates' })).toBeVisible();
  await expectAccessibleBothModes(page);

  // Certificate details: too long is refused, then saved.
  const details = page.getByRole('form', { name: 'Certificate details' });
  await details.getByLabel('Credit name').fill('x'.repeat(61));
  await details.getByRole('button', { name: 'Save certificate details' }).click();
  await expect(details.getByText('Use 60 characters or fewer.')).toBeVisible();
  await details.getByLabel('Credit name').fill('CPE credits');
  await details.getByLabel('Accrediting body').fill('Harbor Board of Accountancy');
  await details.getByRole('button', { name: 'Save certificate details' }).click();
  await expect(page.getByText('Certificate details saved.')).toBeVisible();

  // Every validation message of a rule, then valid rules.
  await saveRule(page, 'Morning keynote', { credits: 'abc', minutes: '0', inPerson: false, online: false });
  const keynote = ruleForm(page, 'Morning keynote');
  await expect(keynote.getByText('Enter credits from 0.01 to 100, with up to two decimals.')).toBeVisible();
  await expect(keynote.getByText('Enter whole minutes from 1 to 1440.')).toBeVisible();
  await expect(keynote.getByText('Choose at least one kind of attendance.')).toBeVisible();
  await expect(keynote.getByText('Check the fields marked below.')).toBeVisible();
  await expectAccessible(page);
  await saveRule(page, 'Morning keynote', { credits: '1.5', minutes: '45', inPerson: true, online: false });
  await expect(page.getByText('Credit rule saved for Morning keynote.')).toBeVisible();
  await saveRule(page, 'Clinical update', { credits: '1', minutes: '10', inPerson: false, online: true });
  await expect(page.getByText('Credit rule saved for Clinical update.')).toBeVisible();

  // Calculate: Ana (50 minutes in the room, 15 online) gets 2.5; Ben (20 minutes) nothing.
  await calculate(
    page,
    'New certificates: 1. Revised: 0. Withdrawn: 0. Unchanged: 0.',
    'Attendees below every minimum: 1.',
  );
  await page.reload();
  const table = page.getByRole('table', { name: 'Certificates' });
  const row = table.getByRole('row').filter({ hasText: ana(f).name });
  await expect(row).toContainText('2.5 CPE credits');
  await expect(row).toContainText('Issued · revision 1');
  await expect(table.getByRole('row').filter({ hasText: ben(f).name })).toHaveCount(0);
  const code = ((await row.getByRole('cell').nth(2).textContent()) ?? '').trim();
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  // Persisted rules after reload.
  await expect(ruleForm(page, 'Morning keynote').getByLabel('Minimum minutes')).toHaveValue('45');
  await expect(ruleForm(page, 'Clinical update').getByLabel('In person (door scans)')).not.toBeChecked();
  const hostPdf = await row
    .getByRole('link', { name: `Download the certificate of ${ana(f).name}` })
    .getAttribute('href');
  const pdf = await page.request.get(hostPdf ?? '');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  await expectAccessibleBothModes(page);
  // Calculating again changes nothing.
  await calculate(page, 'New certificates: 0. Revised: 0. Withdrawn: 0. Unchanged: 1.');

  // Ana's email: the certificate as text and the PDF link (the holder only).
  const mail = await certificateMail(page, org, ana(f).email);
  expect(mail.text).toContain('This certifies that Ana Lovelace');
  expect(mail.text).toContain('and earned 2.5 CPE credits.');
  expect(mail.text).toContain(`Verification code: ${code}`);
  await expectHtmlAccessible(page, mail.html);
  const link = linkIn(mail.html);
  expect(link).toMatch(/^\/certificates\/[0-9a-f-]{36}\/[0-9a-f-]{36}~/);
  const a = await guest(browser);
  const doc = await a.request.get(link);
  expect(doc.status()).toBe(200);
  expect(doc.headers()['content-type']).toBe('application/pdf');
  expect(doc.headers()['cache-control']).toContain('no-store');
  expect((await doc.body()).subarray(0, 5).toString()).toBe('%PDF-');
  expect((await a.request.get(`${link.slice(0, -4)}xxxx`)).status()).toBe(404);
  // The HTML alternative of the same document.
  await a.goto(`${link}?format=html`);
  await expect(a.getByRole('heading', { name: 'Certificate of attendance', level: 1 })).toBeVisible();
  await expect(a.getByRole('row', { name: /Morning keynote/ })).toContainText('50');
  await expectAccessible(a);
  // The order page links to it; Ben's does not.
  await a.goto(`/orders/${ana(f).token}`);
  const download = a.getByRole('link', { name: /Download the CE certificate of ticket/ });
  await expect(download).toBeVisible();
  expect((await a.request.get((await download.getAttribute('href')) ?? '')).status()).toBe(200);
  await expectAccessible(a);
  const b = await guest(browser);
  await b.goto(`/orders/${ben(f).token}`);
  await expect(b.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(b.getByRole('link', { name: /CE certificate/ })).toHaveCount(0);

  // Anyone with the certificate verifies its code: valid, a masked name, never the address.
  await b.goto(`/certificates/${f.orgId}/verify`);
  await expect(b.getByRole('heading', { name: 'Verify a certificate', level: 1 })).toBeVisible();
  await b.getByLabel('Verification code').fill('nope');
  await b.getByRole('button', { name: 'Check certificate' }).click();
  await expect(b.getByText('That is not a verification code. Check it and try again.')).toBeVisible();
  await expectAccessible(b);
  await b.getByLabel('Verification code').fill(code.toLowerCase().replace('-', ' '));
  await b.getByRole('button', { name: 'Check certificate' }).click();
  await expect(b).toHaveURL(new RegExp(`/certificates/${f.orgId}/verify/${code}$`));
  await expect(b.getByText('Valid', { exact: true })).toBeVisible();
  await expect(b.getByText('Ana L.', { exact: true })).toBeVisible();
  await expect(b.getByTestId('verify-credits')).toHaveText('2.5 CPE credits');
  await expect(b.getByText('Harbor Board of Accountancy')).toBeVisible();
  await expect(b.getByText('Lovelace')).toHaveCount(0);
  await expect(b.getByText(ana(f).email)).toHaveCount(0);
  await expectAccessibleBothModes(b);
  await b.goto(`/certificates/${f.orgId}/verify/ZZZZZ-ZZZZZ`);
  await expect(b.getByText('No certificate has this code')).toBeVisible();

  // Withdrawn when no session qualifies any more: the code says so, the link disappears.
  await saveRule(page, 'Morning keynote', { credits: '1.5', minutes: '60', inPerson: true, online: false });
  await expect(page.getByText('Credit rule saved for Morning keynote.')).toBeVisible();
  await ruleForm(page, 'Clinical update')
    .getByRole('button', { name: 'Remove the credit rule for Clinical update' })
    .click();
  await expect(page.getByText('Credit rule removed for Clinical update.')).toBeVisible();
  await calculate(page, 'Withdrawn: 1.');
  await b.goto(`/certificates/${f.orgId}/verify/${code}`);
  await expect(b.getByText('The organizer withdrew this certificate.')).toBeVisible();
  await a.goto(`/orders/${ana(f).token}`);
  await expect(a.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(a.getByRole('link', { name: /CE certificate/ })).toHaveCount(0);
});

test('Zoom: link a webinar, registrants sync once, the attendance report counts for CE credits', async ({
  page,
}) => {
  const { org, f } = await conference(page);
  await page.goto(`${f.path}/virtual`);
  await expect(page.getByRole('heading', { name: 'Zoom webinars' })).toBeVisible();
  await expect(page.getByText('Zoom is not connected.')).toBeVisible();
  await page.getByRole('link', { name: 'Connect Zoom in Integrations' }).click();
  await page.getByRole('button', { name: 'Connect Zoom' }).click();
  await expect(page.getByRole('heading', { name: 'Connect Zoom to Yayatoh?' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByText('Zoom is connected. The first sync starts shortly.')).toBeVisible();
  const connection = /\/integrations\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string;
  expect(connection).toBeTruthy();

  await page.goto(`${f.path}/virtual`);
  await expect(page.getByText('Zoom is not connected.')).toHaveCount(0);
  const form = page.getByRole('form', { name: 'Zoom webinar for Clinical update' });
  await form.getByLabel('Zoom webinar ID').fill('12ab');
  await form.getByRole('button', { name: 'Link the Zoom webinar for Clinical update' }).click();
  await expect(form.getByText('Enter the webinar ID from Zoom: 9 to 12 digits.')).toBeVisible();
  await expectAccessible(page);
  await form.getByLabel('Zoom webinar ID').fill('812 3450 0001');
  await form.getByRole('button', { name: 'Link the Zoom webinar for Clinical update' }).click();
  await expect(page.getByText('Webinar linked for Clinical update.')).toBeVisible();
  // The same webinar cannot serve a second session.
  const other = page.getByRole('form', { name: 'Zoom webinar for Morning keynote' });
  await other.getByLabel('Zoom webinar ID').fill('81234500001');
  await other.getByRole('button', { name: 'Link the Zoom webinar for Morning keynote' }).click();
  await expect(other.getByText('This webinar is linked to another session.')).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('form', { name: 'Zoom webinar for Clinical update' }).getByLabel('Zoom webinar ID'),
  ).toHaveValue('81234500001');
  const counts = page.getByTestId('zoom-counts');
  await expect(counts).toHaveText('Registrants: 2 · Attended: 0');
  await expectAccessibleBothModes(page);

  // Ana joined the webinar for 40 minutes; the report comes back with the next sync.
  const zoom = (form: Record<string, string>) =>
    page.request.post('/api/dev/zoom', { form: { connection, webinar: '81234500001', ...form } });
  expect(
    (
      await zoom({
        action: 'attend',
        email: ana(f).email,
        name: ana(f).name,
        minutesAgo: '100',
        minutes: '40',
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole('button', { name: 'Sync with Zoom now' }).click();
  await expect(page.getByText('Sync with Zoom on its way.')).toBeVisible();
  expect((await page.request.post('/api/dev/integrations/run', { form: { org } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('zoom-counts')).toHaveText('Registrants: 2 · Attended: 1');
  // Syncing again never duplicates a registrant at Zoom.
  await page.getByRole('button', { name: 'Sync with Zoom now' }).click();
  await expect(page.getByText('Sync with Zoom on its way.')).toBeVisible();
  expect((await page.request.post('/api/dev/integrations/run', { form: { org } })).ok()).toBe(true);
  const regs = (await (await zoom({ action: 'registrants' })).json()) as { emails: string[] };
  expect(regs.emails.sort()).toEqual([ana(f).email, ben(f).email].sort());

  // Zoom minutes count as online attendance: 40 minutes clear a 30-minute minimum.
  await page.goto(`${f.path}/ce-credits`);
  await saveRule(page, 'Clinical update', { credits: '2', minutes: '30', inPerson: false, online: true });
  await expect(page.getByText('Credit rule saved for Clinical update.')).toBeVisible();
  await calculate(page, 'New certificates: 1.');
  await page.reload();
  await expect(
    page
      .getByRole('table', { name: 'Certificates' })
      .getByRole('row')
      .filter({ hasText: ana(f).name }),
  ).toContainText('2 CE credits');
});

test('a viewer sees CE credits read-only; keyboard only for the owner', async ({ page, browser }) => {
  const { org, f } = await conference(page);
  const v = await guest(browser);
  await newUser(v, { join: [`${org}:viewer`] });
  await v.goto(`${f.path}/ce-credits`);
  await expect(
    v.getByText('You can see CE credits. Ask an editor to change rules or issue certificates.'),
  ).toBeVisible();
  await expect(v.getByRole('button', { name: 'Calculate credits and issue certificates' })).toHaveCount(0);
  await expect(v.getByRole('button', { name: /Save the credit rule/ })).toHaveCount(0);
  await expect(v.getByRole('button', { name: 'Save certificate details' })).toHaveCount(0);
  await expect(ruleForm(v, 'Morning keynote').getByLabel('Credits', { exact: true })).toBeDisabled();
  await expectAccessible(v);
  // The viewer cannot link a Zoom webinar either.
  await v.goto(`${f.path}/virtual`);
  await expect(v.getByRole('button', { name: /Link the Zoom webinar/ })).toHaveCount(0);

  // Keyboard only: fill a rule, tick a box with Space, save with Enter, calculate with Enter.
  await page.goto(`${f.path}/ce-credits`);
  const form = ruleForm(page, 'Morning keynote');
  await form.getByLabel('Credits', { exact: true }).focus();
  await page.keyboard.type('1.25');
  await page.keyboard.press('Tab');
  await expect(form.getByLabel('Minimum minutes')).toBeFocused();
  await page.keyboard.type('40');
  await page.keyboard.press('Tab');
  await expect(form.getByLabel('In person (door scans)')).toBeFocused();
  await expect(form.getByLabel('In person (door scans)')).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(form.getByLabel('Online (watch time and Zoom)')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(form.getByLabel('Online (watch time and Zoom)')).not.toBeChecked();
  await page.keyboard.press('Tab');
  await expect(form.getByRole('button', { name: 'Save the credit rule for Morning keynote' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Credit rule saved for Morning keynote.')).toBeVisible();
  const calc = page.getByRole('button', { name: 'Calculate credits and issue certificates' });
  await calc.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('ce-result')).toContainText('New certificates: 1.');
});

test('Arabic (RTL): the CE page, the certificate and its verification', async ({ page, browser }) => {
  const { org, f } = await conference(page);
  await page.goto(`${f.path}/ce-credits`);
  await saveRule(page, 'Morning keynote', { credits: '1.5', minutes: '45', inPerson: true, online: true });
  await expect(page.getByText('Credit rule saved for Morning keynote.')).toBeVisible();
  await calculate(page);
  await page.goto(`/ar${f.path}/ce-credits`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'ساعات التعليم المستمر', level: 1 })).toBeVisible();
  await expectAccessibleBothModes(page);
  const mail = await certificateMail(page, org, ana(f).email);
  const link = linkIn(mail.html);
  const g = await guest(browser);
  // The certificate in Arabic: right to left, the Arabic legal-copy text.
  await g.goto(`/ar${link}?format=html`);
  await expect(g.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(g.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(g.getByRole('heading', { name: 'شهادة حضور', level: 1 })).toBeVisible();
  await expectAccessible(g);
  const pdf = await g.request.get(`/ar${link}`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  const code = /([0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5})/.exec(mail.text)?.[1] as string;
  await g.goto(`/ar/certificates/${f.orgId}/verify/${code}`);
  await expect(g.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(g.getByRole('heading', { name: 'التحقق من شهادة', level: 1 })).toBeVisible();
  await expect(g.getByText('صالحة', { exact: true })).toBeVisible();
  await expectAccessibleBothModes(g);
});
