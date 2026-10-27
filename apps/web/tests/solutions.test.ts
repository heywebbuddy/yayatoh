import { PROFILES } from '@yayatoh/platform';
import { describe, expect, it } from 'vitest';
import { SOLUTION_KEYS, SOLUTIONS } from '../src/components/showcase/solutions.ts';

describe('solution landing pages', () => {
  it.each(SOLUTION_KEYS)('%s lists only modules its profile really has', (key) => {
    const s = SOLUTIONS[key];
    // A feature is real when the profile ships it by default or lists its page in its navigation.
    const p = PROFILES[s.profile];
    const modules: readonly string[] = [...p.defaultModules, ...p.nav.map((n) => n.module)];
    expect(s.features).toHaveLength(6);
    for (const f of s.features) expect(modules, `${key}/${f.key}`).toContain(f.module);
  });
});
