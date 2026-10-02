import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, lastEmailedCode, ownClientIp, signIn } from './helpers.ts';

/**
 * M5.4a: the exhibitor portal and booths. An organizer invites an exhibitor admin, who signs in
 * through the one portal sign-in (M5.3a: the emailed invitation, then a code), edits the profile and logo, and invites staff until the allowance refuses;
 * the organizer places booths and assigns them by keyboard (conflicts warned); the public
 * exhibitor map shows only allowlisted data. The viewer is refused every organizer action.
 */
const ORG = '/o/lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const TZ = 'America/Chicago';
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'packages', 'modules', 'media', 'fixtures');
const LOGO = () => ({
  name: 'acme.png',
  mimeType: 'image/png',
  buffer: readFileSync(join(FIXTURES, 'alpha.png')),
});

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

/** A published conference with one exhibitor per name, via the console. */
async function conference(page: Page, name: string, exhibitors: string[]) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Event type').selectOption('conference');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(at(40, '09:00'));
  await page.getByLabel('Ends', { exact: true }).fill(at(42, '18:00'));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/exhibitors`);
  for (const x of exhibitors) {
    const add = page.getByRole('region', { name: 'Add exhibitor' });
    await add.getByLabel('Exhibitor name').fill(x);
    await add.getByRole('button', { name: 'Add exhibitor' }).click();
    await expect(add.getByText('Exhibitor added.')).toBeVisible();
  }
  return { base, slug: base.split('/').pop() ?? '' };
}

async function drain(page: Page) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org: 'lakeside-events' } });
  expect(res.status()).toBe(200);
}

type Mail = { subject: string; text: string };
async function invitations(page: Page, email: string): Promise<Mail[]> {
  const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
  return ((await res.json()) as Mail[]).filter((m) => /portal/.test(m.subject) && /invite/.test(m.text));
}

/**
 * The invitation link in the newest portal invitation to an address (the outbox is drained first:
 * the portal invite mailer sends it). `after` waits for a newer one than that many.
 */
async function portalLink(page: Page, email: string, after = 0) {
  let link = '';
  await expect
    .poll(
      async () => {
        await drain(page);
        const list = await invitations(page, email);
        if (list.length <= after) return false;
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

/** Sign in through an invitation: email a code, then type it (keyboard only). */
async function signInByCode(guest: Page, link: string, email: string) {
  await guest.goto(link);
  await guest.getByRole('button', { name: 'Email me a sign-in code' }).focus();
  await guest.keyboard.press('Enter');
  const code = guest.getByLabel('Verification code', { exact: true });
  await expect(code).toBeFocused();
  await code.fill(await lastEmailedCode(guest, email));
  await code.press('Enter');
  await expect(guest).toHaveURL(/\/event-portal$/);
}

async function guestPage(browser: Browser) {
  const context = await browser.newContext();
  await ownClientIp(context);
  return context.newPage();
}

/** Invite someone from the organizer's portal page (the exhibitor's card). */
async function inviteFromConsole(page: Page, exhibitor: string, email: string) {
  await page.getByText(`Invite someone to ${exhibitor}`).click();
  const form = page
    .locator('form')
    .filter({ has: page.locator(`input[id^="invite-"][name="email"]`) })
    .first();
  await form.getByLabel('Email').fill(email);
  await form.getByRole('button', { name: 'Send invitation' }).click();
  await expect(form.getByText('Invitation sent.')).toBeVisible();
}

test.describe('exhibitor portal (M5.4a)', () => {
  test('invite an admin, sign in by link, edit profile and logo, staff up to the allowance; keyboard, axe, RTL', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const s = stamp();
    const acme = `Acme ${s}`;
    await signIn(page);
    const { base, slug } = await conference(page, `Expo ${s}`, [acme]);

    // The organizer's portal page: settings (2 staff places), then invite the admin.
    await page.goto(`${base}/exhibitors`);
    await page.getByRole('link', { name: 'Portal and staff' }).click();
    await expect(page.getByRole('heading', { name: 'Exhibitor portal', level: 1 })).toBeVisible();
    await expect(page.getByText('No one invited yet.')).toBeVisible();
    await expectAccessible(page);
    const settings = page.getByRole('region', { name: 'Portal settings' });
    await settings.getByLabel('Staff places per exhibitor').fill('');
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings.getByText('Enter a whole number from 0 to 500.')).toBeVisible();
    await settings.getByLabel('Staff places per exhibitor').fill('2');
    // Keyboard: Enter submits the form.
    await settings.getByLabel('Staff places per exhibitor').press('Enter');
    await expect(settings.getByText('Settings saved.')).toBeVisible();
    await page.reload();
    await expect(
      page.getByText(
        'Each exhibitor gets 2 staff places unless you set its own. Profile changes go live at once.',
      ),
    ).toBeVisible();

    const admin = `admin-${s}@acme.test`;
    await page.getByText(`Invite someone to ${acme}`).click();
    const invite = page
      .locator('form')
      .filter({ has: page.getByRole('combobox', { name: 'Role' }) })
      .first();
    await invite.getByLabel('Email').fill('not-an-email');
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    await expect(invite.getByText('Enter a valid email address.')).toBeVisible();
    await invite.getByLabel('Email').fill(admin);
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    await expect(invite.getByText('Invitation sent.')).toBeVisible();
    await invite.getByLabel('Email').fill(admin);
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    await expect(invite.getByText('That address is already invited.')).toBeVisible();
    await page.reload();
    await expect(page.getByText(admin, { exact: true })).toBeVisible();
    await expect(page.getByText('Exhibitor admin · Invited')).toBeVisible();

    // The admin opens the emailed invitation in their own browser and signs in with a code (the
    // same sign-in as every portal role).
    const link = await portalLink(page, admin);
    const guest = await guestPage(browser);
    await guest.goto(link);
    await expect(guest.getByRole('heading', { name: 'Sign in to the portal' })).toBeVisible();
    await expect(guest.getByText("You're invited as an exhibitor admin.")).toBeVisible();
    await expectAccessible(guest);
    await signInByCode(guest, link, admin);
    await expect(guest.getByRole('heading', { name: acme, level: 1 })).toBeVisible();
    await expect(guest.getByText(`Signed in as ${admin} (Exhibitor admin).`)).toBeVisible();
    await expect(guest.getByText('No booth yet')).toBeVisible();
    await expect(guest.getByText('No tasks yet')).toBeVisible();
    await expectAccessible(guest);
    // Portal people never reach the console.
    await guest.goto(`${base}/exhibitors`);
    await expect(guest).toHaveURL(/sign-in/);
    await guest.goto('/event-portal');

    // Profile: a validation error keeps the values; then it saves and survives a reload.
    const profile = guest.getByRole('region', { name: 'Profile' });
    await profile.getByLabel('Website').fill('ftp://acme.test');
    await profile.getByLabel('Description').fill('Robots that *sort* parcels.');
    await profile.getByRole('button', { name: 'Save profile' }).click();
    await expect(
      profile.getByText('Enter a web address that starts with https:// or http://.'),
    ).toBeVisible();
    await expect(profile.getByLabel('Description')).toHaveValue('Robots that *sort* parcels.');
    await profile.getByLabel('Website').fill('https://acme.test');
    await profile.getByLabel('Categories').fill('Robotics, Logistics');
    await profile.getByRole('button', { name: 'Save profile' }).click();
    await expect(profile.getByText('Profile saved.')).toBeVisible();
    await guest.reload();
    await expect(guest.getByRole('region', { name: 'Profile' }).getByLabel('Categories')).toHaveValue(
      'Robotics, Logistics',
    );

    // Logo: a missing description is refused; an image uploads and replaces.
    const logo = guest.getByRole('region', { name: 'Logo' });
    await expect(logo.getByText('No logo yet.')).toBeVisible();
    await logo.getByLabel('Logo image').setInputFiles(LOGO());
    await logo.getByLabel('Logo description').fill('Acme robot arm logo');
    await logo.getByRole('button', { name: 'Upload logo' }).click();
    await expect(guest.getByText('Logo uploaded.')).toBeVisible();
    await expect(guest.getByText('Current logo: Acme robot arm logo')).toBeVisible();
    await expectAccessible(guest);

    // Staff: two places; pending invitations count, the third is refused, revoking frees one.
    const staff = guest.getByRole('region', { name: 'Staff' });
    await expect(staff.getByText('0 of 2 staff places used.')).toBeVisible();
    for (const n of [1, 2]) {
      await staff.getByLabel('Staff email').fill(`staff${n}-${s}@acme.test`);
      await staff.getByLabel('Staff email').press('Enter');
      await expect(staff.getByText('Invitation sent.')).toBeVisible();
      await expect(staff.getByText(`${n} of 2 staff places used.`)).toBeVisible();
    }
    await staff.getByLabel('Staff email').fill(`staff3-${s}@acme.test`);
    await staff.getByRole('button', { name: 'Send invitation' }).click();
    await expect(
      staff.getByText(
        'All 2 staff places are taken. Revoke an invitation to free a place, or ask the organizer for more.',
      ),
    ).toBeVisible();
    await staff.getByRole('button', { name: `Revoke staff1-${s}@acme.test` }).click();
    await expect(staff.getByText('1 of 2 staff places used.')).toBeVisible();
    await staff.getByLabel('Staff email').fill(`staff3-${s}@acme.test`);
    await staff.getByRole('button', { name: 'Send invitation' }).click();
    await expect(staff.getByText('2 of 2 staff places used.')).toBeVisible();
    await expect(staff.getByText(`staff1-${s}@acme.test`)).toHaveCount(0);

    // A staff member signs in by their link: no staff list, no profile form.
    const staffLink = await portalLink(page, `staff2-${s}@acme.test`);
    const staffPage = await guestPage(browser);
    await signInByCode(staffPage, staffLink, `staff2-${s}@acme.test`);
    await expect(staffPage.getByText(`Signed in as staff2-${s}@acme.test (Exhibitor staff).`)).toBeVisible();
    await expect(staffPage.getByRole('button', { name: 'Save profile' })).toHaveCount(0);
    await expect(staffPage.getByRole('region', { name: 'Staff' })).toHaveCount(0);
    await expect(staffPage.getByText('Your exhibitor admin edits this profile.')).toBeVisible();
    await expectAccessible(staffPage);

    // Sign out, then ask for the invitation again on the event's shareable sign-in page (same
    // answer for any address) and sign in through it.
    await guest.goto('/event-portal');
    await guest.getByRole('button', { name: 'Sign out' }).click();
    await expect(guest.getByRole('heading', { name: "You're signed out" })).toBeVisible();
    await expectAccessible(guest);
    await page.goto(`${base}/exhibitors/portal`);
    const shared = (await page.getByText(/\/event-portal\/sign-in\//).textContent()) ?? '';
    const sitePath = new URL(shared.slice(shared.indexOf('http')).trim()).pathname;
    const sent = (await invitations(page, admin)).length;
    await guest.goto(sitePath);
    await expect(guest.getByRole('heading', { name: 'Portal sign-in' })).toBeVisible();
    await expectAccessible(guest);
    await guest.getByLabel('Email').fill('not-an-email');
    await guest.getByRole('button', { name: 'Email me my invitation' }).click();
    await expect(guest.getByText('Enter a valid email address.')).toBeVisible();
    await guest.getByLabel('Email').fill(`nobody-${s}@acme.test`);
    await guest.getByRole('button', { name: 'Email me my invitation' }).click();
    await expect(guest.getByText(/If this address is invited to the event's portal/)).toBeVisible();
    await guest.reload();
    await guest.getByLabel('Email').fill(admin);
    await guest.getByLabel('Email').press('Enter');
    await expect(guest.getByText(/If this address is invited to the event's portal/)).toBeVisible();
    const again = await portalLink(page, admin, sent);
    await signInByCode(guest, again, admin);
    await expect(guest.getByRole('heading', { name: acme, level: 1 })).toBeVisible();
    // A forged sign-in page link says so.
    const forged = await guestPage(browser);
    await forged.goto(`${sitePath.slice(0, -4)}AAAA`);
    await expect(forged.getByText("This sign-in page link doesn't work.", { exact: false })).toBeVisible();

    // Arabic: the portal renders right-to-left.
    await guest.goto('/ar/event-portal');
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.getByRole('heading', { name: acme, level: 1 })).toBeVisible();
    await expectAccessible(guest);

    // The organizer sees the admin active and the logo on the public page.
    await page.goto(`${base}/exhibitors/portal`);
    await expect(page.getByText('Exhibitor admin · Signed in')).toBeVisible();
    await expect(
      page.getByText(`2 of 2 staff places used · event default · Robotics, Logistics`),
    ).toBeVisible();
    const pub = await guestPage(browser);
    await pub.goto(`/events/${slug}#exhibitors`);
    await expect(pub.getByRole('img', { name: 'Acme robot arm logo' })).toBeVisible();
  });

  test('approval on: the organizer sees a diff and approves or rejects; the public shows approved values only', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const s = stamp();
    const name = `Globex ${s}`;
    await signIn(page);
    const { base, slug } = await conference(page, `Approvals ${s}`, [name]);
    await page.goto(`${base}/exhibitors/portal`);
    const settings = page.getByRole('region', { name: 'Portal settings' });
    await settings.getByRole('checkbox', { name: 'Approve profile changes before they go live' }).check();
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings.getByText('Settings saved.')).toBeVisible();
    const admin = `admin-${s}@globex.test`;
    await inviteFromConsole(page, name, admin);
    const guest = await guestPage(browser);
    await signInByCode(guest, await portalLink(page, admin), admin);
    await expect(
      guest.getByText('The organizer reviews profile changes before they appear publicly.'),
    ).toBeVisible();
    const profile = guest.getByRole('region', { name: 'Profile' });
    await profile.getByLabel('Exhibitor name').fill(`${name} Corp`);
    await profile.getByLabel('Description').fill('World domination, responsibly.');
    await profile.getByRole('button', { name: 'Save profile' }).click();
    await expect(profile.getByText('Sent to the organizer for approval.')).toBeVisible();
    await guest.reload();
    await expect(guest.getByText('Changes waiting for approval')).toBeVisible();
    await expect(guest.getByRole('heading', { name, level: 1 })).toBeVisible();

    // The public page shows the approved name only.
    const pub = await guestPage(browser);
    await pub.goto(`/events/${slug}`);
    await expect(pub.getByText(name, { exact: true })).toBeVisible();
    await expect(pub.getByText(`${name} Corp`)).toHaveCount(0);

    // The organizer sees the diff and approves by keyboard.
    await page.reload();
    const table = page.getByRole('table', { name: `Changes ${name} proposed` });
    await expect(table.getByRole('row', { name: new RegExp(`Name ${name} ${name} Corp`) })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: `Approve changes from ${name}` }).focus();
    await page.keyboard.press('Enter');
    // The change is applied: its diff is gone.
    await expect(page.getByRole('table', { name: /proposed/ })).toHaveCount(0);
    await pub.reload();
    await expect(pub.getByText(`${name} Corp`)).toBeVisible();

    // A second change, rejected with a reason: nothing changes publicly.
    await guest.reload();
    await profile.getByLabel('Exhibitor name').fill('Totally Different');
    await profile.getByRole('button', { name: 'Save profile' }).click();
    await expect(profile.getByText('Sent to the organizer for approval.')).toBeVisible();
    await page.reload();
    await page.getByLabel('Reason (optional)').fill('Please keep the registered name.');
    await page.getByRole('button', { name: `Reject changes from ${name} Corp` }).click();
    await expect(page.getByRole('table', { name: /proposed/ })).toHaveCount(0);
    await guest.reload();
    await expect(guest.getByRole('heading', { name: `${name} Corp`, level: 1 })).toBeVisible();
    await expect(guest.getByText('Changes waiting for approval')).toHaveCount(0);
  });

  test('booths: add by form, conflicts warned, assign by keyboard, drag shortcut; the public map; RTL', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const s = stamp();
    const [acme, globex] = [`Acme ${s}`, `Globex ${s}`];
    await signIn(page);
    const { base, slug } = await conference(page, `Hall ${s}`, [acme, globex]);
    await page.goto(`${base}/exhibitors`);
    await page.getByRole('link', { name: 'Booths and floor plan' }).click();
    await expect(page.getByRole('heading', { name: 'Booths', level: 1 })).toBeVisible();
    await expect(page.getByText('No booths yet')).toBeVisible();
    await expectAccessible(page);

    const add = page.getByRole('region', { name: 'Add booth' });
    await add.getByLabel('Booth number').fill('');
    await add.getByRole('button', { name: 'Add booth' }).click();
    await expect(add.getByText('Enter a booth number of up to 20 letters or digits.')).toBeVisible();
    await add.getByLabel('Booth number').fill('B12');
    await add.getByLabel('Category').fill('Robotics');
    await add.getByLabel('Width (m)').fill('0.1');
    await add.getByRole('button', { name: 'Add booth' }).click();
    await expect(add.getByText('Enter a size from 0.5 to 100 m.')).toBeVisible();
    await add.getByLabel('Width (m)').fill('3');
    await add.getByLabel('Depth (m)').fill('2.5');
    // Keyboard: Enter in a field submits.
    await add.getByLabel('Depth (m)').press('Enter');
    await expect(add.getByText('Booth added.')).toBeVisible();
    await add.getByLabel('Booth number').fill('b12');
    await add.getByRole('button', { name: 'Add booth' }).click();
    await expect(add.getByText('That booth number is already used for this event.')).toBeVisible();
    await add.getByLabel('Booth number').fill('B13');
    await add.getByLabel('Category').fill('');
    await add.getByLabel('From the left wall (m)').fill('2');
    await add.getByRole('button', { name: 'Add booth' }).click();
    await expect(add.getByText('Booth added.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Booths B12 and B13 overlap on the plan.')).toBeVisible();
    await expect(page.getByText('3 × 2.5 m (7.5 m²)')).toBeVisible();
    // Move B13 clear of B12 by editing it.
    await page.getByText('Edit booth B13').click();
    const edit = page.locator('form').filter({ has: page.locator('input[id$="-number"][value="B13"]') });
    await edit.getByLabel('From the left wall (m)').fill('5');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByText(/overlap on the plan/)).toHaveCount(0);

    // Assign by keyboard only: pick with the arrow keys, submit with Enter.
    const assign = page.getByRole('region', { name: 'Assign a booth' });
    await assign.getByLabel('Booth', { exact: true }).focus();
    await expect(assign.getByLabel('Booth', { exact: true })).toHaveValue(/.+/);
    await page.keyboard.press('Tab');
    await expect(assign.getByLabel('Exhibitor', { exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(assign.getByRole('button', { name: 'Assign' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(assign.getByText('Assigned.')).toBeVisible();
    await page.reload();
    const b12 = page.getByRole('list', { name: 'Exhibitors at booth B12' });
    await expect(b12.getByText(acme, { exact: true })).toBeVisible();
    await expect(b12.getByText('Primary')).toBeVisible();
    // Again: already there.
    await page.getByRole('button', { name: 'Assign' }).click();
    await expect(assign.getByText('That exhibitor is already at this booth.')).toBeVisible();
    // A co-exhibitor at B12 is a warning; making them primary swaps.
    await assign.getByLabel('Exhibitor', { exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(assign.getByLabel('Exhibitor', { exact: true })).toHaveValue(/.+/);
    await assign.getByRole('button', { name: 'Assign' }).click();
    await expect(assign.getByText('Assigned.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Booth B12 is shared by 2 exhibitors.')).toBeVisible();
    await page.getByRole('button', { name: `Make ${globex} primary at B12` }).click();
    await expect(
      page.getByRole('list', { name: 'Exhibitors at booth B12' }).getByRole('listitem').first(),
    ).toContainText(globex);
    await page.getByRole('button', { name: `Remove ${globex} from B12` }).click();
    await expect(page.getByText(/is shared by/)).toHaveCount(0);
    await expectAccessible(page);

    // The drag shortcut (the same assignment as the form).
    await page
      .locator(`li[draggable="true"]`, { hasText: globex })
      .dragTo(page.locator('svg g[data-booth="B13"]'));
    await expect(page.getByText('Exhibitor assigned.')).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Exhibitors at booth B13' }).getByText(globex, { exact: true }),
    ).toBeVisible();

    // The organizer hides Globex from the public.
    await page.goto(`${base}/exhibitors/portal`);
    await page.getByText(`Listing and allowance of ${globex}`).click();
    const listing = page
      .locator('form')
      .filter({ has: page.getByRole('checkbox', { name: 'Show on the event page and exhibitor map' }) })
      .last();
    await listing.getByRole('checkbox', { name: 'Show on the event page and exhibitor map' }).uncheck();
    await listing.getByRole('button', { name: 'Save' }).click();
    await expect(listing.getByText('Saved.')).toBeVisible();

    // The public map: booths drawn and listed; only the listed exhibitor; linked from the event.
    const pub = await guestPage(browser);
    await pub.goto(`/events/${slug}`);
    await pub.getByRole('link', { name: 'Exhibitor map' }).click();
    await expect(pub.getByRole('heading', { name: `Exhibitors at Hall ${s}`, level: 1 })).toBeVisible();
    await expect(pub.getByRole('img', { name: /Exhibit hall map with 2 booths/ })).toBeVisible();
    await expect(pub.getByRole('heading', { name: acme, level: 3 })).toBeVisible();
    await expect(pub.getByText('Booth B12', { exact: true })).toBeVisible();
    const rows = pub.getByRole('table', { name: 'Booths and their exhibitors' });
    await expect(rows.getByRole('row', { name: new RegExp(`B12 ${acme} Robotics`) })).toBeVisible();
    await expect(rows.getByRole('row', { name: /B13 Available/ })).toBeVisible();
    await expect(pub.getByText(globex)).toHaveCount(0);
    const html = await pub.content();
    expect(html).not.toContain('@acme.test');
    await expectAccessible(pub);
    await pub.goto(`/ar/events/${slug}/exhibitors`);
    await expect(pub.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(pub.getByRole('heading', { name: acme, level: 3 })).toBeVisible();
    await expectAccessible(pub);
    // Arabic booths page for the organizer.
    await page.goto(`/ar${base}/exhibitors/booths`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
  });

  test('the viewer sees portal and booths read-only and is refused every organizer action', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const s = stamp();
    const acme = `Acme ${s}`;
    await signIn(page);
    const { base } = await conference(page, `Viewer Expo ${s}`, [acme]);
    await page.goto(`${base}/exhibitors/booths`);
    const add = page.getByRole('region', { name: 'Add booth' });
    await add.getByLabel('Booth number').fill('V1');
    await add.getByRole('button', { name: 'Add booth' }).click();
    await expect(add.getByText('Booth added.')).toBeVisible();

    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    for (const path of ['exhibitors/portal', 'exhibitors/booths']) {
      await viewer.goto(`${base}/${path}`);
      await expect(
        viewer.getByText('You can view the program. Only organizers with edit rights can change it.'),
      ).toBeVisible();
      await expect(
        viewer.getByRole('button', { name: /^(Add booth|Assign|Save settings|Send invitation)$/ }),
      ).toHaveCount(0);
      await expect(viewer.getByText(/^(Edit booth|Invite someone|Listing and allowance)/)).toHaveCount(0);
      await expectAccessible(viewer);
    }
    // Forms opened by the owner, submitted as the viewer: every one is refused by the server.
    const refused = "You don't have access to this.";
    await page.goto(`${base}/exhibitors/portal`);
    const settings = page.getByRole('region', { name: 'Portal settings' });
    await settings.getByLabel('Staff places per exhibitor').fill('9');
    await page.getByText(`Invite someone to ${acme}`).click();
    const invite = page
      .locator('form')
      .filter({ has: page.getByRole('combobox', { name: 'Role' }) })
      .first();
    await invite.getByLabel('Email').fill(`sneaky-${s}@acme.test`);
    await signIn(page, VIEWER);
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings.getByRole('alert').filter({ hasText: refused })).toBeVisible();
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    await expect(invite.getByRole('alert').filter({ hasText: refused })).toBeVisible();
    await signIn(page);
    await page.goto(`${base}/exhibitors/booths`);
    const addAgain = page.getByRole('region', { name: 'Add booth' });
    const assign = page.getByRole('region', { name: 'Assign a booth' });
    await addAgain.getByLabel('Booth number').fill('V2');
    await signIn(page, VIEWER);
    await addAgain.getByRole('button', { name: 'Add booth' }).click();
    await expect(addAgain.getByRole('alert').filter({ hasText: refused })).toBeVisible();
    await assign.getByRole('button', { name: 'Assign' }).click();
    await expect(assign.getByRole('alert').filter({ hasText: refused })).toBeVisible();
    // Nothing changed.
    await signIn(page);
    await page.goto(`${base}/exhibitors/booths`);
    await expect(page.getByRole('heading', { name: 'Booth V2' })).toHaveCount(0);
    await expect(page.getByText('No exhibitor yet.')).toBeVisible();
    await page.goto(`${base}/exhibitors/portal`);
    await expect(page.getByText(`sneaky-${s}@acme.test`)).toHaveCount(0);
    await expect(page.getByText(/Each exhibitor gets 5 staff places/)).toBeVisible();
  });
});
