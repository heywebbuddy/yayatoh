/**
 * The `VideoProvider` port (M6.9a, decision P6-9): live streams and signed playback for virtual
 * and hybrid sessions. Production uses Mux; dev, CI and previews use the fake (no account, no
 * network). **Stream keys never touch the database**: Yayatoh stores the provider's stream id and
 * playback id only, and asks the provider for the key when an organizer reveals it.
 *
 * A playback token is a short-lived JWT for one playback id (Mux's `sub`/`aud`/`exp` claims) that
 * also carries Yayatoh's own claims under `yy`: the org and the viewing it was issued for. The
 * viewing names one ticket and one session, so a token works for its attendee and session only.
 */

/**
 * Adapters by name (M6.10a): Mux and Cloudflare Stream, each with its fake (`fake` is the fake
 * Mux of M6.9a). A session's stream names the adapter that serves it.
 */
export const VIDEO_PROVIDERS = ['fake', 'mux', 'fake_cloudflare', 'cloudflare'] as const;
export type VideoProviderName = (typeof VIDEO_PROVIDERS)[number];
/** The service behind an adapter (what the organizer chooses per session). */
export type VideoProviderKind = 'mux' | 'cloudflare';

/** What Yayatoh keeps about a stream: none of these is a secret. */
export interface LiveStream {
  readonly providerStreamId: string;
  readonly playbackId: string;
  /** The RTMP(S) ingest address (public; the stream key is the secret part). */
  readonly ingestUrl: string;
  /**
   * M6.10a RTMP overflow: the provider's backup ingest for the same stream (same key, same
   * playback), which the organizer switches the encoder to when the primary ingest fails.
   */
  readonly backupIngestUrl: string | null;
}

export interface PlaybackClaims {
  readonly playbackId: string;
  readonly orgId: string;
  /** The viewing (`virtual.views` row): one ticket, one session. */
  readonly viewId: string;
  readonly expiresAt: Date;
}

export interface VideoProvider {
  readonly name: VideoProviderName;
  readonly kind: VideoProviderKind;
  /** A fake (no account, no network): dev, CI and previews. */
  readonly sandbox: boolean;
  /** A new live stream with a signed-only playback id. Retried calls with the same key reuse it. */
  createLiveStream(input: {
    readonly orgId: string;
    readonly sessionId: string;
    readonly idempotencyKey: string;
  }): Promise<LiveStream>;
  /** The stream key for the organizer's encoder (a secret: shown on request, never stored). */
  streamKey(providerStreamId: string): Promise<string>;
  /** Sign a playback token (no network: Mux tokens are signed with the org's signing key). */
  signPlayback(claims: PlaybackClaims): string;
  /** The claims of an authentic, unexpired token, else null. */
  verifyPlayback(token: string, now: Date): PlaybackClaims | null;
  /** Where the player loads the stream (HLS). */
  playbackUrl(playbackId: string, token: string): string;
}

/** The provider is configured but cannot do this (e.g. the Mux account is not provisioned yet). */
export class VideoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoUnavailableError';
  }
}
