'use server';

import { checkoutTarget } from '@yayatoh/events';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { startPlaybackCommand } from '@yayatoh/virtual';
import { ports } from '@/server/ports.ts';

/** A playback token for the player, or the refusal's code and reason. */
export interface PlaybackState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string | null;
  readonly token?: string;
  readonly playbackUrl?: string;
  readonly expiresAt?: string;
  readonly provider?: 'fake' | 'mux';
}

/**
 * Start (or renew) a viewing (M6.9a): the org and event come from the public slug, the ticket
 * from its signed watch link; the command refuses a ticket without virtual access.
 */
export async function startPlaybackAction(
  slug: string,
  ticket: string,
  sessionId: string,
): Promise<PlaybackState> {
  const target = await checkoutTarget(slug);
  if (!target) return { ok: false, code: 'not_found' };
  try {
    const p = await executeCommand(
      startPlaybackCommand,
      { eventId: target.eventId, sessionId, ticketToken: ticket },
      createCtx({ orgId: target.orgId }),
      ports,
    );
    return {
      ok: true,
      code: null,
      token: p.token,
      playbackUrl: p.playbackUrl,
      expiresAt: p.expiresAt.toISOString(),
      provider: p.provider,
    };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return {
      ok: false,
      code: err.code,
      reason: typeof err.details?.reason === 'string' ? err.details.reason : null,
    };
  }
}
