import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Staff sign-in mail (agreement audit 2026-10-12): the console used the console mailer, which
 * refuses in production, so staff email codes and resets never arrived. It now sends through the
 * live provider and, without one in production, fails loudly instead of logging the code.
 */
describe('staff mailer', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('refuses in production without an email provider, and never logs the code', async () => {
    vi.stubEnv('YAYATOH_ENV', 'production');
    vi.stubEnv('EMAIL_PROVIDER', '');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { staffMailer } = await import('../src/server/mail.ts');
    await expect(staffMailer.sendOtp('staff@example.com', '123456', 'sign-in')).rejects.toThrow(
      'No email provider is configured for staff sign-in email',
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain('123456');
    info.mockRestore();
  });

  it('keeps the console mailer in development without a provider', async () => {
    vi.stubEnv('YAYATOH_ENV', 'development');
    vi.stubEnv('EMAIL_PROVIDER', '');
    const { staffMailer, liveEmail } = await import('../src/server/mail.ts');
    expect(liveEmail()).toBeNull();
    await expect(
      staffMailer.sendMagicLink('staff@example.com', 'https://admin.test/x'),
    ).resolves.toBeUndefined();
  });
});
