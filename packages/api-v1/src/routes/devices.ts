import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { DomainError } from '@yayatoh/kernel';
import { AppDeviceInput, createNotifier, registerAppDevice, removeAppDevice } from '@yayatoh/notifications';
import { queueRemindersForHolderTx } from '@yayatoh/orders';
import type { V1Deps, V1Env } from '../context.ts';
import { body, json, problems, userSecurity, writeProblems } from './common.ts';

/**
 * The signed-in person's phones for push (M7.2c), under the `/me/…` scope (verified email).
 * A phone is stored in every organization where the person has an order or a ticket, so each can
 * send them updates about their events and none can reach a person it has no relation to.
 */
const DevicePlatform = z
  .enum(['apns', 'fcm'])
  .openapi('DevicePlatform', { description: '`apns` for iOS, `fcm` for Android.' });
const ApnsEnvironment = z.enum(['sandbox', 'production']).openapi('ApnsEnvironment');

const DeviceRequest = z
  .object({
    platform: DevicePlatform,
    token: z.string().min(8).max(4096).openapi({
      description:
        'The APNs device token (hex) or the FCM registration token. Send it again whenever the OS rotates it.',
    }),
    appId: z
      .string()
      .openapi({ description: 'The bundle id (iOS) or package name (Android).', example: 'com.yayatoh.app' }),
    appVersion: z.string().openapi({ example: '1.4.0' }),
    locale: z
      .string()
      .openapi({ description: 'The app’s language tag; push text is rendered in it.', example: 'pt-BR' }),
    timeZone: z.string().max(64).optional().openapi({
      description: 'The phone’s IANA time zone; quiet hours follow it.',
      example: 'Europe/Lisbon',
    }),
    environment: ApnsEnvironment.optional().openapi({
      description: 'APNs only: `sandbox` for a development build’s token (default `production`).',
    }),
  })
  .openapi('DeviceRequest');

const DeviceRegistration = z
  .object({
    organizations: z.number().int().min(0).openapi({
      description:
        'In how many organizations the phone is now stored. 0: the person has no order or ticket yet; register again after the first purchase.',
    }),
  })
  .openapi('DeviceRegistration');

const TokenParam = z.object({
  token: z
    .string()
    .min(8)
    .max(4096)
    .openapi({ param: { name: 'token', in: 'path' }, description: 'The device token, URL-encoded' }),
});

const register = createRoute({
  method: 'post',
  path: '/me/devices',
  operationId: 'registerDevice',
  tags: ['me'],
  summary: 'Register this phone for push notifications',
  description:
    'Stores the phone in every organization where the signed-in person has an order or an active ticket, and removes it from anyone else it was registered to (the phone changed hands). Registering again refreshes the row and re-enables a token the push service had reported gone. Needs a verified email.',
  security: userSecurity,
  request: body(DeviceRequest),
  responses: { 200: json(DeviceRegistration, 'Registered'), ...writeProblems },
});

const remove = createRoute({
  method: 'delete',
  path: '/me/devices/{token}',
  operationId: 'removeDevice',
  tags: ['me'],
  summary: 'Remove this phone (sign-out)',
  description:
    'Deletes the phone’s rows in every organization, for the signed-in person only. Unknown tokens also answer `204`. Call it before signing out.',
  security: userSecurity,
  request: { params: TokenParam },
  responses: { 204: { description: 'Removed (unknown tokens too)' }, ...problems },
});

export function deviceRoutes(deps: V1Deps) {
  return new OpenAPIHono<V1Env>()
    .openapi(register, async (c) => {
      const { user } = c.get('me');
      const parsed = AppDeviceInput.safeParse(c.req.valid('json'));
      if (!parsed.success)
        throw new DomainError('validation_failed', 'Invalid request', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.code })),
        });
      const device = parsed.data;
      const notifier = createNotifier();
      const r = await registerAppDevice({
        email: user.email,
        device,
        ports: deps.ports,
        // Reminders skipped while the person had no phone here are queued now.
        afterOrg: (tx, _orgId, emailNorm) =>
          queueRemindersForHolderTx(tx, notifier, emailNorm, new Date()).then(() => undefined),
      });
      return c.json({ organizations: r.orgs }, 200);
    })
    .openapi(remove, async (c) => {
      const { user } = c.get('me');
      await removeAppDevice(user.email, c.req.valid('param').token);
      return c.body(null, 204);
    });
}
