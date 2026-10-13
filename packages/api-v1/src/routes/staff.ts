import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  ACTIVITY_KINDS,
  PRIORITIES,
  REASONS,
  REQUEST_SOURCES,
  REQUEST_STATES,
  STAFF_REASONS,
} from '@yayatoh/assistance';
import {
  ARRIVAL_RESULTS,
  MAX_ARRIVALS_PER_SYNC,
  NATIVE_PUSH_PLATFORMS,
  STAFF_ALERT_KINDS,
  STAFF_PUSH_PLATFORMS,
} from '@yayatoh/checkin';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { createMiddleware } from 'hono/factory';
import type { V1Deps, V1Env } from '../context.ts';
import { toWire } from '../resources.ts';
import {
  deviceFromAuthorization,
  guestSnapshotFor,
  openAssistanceQueue,
  opsViewFor,
  raiseStaffRequest,
  recordGuestArrivals,
  registerNativePush,
  STAFF_ASSISTANCE_ACTIONS,
  staffOverviewFor,
  staffPushStatus,
  unsubscribeStaffPush,
  workStaffRequest,
} from '../staff/index.ts';
import { body, EventParams, json, problems, userSecurity, writeProblems } from './common.ts';

/**
 * M7.2e, the door apps' API. The Staff app (and nothing else) calls these with the device token an
 * organizer's enrolment QR hands it (`yyd_…`): the PWA's `/api/scan/*` reads and writes, one
 * implementation behind both (`../staff`). A revoked or wiped device is refused on every route
 * at once. Plus the organizer's read-only event-day view, with a member's bearer session.
 */
type Env = { Variables: V1Env['Variables'] & { device: Ctx } };

const deviceSecurity = [{ deviceToken: [] }];
const iso = z.iso.datetime({ offset: true });
const Count = z.int().min(0);

const deviceProblems = {
  ...problems,
  401: {
    ...problems[401],
    description: 'Missing, unknown, revoked or wiped device token (`unauthenticated`)',
  },
};
const deviceWriteProblems = { ...writeProblems, ...deviceProblems };

const EventIdParam = z.object({
  eventId: z
    .uuid()
    .openapi({ param: { name: 'eventId', in: 'path' }, description: 'The event the device works' }),
});

/* ---------------------------------------------------------------- staff overview ---- */

const StaffAlertKind = z.enum(STAFF_ALERT_KINDS).openapi('StaffAlertKind');
const StaffAlertSeverity = z.enum(['warning', 'critical']).openapi('StaffAlertSeverity');
const DeviceMode = z.enum(['scanner', 'kiosk']).openapi('DeviceMode');

const StaffOverview = z
  .object({
    eventId: z.uuid(),
    eventName: z.string(),
    timezone: z.string(),
    day: z.string().openapi({ description: 'Today in the event’s time zone (`YYYY-MM-DD`).' }),
    asOf: iso,
    checkedIn: Count.openapi({ description: 'Tickets checked in today (live admissions).' }),
    expected: Count.openapi({ description: 'Tickets issued for the event.' }),
    byEntrance: z.array(z.object({ checkpointId: z.uuid(), name: z.string(), checkedIn: Count })),
    byDate: z
      .array(z.object({ day: z.string(), checkedIn: Count }))
      .openapi({ description: 'Live admissions per event day (multi-day events), oldest first.' }),
    devices: z.array(
      z.object({
        id: z.uuid(),
        label: z.string(),
        online: z.boolean(),
        lastSeenAt: iso.nullable(),
        batteryPct: z.int().nullable(),
        queueDepth: z.int().nullable(),
        checkpointId: z.uuid().nullable(),
        mode: DeviceMode,
        self: z.boolean().openapi({ description: 'The device asking.' }),
      }),
    ),
    alerts: z
      .array(
        z.object({
          key: z.string(),
          kind: StaffAlertKind,
          severity: StaffAlertSeverity,
          deviceId: z.uuid().nullable(),
          deviceLabel: z.string().nullable(),
          percent: z.int().nullable(),
          count: z.int().nullable(),
          since: iso,
        }),
      )
      .openapi({
        description:
          'Staff alerts; a device a supervisor opted in for also sees device alerts (offline, low battery, backlog).',
      }),
    channels: z
      .object({ checkins: z.string(), devices: z.string(), assistance: z.string() })
      .openapi({ description: 'Realtime channel names to follow for this event.' }),
    deviceId: z.uuid().openapi({ description: 'The device asking.' }),
  })
  .openapi('StaffOverview');

const getOverview = createRoute({
  method: 'get',
  path: '/staff/events/{eventId}/overview',
  operationId: 'getStaffOverview',
  tags: ['staff'],
  summary: 'Staff mode: today’s counts, the device board and alerts for the device’s event',
  description:
    'Check-ins against expected (per entrance and per event day), the event’s devices and the alerts the device may see, plus the realtime channels to follow. Device token only; the app keeps the last answer for offline use. The same answer as the Scan PWA’s staff screen.',
  security: deviceSecurity,
  request: { params: EventIdParam },
  responses: { 200: json(StaffOverview, 'The staff screen'), ...deviceProblems },
});

/* --------------------------------------------------------------------- guests ---- */

const GuestStatus = z.enum(['attending', 'pending', 'declined']).openapi('GuestStatus');
const GuestPlaceKind = z.enum(['table', 'row']).openapi('GuestPlaceKind');

const GuestSnapshot = z
  .object({
    version: z.int(),
    eventId: z.uuid(),
    generatedAt: iso,
    parties: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        tags: z.array(z.string()),
        guests: z.array(
          z.object({
            id: z.uuid(),
            firstName: z.string().nullable(),
            lastName: z.string().nullable(),
            name: z.string().nullable(),
            guestOf: z.string().nullable(),
            status: GuestStatus,
            places: z.array(
              z.object({ chart: z.string().nullable(), kind: GuestPlaceKind, label: z.string() }),
            ),
            arrivedAt: iso.nullable(),
          }),
        ),
      }),
    ),
    card: z.object({ url: z.string(), size: z.int(), d: z.string() }).nullable().openapi({
      description:
        'While the event takes gifts online: the card-saving page opened from check-in, with its QR path (`d`, in a `size`-wide square).',
    }),
  })
  .openapi('GuestSnapshot');

const getGuests = createRoute({
  method: 'get',
  path: '/staff/events/{eventId}/guests',
  operationId: 'getStaffGuestSnapshot',
  tags: ['staff'],
  summary: 'The event’s guests for check-in by name or party, offline too',
  description:
    'Names, party labels, tables and arrivals of the event’s guest list: an allowlist with no contact detail, meal or private answer. Device token only.',
  security: deviceSecurity,
  request: { params: EventIdParam },
  responses: { 200: json(GuestSnapshot, 'The guest snapshot'), ...deviceProblems },
});

const ArrivalSource = z.enum(['scanner', 'kiosk']).openapi('GuestArrivalSource');
const ArrivalResult = z.enum(ARRIVAL_RESULTS).openapi('GuestArrivalResult');

const GuestArrivalsBody = z
  .object({
    eventId: z.uuid(),
    arrivals: z
      .array(
        z.object({
          clientId: z
            .uuid()
            .openapi({ description: 'The device’s id for this check-in: a resend is a no-op.' }),
          guestId: z.uuid(),
          deviceTs: iso,
          clockOffsetMs: z.int(),
          source: ArrivalSource,
        }),
      )
      .min(1)
      .max(MAX_ARRIVALS_PER_SYNC),
  })
  .openapi('GuestArrivalsRequest');

const GuestArrivalsResult = z
  .object({ results: z.array(z.object({ clientId: z.uuid(), result: ArrivalResult })) })
  .openapi('GuestArrivalsResult');

const postArrivals = createRoute({
  method: 'post',
  path: '/staff/guest-arrivals',
  operationId: 'recordStaffGuestArrivals',
  tags: ['staff'],
  summary: 'Sync guest check-ins made on the device, offline ones too (idempotent per check-in)',
  description:
    'Up to 500 arrivals; each is applied once by its `clientId`, so a retry is safe, and the first arrival of a guest (corrected device time) wins. `arrived`: this check-in is the guest’s arrival; `already`: someone checked the guest in earlier; `unknown`: not a guest of this event. Device token only.',
  security: deviceSecurity,
  request: body(GuestArrivalsBody),
  responses: { 200: json(GuestArrivalsResult, 'Results per check-in'), ...deviceWriteProblems },
});

/* ----------------------------------------------------------------- assistance ---- */

const AssistanceSource = z.enum(REQUEST_SOURCES).openapi('AssistanceSource');
const AssistanceReason = z.enum(REASONS as [string, ...string[]]).openapi('AssistanceReason');
const AssistancePriority = z.enum(PRIORITIES).openapi('AssistancePriority');
const AssistanceState = z.enum(REQUEST_STATES).openapi('AssistanceState');
const AssigneeKind = z.enum(['user', 'device']).openapi('AssistanceAssigneeKind');
const AssistanceActivityKind = z.enum(ACTIVITY_KINDS).openapi('AssistanceActivityKind');
const AssistanceActor = z.enum(['guest', 'member', 'device', 'system']).openapi('AssistanceActor');
const StaffAssistanceReason = z.enum(STAFF_REASONS).openapi('StaffAssistanceReason');

const AssistanceRequest = z
  .object({
    id: z.uuid(),
    number: z.int(),
    source: AssistanceSource,
    reason: AssistanceReason,
    priority: AssistancePriority,
    state: AssistanceState,
    note: z.string(),
    location: z.string(),
    guest: z.object({ name: z.string(), ticket: z.string() }).nullable(),
    device: z.string().nullable().openapi({ description: 'The device that raised a staff request.' }),
    checkpoint: z.string().nullable(),
    assignee: z.object({ kind: AssigneeKind, id: z.uuid(), label: z.string().nullable() }).nullable(),
    mine: z.boolean().openapi({ description: 'Assigned to the device asking.' }),
    createdAt: iso,
    dueAt: iso,
    assignedAt: iso.nullable(),
    startedAt: iso.nullable(),
    closedAt: iso.nullable(),
    overdue: z.boolean(),
    activity: z.array(
      z.object({
        kind: AssistanceActivityKind,
        body: z.string(),
        actor: AssistanceActor,
        actorUserId: z.uuid().nullable(),
        actorDevice: z.string().nullable(),
        assigneeUserId: z.uuid().nullable(),
        assigneeDevice: z.string().nullable(),
        at: iso,
      }),
    ),
  })
  .openapi('AssistanceRequest');

const AssistanceQueue = z.object({ requests: z.array(AssistanceRequest) }).openapi('AssistanceQueue');

const listAssistance = createRoute({
  method: 'get',
  path: '/staff/events/{eventId}/assistance',
  operationId: 'listStaffAssistance',
  tags: ['staff'],
  summary: 'The event’s open help requests, most urgent first',
  description:
    'Open requests (guests’ and staff’s) most urgent first, then oldest first; at most 50. Device token only.',
  security: deviceSecurity,
  request: { params: EventIdParam },
  responses: { 200: json(AssistanceQueue, 'The open queue'), ...deviceProblems },
});

const StaffRequestBody = z
  .object({
    eventId: z.uuid(),
    reason: StaffAssistanceReason,
    note: z.string().max(500).optional(),
    checkpointId: z
      .uuid()
      .nullable()
      .optional()
      .openapi({ description: 'The entrance the device scans at, if any.' }),
  })
  .openapi('StaffAssistanceRequestBody');

const StaffRequestCreated = z
  .object({ requestId: z.uuid(), number: z.int() })
  .openapi('StaffAssistanceCreated');

const createAssistance = createRoute({
  method: 'post',
  path: '/staff/assistance',
  operationId: 'createStaffAssistanceRequest',
  tags: ['staff'],
  summary: 'Ask for backup, a supervisor, medical help, security or device support',
  description:
    'Raises a staff request tied to this device and the entrance it scans at; urgent ones push to the other staff devices. Device token only.',
  security: deviceSecurity,
  request: body(StaffRequestBody),
  responses: { 201: json(StaffRequestCreated, 'The request'), ...deviceWriteProblems },
});

const AssistanceAction = z.enum(STAFF_ASSISTANCE_ACTIONS).openapi('StaffAssistanceAction');

const WorkRequestParams = z.object({
  requestId: z.uuid().openapi({ param: { name: 'requestId', in: 'path' }, description: 'The help request' }),
  action: AssistanceAction.openapi({
    param: { name: 'action', in: 'path' },
    description:
      '`take` gives the request to this device; `start`, `resolve` and `cancel` move it on (resolving and cancelling close it).',
  }),
});

const WorkRequestBody = z.object({ eventId: z.uuid() }).openapi('StaffAssistanceWorkBody');
const WorkRequestResult = z.object({ state: AssistanceState }).openapi('StaffAssistanceWorked');

const workAssistance = createRoute({
  method: 'post',
  path: '/staff/assistance/{requestId}/{action}',
  operationId: 'workStaffAssistanceRequest',
  tags: ['staff'],
  summary: 'Take, start, resolve or cancel a help request',
  description:
    'Works one help request of the device’s event. A request that changed meanwhile answers 409; one that cannot take that action answers 409 `invalid_state`. Device token only.',
  security: deviceSecurity,
  request: { params: WorkRequestParams, ...body(WorkRequestBody) },
  responses: { 200: json(WorkRequestResult, 'The request’s new state'), ...deviceWriteProblems },
});

/* ------------------------------------------------------------------------ push ---- */

const NativePushPlatform = z.enum(NATIVE_PUSH_PLATFORMS).openapi('NativePushPlatform');
const StaffPushPlatform = z.enum(STAFF_PUSH_PLATFORMS).openapi('StaffPushPlatform');
const AlertCopy = z.object({ title: z.string().min(1).max(200), body: z.string().min(1).max(200) });

const NativePushBody = z
  .object({
    platform: NativePushPlatform,
    token: z
      .string()
      .min(8)
      .max(4096)
      .openapi({ description: 'The APNs device token or the FCM registration token.' }),
    appId: z
      .string()
      .min(3)
      .max(200)
      .nullable()
      .optional()
      .openapi({ description: 'The app’s bundle id (APNs topic) or package name.' }),
    locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    copy: z
      .object({
        ...(Object.fromEntries(STAFF_ALERT_KINDS.map((k) => [k, AlertCopy])) as Record<
          (typeof STAFF_ALERT_KINDS)[number],
          typeof AlertCopy
        >),
        assistance: AlertCopy.optional(),
      })
      .openapi({
        description:
          'The notification text per alert kind in the device’s language (placeholders `{label}` and `{percent}`); the server holds no UI strings.',
      }),
  })
  .openapi('StaffNativePushRequest');

const PushStatus = z
  .object({
    subscribed: z.boolean(),
    supervisor: z.boolean().openapi({ description: 'A supervisor claimed device alerts on this device.' }),
    platform: StaffPushPlatform.nullable(),
  })
  .openapi('StaffPushStatus');

const getPush = createRoute({
  method: 'get',
  path: '/staff/push',
  operationId: 'getStaffPush',
  tags: ['staff'],
  summary: 'Are staff alerts pushed to this device?',
  description:
    'Whether this device has a push registration for staff alerts, and on which service. Device token only.',
  security: deviceSecurity,
  responses: { 200: json(PushStatus, 'The registration'), ...deviceProblems },
});

const OkResult = z.object({ ok: z.boolean() }).openapi('StaffPushOk');

const putPush = createRoute({
  method: 'put',
  path: '/staff/push',
  operationId: 'registerStaffPush',
  tags: ['staff'],
  summary: 'Register this device for staff alerts on APNs or FCM',
  description:
    'The device’s one push registration: a new one replaces the old. It is deleted when an organizer revokes or wipes the device. Pushes carry the app’s own words (`copy`) with a device label or a percentage, never personal data. Device token only.',
  security: deviceSecurity,
  request: body(NativePushBody),
  responses: { 200: json(OkResult, 'Registered'), ...deviceWriteProblems },
});

const deletePush = createRoute({
  method: 'delete',
  path: '/staff/push',
  operationId: 'unregisterStaffPush',
  tags: ['staff'],
  summary: 'Stop pushing staff alerts to this device',
  description: 'Removes the device’s push registration. Device token only.',
  security: deviceSecurity,
  responses: { 200: json(OkResult, 'Removed'), ...deviceProblems },
});

/* ------------------------------------------------------------------------ ops ---- */

const OpsCheckins = z
  .object({
    timeZone: z.string(),
    checkedIn: Count,
    expected: Count,
    byEntrance: z.array(z.object({ name: z.string(), checkedIn: Count })),
    byDate: z.array(z.object({ day: z.string(), checkedIn: Count })),
    asOf: iso,
  })
  .openapi('OpsCheckins');

const OpsRate = z.object({
  id: z.uuid().nullable(),
  name: z.string().nullable(),
  scansPerMin: z.number().min(0),
  medianGapS: z.number().min(0).nullable(),
  queueMin: z.int().min(0).nullable(),
});

const OpsThroughput = z
  .object({
    windowMin: z.int(),
    series: z
      .array(z.object({ at: iso, count: Count }))
      .openapi({ description: 'Check-ins per minute over the last 15 minutes, oldest first.' }),
    scansPerMin: z.number().min(0),
    medianGapS: z.number().min(0).nullable(),
    queueMin: z.int().min(0).nullable(),
    remaining: Count.openapi({ description: 'Expected guests not in yet.' }),
    entrances: z.array(OpsRate).openapi({ description: 'Scans per minute at each entrance.' }),
    devices: z.array(OpsRate),
    asOf: iso,
  })
  .openapi('OpsThroughput');

const ScanResultName = z.string().regex(/^[a-z_]{3,40}$/);

const OpsScanIssues = z
  .object({
    counts: z.array(z.object({ result: ScanResultName, count: Count })),
    duplicates: Count,
    refused: Count,
    recent: z.array(
      z.object({
        id: z.uuid(),
        result: ScanResultName,
        at: iso,
        checkpoint: z.string().nullable(),
        device: z.string().nullable(),
        orderId: z.uuid().nullable(),
      }),
    ),
    asOf: iso,
  })
  .openapi('OpsScanIssues');

const OpsDevices = z
  .object({
    devices: z.array(
      z.object({
        id: z.uuid(),
        label: z.string(),
        online: z.boolean(),
        lastSeenAt: iso.nullable(),
        batteryPct: z.int().nullable(),
        queueDepth: z.int().nullable(),
        checkpoint: z.string().nullable(),
        kiosk: z.boolean(),
        appVersion: z.string().nullable(),
        lastScanAt: iso.nullable(),
      }),
    ),
    asOf: iso,
  })
  .openapi('OpsDevices');

const AlertSeverity = z.enum(['info', 'warning', 'critical']).openapi('OpsAlertSeverity');
const AlertState = z.enum(['open', 'acknowledged', 'snoozed']).openapi('OpsAlertState');

const OpsAlerts = z
  .object({
    alerts: z.array(
      z.object({
        id: z.uuid(),
        rule: z.string().openapi({ description: 'The alert rule’s key.' }),
        severity: AlertSeverity,
        state: AlertState,
        count: Count,
        href: z.string().nullable().openapi({ description: 'Console path of the page that fixes it.' }),
        at: iso,
      }),
    ),
  })
  .openapi('OpsAlerts');

const EventMode = z.enum(['planning', 'pre_show', 'live', 'wrap']).openapi('EventMode');

const OpsView = z
  .object({
    eventId: z.uuid(),
    asOf: iso,
    timeZone: z.string(),
    mode: EventMode.openapi({ description: 'The Command Center mode in force.' }),
    checkins: OpsCheckins.nullable(),
    throughput: OpsThroughput.nullable(),
    scanIssues: OpsScanIssues.nullable(),
    devices: OpsDevices.nullable(),
    alerts: OpsAlerts.nullable(),
  })
  .openapi('OpsView');

const getOps = createRoute({
  method: 'get',
  path: '/orgs/{org}/events/{eventId}/ops',
  operationId: 'getEventOps',
  tags: ['staff'],
  summary: 'The event-day view: check-ins against expected, throughput, scan issues, devices and alerts',
  description:
    'Read-only, for members who can read the event (a bearer session; an API key answers 403, the Command Center is for members). The numbers are the web Command Center’s, from the same loaders: check-ins against expected, scans per minute per entrance and a per-minute series, duplicate and invalid scans, device status and the active alerts. A section the member’s role or the organization’s plan does not include is `null`.',
  security: userSecurity,
  request: { params: EventParams },
  responses: { 200: json(OpsView, 'The event-day view'), ...problems },
});

/**
 * Device authentication for `/staff/*`: the bearer token decides the org. An unknown, revoked or
 * wiped token is a 401 on every route at once (the device then drops its token).
 */
const authenticate = createMiddleware<Env>(async (c, next) => {
  const ctx = await deviceFromAuthorization(c.req.header('authorization'), { refuseWiped: true });
  if (!ctx) throw new DomainError('unauthenticated', 'Device token required');
  c.set('device', ctx);
  await next();
});

export function staffRoutes(deps: V1Deps) {
  const { ports } = deps;
  const staff = new OpenAPIHono<Env>();
  staff.use('/staff/*', authenticate);
  return staff
    .openapi(getOverview, async (c) => {
      const view = await staffOverviewFor(c.get('device'), c.req.valid('param').eventId, ports);
      return c.json(toWire(StaffOverview, view), 200);
    })
    .openapi(getGuests, async (c) => {
      const snap = await guestSnapshotFor(c.get('device'), c.req.valid('param').eventId, ports);
      return c.json(toWire(GuestSnapshot, snap), 200);
    })
    .openapi(postArrivals, async (c) => {
      const r = await recordGuestArrivals(c.get('device'), c.req.valid('json'), ports);
      return c.json(toWire(GuestArrivalsResult, r), 200);
    })
    .openapi(listAssistance, async (c) => {
      const requests = await openAssistanceQueue(c.get('device'), c.req.valid('param').eventId, ports);
      return c.json(toWire(AssistanceQueue, { requests }), 200);
    })
    .openapi(createAssistance, async (c) => {
      const r = await raiseStaffRequest(c.get('device'), c.req.valid('json'), ports);
      return c.json(toWire(StaffRequestCreated, r), 201);
    })
    .openapi(workAssistance, async (c) => {
      const { requestId, action } = c.req.valid('param');
      const r = await workStaffRequest(
        c.get('device'),
        { eventId: c.req.valid('json').eventId, requestId, action },
        ports,
      );
      return c.json(toWire(WorkRequestResult, r), 200);
    })
    .openapi(getPush, async (c) => {
      const s = await staffPushStatus(c.get('device'), ports);
      return c.json(toWire(PushStatus, s), 200);
    })
    .openapi(putPush, async (c) => {
      const r = await registerNativePush(c.get('device'), c.req.valid('json'), ports);
      return c.json(toWire(OkResult, r), 200);
    })
    .openapi(deletePush, async (c) => {
      const r = await unsubscribeStaffPush(c.get('device'), ports);
      return c.json(toWire(OkResult, r), 200);
    })
    .openapi(getOps, async (c) => {
      const view = await opsViewFor(c.get('ctx'), c.req.valid('param').eventId, ports);
      return c.json(toWire(OpsView, view), 200);
    });
}
