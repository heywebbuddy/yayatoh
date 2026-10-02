import { createHash, randomUUID } from 'node:crypto';
import type { TenantTx } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  createCtx,
  DomainError,
  executeCommand,
  requireOrg,
} from '@yayatoh/kernel';
import {
  catchUpSubscriber,
  defineSubscriber,
  emitEvents,
  type Subscriber,
  tenantCommand,
  tenantQuery,
} from '@yayatoh/platform';
import {
  completeTaskWithFileTx,
  programOwnerTx,
  proposeSpeakerPhotoTx,
  speakerPrincipalTx,
  taskFileOwnerTx,
  taskFileTargetTx,
} from '@yayatoh/program';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { storeProgramImageTx } from './media.ts';
import {
  cleanFileName,
  PORTAL_FILE_CONTENT_TYPES,
  PORTAL_FILE_EXT,
  PORTAL_FILE_MAX_BYTES,
  PORTAL_IMAGE_TYPES,
  PORTAL_PHOTO_MAX_BYTES,
  sniffPortalFile,
} from './pipeline/documents.ts';
import { MediaRejected, processImage } from './pipeline/process.ts';
import { PORTAL_FILE_TYPES, portalFiles } from './schema-files.ts';
import { mediaStore } from './storage/config.ts';
import { storageKey } from './storage/port.ts';

/**
 * M5.3a portal files. A speaker answers an `upload` task ("upload slides") or proposes a photo;
 * the bytes are sniffed (PDF, PowerPoint, Word, JPEG, PNG, WebP; photos: images only and
 * decodable) and size-capped, stored as uploaded, and handed to the program module in the same
 * transaction (it completes the task or attaches the photo to the pending profile change). Files
 * are never public: organizers download them through `portalFileQuery`.
 */
export const UploadPortalFileInput = z.object({
  /** Chosen by the server wrapper, so a failed upload's object can be purged. */
  fileId: z.uuid(),
  purpose: z.enum(['task_answer', 'speaker_photo']),
  assigneeId: z.uuid().nullable().default(null),
  file: z.custom<Uint8Array>((v) => v instanceof Uint8Array, 'must be the file bytes'),
  fileName: z.string().max(500).default(''),
});
export type UploadPortalFileInput = z.input<typeof UploadPortalFileInput>;

export const PortalFileResultDto = z.object({
  fileId: z.uuid(),
  fileName: z.string(),
  fileType: z.enum(PORTAL_FILE_TYPES),
  /** A replaced pending photo whose object the wrapper deletes after commit. */
  replacedFileId: z.uuid().nullable(),
});
export type PortalFileResultDto = z.infer<typeof PortalFileResultDto>;

const reject = (reason: string) =>
  new DomainError('validation_failed', 'The file was refused', { field: 'file', reason });

export const uploadSpeakerPortalFileCommand = tenantCommand({
  name: 'media.uploadSpeakerPortalFile',
  input: UploadPortalFileInput,
  output: PortalFileResultDto,
  entitlement: 'speakers',
  permission: 'portal:speaker',
  handler: async ({ input, ctx, tx, emit }): Promise<PortalFileResultDto> => {
    const orgId = requireOrg(ctx);
    // The target first: another speaker's task, a done task or a guessed id never stores a byte.
    let ownerId: string;
    if (input.purpose === 'task_answer') {
      if (!input.assigneeId) throw new DomainError('not_found');
      await taskFileTargetTx(tx, ctx, input.assigneeId);
      ownerId = input.assigneeId;
    } else {
      ownerId = (await speakerPrincipalTx(tx, ctx)).speaker.id;
    }
    const bytes = input.file;
    if (bytes.byteLength === 0) throw reject('no_file');
    if (bytes.byteLength > PORTAL_FILE_MAX_BYTES) throw reject('too_large');
    const type = sniffPortalFile(bytes);
    if (!type) throw reject('unsupported_type');
    if (input.purpose === 'speaker_photo') {
      if (!PORTAL_IMAGE_TYPES.includes(type)) throw reject('unsupported_type');
      if (bytes.byteLength > PORTAL_PHOTO_MAX_BYTES) throw reject('too_large');
      try {
        // Decodable now, so approving it later cannot fail on the file.
        await processImage(bytes);
      } catch (err) {
        if (err instanceof MediaRejected) throw reject(err.reason);
        throw err;
      }
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const fileName = cleanFileName(input.fileName, type);
    const key = storageKey(orgId, input.fileId, `f-${sha256.slice(0, 32)}.${PORTAL_FILE_EXT[type]}`);
    await mediaStore().put(orgId, key, bytes, PORTAL_FILE_CONTENT_TYPES[type]);
    await tx.insert(portalFiles).values({
      id: input.fileId,
      orgId,
      purpose: input.purpose,
      ownerId,
      fileType: type,
      fileName,
      storageKey: key,
      sha256,
      bytes: bytes.byteLength,
      createdBy: ctx.actor.type === 'portal' ? `portal:${ctx.actor.accountId}` : 'system',
    });
    let replacedFileId: string | null = null;
    if (input.purpose === 'task_answer' && input.assigneeId) {
      for (const e of await completeTaskWithFileTx(tx, ctx, {
        assigneeId: input.assigneeId,
        fileId: input.fileId,
        fileName,
      }))
        emit(e);
    } else {
      replacedFileId = (await proposeSpeakerPhotoTx(tx, ctx, input.fileId)).replacedFileId;
      if (replacedFileId) await tx.delete(portalFiles).where(eq(portalFiles.id, replacedFileId));
    }
    return { fileId: input.fileId, fileName, fileType: type, replacedFileId };
  },
  audit: (input, r) => ({
    action: 'media.portal_file.upload',
    targetType: 'portal_file',
    targetId: r.fileId,
    data: {
      purpose: input.purpose,
      assigneeId: input.assigneeId,
      fileType: r.fileType,
      bytes: input.file.byteLength,
    },
  }),
});

/** Upload through the portal: the server picks the file id and purges the object on failure. */
export async function uploadSpeakerPortalFile(
  ctx: Ctx,
  input: Omit<UploadPortalFileInput, 'fileId'>,
  ports: CommandPorts<TenantTx>,
): Promise<PortalFileResultDto> {
  const orgId = requireOrg(ctx);
  const fileId = randomUUID();
  let r: PortalFileResultDto;
  try {
    r = await executeCommand(uploadSpeakerPortalFileCommand, { ...input, fileId }, ctx, ports);
  } catch (err) {
    await mediaStore()
      .deleteAsset(orgId, fileId)
      .catch(() => undefined);
    throw err;
  }
  if (r.replacedFileId) await mediaStore().deleteAsset(orgId, r.replacedFileId);
  return r;
}

export const PortalFileDto = z.object({
  fileName: z.string(),
  fileType: z.enum(PORTAL_FILE_TYPES),
  contentType: z.string(),
  bytes: z.custom<Uint8Array>((v) => v instanceof Uint8Array),
});
export type PortalFileDto = z.infer<typeof PortalFileDto>;

/**
 * A portal file for the organizer (a task answer or a proposed photo of one of the org's events).
 * Viewers may read (`events:read`); other orgs' and unknown ids are `not_found`.
 */
export const portalFileQuery = tenantQuery({
  name: 'media.portalFile',
  input: z.object({ fileId: z.uuid() }),
  output: PortalFileDto,
  entitlement: 'speakers',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const [row] = await tx.select().from(portalFiles).where(eq(portalFiles.id, input.fileId));
    if (!row) throw new DomainError('not_found');
    // Its program owner must still exist (a deleted task or speaker takes its files out of reach).
    const owner =
      row.purpose === 'task_answer'
        ? await taskFileOwnerTx(tx, row.id)
        : await programOwnerTx(tx, 'speaker', row.ownerId);
    if (!owner) throw new DomainError('not_found');
    const bytes = await mediaStore().get(row.orgId, row.storageKey);
    if (!bytes) throw new DomainError('not_found');
    const fileType = row.fileType as (typeof PORTAL_FILE_TYPES)[number];
    return { fileName: row.fileName, fileType, contentType: PORTAL_FILE_CONTENT_TYPES[fileType], bytes };
  },
});

const DecidedPayload = z.object({
  changeId: z.uuid(),
  speakerId: z.uuid(),
  decision: z.enum(['approved', 'rejected']),
  photoFileId: z.uuid().nullable(),
});

/**
 * An approved profile change with a photo becomes the speaker's photo (processed like an
 * organizer upload: re-encoded, alt text = the speaker's name, replacing the old photo).
 */
export function speakerPhotoApprover(): Subscriber {
  return defineSubscriber({
    name: 'media.speaker-photo-approver',
    events: ['program.speaker_change.decided@1'],
    handle: async (tx, event) => {
      const p = DecidedPayload.parse(event.payload);
      if (p.decision !== 'approved' || !p.photoFileId) return;
      const [file] = await tx
        .select()
        .from(portalFiles)
        .where(
          and(
            eq(portalFiles.id, p.photoFileId),
            eq(portalFiles.purpose, 'speaker_photo'),
            eq(portalFiles.ownerId, p.speakerId),
          ),
        );
      const owner = await programOwnerTx(tx, 'speaker', p.speakerId);
      if (!file || !owner) return;
      const bytes = await mediaStore().get(event.orgId, file.storageKey);
      if (!bytes) return;
      const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: 'media.speaker-photo' } });
      const events: Parameters<typeof emitEvents>[2][number][] = [];
      const r = await storeProgramImageTx(tx, ctx, (e) => events.push(e), {
        kind: 'speaker',
        ownerId: p.speakerId,
        assetId: randomUUID(),
        file: bytes,
        alt: owner.name,
      });
      await emitEvents(tx, ctx, events);
      if (r.replacedAssetId) await mediaStore().deleteAsset(event.orgId, r.replacedAssetId);
    },
  });
}

/** Apply approved photos now (the web right after an approval; e2e). The worker is the backstop. */
export function catchUpSpeakerPhotos(orgId: string): Promise<number> {
  return catchUpSubscriber(speakerPhotoApprover(), orgId);
}
