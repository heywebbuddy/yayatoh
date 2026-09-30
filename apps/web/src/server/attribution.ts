import 'server-only';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import {
  attributeOrderCommand,
  CLICK_COOKIE,
  CLICK_COOKIE_MAX_AGE_S,
  decodeUtmCookie,
  UTM_COOKIE,
  verifyClickToken,
} from '@yayatoh/marketing';
import { appTokenSecret } from '@yayatoh/platform';
import { DEVICE_COOKIE, isDeviceId } from '@yayatoh/platform/security';
import { cookies } from 'next/headers';
import { ports } from './ports.ts';

/**
 * The checkout hook (M3.8a): record where a new order came from. Reads the verified click cookie,
 * the device cookie (earlier clicks inside the window) and the UTM landing cookie; the command
 * decides first and last touch. Never breaks checkout: any failure is logged and ignored.
 */
export async function recordCheckoutAttribution(orgId: string, orderId: string): Promise<void> {
  try {
    const jar = await cookies();
    const clickId = verifyClickToken(jar.get(CLICK_COOKIE)?.value, appTokenSecret(), {
      now: Date.now(),
      maxAgeMs: CLICK_COOKIE_MAX_AGE_S * 1000,
    });
    const device = jar.get(DEVICE_COOKIE)?.value;
    const utm = decodeUtmCookie(jar.get(UTM_COOKIE)?.value);
    await executeCommand(
      attributeOrderCommand,
      {
        orderId,
        clickIds: clickId ? [clickId] : [],
        deviceId: isDeviceId(device) ? device : null,
        utm: utm ? { first: utm.first, last: utm.last } : null,
      },
      createCtx({ orgId, actor: { type: 'anonymous' } }),
      ports,
    );
  } catch (err) {
    console.error(JSON.stringify({ attribution: 'not_recorded', message: String(err) }));
  }
}
