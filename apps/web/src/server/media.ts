import 'server-only';
import { executeQuery } from '@yayatoh/kernel';
import {
  catchUpProgramMedia,
  isProgramOwner,
  listMediaQuery,
  listOwnersMediaQuery,
  type MediaAssetDto,
  type OwnerType,
  PROGRAM_IMAGES,
  type ProgramImageOwner,
  type Slot,
  signUploadTicket,
} from '@yayatoh/media';
import { catchUpSubscriber } from '@yayatoh/platform';
import { portalSpeakerCleanup } from '@yayatoh/program';
import { roleCan } from '@yayatoh/tenancy';
import type { ConsoleData } from './console.ts';
import { ports } from './ports.ts';

/** What the console uploader shows for one image (serializable for the client component). */
export interface MediaItem {
  readonly id: string;
  readonly alt: string | null;
  readonly decorative: boolean;
  readonly width: number;
  readonly height: number;
  readonly sourceType: string;
  /** A small preview (the vector for SVG, else the smallest WebP). */
  readonly preview: string;
  /** `{url} {width}w` for the WebP variants (thumbnails pick the right one). */
  readonly srcSet: string;
}

function toItem(a: MediaAssetDto): MediaItem {
  const vector = a.variants.find((v) => v.format === 'svg');
  const webp = a.variants.filter((v) => v.format === 'webp').sort((x, y) => x.width - y.width);
  return {
    id: a.id,
    alt: a.alt,
    decorative: a.decorative,
    width: a.width,
    height: a.height,
    sourceType: a.sourceType,
    preview: (vector ?? webp[0] ?? a.variants[0])?.url ?? '',
    srcSet: vector ? '' : webp.map((v) => `${v.url} ${v.width}w`).join(', '),
  };
}

/**
 * The images of one owner slot for the console, and an upload ticket for people who may change
 * them (event editors for event and venue images, org settings for the logo). Viewers get no
 * ticket, so no upload control is rendered for them.
 */
export async function mediaPanel(
  data: ConsoleData,
  ownerType: OwnerType,
  ownerId: string,
  slot: Slot,
): Promise<{ items: MediaItem[]; ticket: string | null; canWrite: boolean }> {
  const assets = await executeQuery(listMediaQuery, { ownerType, ownerId, slot }, data.ctx, ports);
  const canWrite = roleCan(data.role, ownerType === 'org' ? 'org:update' : 'events:write');
  const ticket = canWrite
    ? signUploadTicket({ orgId: data.org.id, ownerType, ownerId, slot, userId: data.session.userId })
    : null;
  return { items: assets.map(toItem), ticket, canWrite };
}

/**
 * M1.4h: the images of every speaker, exhibitor or sponsor on a program page in one query, with
 * an upload ticket per row for people who may change them (event editors). Viewers get no
 * tickets, so no upload control renders for them.
 */
export async function programMediaPanels(
  data: ConsoleData,
  kind: ProgramImageOwner,
  ownerIds: readonly string[],
): Promise<Map<string, { items: MediaItem[]; ticket: string | null }>> {
  const assets = await executeQuery(
    listOwnersMediaQuery,
    { ownerType: kind, ownerIds: [...ownerIds] },
    data.ctx,
    ports,
  );
  const canWrite = isProgramOwner(kind) && roleCan(data.role, 'events:write');
  const slot = PROGRAM_IMAGES[kind].slot;
  return new Map(
    ownerIds.map((id) => [
      id,
      {
        items: assets.filter((a) => a.ownerId === id).map(toItem),
        ticket: canWrite
          ? signUploadTicket({
              orgId: data.org.id,
              ownerType: kind,
              ownerId: id,
              slot,
              userId: data.session.userId,
            })
          : null,
      },
    ]),
  );
}

/**
 * Right after a speaker, exhibitor or sponsor is deleted: remove its images now (rows, then
 * files) instead of waiting for the worker, which delivers the same outbox event as a backstop.
 * The image is already private at this point (its owner is gone), so a failure only logs.
 */
export async function purgeDeletedProgramMedia(orgId: string): Promise<void> {
  try {
    await catchUpProgramMedia(orgId);
    // M5.3a: a deleted speaker's portal tasks and access go too.
    await catchUpSubscriber(portalSpeakerCleanup(), orgId);
  } catch (err) {
    console.warn(`program media cleanup ${orgId}: ${(err as Error).message}`);
  }
}
