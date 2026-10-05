import 'server-only';
import { executeQuery } from '@yayatoh/kernel';
import {
  catchUpProgramMedia,
  isProgramOwner,
  type LibraryItemDto,
  libraryQuery,
  listMediaQuery,
  listOwnersMediaQuery,
  type MediaAssetDto,
  type OwnerType,
  type PlacementDto,
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

export function toItem(a: MediaAssetDto): MediaItem {
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
 * U3: the first photo of each venue, for the venue list's thumbnails (one query for the page).
 * Venues without a photo are absent from the map.
 */
export async function venueThumbnails(
  data: ConsoleData,
  venueIds: readonly string[],
): Promise<Map<string, MediaItem>> {
  const assets = await executeQuery(
    listOwnersMediaQuery,
    { ownerType: 'venue', ownerIds: [...venueIds].slice(0, 500) },
    data.ctx,
    ports,
  );
  const out = new Map<string, MediaItem>();
  for (const a of assets) if (a.slot === 'photo' && !out.has(a.ownerId)) out.set(a.ownerId, toItem(a));
  return out;
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

/** U10: one image of the media library for the console (serializable). */
export interface LibraryEntry extends MediaItem {
  readonly bytes: number;
  readonly createdAt: string;
  readonly usedIn: readonly Placement[];
}

/** Where a library image is shown, with its console link (null: no page of its own). */
export interface Placement {
  readonly assetId: string;
  readonly ownerType: PlacementDto['ownerType'];
  readonly slot: PlacementDto['slot'];
  readonly label: string;
  readonly href: string | null;
}

/** The console page that shows an image's place (event media, venue, speakers, the logo…). */
export function placementHref(org: string, p: PlacementDto): string | null {
  switch (p.ownerType) {
    case 'event':
      return p.eventSlug ? `/o/${org}/e/${p.eventSlug}/media` : null;
    case 'venue':
      return `/o/${org}/venues/${p.ownerId}`;
    case 'org':
      return `/o/${org}/settings`;
    case 'speaker':
      return p.eventSlug ? `/o/${org}/e/${p.eventSlug}/speakers` : null;
    case 'exhibitor':
      return p.eventSlug ? `/o/${org}/e/${p.eventSlug}/exhibitors` : null;
    case 'sponsor':
      return p.eventSlug ? `/o/${org}/e/${p.eventSlug}/sponsors` : null;
    default:
      return null;
  }
}

export function toLibraryEntry(org: string, i: LibraryItemDto): LibraryEntry {
  return {
    ...toItem(i.asset),
    bytes: i.asset.bytes,
    createdAt: i.asset.createdAt.toISOString(),
    usedIn: i.usedIn.map((p) => ({
      assetId: p.assetId,
      ownerType: p.ownerType,
      slot: p.slot,
      label: p.label,
      href: placementHref(org, p),
    })),
  };
}

/** A page of the org's media library (every member may look). */
export async function libraryPage(
  data: ConsoleData,
  opts: { page: number; unusedOnly: boolean; perPage?: number },
): Promise<{ items: LibraryEntry[]; total: number; pageCount: number; page: number }> {
  const perPage = opts.perPage ?? 48;
  const first = await executeQuery(
    libraryQuery,
    { limit: perPage, offset: (Math.max(1, opts.page) - 1) * perPage, unusedOnly: opts.unusedOnly },
    data.ctx,
    ports,
  );
  const pageCount = Math.max(1, Math.ceil(first.total / perPage));
  return {
    items: first.items.map((i) => toLibraryEntry(data.org.slug, i)),
    total: first.total,
    pageCount,
    page: Math.min(Math.max(1, opts.page), pageCount),
  };
}
