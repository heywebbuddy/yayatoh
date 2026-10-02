import { expect, type Page, test } from '@playwright/test';
import { ageSession, confirmStepUp, expectAccessible, personaCode, signIn } from './helpers.ts';

const LIST = '/o/lakeside-events/webhooks';
const VIEWER = 'jordan@lakeside.test';

/** A receiver URL unique per project and run, so parallel projects and reruns never collide. */
const hookUrl = (what: string, path = 'in') =>
  `https://hooks.example.com/${what}-${test.info().project.name}-${Date.now()}/${path}`;

/** Add an endpoint through the form; lands on its page. Returns the endpoint page's path. */
async function addEndpoint(page: Page, url: string, opts: { types?: string[]; description?: string } = {}) {
  await page.goto(LIST);
  await page.getByLabel('Endpoint URL').fill(url);
  if (opts.description) await page.getByLabel('Description').fill(opts.description);
  if (opts.types) {
    await page.getByRole('radio', { name: 'Only the events I choose' }).check();
    for (const type of opts.types) await page.getByRole('checkbox', { name: type, exact: true }).check();
  }
  await page.getByRole('button', { name: 'Add endpoint' }).click();
  await expect(page.getByRole('heading', { name: 'Webhook endpoint', level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Endpoint added.' })).toBeVisible();
  await expect(page.getByTestId('endpoint-url')).toHaveText(url);
  return new URL(page.url()).pathname;
}

/** Delete the endpoint on its page; back on the list. */
async function deleteEndpoint(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole('button', { name: 'Delete endpoint' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Endpoint deleted.' })).toBeVisible();
}

const deliveries = (page: Page) => page.getByRole('region', { name: 'Recent deliveries' });

test.describe('webhooks console (M6.3b)', () => {
  test('add an endpoint, send a test, see the signed delivery, then delete it', async ({ page }) => {
    await signIn(page);
    await page.goto(LIST);
    await expect(page.getByRole('heading', { name: 'Webhooks', level: 1 })).toBeVisible();
    await expectAccessible(page);
    const url = hookUrl('happy');
    const path = await addEndpoint(page, url, { description: 'CRM sync' });
    await expect(page.getByText('No deliveries yet')).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Send test' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Test message sent (webhook.test)' }),
    ).toBeVisible();
    const row = deliveries(page).getByRole('row').filter({ hasText: 'webhook.test' }).first();
    await expect(row).toContainText('Delivered');
    await expect(row).toContainText('200');
    await expectAccessible(page);

    // Any catalog event can be sent with its documented example.
    await page.getByLabel('Message type').selectOption('order.paid');
    await page.getByRole('button', { name: 'Send test' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Test message sent (order.paid)' }),
    ).toBeVisible();
    await expect(deliveries(page).getByRole('row').filter({ hasText: 'order.paid' })).toContainText(
      'Delivered',
    );

    // Persisted: listed after a reload, with its description and "All events".
    await page.goto(LIST);
    const listed = page.getByRole('row').filter({ hasText: url });
    await expect(listed).toContainText('CRM sync');
    await expect(listed).toContainText('All events');
    await expect(listed).toContainText('Active');
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: url })).toBeVisible();

    await deleteEndpoint(page, path);
    await expect(page.getByRole('row').filter({ hasText: url })).toHaveCount(0);
    expect((await page.goto(path))?.status()).toBe(404);
  });

  test('a real outbox event reaches an endpoint subscribed to it (thin, from the relay)', async ({
    page,
  }) => {
    await signIn(page);
    const path = await addEndpoint(page, hookUrl('lifecycle'), {
      types: ['event.created', 'event.published'],
    });
    // A new event, published: two public events.
    const name = `Hook night ${test.info().project.name} ${Date.now()}`;
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name', { exact: true }).fill(name);
    await page.getByLabel('Time zone').selectOption('America/Chicago');
    await page.getByLabel('Starts', { exact: true }).fill('2031-06-01T19:00');
    await page.getByLabel('Ends', { exact: true }).fill('2031-06-01T23:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    // The worker's relay, now (dev/CI).
    const drained = await page.request.post('/api/dev/webhooks/drain', { form: { org: 'lakeside-events' } });
    expect(drained.ok()).toBe(true);
    await page.goto(path);
    await expect(
      deliveries(page).getByRole('row').filter({ hasText: 'event.created' }).first(),
    ).toContainText('Delivered');
    await expect(
      deliveries(page).getByRole('row').filter({ hasText: 'event.published' }).first(),
    ).toContainText('Delivered');
    // Only the chosen types: no ticket types, orders or anything else reached it.
    const types = await deliveries(page).getByRole('row').locator('td:nth-child(2)').allTextContents();
    expect(new Set(types.filter(Boolean))).toEqual(new Set(['event.created', 'event.published']));
    await deleteEndpoint(page, path);
  });

  test('signing secret: shown on request, copied, rotated with confirmation', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page);
    const path = await addEndpoint(page, hookUrl('secret'));
    await page.getByRole('button', { name: 'Show secret' }).click();
    const first = (await page.getByTestId('webhook-secret').textContent()) ?? '';
    expect(first).toMatch(/^whsec_[A-Za-z0-9+/=]{20,}$/);
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);
    await page.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(page.getByTestId('webhook-secret')).toHaveCount(0);

    // Rotating asks "Confirm it's you" once the sign-in is no longer fresh.
    await ageSession(page);
    await page.reload();
    await page.getByRole('button', { name: 'Rotate secret' }).click();
    await confirmStepUp(page, personaCode());
    await expect(page.getByRole('status').filter({ hasText: 'Secret rotated.' })).toBeVisible();
    await page.getByRole('button', { name: 'Show secret' }).click();
    const second = (await page.getByTestId('webhook-secret').textContent()) ?? '';
    expect(second).toMatch(/^whsec_/);
    expect(second).not.toBe(first);
    await expectAccessible(page);
    await deleteEndpoint(page, path);
  });

  test('a failing receiver: failed delivery with a retry time, fixed URL, resend and recover', async ({
    page,
  }) => {
    await signIn(page);
    const path = await addEndpoint(page, hookUrl('broken', 'fail'));
    await page.getByRole('button', { name: 'Send test' }).click();
    const failed = deliveries(page).getByRole('row').filter({ hasText: 'Failed' }).first();
    await expect(failed).toContainText('503');
    await expect(failed).toContainText('Automatic');
    await expect(failed.locator('td').nth(5)).not.toHaveText('—');

    // Point it at a working URL (the settings form), then replay the failed message.
    const settings = page.getByRole('heading', { name: 'Endpoint settings' }).locator('..');
    await settings.getByLabel('Endpoint URL').fill(hookUrl('fixed'));
    await settings.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Endpoint saved.' })).toBeVisible();
    await page
      .getByRole('button', { name: /^Resend webhook\.test from / })
      .first()
      .click();
    await expect(page.getByText('Resent', { exact: true }).first()).toBeVisible();
    await page.reload();
    const resent = deliveries(page).getByRole('row').filter({ hasText: 'Resend' }).first();
    await expect(resent).toContainText('Delivered');

    await page.getByLabel('Failed since').selectOption('24h');
    await page.getByRole('button', { name: 'Resend failed messages' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Failed messages are being resent.' }),
    ).toBeVisible();
    await expectAccessible(page);
    await deleteEndpoint(page, path);
  });

  test('pausing an endpoint shows it paused, and it can be turned back on', async ({ page }) => {
    await signIn(page);
    const url = hookUrl('pause');
    const path = await addEndpoint(page, url);
    const settings = page.getByRole('heading', { name: 'Endpoint settings' }).locator('..');
    await settings.getByRole('checkbox', { name: /Send messages to this endpoint/ }).uncheck();
    await settings.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Endpoint saved.' })).toBeVisible();
    await page.goto(LIST);
    await expect(page.getByRole('row').filter({ hasText: url })).toContainText('Paused');
    await page.goto(path);
    await page
      .getByRole('heading', { name: 'Endpoint settings' })
      .locator('..')
      .getByRole('checkbox', { name: /Send messages to this endpoint/ })
      .check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Endpoint saved.' })).toBeVisible();
    await page.goto(LIST);
    await expect(page.getByRole('row').filter({ hasText: url })).toContainText('Active');
    await deleteEndpoint(page, path);
  });

  test('validation: empty, http, private and credentialed URLs, and no event chosen', async ({ page }) => {
    await signIn(page);
    await page.goto(LIST);
    const url = page.getByLabel('Endpoint URL');
    const add = page.getByRole('button', { name: 'Add endpoint' });
    await add.click();
    await expect(page.getByText('Enter a full URL, like https://example.com/webhooks.')).toBeVisible();
    await expect(url).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);
    for (const [value, message] of [
      ['http://hooks.example.com/x', 'Use an https:// URL.'],
      ['https://10.0.0.5/hook', 'This address is private or reserved. Use a public address.'],
      ['https://localhost/hook', "This host can't receive webhooks. Use a public address."],
      ['https://me:pw@hooks.example.com/x', 'Remove the user name and password from the URL.'],
      ['https://hooks.example.com:8443/x', 'Use the standard https port (443).'],
    ] as const) {
      await url.fill(value);
      await add.click();
      await expect(page.getByText(message)).toBeVisible();
    }
    await url.fill(hookUrl('none-chosen'));
    await page.getByRole('radio', { name: 'Only the events I choose' }).check();
    await add.click();
    await expect(page.getByText('Choose at least one event, or send all events.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Webhook endpoint', level: 1 })).toHaveCount(0);
  });

  test('keyboard only: add an endpoint and send a test', async ({ page }) => {
    await signIn(page);
    await page.goto(LIST);
    await page.getByLabel('Endpoint URL').focus();
    const url = hookUrl('keys');
    await page.keyboard.type(url);
    await page.keyboard.press('Tab');
    await page.keyboard.type('Keyboard receiver');
    await page.keyboard.press('Tab');
    // The "All events" radio has focus; arrow to "Only the events I choose", then into the list.
    await expect(page.getByRole('radio', { name: 'All events, including new ones' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'Only the events I choose' })).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('checkbox', { name: 'order.paid', exact: true })).toBeFocused();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Add endpoint' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Webhook endpoint', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Send test' }).focus();
    await page.keyboard.press('Enter');
    await expect(deliveries(page).getByRole('row').filter({ hasText: 'webhook.test' }).first()).toContainText(
      'Delivered',
    );
    await deleteEndpoint(page, new URL(page.url()).pathname);
  });

  test('the embedded webhook portal shows the org’s endpoints and attempts', async ({ page }) => {
    await signIn(page);
    const url = hookUrl('portal');
    const path = await addEndpoint(page, url);
    await page.getByRole('button', { name: 'Send test' }).click();
    await expect(deliveries(page).getByRole('row').filter({ hasText: 'webhook.test' }).first()).toBeVisible();
    await page.goto(LIST);
    await page.getByRole('link', { name: 'Open the webhook portal' }).click();
    await expect(page.getByRole('heading', { name: 'Webhook portal', level: 1 })).toBeVisible();
    const frame = page.frameLocator('iframe[title="Webhook portal"]');
    await expect(frame.getByRole('heading', { name: 'Webhook portal (test mode)' })).toBeVisible();
    await expect(frame.getByRole('row').filter({ hasText: url })).toBeVisible();
    await expect(frame.getByRole('row').filter({ hasText: 'webhook.test' }).first()).toContainText(
      'Delivered',
    );
    // The accessible path: everything is on the console's own pages.
    await expect(page.getByRole('link', { name: 'the Webhooks pages' })).toBeVisible();
    await expectAccessible(page);
    // A forged portal link opens nothing.
    expect((await page.goto('/webhook-portal/forged~token'))?.status()).toBe(404);
    await deleteEndpoint(page, path);
  });

  test('a viewer cannot see or reach webhook endpoints', async ({ page, browser }) => {
    // An owner's endpoint the viewer must not reach.
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await signIn(owner);
    const path = await addEndpoint(owner, hookUrl('viewer'));

    await signIn(page, VIEWER);
    await page.goto(LIST);
    await expect(page.getByText('Only owners and admins manage webhooks')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add endpoint' })).toHaveCount(0);
    await expect(page.getByLabel('Endpoint URL')).toHaveCount(0);
    await expectAccessible(page);
    expect((await page.goto(path))?.status()).toBe(404);
    expect((await page.goto(`${LIST}/portal`))?.status()).toBe(404);

    await deleteEndpoint(owner, path);
    await ownerContext.close();
  });

  test('Arabic: the webhooks pages render right to left', async ({ page }) => {
    await signIn(page);
    await page.goto(`/ar${LIST}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'خطافات الويب', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'أضف نقطة الاستقبال' })).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('عنوان نقطة الاستقبال').fill('http://hooks.example.com/x');
    await page.getByRole('button', { name: 'أضف نقطة الاستقبال' }).click();
    await expect(page.getByText('استخدم عنوانًا يبدأ بـ https://.')).toBeVisible();
    await expectAccessible(page);
  });

  test('the API keys page links to webhooks', async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events/api-keys');
    await page.getByRole('link', { name: 'Webhooks', exact: true }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/webhooks$/);
  });
});
