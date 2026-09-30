import { describe, expect, it } from 'vitest';
import { forceRowLevelSecurity } from '../src/rls-migration.ts';

describe('forceRowLevelSecurity', () => {
  it('adds FORCE after every ENABLE, once', () => {
    const input =
      'ALTER TABLE "tenancy"."members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint\nSELECT 1;';
    const once = forceRowLevelSecurity(input);
    expect(once).toContain('ALTER TABLE "tenancy"."members" FORCE ROW LEVEL SECURITY;');
    expect(forceRowLevelSecurity(once)).toBe(once);
  });
});
