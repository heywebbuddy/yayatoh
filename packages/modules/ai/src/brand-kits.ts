import type { TenantTx } from '@yayatoh/db';
import { actorId, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { BrandVoice } from './domain/compose.ts';
import {
  BRAND_KIT_NAME_MAX,
  BRAND_TERM_MAX,
  BRAND_TERMS_MAX,
  BRAND_VOICE_MAX,
  MAX_BRAND_KITS,
  TONES,
} from './domain/tones.ts';
import { brandKits } from './schema.ts';

export const BrandKitDto = z.object({
  id: z.uuid(),
  name: z.string(),
  voice: z.string(),
  tone: z.enum(TONES),
  keywords: z.array(z.string()),
  avoid: z.array(z.string()),
  isDefault: z.boolean(),
  updatedAt: z.date(),
});
export type BrandKitDto = z.infer<typeof BrandKitDto>;

/** Comma- or line-separated words, trimmed, de-duplicated (case-insensitive), capped. */
const Terms = z
  .union([z.string().max(2000), z.array(z.string().max(200)).max(50)])
  .default([])
  .transform((v, c) => {
    const parts = (Array.isArray(v) ? v : v.split(/[,\n]/)).map((s) => s.trim().replace(/\s+/g, ' '));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of parts) {
      if (!p || seen.has(p.toLowerCase())) continue;
      if (p.length > BRAND_TERM_MAX) {
        c.addIssue({ code: 'too_big', maximum: BRAND_TERM_MAX, origin: 'string', inclusive: true, message: 'term' });
        return z.NEVER;
      }
      seen.add(p.toLowerCase());
      out.push(p);
    }
    if (out.length > BRAND_TERMS_MAX) {
      c.addIssue({ code: 'too_big', maximum: BRAND_TERMS_MAX, origin: 'array', inclusive: true, message: 'terms' });
      return z.NEVER;
    }
    return out;
  });

export const SaveBrandKitInput = z.object({
  kitId: z.uuid().nullable().default(null),
  name: z.string().trim().min(1).max(BRAND_KIT_NAME_MAX),
  voice: z.string().trim().max(BRAND_VOICE_MAX).default(''),
  tone: z.enum(TONES).default('friendly'),
  keywords: Terms,
  avoid: Terms,
  isDefault: z.boolean().default(false),
});
export type SaveBrandKitInput = z.input<typeof SaveBrandKitInput>;

const toDto = (r: typeof brandKits.$inferSelect): BrandKitDto => BrandKitDto.parse(r);

export const listBrandKitsQuery = tenantQuery({
  name: 'ai.listBrandKits',
  input: z.object({}),
  output: z.array(BrandKitDto),
  entitlement: 'ai',
  permission: 'marketing:read',
  handler: async ({ tx }) => {
    const rows = await tx
      .select()
      .from(brandKits)
      .orderBy(desc(brandKits.isDefault), asc(sql`lower(${brandKits.name})`));
    return rows.map(toDto);
  },
});

/** The brand voice a draft follows (null when the kit doesn't exist in this org). */
export async function brandVoiceTx(tx: TenantTx, kitId: string): Promise<BrandVoice | null> {
  const [k] = await tx.select().from(brandKits).where(eq(brandKits.id, kitId));
  return k ? { name: k.name, voice: k.voice, keywords: k.keywords, avoid: k.avoid } : null;
}

export const saveBrandKitCommand = tenantCommand({
  name: 'ai.saveBrandKit',
  input: SaveBrandKitInput,
  output: BrandKitDto,
  entitlement: 'ai',
  permission: 'marketing:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    if (input.kitId) {
      const [own] = await tx.select({ id: brandKits.id }).from(brandKits).where(eq(brandKits.id, input.kitId));
      if (!own) throw new DomainError('not_found');
    } else {
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(brandKits);
      if (n >= MAX_BRAND_KITS)
        throw new DomainError('invalid_state', 'Too many brand kits', { reason: 'brand_kit_limit' });
    }
    const [clash] = await tx
      .select({ id: brandKits.id })
      .from(brandKits)
      .where(
        and(
          sql`lower(${brandKits.name}) = lower(${input.name})`,
          input.kitId ? ne(brandKits.id, input.kitId) : undefined,
        ),
      );
    if (clash) throw new DomainError('conflict', 'A brand kit with this name exists', { field: 'name' });
    // Only one default: setting one clears the others first (the partial unique index enforces it).
    if (input.isDefault)
      await tx
        .update(brandKits)
        .set({ isDefault: false, updatedAt: ctx.now })
        .where(and(eq(brandKits.isDefault, true), input.kitId ? ne(brandKits.id, input.kitId) : undefined));
    const values = {
      name: input.name,
      voice: input.voice,
      tone: input.tone,
      keywords: input.keywords,
      avoid: input.avoid,
      isDefault: input.isDefault,
      updatedAt: ctx.now,
    };
    const [row] = input.kitId
      ? await tx.update(brandKits).set(values).where(eq(brandKits.id, input.kitId)).returning()
      : await tx
          .insert(brandKits)
          .values({ orgId, ...values, createdBy: actorId(ctx.actor) })
          .returning();
    if (!row) throw new DomainError('internal');
    return toDto(row);
  },
  audit: (input, res) => ({
    action: input.kitId ? 'ai.brand_kit.update' : 'ai.brand_kit.create',
    targetType: 'brand_kit',
    targetId: res.id,
    data: { name: res.name, tone: res.tone, isDefault: res.isDefault },
  }),
});

export const deleteBrandKitCommand = tenantCommand({
  name: 'ai.deleteBrandKit',
  input: z.object({ kitId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'ai',
  permission: 'marketing:write',
  handler: async ({ input, tx }) => {
    const rows = await tx.delete(brandKits).where(eq(brandKits.id, input.kitId)).returning({ id: brandKits.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { deleted: true };
  },
  audit: (input) => ({ action: 'ai.brand_kit.delete', targetType: 'brand_kit', targetId: input.kitId }),
});
