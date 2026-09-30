import { describe, expect, it } from 'vitest';
import { cacheKey, orgChangeTags, scopeTag } from '../src/lib/cache-keys.ts';
import { TtlCache } from '../src/lib/ttl-cache.ts';

const A = '01900000-0000-7000-8000-00000000000a';
const B = '01900000-0000-7000-8000-00000000000b';

describe('cache guard (M1.11a, isolation suite step 6)', () => {
  it('the same route for two orgs never shares a key or a tag', () => {
    const parts = ['tenant-home', 1];
    expect(cacheKey({ org: A }, parts)).not.toEqual(cacheKey({ org: B }, parts));
    expect(cacheKey({ org: A }, parts)[0]).toBe(`org:${A}`);
    expect(scopeTag({ org: A })).not.toBe(scopeTag({ org: B }));
    expect(cacheKey('marketplace', parts)[0]).toBe('marketplace');
  });

  it('refuses a scope without a real org id', () => {
    expect(() => scopeTag({ org: '' })).toThrow();
    expect(() => scopeTag({ org: 'lakeside-events' })).toThrow();
  });

  it('keeps key parts distinct by type and revalidates the org and the marketplace', () => {
    expect(cacheKey({ org: A }, [1])).not.toEqual(cacheKey({ org: A }, ['1']));
    expect(orgChangeTags(A)).toEqual([`org:${A}`, 'marketplace']);
  });
});

describe('ttl cache (proxy host lookups)', () => {
  it('expires entries and evicts the least recently used', () => {
    let t = 0;
    const c = new TtlCache<string | null>(2, 100, () => t);
    c.set('a', 'A');
    c.set('b', null);
    expect(c.get('b')).toBeNull();
    expect(c.get('a')).toBe('A');
    c.set('c', 'C'); // evicts b (a was used more recently)
    expect(c.get('b')).toBeUndefined();
    t = 150;
    expect(c.get('a')).toBeUndefined();
  });
});
