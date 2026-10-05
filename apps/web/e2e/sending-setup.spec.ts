import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, newUser, pickOption } from './helpers.ts';

/**
 * M3.5b sending setup (`/o/{org}/sending`): the org's own email sending domain (added, checked
 * and removed by owners, from the keyboard; DKIM/SPF/DMARC surfaced; DNS records to publish;
 * mail then comes from the org's address), the text senders and the fallback chains. Viewers see
 * it read-only and are refused when replaying an owner's action. Axe and Arabic RTL throughout.
 * Development uses the fake identity provider: a `fail` label fails DKIM, a `nodmarc` label has
 * no DMARC record, everything else verifies on the first check.
 */
const stampOf = () => `${Date.now().toString(36)}${test.info().project.name.slice(0, 1)}`;

async function drain(page: Page, org: string) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org } });
  expect(res.ok()).toBe(true);
}

test.describe('sending setup', () => {
  test('an owner adds a sending domain from the keyboard, checks DNS, mail uses it, then removes it', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const stamp = stampOf();
    const owner = await newUser(page, { org: true, twoFactor: true });
    const org = owner.orgSlug ?? '';
    // The console nav links to it (collapsed into the menu on small screens).
    await page.goto(`/o/${org}`);
    await expect(page.locator(`a[href="/o/${org}/sending"]`).first()).toBeAttached();
    await page.goto(`/o/${org}/sending`);
    await expect(page).toHaveURL(new RegExp(`/o/${org}/sending$`));
    await expect(page.getByRole('heading', { name: 'Sending setup', level: 1 })).toBeVisible();
    await expect(page.getByText(/Your emails go out from notifications@mail\.yayatoh\.com/)).toBeVisible();
    await expectAccessible(page);

    // Validation, keyboard only: an empty field, then a Yayatoh address.
    const field = page.getByLabel('Sending domain', { exact: true });
    await field.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'Enter a domain.' })).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await field.fill('mail.yayatoh.com');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: /not a Yayatoh address/ })).toBeVisible();
    await expect(field).toHaveValue('mail.yayatoh.com');
    await expectAccessible(page);

    const domain = `mail.${stamp}.nodmarc.test`;
    await field.fill(` HTTPS://${domain.toUpperCase()}/ `);
    await page.keyboard.press('Enter');
    await expect(page.getByText('The domain was added. Publish the DNS records below.')).toBeVisible();
    await expect(page.getByRole('heading', { name: domain, level: 3 })).toBeVisible();
    await expect(page.getByText('Waiting for DNS', { exact: true })).toBeVisible();
    const checks = page.getByRole('table', { name: `DNS checks for ${domain}` });
    await expect(checks.getByRole('row').filter({ hasText: 'DKIM (signature)' })).toContainText('Waiting');
    await expect(checks.getByRole('row').filter({ hasText: 'DMARC (policy)' })).toContainText('Missing');
    const records = page.getByRole('table', { name: `DNS records for ${domain}` });
    await expect(records.getByRole('row').filter({ hasText: 'CNAME' })).toHaveCount(3);
    await expect(records.getByRole('row').filter({ hasText: `bounce.${domain}` })).toHaveCount(2);
    await expect(records.getByRole('row').filter({ hasText: '_dmarc.nodmarc.test' })).toContainText(
      'v=DMARC1; p=none;',
    );
    await expectAccessible(page);

    // "Check DNS now" from the keyboard.
    const check = page.getByRole('button', { name: 'Check DNS now' });
    await check.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('DNS checked.')).toBeVisible();
    await expect(page.getByText('Verified', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`Your emails now come from notifications@${domain}.`)).toBeVisible();
    await expect(checks.getByRole('row').filter({ hasText: 'DKIM (signature)' })).toContainText('Verified');
    await expect(checks.getByRole('row').filter({ hasText: 'SPF (bounce domain)' })).toContainText(
      'Verified',
    );
    await expect(page.getByText(/^Last checked /)).toBeVisible();
    // Persists.
    await page.reload();
    await expect(page.getByText(`Your emails now come from notifications@${domain}.`)).toBeVisible();
    await expectAccessible(page);

    // The org's mail now leaves from its own domain (a team invitation, drained to the dev mailbox).
    const invitee = `invitee.${stamp}@example.test`;
    await page.goto(`/o/${org}/team`);
    await page.getByLabel('Email address').fill(invitee);
    await pickOption(page.getByLabel('Role', { exact: true }), 'scanner');
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent.')).toBeVisible();
    await drain(page, org);
    const mail = (await (
      await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(invitee)}`)
    ).json()) as Array<{ sender?: { address: string } | null }>;
    expect(mail[0]?.sender?.address).toBe(`notifications@${domain}`);

    // Arabic, right to left (its own context: the locale cookie sticks).
    const ar = await (
      await browser.newContext({ storageState: await page.context().storageState() })
    ).newPage();
    await ar.goto(`/ar/o/${org}/sending`);
    await expect(ar.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(ar.getByRole('heading', { name: 'إعداد الإرسال', level: 1 })).toBeVisible();
    await expect(ar.getByRole('button', { name: 'افحص DNS الآن' })).toBeVisible();
    // U10: scoped to the domain section (the From name preview above also shows the address).
    await expect(
      ar.getByRole('region', { name: 'نطاق إرسال البريد الإلكتروني' }).getByText(`notifications@${domain}`),
    ).toBeVisible();
    await expectAccessible(ar);

    // Remove it: back to the platform sender.
    await page.goto(`/o/${org}/sending`);
    await page.getByRole('button', { name: 'Remove domain' }).click();
    await expect(
      page.getByText("The sending domain was removed. Emails come from Yayatoh's address again."),
    ).toBeVisible();
    await expect(page.getByLabel('Sending domain', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: domain })).toHaveCount(0);
  });

  test('a failing DKIM is shown; a domain another organization uses is refused', async ({
    page,
    browser,
  }) => {
    const stamp = stampOf();
    const owner = await newUser(page, { org: true, twoFactor: true });
    const domain = `mail.${stamp}.fail.test`;
    await page.goto(`/o/${owner.orgSlug}/sending`);
    await page.getByLabel('Sending domain', { exact: true }).fill(domain);
    await page.getByRole('button', { name: 'Add domain' }).click();
    await expect(page.getByText('The domain was added. Publish the DNS records below.')).toBeVisible();
    await page.getByRole('button', { name: 'Check DNS now' }).click();
    await expect(page.getByText('DNS checked.')).toBeVisible();
    await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible();
    const checks = page.getByRole('table', { name: `DNS checks for ${domain}` });
    await expect(checks.getByRole('row').filter({ hasText: 'DKIM (signature)' })).toContainText('Failed');
    await expect(
      page.getByText(/Once DKIM and SPF are verified, your emails will come from notifications@/),
    ).toBeVisible();
    await expectAccessible(page);

    const other = await (await browser.newContext()).newPage();
    const second = await newUser(other, { org: true, twoFactor: true });
    await other.goto(`/o/${second.orgSlug}/sending`);
    await other.getByLabel('Sending domain', { exact: true }).fill(domain);
    await other.getByRole('button', { name: 'Add domain' }).click();
    await expect(
      other.getByRole('alert').filter({ hasText: 'Another organization already uses this domain.' }),
    ).toBeVisible();
    await expectAccessible(other);
  });

  test('text senders and fallback chains are shown; a viewer reads them and is refused on replay', async ({
    page,
    browser,
  }) => {
    const stamp = stampOf();
    const owner = await newUser(page, { org: true, twoFactor: true });
    const org = owner.orgSlug ?? '';
    await page.goto(`/o/${org}/sending`);
    // Defaults: the shared senders, and the fallback order per message type.
    await expect(page.getByText("Yayatoh's shared number")).toBeVisible();
    await expect(page.getByText("Yayatoh's WhatsApp number")).toBeVisible();
    const chains = page.getByRole('table', { name: 'Fallback order per message type' });
    await expect(chains.getByRole('row').filter({ hasText: 'Tickets and order messages' })).toContainText(
      'WhatsApp → SMS → Email',
    );
    await expect(chains.getByRole('row').filter({ hasText: 'News and offers' })).toContainText('No fallback');
    await expect(chains.getByRole('row').filter({ hasText: 'Sales alerts for your team' })).toContainText(
      'Push → Email',
    );

    const domain = `mail.${stamp}.viewer.test`;
    await page.getByLabel('Sending domain', { exact: true }).fill(domain);
    await page.getByRole('button', { name: 'Add domain' }).click();
    await expect(page.getByText('The domain was added. Publish the DNS records below.')).toBeVisible();
    // Capture the owner's "Remove domain" server action without letting it run.
    await page.route('**/*', async (route) => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action'])
        await route.abort();
      else await route.continue();
    });
    const [removeRequest] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && Boolean(r.headers()['next-action'])),
      page.getByRole('button', { name: 'Remove domain' }).click(),
    ]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // A viewer of this org: read-only, no controls.
    const viewer = await (await browser.newContext()).newPage();
    await newUser(viewer, { join: [`${org}:viewer`] });
    await viewer.goto(`/o/${org}/sending`);
    await expect(viewer.getByRole('heading', { name: domain, level: 3 })).toBeVisible();
    await expect(viewer.getByText('Only owners and admins can change this.')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Check DNS now' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Remove domain' })).toHaveCount(0);
    await expectAccessible(viewer);
    // Replaying the owner's action with the viewer's session is refused; the domain stays.
    const res = await viewer.request.post(`/o/${org}/sending`, {
      headers: {
        'next-action': removeRequest.headers()['next-action'] ?? '',
        'content-type': removeRequest.headers()['content-type'] ?? 'text/plain;charset=UTF-8',
        accept: 'text/x-component',
      },
      data: removeRequest.postData() ?? '',
      maxRedirects: 0,
    });
    expect(res.status()).toBeLessThan(500);
    expect(res.headers()['x-action-redirect'] ?? '').toContain('done=forbidden');
    await viewer.goto(`/o/${org}/sending?done=forbidden`);
    await expect(
      viewer.getByRole('alert').filter({ hasText: 'Only owners and admins can change this.' }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: domain, level: 3 })).toBeVisible();

    // Arabic for the viewer too.
    await viewer.goto(`/ar/o/${org}/sending`);
    await expect(viewer.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(viewer.getByRole('table', { name: 'ترتيب القنوات البديلة حسب نوع الرسالة' })).toContainText(
      'واتساب',
    );
    await expectAccessible(viewer);
  });

  test('provider webhooks answer only for configured providers', async ({ request }) => {
    for (const path of [
      '/api/webhooks/email/ses',
      '/api/webhooks/sms/twilio',
      '/api/webhooks/sms/twilio/inbound',
      '/api/webhooks/whatsapp/cloud',
      '/api/webhooks/whatsapp/gateway',
      '/api/webhooks/sms/other',
    ])
      expect((await request.post(path, { data: 'x' })).status(), path).toBe(404);
    expect(
      (await request.get('/api/webhooks/whatsapp/cloud?hub.mode=subscribe&hub.challenge=1')).status(),
    ).toBe(404);
    // The fake email provider still verifies: a forged report is a 400.
    expect((await request.post('/api/webhooks/email/fake', { data: '{}' })).status()).toBe(400);
  });
});
