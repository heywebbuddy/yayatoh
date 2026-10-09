import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ own: vi.fn(), update: vi.fn(), revalidate: vi.fn(), access: vi.fn() }));
vi.mock('../src/server/dashboard-access.ts', () => ({ dashboardAccess: mocks.access }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../src/server/session.ts', () => ({ ownAuthSession: mocks.own }));
vi.mock('../src/server/auth.ts', () => ({ getAuth: () => ({ api: { updateUser: mocks.update } }) }));
const { saveAttendeeProfile } = await import('../src/app/[locale]/attendee/profile-actions.ts');
const previous = { ok: false, code: null };
function form() {
  const data = new FormData();
  data.set('name', ' My name ');
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.own.mockResolvedValue({ user: { id: 'self', emailVerified: true } });
  mocks.access.mockResolvedValue({ kind: 'attendee' });
});

describe('Attendee profile updates', () => {
  it('rejects organizer profile updates through attendee actions', async () => {
    mocks.access.mockResolvedValue({ kind: 'organizer' });
    expect((await saveAttendeeProfile(previous, form())).code).toBe('forbidden');
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('requires a verified own account before any update', async () => {
    mocks.own.mockResolvedValue(null);
    expect((await saveAttendeeProfile(previous, form())).code).toBe('unauthenticated');
    mocks.own.mockResolvedValue({ user: { emailVerified: false } });
    expect((await saveAttendeeProfile(previous, form())).code).toBe('unauthenticated');
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('passes only editable fields to the session-authenticated update API, ignoring forged identity fields', async () => {
    const data = form();
    data.set('userId', 'another-user');
    data.set('email', 'another@example.com');
    expect((await saveAttendeeProfile(previous, data)).ok).toBe(true);
    expect(mocks.update.mock.calls[0]?.[0].body).toEqual({ name: 'My name' });
  });
  it('rejects empty names and oversized or invalid photos without updating the account', async () => {
    const blank = form();
    blank.set('name', '   ');
    expect((await saveAttendeeProfile(previous, blank)).fields).toEqual(['name']);
    const big = form();
    big.set('photo', new File([new Uint8Array(512 * 1024 + 1)], 'photo.png', { type: 'image/png' }));
    expect((await saveAttendeeProfile(previous, big)).fields).toEqual(['photo']);
    const fake = form();
    fake.set('photo', new File(['invalid'], 'photo.png', { type: 'image/png' }));
    expect((await saveAttendeeProfile(previous, fake)).fields).toEqual(['photo']);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('decodes and resizes actual image bytes before storing a profile thumbnail', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#8844ff' } })
      .png()
      .toBuffer();
    const data = form();
    data.set('photo', new File([png], 'photo.png', { type: 'image/png' }));
    expect((await saveAttendeeProfile(previous, data)).ok).toBe(true);
    const image = mocks.update.mock.calls[0]?.[0].body.image as string;
    expect(image).toMatch(/^data:image\/webp;base64,/);
    const metadata = await sharp(Buffer.from(image.split(',')[1] ?? '', 'base64')).metadata();
    expect([metadata.width, metadata.height]).toEqual([256, 256]);
  });
});
