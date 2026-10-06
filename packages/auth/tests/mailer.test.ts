import { afterEach, describe, expect, it, vi } from 'vitest';
import { consoleMailer } from '../src/mailer.ts';

describe('console mailer', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('logs codes and links outside production (dev personas, e2e)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await consoleMailer.sendOtp('a@example.test', '305117', 'sign-in');
    expect(info.mock.calls[0]?.[0]).toContain('305117');
  });

  it('refuses in production and never writes the code or link to a log', async () => {
    vi.stubEnv('YAYATOH_ENV', 'production');
    const logged: string[] = [];
    for (const level of ['info', 'log', 'warn', 'error'] as const)
      vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(a.join(' ')));
    await expect(consoleMailer.sendOtp('a@example.test', '305117', 'sign-in')).rejects.toThrow();
    await expect(
      consoleMailer.sendMagicLink('a@example.test', 'https://x.test/secret-link'),
    ).rejects.toThrow();
    await expect(
      consoleMailer.sendPasswordReset?.('a@example.test', 'https://x.test/secret-reset'),
    ).rejects.toThrow();
    const all = logged.join('\n');
    expect(all).not.toContain('305117');
    expect(all).not.toContain('secret-link');
    expect(all).not.toContain('secret-reset');
  });
});
