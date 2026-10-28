import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const at = (p: string) => new URL(p, import.meta.url);
const source = readFileSync(at('../src/components/organizers/landing-top.tsx'), 'utf8');
const en = JSON.parse(readFileSync(at('../messages/en.json'), 'utf8')).forOrganizers as Record<
  string,
  unknown
>;

describe('the organizer landing page', () => {
  it('every screenshot it shows exists in public/organizers/shots', () => {
    const shots = [
      'ticketing',
      'seating',
      'checkout',
      'website',
      'checkin',
      'sponsors',
      'networking',
      'ai',
      'donations',
      'analytics',
      'marketing',
      'team',
      'languages',
      'site-org',
    ];
    for (const n of shots) expect(existsSync(at(`../public/organizers/shots/${n}.jpg`)), n).toBe(true);
    for (const m of source.matchAll(/shots\/\$\{(\w+)/g)) expect(m[1]).toBeTruthy();
  });

  it('has copy for every feature, template and event type it renders', () => {
    const features = [
      'ticketing',
      'checkout',
      'website',
      'checkin',
      'sponsors',
      'networking',
      'ai',
      'donations',
      'analytics',
      'marketing',
      'team',
      'languages',
    ];
    const showcase = (en.showcase as { features: Record<string, Record<string, string>> }).features;
    for (const f of features)
      expect(Object.keys(showcase[f] ?? {}).sort(), f).toEqual([
        'outcome',
        's1',
        's2',
        's3',
        'title',
        'what',
      ]);
    const templates = en.templates as Record<string, Record<string, string>>;
    for (const k of ['gala', 'conference', 'concert', 'wedding', 'tour'])
      expect(templates[k]?.name, k).toBeTruthy();
    const types = en.types as Record<string, string>;
    for (const k of ['wedding', 'gala', 'concert', 'conference', 'community', 'tour', 'corporate'])
      expect(types[k], k).toBeTruthy();
  });

  it('applies motion only after mount: no style attribute is rendered by the motion components', () => {
    const motion = readFileSync(at('../src/components/organizers/motion.tsx'), 'utf8');
    expect(motion).not.toMatch(/<motion\./);
    expect(motion).not.toMatch(/\bstyle=\{/);
  });
});
