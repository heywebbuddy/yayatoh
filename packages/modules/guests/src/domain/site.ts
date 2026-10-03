import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { sanitizeMarkdown } from '@yayatoh/contracts';
import { z } from 'zod';
import type { SiteBlockKind } from '../schema.ts';

/**
 * The guest website (M4.5a): a block-based page for the guests of one wedding or gala, behind a
 * password (P4-3c), `noindex`, never on the marketplace. Pure rules: the block kinds and their
 * content, the password policy and hash, the access token a visitor's cookie carries, and which
 * sub-events a program block shows.
 */

export const MAX_SITE_BLOCKS = 30;
export const MAX_BLOCK_ITEMS = 20;
export const SITE_TITLE_MAX = 120;
export const SITE_INTRO_MAX = 1000;
export const BLOCK_HEADING_MAX = 120;
export const BLOCK_BODY_MAX = 5000;
export const ITEM_TEXT_MAX = 2000;
export const SITE_PASSWORD_MIN = 6;
export const SITE_PASSWORD_MAX = 72;

const Line = (max: number) => z.string().trim().max(max);
const Markdown = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((v) => sanitizeMarkdown(v.trim(), max));

/** An https link (registries, hotels): anything else is refused. */
export const HttpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && Boolean(u.hostname) && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'https_only');

const OptionalUrl = z
  .union([z.literal(''), HttpsUrl])
  .nullish()
  .transform((v) => (v ? v : null));

export const TextContent = z.object({ body: Markdown(BLOCK_BODY_MAX).default('') });
/** `everyone`: the sub-events every guest is invited to (new ones appear); `chosen`: the host's pick. */
export const ProgramContent = z.object({
  show: z.enum(['everyone', 'chosen']).default('everyone'),
  subEventIds: z.array(z.uuid()).max(20).default([]),
});
export const TravelItem = z.object({
  title: Line(120).min(1),
  details: Markdown(ITEM_TEXT_MAX).default(''),
  url: OptionalUrl,
});
export const TravelContent = z.object({ items: z.array(TravelItem).max(MAX_BLOCK_ITEMS).default([]) });
export const RegistryItem = z.object({ label: Line(120).min(1), url: HttpsUrl });
export const RegistryContent = z.object({ items: z.array(RegistryItem).max(MAX_BLOCK_ITEMS).default([]) });
export const FaqItem = z.object({ question: Line(200).min(1), answer: Markdown(ITEM_TEXT_MAX).pipe(z.string().min(1)) });
export const FaqContent = z.object({ items: z.array(FaqItem).max(MAX_BLOCK_ITEMS).default([]) });

export const BLOCK_CONTENT = {
  text: TextContent,
  program: ProgramContent,
  travel: TravelContent,
  registry: RegistryContent,
  faq: FaqContent,
} as const;

export type TextContent = z.infer<typeof TextContent>;
export type ProgramContent = z.infer<typeof ProgramContent>;
export type TravelContent = z.infer<typeof TravelContent>;
export type RegistryContent = z.infer<typeof RegistryContent>;
export type FaqContent = z.infer<typeof FaqContent>;

export type BlockContent =
  | { kind: 'text'; content: TextContent }
  | { kind: 'program'; content: ProgramContent }
  | { kind: 'travel'; content: TravelContent }
  | { kind: 'registry'; content: RegistryContent }
  | { kind: 'faq'; content: FaqContent };

/** What a new block of each kind starts with. */
export function emptyContent(kind: SiteBlockKind): BlockContent['content'] {
  return BLOCK_CONTENT[kind].parse({});
}

/**
 * Stored content as the page may use it: the kind's schema over what the row holds, item by item
 * (a malformed item is dropped, never shown raw). Anything unknown is ignored.
 */
export function readContent(kind: SiteBlockKind, raw: unknown): BlockContent {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const items = (schema: z.ZodType) =>
    Array.isArray(obj.items)
      ? obj.items.flatMap((i) => {
          const r = schema.safeParse(i);
          return r.success ? [r.data] : [];
        })
      : [];
  switch (kind) {
    case 'text':
      return { kind, content: { body: typeof obj.body === 'string' ? obj.body : '' } };
    case 'program': {
      const r = ProgramContent.safeParse({ show: obj.show, subEventIds: obj.subEventIds });
      return { kind, content: r.success ? r.data : ProgramContent.parse({}) };
    }
    case 'travel':
      return { kind, content: { items: items(TravelItem) as TravelContent['items'] } };
    case 'registry':
      return { kind, content: { items: items(RegistryItem) as RegistryContent['items'] } };
    case 'faq':
      return { kind, content: { items: items(FaqItem) as FaqContent['items'] } };
  }
}

/** Whether a block has anything to show guests (empty blocks stay off the public page). */
export function blockHasContent(b: BlockContent, programItems = 0): boolean {
  switch (b.kind) {
    case 'text':
      return b.content.body.trim().length > 0;
    case 'program':
      return programItems > 0;
    default:
      return b.content.items.length > 0;
  }
}

/**
 * The sub-events a program block shows, in the host's order: with `everyone`, those every guest
 * is invited to (a sub-event for some guests only, say a rehearsal dinner, never appears on a
 * page anyone with the password can read); with `chosen`, the host's pick of existing ones.
 */
export function programSubEvents<T extends { id: string; inviteAll: boolean }>(
  all: readonly T[],
  content: ProgramContent,
): T[] {
  if (content.show === 'everyone') return all.filter((s) => s.inviteAll);
  const chosen = new Set(content.subEventIds);
  return all.filter((s) => chosen.has(s.id));
}

/** One step up or down; null at either end. */
export function moveIndex(length: number, index: number, direction: 'up' | 'down'): number | null {
  const to = direction === 'up' ? index - 1 : index + 1;
  return index < 0 || to < 0 || to >= length ? null : to;
}

/* ------------------------------------------------------------------------------ password ---- */

export type PasswordProblem = 'too_short' | 'too_long';

/** The site password as the host types it: any characters, 6–72 (spaces at the ends dropped). */
export function passwordProblem(raw: string): PasswordProblem | null {
  const p = raw.trim();
  if (p.length < SITE_PASSWORD_MIN) return 'too_short';
  if (p.length > SITE_PASSWORD_MAX) return 'too_long';
  return null;
}

/** Guests type it from a printed card: case and surrounding spaces don't matter. */
export const normalizeSitePassword = (raw: string) => raw.trim().normalize('NFKC').toLowerCase();

const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 32 } as const;
export const PASSWORD_HASH_PATTERN = /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      normalizeSitePassword(password),
      salt,
      SCRYPT.keylen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

/** `scrypt$N$r$p$<salt>$<key>` (base64url); the password itself is never stored. */
export async function hashSitePassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Constant-time check of a typed password against the stored hash (false for any bad hash). */
export async function verifySitePassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored || !PASSWORD_HASH_PATTERN.test(stored)) {
    // Same work either way, so timing doesn't tell a site without a password apart.
    await derive(password, Buffer.alloc(16));
    return false;
  }
  const [, , , , salt = '', key = ''] = stored.split('$');
  const expected = Buffer.from(key, 'base64url');
  const given = await derive(password, Buffer.from(salt, 'base64url'));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/* -------------------------------------------------------------------------------- access ---- */

/**
 * The visitor's proof of the password: an HMAC of the site and its password version under the app
 * secret. Changing the password bumps the version, so every earlier cookie stops working at once.
 */
export function siteAccessToken(siteId: string, passwordVersion: number, secret: string): string {
  return createHmac('sha256', secret).update(`guests.site-access:${siteId}:${passwordVersion}`).digest('base64url');
}

export function siteAccessValid(
  token: string | null | undefined,
  siteId: string,
  passwordVersion: number,
  secret: string,
): boolean {
  if (!token || token.length > 100) return false;
  const given = Buffer.from(token);
  const expected = Buffer.from(siteAccessToken(siteId, passwordVersion, secret));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
