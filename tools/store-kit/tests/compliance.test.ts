import { USES_NON_EXEMPT_ENCRYPTION } from '@yayatoh/mobile-core/app-config';
import { describe, expect, it } from 'vitest';
import { APPS, loadStore, productionConfig, runChecks } from '../src/app.ts';
import { checkCompliance, MOBILE_GUIDELINES } from '../src/compliance.ts';
import { clone, type Doc } from './doc.ts';

describe.each(APPS)('%s compliance answers', (app) => {
  it('pass every check', () => {
    expect(runChecks(app).compliance).toEqual([]);
  });

  it('write the export-compliance answer into the iOS build', () => {
    const config = productionConfig(app);
    expect(config.ios?.config?.usesNonExemptEncryption).toBe(USES_NON_EXEMPT_ENCRYPTION);
    expect((loadStore(app).compliance as Doc).exportCompliance.usesNonExemptEncryption).toBe(
      USES_NON_EXEMPT_ENCRYPTION,
    );
  });

  it('rate the app consistently with the Apple advisory answers', () => {
    const store = loadStore(app);
    const advisory = (store.apple as Doc).apple.advisory as Record<string, unknown>;
    const frequent = Object.values(advisory).some((v) => v === 'FREQUENT_OR_INTENSE');
    expect(frequent).toBe(false);
    expect(advisory.unrestrictedWebAccess).toBe(false);
    expect(advisory.gambling).toBe(false);
  });
});

describe('the attendee review notes', () => {
  const notes = ((loadStore('mobile').apple as Doc).apple.review.notes as string) ?? '';

  it('explain no in-app purchase, Sign in with Apple and in-app account deletion', () => {
    for (const id of MOBILE_GUIDELINES) expect(notes).toContain(id);
    expect(notes).toMatch(/no in-app purchase|not with in-app purchase/i);
    expect(notes).toMatch(/Buy on the web/);
    expect(notes).toMatch(/Account tab → Delete account/);
  });

  it('say how a reviewer signs in and never contain a real code, address or password', () => {
    expect(notes).toMatch(/HOW TO SIGN IN/);
    expect(notes).not.toMatch(/\b\d{6}\b/);
    expect(notes).not.toMatch(/@/);
  });
});

describe('the Staff review notes', () => {
  const notes = ((loadStore('staff').apple as Doc).apple.review.notes as string) ?? '';

  it('walk a reviewer through enrolment, a scan and a repeat scan', () => {
    expect(notes).toMatch(/Enrol this device/);
    expect(notes).toMatch(/Enrolment link/);
    expect(notes).toMatch(/Enrol with this link/);
    expect(notes).toMatch(/Type a code/);
    expect(notes).toMatch(/Already scanned/);
    expect(notes).toMatch(/airplane mode/);
  });

  it('say the camera only reads QR codes and the app sells nothing', () => {
    expect(notes).toMatch(/camera is used only to read QR codes/i);
    expect(notes).toMatch(/no in-app purchase/i);
  });
});

describe('what the check refuses', () => {
  const base = () => ({
    compliance: clone(loadStore('mobile').compliance),
    reviewNotes: (loadStore('mobile').apple as Doc).apple.review.notes as string,
    configUsesNonExemptEncryption: true as boolean | undefined,
    requiredGuidelines: MOBILE_GUIDELINES,
  });

  it('an export answer that disagrees with app.config.ts', () => {
    expect(checkCompliance({ ...base(), configUsesNonExemptEncryption: false }).join()).toMatch(
      /does not match ios.config.usesNonExemptEncryption/,
    );
    expect(checkCompliance({ ...base(), configUsesNonExemptEncryption: undefined }).join()).toMatch(
      /does not match/,
    );
  });

  it('review notes that skip a guideline the answers rely on', () => {
    const input = base();
    expect(checkCompliance({ ...input, reviewNotes: input.reviewNotes.replace('5.1.1(v)', 'x') })).toContain(
      'the review notes do not cite guideline 5.1.1(v)',
    );
  });

  it('proprietary cryptography', () => {
    const input = base();
    (input.compliance as Doc).exportCompliance.algorithms = 'custom';
    expect(checkCompliance(input).join()).toMatch(/only standard, published algorithms/);
  });

  it('a missing Play account-deletion link', () => {
    const input = base();
    delete (input.compliance as Doc).play.accountDeletionUrl;
    expect(checkCompliance(input).join()).toMatch(/play.accountDeletionUrl/);
  });
});
