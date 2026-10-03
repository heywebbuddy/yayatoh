/** Browser-safe exports: the segment DSL (zod only), shared by the audience builder and the server. */

/** M6.1a: duplicate scoring and merge rules (pure). */
export * from './merge/domain.ts';
export * from './segments/dsl.ts';
/** M6.1b: the contact stats formulas (pure), for pages that explain a number. */
export * from './stats/formulas.ts';
