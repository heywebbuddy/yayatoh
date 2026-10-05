import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, type Ctx, executeCommand } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { exhibitorPrincipalTx } from '@yayatoh/program';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { UploadResultDto } from './dto.ts';
import { runUpload, storeUploadTx } from './media.ts';
import { assets } from './schema.ts';

/**
 * M5.4a: an exhibitor admin replaces their own exhibitor's logo from the portal. The portal
 * account is re-checked in the transaction (an admin of that exhibitor, live); the owner is
 * always the principal's exhibitor, never an id from the request. Same pipeline, quota and single
 * logo slot as the console's upload.
 */
const PortalLogoInput = z.object({
  assetId: z.uuid(),
  file: z.custom<Uint8Array>((v) => v instanceof Uint8Array, 'must be the file bytes'),
  alt: z.string().trim().min(1).max(300),
});

export const portalExhibitorLogoCommand = tenantCommand({
  name: 'media.portalUploadExhibitorLogo',
  input: PortalLogoInput,
  output: UploadResultDto,
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor_admin',
  handler: async ({ input, ctx, tx, emit }) => {
    const { exhibitor } = await exhibitorPrincipalTx(tx, ctx, 'admin');
    return storeUploadTx({
      tx,
      ctx,
      emit,
      ownerType: 'exhibitor',
      ownerId: exhibitor.id,
      slot: 'logo',
      input: {
        assetId: input.assetId,
        file: input.file,
        alt: input.alt,
        decorative: false,
        replaceAssetId: null,
      },
    });
  },
  audit: (input, r) => ({
    action: 'media.upload',
    targetType: 'media_asset',
    targetId: input.assetId,
    data: {
      ownerType: r.asset.ownerType,
      ownerId: r.asset.ownerId,
      slot: r.asset.slot,
      bytes: r.asset.bytes,
      replacedAssetId: r.replacedAssetId,
      by: 'exhibitor_portal',
    },
  }),
});

export function uploadExhibitorLogoFromPortal(
  ctx: Ctx,
  input: { alt: string; file: Uint8Array },
  ports: CommandPorts<TenantTx>,
): Promise<UploadResultDto> {
  return runUpload(ctx, (assetId) =>
    executeCommand(portalExhibitorLogoCommand, { ...input, assetId }, ctx, ports),
  );
}

/** The exhibitor's current logo as the portal shows it (its alt text and when it was uploaded). */
export const portalExhibitorLogoQuery = tenantQuery({
  name: 'media.portalExhibitorLogo',
  input: z.object({}),
  output: z.object({ alt: z.string(), uploadedAt: z.date() }).nullable(),
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor',
  handler: async ({ ctx, tx }) => {
    const { exhibitor } = await exhibitorPrincipalTx(tx, ctx);
    const [row] = await tx
      .select({ alt: assets.alt, createdAt: assets.createdAt })
      .from(assets)
      .where(
        and(eq(assets.ownerType, 'exhibitor'), eq(assets.ownerId, exhibitor.id), eq(assets.slot, 'logo')),
      );
    return row ? { alt: row.alt ?? '', uploadedAt: row.createdAt } : null;
  },
});
