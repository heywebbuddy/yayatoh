import { expect, type Page, test } from '@playwright/test';
import { createYayatohClient, type Schemas, unwrap, YayatohApiError } from '@yayatoh/sdk';
import { inOptions, pickOption, signIn } from './helpers.ts';

const ORG = '/o/lakeside-events';
const TZ = 'America/Chicago';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

/** `YYYY-MM-DD` in Chicago, `days` from today. */
function chicagoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}
const at = (days: number, hhmm: string) => `${chicagoDate(days)}T${hhmm}`;

/** A conference in Chicago from day 40 09:00 to day 42 18:00, via the one-page form. */
async function createEvent(page: Page, name: string, opts: { private?: boolean } = {}) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Event type'), 'conference');
  await pickOption(page.getByLabel('Time zone'), TZ);
  await page.getByLabel('Starts', { exact: true }).fill(at(40, '09:00'));
  await page.getByLabel('Ends', { exact: true }).fill(at(42, '18:00'));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  if (opts.private) {
    await page.goto(`${base}/details`);
    await page.getByLabel('Private (access code)', { exact: true }).check();
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved.')).toBeVisible();
    await page.goto(base);
  }
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  return { base, slug: base.split('/').pop() ?? '' };
}

async function addSpeaker(page: Page, base: string, name: string) {
  await page.goto(`${base}/speakers`);
  const add = page.getByRole('region', { name: 'Add speaker' });
  await add.getByLabel('Speaker name').fill(name);
  await add.getByRole('button', { name: 'Add speaker' }).click();
  await expect(add.getByText('Speaker added.')).toBeVisible();
}

async function addSession(
  page: Page,
  base: string,
  s: { title: string; from: string; to: string; speaker?: string },
) {
  await page.goto(`${base}/sessions`);
  const rooms = page.getByRole('region', { name: 'Rooms' });
  if (
    (await inOptions(
      page.getByRole('region', { name: 'Add session' }).getByLabel('Room', { exact: true }),
      (list) => list.getByRole('option', { name: 'Main hall' }).count(),
    )) === 0
  ) {
    await rooms.getByLabel('Room name').fill('Main hall');
    await rooms.getByRole('button', { name: 'Add room' }).click();
    await expect(rooms.getByText('Room added.')).toBeVisible();
  }
  const add = page.getByRole('region', { name: 'Add session' });
  await add.getByLabel('Session title').fill(s.title);
  await add.getByLabel('Session starts').fill(s.from);
  await add.getByLabel('Session ends').fill(s.to);
  await pickOption(add.getByLabel('Room', { exact: true }), { label: 'Main hall' });
  if (s.speaker) await add.getByRole('checkbox', { name: s.speaker }).check();
  await add.getByRole('button', { name: 'Add session' }).click();
  await expect(add.getByText('Session added.')).toBeVisible();
}

test.describe('/v1 content through the TypeScript SDK (M1.13d)', () => {
  test('the SDK reads a published agenda from the built app; a private event stays a 404', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const n = stamp();
    const speaker = `Sdk Speaker ${n}`;
    const { base, slug } = await createEvent(page, `SDK Summit ${n}`);
    await addSpeaker(page, base, speaker);
    await addSession(page, base, {
      title: `Keynote ${n}`,
      from: at(40, '10:00'),
      to: at(40, '11:00'),
      speaker,
    });
    await addSession(page, base, { title: `Closing ${n}`, from: at(41, '16:00'), to: at(41, '17:00') });

    // The generated client against the web app's /api/v1 mount, no credential.
    const sdk = createYayatohClient({ baseUrl: `${baseURL}/api`, client: 'sdk-ts/0.3.0' });
    const agenda: Schemas['PublicAgenda'] = await unwrap(
      sdk.GET('/v1/public/events/{slug}/agenda', { params: { path: { slug } } }),
    );
    expect(agenda.timezone).toBe(TZ);
    expect(agenda.days.map((d) => d.date)).toEqual([chicagoDate(40), chicagoDate(41)]);
    expect(agenda.days[0]?.sessions[0]).toMatchObject({
      title: `Keynote ${n}`,
      room: 'Main hall',
      speakers: [{ name: speaker }],
    });
    expect(agenda.days[1]?.sessions.map((s) => s.title)).toEqual([`Closing ${n}`]);

    const speakers = await unwrap(
      sdk.GET('/v1/public/events/{slug}/speakers', { params: { path: { slug } } }),
    );
    expect(speakers.data.map((s) => s.name)).toEqual([speaker]);
    const one = await unwrap(
      sdk.GET('/v1/public/events/{slug}/speakers/{speakerId}', {
        params: { path: { slug, speakerId: speakers.data[0]?.id ?? '' } },
      }),
    );
    expect(one.sessions.map((s) => s.title)).toEqual([`Keynote ${n}`]);

    // Conditional GET: the ETag comes back as a 304.
    const first = await page.request.get(`/api/v1/public/events/${slug}/agenda`);
    expect(first.headers()['cache-control']).toBe('public, max-age=60');
    const again = await page.request.get(`/api/v1/public/events/${slug}/agenda`, {
      headers: { 'if-none-match': first.headers().etag ?? '' },
    });
    expect(again.status()).toBe(304);

    // A private event's agenda is a 404 for anyone without the org's credential.
    const priv = await createEvent(page, `Private SDK ${n}`, { private: true });
    await addSession(page, priv.base, { title: `Hidden ${n}`, from: at(40, '10:00'), to: at(40, '11:00') });
    const err = await unwrap(
      sdk.GET('/v1/public/events/{slug}/agenda', { params: { path: { slug: priv.slug } } }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YayatohApiError);
    expect((err as YayatohApiError).status).toBe(404);
    expect((err as YayatohApiError).code).toBe('not_found');
    const sections = await page.request.get(`/api/v1/public/events/${priv.slug}/sections`);
    expect(sections.status()).toBe(404);
    expect(await sections.text()).not.toContain(`Hidden ${n}`);
  });
});
