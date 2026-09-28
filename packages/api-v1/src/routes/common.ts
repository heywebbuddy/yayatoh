import { z } from '@hono/zod-openapi';
import type { Command } from '@yayatoh/kernel';
import { DEFAULT_LIMIT, MAX_LIMIT } from '../cursor.ts';
import { Problem } from '../resources.ts';

const problemContent = { 'application/problem+json': { schema: Problem } };
const p = (description: string) => ({ description, content: problemContent });

/** The problem responses every authenticated route can return. */
export const problems = {
  400: p('Validation failed (`validation_failed`)'),
  401: p('Missing, unknown or revoked credential (`unauthenticated`)'),
  403: p('The credential lacks the scope or role (`forbidden`, `module_not_enabled`)'),
  404: p('Not found, or not visible to this credential (`not_found`)'),
  429: p('Too many requests (`rate_limited`); see `Retry-After`'),
};
export const writeProblems = {
  ...problems,
  409: p('Conflict, invalid state, or the same Idempotency-Key is in flight'),
  422: p('The Idempotency-Key was used with a different request (`idempotency_key_reused`)'),
};
export const publicProblems = { 400: problems[400], 404: problems[404], 429: problems[429] };
/** Conditional GETs (`If-None-Match` matched the `ETag`). */
export const notModified = { 304: { description: 'Not modified: `If-None-Match` matched the `ETag`' } };

/** Org API key or a user's bearer session. */
export const orgSecurity: Record<string, string[]>[] = [{ apiKey: [] }, { bearerSession: [] }];
export const userSecurity: Record<string, string[]>[] = [{ bearerSession: [] }];

export const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
export const body = <S extends z.ZodType>(schema: S) => ({
  body: { content: { 'application/json': { schema } }, required: true as const },
});

export const OrgParam = z.object({
  org: z
    .string()
    .min(1)
    .max(63)
    .openapi({
      param: { name: 'org', in: 'path' },
      description: 'Organization id or slug',
      example: 'lakeside-events',
    }),
});
export const EventParams = OrgParam.extend({
  eventId: z.uuid().openapi({ param: { name: 'eventId', in: 'path' }, description: 'The event id' }),
});

export const SlugParam = z.object({
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9-]+$/)
    .openapi({
      param: { name: 'slug', in: 'path' },
      description: 'The event’s public slug',
      example: 'lakeside-jazz-night',
    }),
});

const Limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT)
  .openapi({ description: `Page size (1–${MAX_LIMIT}).` });

export const PageQuery = z.object({
  limit: Limit,
  cursor: z.string().max(200).optional().openapi({ description: 'The previous page’s `nextCursor`.' }),
});
/** Pages sorted by a name (M1.13d): the same contract, with room for a longer opaque cursor. */
export const KeyPageQuery = z.object({
  limit: Limit,
  cursor: z.string().max(512).optional().openapi({ description: 'The previous page’s `nextCursor`.' }),
});

export const IdempotencyHeader = z.object({
  'idempotency-key': z
    .string()
    .regex(/^[\x21-\x7e]{8,255}$/)
    .openapi({
      description:
        'Required on every write. Retrying with the same key returns the stored result (kept 24 h).',
      example: '6f1c2c1e-5d1e-4d7a-9f5b-2c4b1f0e9a11',
    }),
});

const cache = new WeakMap<object, unknown>();
/** The same command with Idempotency-Key required and replay of the stored output (kernel step 5). */
// biome-ignore lint/suspicious/noExplicitAny: any command shape
export function idempotent<C extends Command<any, any, any, any>>(command: C): C {
  let c = cache.get(command) as C | undefined;
  if (!c) {
    c = Object.freeze({ ...command, idempotent: true }) as C;
    cache.set(command, c);
  }
  return c;
}
