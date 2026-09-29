import { type Ctx, DomainError } from '@yayatoh/kernel';

/** Devices act as a system actor named after the device; authorization happened at the token. */
const DEVICE_ACTOR = /^device:([0-9a-f-]{36})$/;

export function deviceIdOf(ctx: Ctx): string {
  const m = ctx.actor.type === 'system' ? DEVICE_ACTOR.exec(ctx.actor.name) : null;
  if (!m?.[1]) throw new DomainError('forbidden', 'Device credentials required');
  return m[1];
}
