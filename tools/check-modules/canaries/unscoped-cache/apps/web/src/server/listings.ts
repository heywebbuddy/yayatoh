import { unstable_cache } from 'next/cache';

// Canary: a cached public read whose key has no org scope (two tenants could share it).
export const listings = unstable_cache(async () => [], ['listings']);
