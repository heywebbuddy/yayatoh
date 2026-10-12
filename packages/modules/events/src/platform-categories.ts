import { withoutTenant } from '@yayatoh/db';
import { asc } from 'drizzle-orm';
import { platformCategories } from './schema.ts';

/** Public reference data only. Organization and event data are never read here. */
export function listPlatformCategoryCatalog() {
  return withoutTenant((tx) =>
    tx
      .select({
        key: platformCategories.key,
        label: platformCategories.label,
        inDefaults: platformCategories.inDefaults,
      })
      .from(platformCategories)
      .orderBy(asc(platformCategories.position), asc(platformCategories.key)),
  );
}
