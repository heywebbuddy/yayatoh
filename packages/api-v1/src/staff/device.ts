import { deviceContext } from '@yayatoh/checkin';
import type { Ctx } from '@yayatoh/kernel';

const BEARER = /^Bearer (yyd_[A-Za-z0-9_-]{43})$/;

/**
 * The device behind an `Authorization` header (the Scan PWA's `/api/scan/*` and the Staff app's
 * `/v1/staff/*` share this): its bearer token decides the org, never a header or a parameter.
 * A missing, malformed, unknown or revoked token is null.
 *
 * `refuseWiped`: a device a supervisor asked to wipe (its token still resolves, so the next
 * heartbeat can deliver the `wipe` command) is refused too. The `/v1/staff` routes set it, so a
 * wiped device gets 401 on every route but the heartbeat; the PWA's routes keep accepting it.
 */
export async function deviceFromAuthorization(
  authorization: string | null | undefined,
  opts: { readonly refuseWiped?: boolean } = {},
): Promise<Ctx | null> {
  const m = BEARER.exec(authorization ?? '');
  const dc = m?.[1] ? await deviceContext(m[1]) : null;
  if (!dc || (opts.refuseWiped && dc.wipe)) return null;
  return dc.ctx;
}
