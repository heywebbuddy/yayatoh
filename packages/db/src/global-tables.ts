/**
 * Tables that are deliberately NOT tenant-scoped. Every other table must be defined with
 * `tenantTable()` (checked statically by tools/check-modules and at runtime by the schema guard).
 * Adding an entry needs a reason and a reviewer from the tenancy lane.
 */
export const GLOBAL_TABLES: Readonly<Record<string, string>> = {};
