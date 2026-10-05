'use server';

import { selfCheckInCommand, selfCheckinDoor } from '@yayatoh/checkin';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

export type SelfCheckinState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'done';
      readonly result: 'entered' | 'duplicate' | 'not_found' | 'closed';
      readonly seq: number;
    }
  | {
      readonly kind: 'error';
      readonly code: 'code_required' | 'rate_limited' | 'gone';
      readonly minutes?: number;
      readonly seq: number;
    };

/**
 * M5.6a: an attendee checks into a session from its flyer with the code on their ticket or badge.
 * The org comes from the flyer's token (a definer lookup), never from a header; code guessing is
 * rate limited per device and IP.
 */
export async function selfCheckinAction(
  token: string,
  prev: SelfCheckinState,
  form: FormData,
): Promise<SelfCheckinState> {
  const seq = (prev.kind === 'idle' ? 0 : prev.seq) + 1;
  const code = String(form.get('code') ?? '').trim();
  if (code.length < 4) return { kind: 'error', code: 'code_required', seq };
  const limit = await limitAction('registrationLookup', { scope: 'session-self-checkin' });
  if (!limit.allowed) return { kind: 'error', code: 'rate_limited', minutes: retryAfterMinutes(limit), seq };
  const door = await selfCheckinDoor(token);
  if (!door) return { kind: 'error', code: 'gone', seq };
  try {
    const r = await executeCommand(
      selfCheckInCommand,
      { token, code },
      createCtx({ orgId: door.orgId }),
      ports,
    );
    return { kind: 'done', result: r.result, seq };
  } catch {
    return { kind: 'error', code: 'gone', seq };
  }
}
