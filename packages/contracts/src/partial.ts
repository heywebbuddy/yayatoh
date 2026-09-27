import { z } from 'zod';

type NoDefaults<S extends z.ZodRawShape> = {
  [K in keyof S]: z.ZodOptional<S[K] extends z.ZodDefault<infer I> ? I : S[K]>;
};

/**
 * Update inputs: every field optional and **without** its create-time `.default()`. Zod's
 * `.partial()` keeps defaults, so an update naming one field would silently reset every other
 * defaulted field.
 */
export function partialNoDefaults<S extends z.ZodRawShape>(
  schema: z.ZodObject<S>,
): z.ZodObject<NoDefaults<S>> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([k, v]) => [
      k,
      (v instanceof z.ZodDefault ? (v.def.innerType as z.ZodType) : (v as z.ZodType)).optional(),
    ]),
  );
  return z.object(shape) as unknown as z.ZodObject<NoDefaults<S>>;
}
