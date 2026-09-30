import type { z } from 'zod';

/**
 * An explicit allowlist serializer (CLAUDE.md "Public output"). Only keys declared in the
 * schema survive; unknown keys are stripped at every depth of plain z.object schemas.
 * `strictObject` / `looseObject` are rejected so a serializer can never pass extra keys through.
 */
export interface Serializer<T> {
  readonly name: string;
  readonly schema: z.ZodType<T>;
  serialize(value: unknown): T;
  serializeMany(values: readonly unknown[]): T[];
}

export function defineSerializer<T>(name: string, schema: z.ZodType<T>): Serializer<T> {
  assertNoPassthrough(schema, name);
  return Object.freeze({
    name,
    schema,
    serialize: (value: unknown) => schema.parse(value),
    serializeMany: (values: readonly unknown[]) => values.map((v) => schema.parse(v)),
  });
}

function assertNoPassthrough(schema: z.ZodType, name: string, seen = new Set<z.ZodType>()): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
  if (def.type === 'object') {
    const catchall = def.catchall as z.ZodType | undefined;
    const catchallType = catchall
      ? (catchall as unknown as { _zod: { def: { type: string } } })._zod.def.type
      : null;
    if (catchallType && catchallType !== 'never') {
      throw new Error(`Serializer ${name}: objects must not pass unknown keys through`);
    }
    for (const child of Object.values(def.shape as Record<string, z.ZodType>))
      assertNoPassthrough(child, name, seen);
    return;
  }
  for (const key of ['innerType', 'element', 'in', 'out', 'left', 'right', 'valueType'] as const) {
    const child = def[key] as z.ZodType | undefined;
    if (child && typeof child === 'object' && '_zod' in child) assertNoPassthrough(child, name, seen);
  }
  if (Array.isArray(def.options))
    for (const o of def.options as z.ZodType[]) assertNoPassthrough(o, name, seen);
}
