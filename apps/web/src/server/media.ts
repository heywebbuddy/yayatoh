import 'server-only';
import { executeQuery } from '@yayatoh/kernel';
import {
  listMediaQuery,
  type MediaAssetDto,
  type OwnerType,
  type Slot,
  signUploadTicket,
} from '@yayatoh/media';
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
