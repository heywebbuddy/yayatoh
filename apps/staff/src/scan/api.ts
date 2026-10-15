/**
 * The two server calls the scanner makes, through `@yayatoh/sdk` with the device token (never a
 * hand-written `/v1` fetch). `ScanApi` is the seam; tests give the engine a fake server.
 */
import type { YayatohClient } from '@yayatoh/sdk';
import type { ManifestPage, QueuedScan, SyncResponse } from './types';

/** The device token was refused: revoked, wiped or never valid. The device layer handles it. */
export class ScanAuthError extends Error {
  constructor(readonly status: number) {
    super(`device token refused (${status})`);
    this.name = 'ScanAuthError';
  }
}

/** The server cannot take this batch as sent (a malformed scan): retrying it unchanged never works. */
export class ScanRejectedError extends Error {
  constructor(readonly status: number) {
    super(`batch rejected (${status})`);
    this.name = 'ScanRejectedError';
  }
}

/** This device may not scan this event (assigned elsewhere, or the manifest scope is not signed). */
export class ScanSyncError extends Error {
  constructor(readonly reason: 'not_assigned' | 'bad_scope') {
    super(reason);
    this.name = 'ScanSyncError';
  }
}

export interface ManifestRequest {
  readonly cursor: string | null;
  readonly overlap: boolean;
  readonly limit: number;
}

export interface ScanApi {
  manifestPage(eventId: string, request: ManifestRequest): Promise<ManifestPage>;
  syncScans(eventId: string, scans: readonly QueuedScan[]): Promise<SyncResponse>;
}

function failure(status: number): Error {
  if (status === 401) return new ScanAuthError(status);
  if (status === 403) return new ScanSyncError('not_assigned');
  if (status === 400 || status === 413 || status === 422) return new ScanRejectedError(status);
  return new Error(`request failed (${status})`);
}

export function sdkScanApi(client: YayatohClient): ScanApi {
  return {
    async manifestPage(eventId, request) {
      const { data, response } = await client.GET('/v1/events/{eventId}/manifest', {
        params: {
          path: { eventId },
          query: {
            limit: request.limit,
            ...(request.cursor ? { cursor: request.cursor } : {}),
            ...(request.cursor && request.overlap ? { overlap: 'true' as const } : {}),
          },
        },
      });
      if (!data) throw failure(response.status);
      return data as unknown as ManifestPage;
    },
    async syncScans(eventId, scans) {
      const { data, response } = await client.POST('/v1/scans/batch', {
        body: {
          eventId,
          scans: scans.map((s) => ({
            scanId: s.scanId,
            code: s.code,
            deviceTs: s.deviceTs,
            clockOffsetMs: s.clockOffsetMs,
            verdict: s.verdict,
            ...(s.checkpointId ? { checkpointId: s.checkpointId } : {}),
            ...(s.direction ? { direction: s.direction } : {}),
          })),
        },
      });
      if (!data) throw failure(response.status);
      return data as SyncResponse;
    },
  };
}
