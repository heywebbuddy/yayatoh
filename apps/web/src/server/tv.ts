import 'server-only';
import { resolveDisplayLink, type TvBoardDto, tvBoardQuery } from '@yayatoh/command-center';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { ports } from './ports.ts';

/**
 * TV mode (M3.3a): the board a display link opens. The token alone picks the org and event (never
 * a header or a session); an unknown, malformed or revoked token (or a suspended org) gets null.
 */
export async function tvBoard(token: string): Promise<TvBoardDto | null> {
  const link = await resolveDisplayLink(token);
  if (!link) return null;
  try {
    return await executeQuery(tvBoardQuery, { eventId: link.eventId }, link.ctx, ports);
  } catch (err) {
    if (isDomainError(err) && ['not_found', 'forbidden', 'module_not_enabled'].includes(err.code))
      return null;
    throw err;
  }
}
