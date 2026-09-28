import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';
import { addGuests, createGala, unique } from './seating-helpers.ts';

/**
 * M1.13d: the M1.8 bulk actions through `/api/v1` with a key made in the console. The new
 * "Change attendees and resend tickets" scope lets a key label and resend; a key without it is
 * refused. A new event on the seeded org, so no other test's data changes.
 */
test.describe('/v1 bulk actions (M1.13d)', () => {
  test('a key with the attendees write scope labels guests, polls, undoes; a read-only key is 403', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const stamp = unique('Api bulk');
    const base = await createGala(page, stamp);
    const guests = [`Ann ${stamp}`, `Bo ${stamp}`];
    await addGuests(page, base, guests);

    const create = async (name: string, scopes: string[]) => {
      await page.goto('/o/lakeside-events/api-keys');
      await page.getByLabel('Name', { exact: true }).fill(name);
      for (const s of scopes) await page.getByRole('checkbox', { name: s }).check();
      await page.getByRole('button', { name: 'Create key' }).click();
      await expect(page.getByText(`Key “${name}” created.`)).toBeVisible();
      return (await page.getByTestId('new-api-key').textContent()) ?? '';
    };
    const writer = await create(`Bulk ${stamp}`, ['Read attendees', 'Change attendees and resend tickets']);
    await expect(page.getByRole('row').filter({ hasText: `Bulk ${stamp}` })).toContainText(
      'Read attendees, Change attendees and resend tickets',
    );
    const reader = await create(`Reader ${stamp}`, ['Read attendees']);
    const auth = (key: string) => ({ authorization: `Bearer ${key}` });

    // The event's id, from the org-wide attendee search.
    const hits = await page.request.get(
      `/api/v1/orgs/lakeside-events/attendees/search?q=${encodeURIComponent(stamp)}`,
      { headers: auth(writer) },
    );
    expect(hits.status()).toBe(200);
    const found = (await hits.json()).data as { eventId: string }[];
    expect(found).toHaveLength(2);
    const eventId = found[0]?.eventId;
    const path = `/api/v1/orgs/lakeside-events/events/${eventId}/bulk/labels`;
    const body = { selection: { filter: { search: stamp } }, add: ['From the API'] };

    const denied = await page.request.post(path, {
      headers: { ...auth(reader), 'idempotency-key': `e2e-${Date.now()}-reader` },
      data: body,
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe('forbidden');

    const key = `e2e-${Date.now()}-labels`;
    const started = await page.request.post(path, {
      headers: { ...auth(writer), 'idempotency-key': key },
      data: body,
    });
    expect(started.status()).toBe(202);
    const op = await started.json();
    expect(op).toMatchObject({ kind: 'labels', total: 2 });
    // A retry with the same key is the same operation.
    const retry = await page.request.post(path, {
      headers: { ...auth(writer), 'idempotency-key': key },
      data: body,
    });
    expect((await retry.json()).id).toBe(op.id);
    await expect
      .poll(async () => {
        const r = await page.request.get(`/api/v1/orgs/lakeside-events/bulk/labels/${op.id}`, {
          headers: auth(writer),
        });
        return (await r.json()).status;
      })
      .toBe('done');

    // The console shows the labels the API added.
    await page.goto(`${base}/attendees`);
    for (const name of guests)
      await expect(page.getByRole('row').filter({ hasText: name })).toContainText('From the API');

    const undone = await page.request.post(`/api/v1/orgs/lakeside-events/bulk/labels/${op.id}/undo`, {
      headers: { ...auth(writer), 'idempotency-key': `e2e-${Date.now()}-undo` },
    });
    expect(undone.status()).toBe(202);
    expect((await undone.json()).status).toBe('undone');
    await page.reload();
    for (const name of guests)
      await expect(page.getByRole('row').filter({ hasText: name })).not.toContainText('From the API');
  });
});
