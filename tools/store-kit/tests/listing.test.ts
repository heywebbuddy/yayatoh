import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPS, loadStore, REPO_ROOT, runChecks } from '../src/app.ts';
import {
  APPLE_LIMITS,
  checkAppleListing,
  checkPlayListing,
  PLAY_LIMITS,
  placeholdersIn,
  renderPlaceholders,
  STORE_LOCALES,
} from '../src/listing.ts';
import { clone, type Doc } from './doc.ts';

describe.each(APPS)('%s listing', (app) => {
  const store = loadStore(app);

  it('passes every App Store and Play check', () => {
    expect(runChecks(app).listing).toEqual([]);
  });

  it('has all 13 locales in both stores', () => {
    const apple = Object.keys((store.apple as Doc).apple.info).sort();
    const play = Object.keys((store.play as Doc).listings).sort();
    expect(apple).toEqual(
      Object.values(STORE_LOCALES)
        .map((l) => l.apple)
        .sort(),
    );
    expect(play).toEqual(
      Object.values(STORE_LOCALES)
        .map((l) => l.play)
        .sort(),
    );
  });

  it('keeps every text of every locale within the store limits (counted in UTF-16 units)', () => {
    for (const [locale, i] of Object.entries<Doc>((store.apple as Doc).apple.info)) {
      expect(i.title.length, `${locale} title`).toBeLessThanOrEqual(APPLE_LIMITS.title);
      expect(i.subtitle.length, `${locale} subtitle`).toBeLessThanOrEqual(APPLE_LIMITS.subtitle);
      expect(i.promoText.length, `${locale} promo`).toBeLessThanOrEqual(APPLE_LIMITS.promoText);
      expect(i.description.length, `${locale} description`).toBeLessThanOrEqual(APPLE_LIMITS.description);
      expect(i.keywords.join(',').length, `${locale} keywords`).toBeLessThanOrEqual(APPLE_LIMITS.keywords);
      expect(i.releaseNotes.length, `${locale} notes`).toBeLessThanOrEqual(APPLE_LIMITS.releaseNotes);
    }
    for (const [locale, i] of Object.entries<Doc>((store.play as Doc).listings)) {
      expect(i.title.length, `${locale} title`).toBeLessThanOrEqual(PLAY_LIMITS.title);
      expect(i.shortDescription.length, `${locale} short`).toBeLessThanOrEqual(PLAY_LIMITS.shortDescription);
      expect(i.fullDescription.length, `${locale} full`).toBeLessThanOrEqual(PLAY_LIMITS.fullDescription);
      expect(i.releaseNotes.length, `${locale} notes`).toBeLessThanOrEqual(PLAY_LIMITS.releaseNotes);
    }
  });

  it('translates every locale: no description is the English text', () => {
    const info = (store.apple as Doc).apple.info as Record<string, Doc>;
    const english = info['en-US']?.description;
    for (const [locale, i] of Object.entries(info))
      if (locale !== 'en-US') expect(i.description).not.toBe(english);
  });

  it('takes support, marketing and privacy URLs from environment names, never literals', () => {
    const names = placeholdersIn(store.apple, store.play);
    expect(names).toEqual(
      expect.arrayContaining(['STORE_SUPPORT_URL', 'STORE_MARKETING_URL', 'STORE_PRIVACY_URL']),
    );
    expect(JSON.stringify(store.apple)).not.toMatch(/https?:\/\//);
    expect(JSON.stringify(store.play)).not.toMatch(/https?:\/\//);
  });

  it("documents every environment name it needs in the app's .env.example", () => {
    const example = readFileSync(join(REPO_ROOT, 'apps', app, '.env.example'), 'utf8');
    for (const name of placeholdersIn(store.apple, store.play, store.compliance))
      expect(example, name).toMatch(new RegExp(`^# ${name}=`, 'm'));
  });

  it('uses phased release and leaves the release itself to the owner (P7-9)', () => {
    const release = (store.apple as Doc).apple.release;
    expect(release).toEqual({ automaticRelease: false, phasedRelease: true });
  });
});

describe('what the checks refuse', () => {
  const apple = () => clone(loadStore('mobile').apple) as Doc;
  const play = () => clone(loadStore('mobile').play) as Doc;

  it('a title over 30 characters', () => {
    const a = apple();
    a.apple.info['de-DE'].title = 'x'.repeat(31);
    expect(checkAppleListing(a)).toContain('apple.info.de-DE.title: 31 characters, limit 30');
  });

  it('a subtitle, promo text, description or keywords over their limits', () => {
    const a = apple();
    const en = a.apple.info['en-US'];
    en.subtitle = 'x'.repeat(31);
    en.promoText = 'x'.repeat(171);
    en.description = 'x'.repeat(4001);
    en.keywords = ['a'.repeat(60), 'b'.repeat(60)];
    const errors = checkAppleListing(a).join('\n');
    expect(errors).toMatch(/subtitle: 31 characters/);
    expect(errors).toMatch(/promoText: 171 characters/);
    expect(errors).toMatch(/description: 4001 characters/);
    expect(errors).toMatch(/keywords: 121 characters/);
  });

  it('a Play short description over 80 and release notes over 500', () => {
    const p = play();
    p.listings['ja-JP'].shortDescription = 'x'.repeat(81);
    p.listings['zh-CN'].releaseNotes = 'x'.repeat(501);
    const errors = checkPlayListing(p).join('\n');
    expect(errors).toMatch(/ja-JP\.shortDescription: 81 characters/);
    expect(errors).toMatch(/zh-CN\.releaseNotes: 501 characters/);
  });

  it('a missing or extra locale', () => {
    const a = apple();
    delete a.apple.info.hi;
    a.apple.info.xx = a.apple.info['en-US'];
    const errors = checkAppleListing(a);
    expect(errors).toContain('apple.info: missing locale hi');
    expect(errors).toContain('apple.info: unexpected locale xx');
  });

  it('a locale still in English', () => {
    const p = play();
    p.listings['fr-FR'].fullDescription = p.listings['en-US'].fullDescription;
    expect(checkPlayListing(p)).toContain('play.listings.fr-FR.fullDescription: still the English text');
  });

  it('a literal URL, or release settings that skip the phased rollout', () => {
    const a = apple();
    a.apple.info['en-US'].supportUrl = 'https://example.com/help';
    a.apple.release.phasedRelease = false;
    const errors = checkAppleListing(a).join('\n');
    expect(errors).toMatch(/supportUrl: must be a/);
    expect(errors).toMatch(/phasedRelease: must be true/);
  });

  it('an unknown advisory value', () => {
    const a = apple();
    a.apple.advisory.violenceRealistic = 'SOMETIMES';
    expect(checkAppleListing(a)).toContain('apple.advisory.violenceRealistic: not an allowed value');
  });
});

describe('render', () => {
  const store = loadStore('mobile');
  const env = {
    STORE_SUPPORT_URL: 'https://example.test/support',
    STORE_MARKETING_URL: 'https://example.test',
    STORE_PRIVACY_URL: 'https://example.test/privacy',
    STORE_SUPPORT_EMAIL: 'help@example.test',
    STORE_REVIEW_FIRST_NAME: 'Rae',
    STORE_REVIEW_LAST_NAME: 'Viewer',
    STORE_REVIEW_EMAIL: 'review@example.test',
    STORE_REVIEW_PHONE: '+1 555 0100',
    REVIEW_DEMO_EMAIL: 'demo@example.test',
    REVIEW_DEMO_CODE: '123456',
  };

  it('fills every placeholder', () => {
    const out = renderPlaceholders(store.apple, env);
    expect(JSON.stringify(out)).not.toMatch(/\$\{/);
    expect((out as Doc).apple.info['en-US'].supportUrl).toBe('https://example.test/support');
    expect((renderPlaceholders(store.play, env) as Doc).contactEmail).toBe('help@example.test');
  });

  it('names every value that is missing instead of writing a blank', () => {
    expect(() =>
      renderPlaceholders(store.apple, { ...env, STORE_SUPPORT_URL: '', REVIEW_DEMO_CODE: undefined }),
    ).toThrow(/REVIEW_DEMO_CODE, STORE_SUPPORT_URL/);
  });

  it('refuses a URL that is not https', () => {
    expect(() =>
      renderPlaceholders(store.apple, { ...env, STORE_PRIVACY_URL: 'http://example.test/p' }),
    ).toThrow(/STORE_PRIVACY_URL must be an https/);
  });
});
