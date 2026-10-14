import { lookupHash, type ManifestRow, phoneLookupHash } from '@yayatoh/checkin-engine';
import { memoryFileStore, memoryKeyValueStore } from '@yayatoh/mobile-core';
import type {
  AssistanceRequest,
  GuestSnapshot,
  Lead,
  LeadSetup,
  OpsView,
  StaffApi,
  StaffOverview,
} from '../../src/tools/api';
import { createVault } from '../../src/tools/vault';

export const SALT = 'yy-manifest:e1';
export const EVENT = '11111111-1111-4111-8111-111111111111';
export const DEVICE = '22222222-2222-4222-8222-222222222222';
export const CHECKPOINT = '33333333-3333-4333-8333-333333333333';

let counter = 0;
export const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export const fakeRandom = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);

export function testVault() {
  const files = memoryFileStore();
  const storage = memoryKeyValueStore();
  return { files, storage, vault: createVault({ files, storage, random: fakeRandom }) };
}

export async function row(
  over: Partial<ManifestRow> & { email?: string; phone?: string } = {},
): Promise<ManifestRow> {
  const { email, phone, ...rest } = over;
  const phoneHash = phone ? await phoneLookupHash(SALT, phone) : null;
  return {
    ticketId: rest.ticketId ?? `t-${++counter}`,
    shortCode: rest.shortCode ?? 'ABCD2345',
    rev: 1,
    status: 'active',
    ticketTypeId: 'type-1',
    typeName: 'General admission',
    accessDates: [{ date: '2026-10-20', name: 'Day 1' }],
    holderName: 'Ada Lovelace',
    emailHash: await lookupHash(SALT, email ?? 'ada@example.test'),
    ...(phoneHash ? { phoneHash } : {}),
    issuedAt: '2026-09-01T10:00:00Z',
    legacyCodes: ['legacy-hash'],
    ...rest,
  };
}

export const overview = (over: Partial<StaffOverview> = {}): StaffOverview => ({
  eventId: EVENT,
  eventName: 'Harbor Summit',
  timezone: 'America/New_York',
  day: '2026-10-20',
  asOf: '2026-10-20T14:00:00Z',
  checkedIn: 412,
  expected: 900,
  byEntrance: [
    { checkpointId: CHECKPOINT, name: 'Main gate', checkedIn: 300 },
    { checkpointId: '44444444-4444-4444-8444-444444444444', name: 'North gate', checkedIn: 112 },
  ],
  byDate: [{ day: '2026-10-20', checkedIn: 412 }],
  devices: [
    {
      id: DEVICE,
      label: 'Gate A iPad',
      online: true,
      lastSeenAt: '2026-10-20T13:59:30Z',
      batteryPct: 81,
      queueDepth: 0,
      checkpointId: CHECKPOINT,
      mode: 'scanner',
      self: true,
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      label: 'Gate B phone',
      online: false,
      lastSeenAt: '2026-10-20T13:40:00Z',
      batteryPct: 9,
      queueDepth: 14,
      checkpointId: null,
      mode: 'scanner',
      self: false,
    },
  ],
  alerts: [
    {
      key: 'device_low_battery:5555',
      kind: 'device_low_battery',
      severity: 'warning',
      deviceId: '55555555-5555-4555-8555-555555555555',
      deviceLabel: 'Gate B phone',
      percent: 9,
      count: null,
      since: '2026-10-20T13:50:00Z',
    },
  ],
  channels: { checkins: 'c', devices: 'd', assistance: 'a' },
  deviceId: DEVICE,
  ...over,
});

export const snapshot = (): GuestSnapshot => ({
  version: 1,
  eventId: EVENT,
  generatedAt: '2026-10-20T08:00:00Z',
  card: null,
  parties: [
    {
      id: 'p1',
      name: 'Hopper wedding',
      tags: ['Family'],
      guests: [
        {
          id: 'g1',
          firstName: 'Grace',
          lastName: 'Hopper',
          name: 'Grace Hopper',
          guestOf: null,
          status: 'attending',
          places: [{ chart: null, kind: 'table', label: 'Table 4' }],
          arrivedAt: null,
        },
        {
          id: 'g2',
          firstName: null,
          lastName: null,
          name: null,
          guestOf: 'Grace Hopper',
          status: 'attending',
          places: [],
          arrivedAt: '2026-10-20T09:00:00Z',
        },
      ],
    },
    {
      id: 'p2',
      name: 'Turing party',
      tags: ['Friends'],
      guests: [
        {
          id: 'g3',
          firstName: 'Alan',
          lastName: 'Turing',
          name: 'Alan Turing',
          guestOf: null,
          status: 'pending',
          places: [{ chart: null, kind: 'table', label: 'Table 9' }],
          arrivedAt: null,
        },
      ],
    },
  ],
});

export const request = (over: Partial<AssistanceRequest> = {}): AssistanceRequest => ({
  id: '66666666-6666-4666-8666-666666666666',
  number: 7,
  source: 'guest',
  reason: 'accessibility',
  priority: 'high',
  state: 'new',
  note: 'Needs a ramp at the north gate',
  location: 'North gate',
  guest: { name: 'Sam Rivera', ticket: 'General' },
  device: null,
  checkpoint: 'North gate',
  assignee: null,
  mine: false,
  createdAt: '2026-10-20T13:50:00Z',
  dueAt: '2026-10-20T14:05:00Z',
  assignedAt: null,
  startedAt: null,
  closedAt: null,
  overdue: false,
  activity: [],
  ...over,
});

export const setup = (over: Partial<LeadSetup> = {}): LeadSetup => ({
  eventName: 'Harbor Summit',
  timezone: 'America/New_York',
  exhibitorName: 'Acme Robotics',
  role: 'exhibitor_staff',
  email: 'rep@acme.test',
  license: 'licensed',
  termsAccepted: true,
  termsVersion: 1,
  capture: {
    state: 'open',
    opensAt: '2026-10-19T13:00:00Z',
    closesAt: '2026-10-22T13:00:00Z',
    accessUntil: '2027-01-20T13:00:00Z',
    accessOpen: true,
  },
  qualifiers: ['Budget approved', 'Wants demo', 'Existing customer'],
  teamVisibility: false,
  leadCount: 0,
  ...over,
});

export const lead = (over: Partial<Lead> = {}): Lead => ({
  id: '77777777-7777-4777-8777-777777777777',
  name: 'Dana Whitfield',
  jobTitle: 'Head of Operations',
  company: 'Northwind',
  email: 'dana@northwind.test',
  sharedFields: ['name', 'job_title', 'company', 'email'],
  emailConsentVersion: 1,
  emailWithdrawnAt: null,
  rating: 'hot',
  qualifiers: ['Wants demo'],
  notes: 'Call after the keynote',
  capturedAt: '2026-10-20T10:00:00Z',
  lastScannedAt: '2026-10-20T10:00:00Z',
  scans: 1,
  scannedByMe: true,
  scannedBy: null,
  ...over,
});

export const opsView = (): OpsView =>
  ({
    eventId: EVENT,
    asOf: '2026-10-20T14:00:00Z',
    timeZone: 'America/New_York',
    mode: 'live',
    checkins: {
      timeZone: 'America/New_York',
      checkedIn: 412,
      expected: 900,
      byEntrance: [
        { name: 'Main gate', checkedIn: 300 },
        { name: 'North gate', checkedIn: 112 },
      ],
      byDate: [{ day: '2026-10-20', checkedIn: 412 }],
      asOf: '2026-10-20T14:00:00Z',
    },
    throughput: {
      windowMin: 15,
      series: [
        { at: '2026-10-20T13:58:00Z', count: 12 },
        { at: '2026-10-20T13:59:00Z', count: 18 },
      ],
      scansPerMin: 15.5,
      medianGapS: 3.2,
      queueMin: 4,
      remaining: 488,
      entrances: [
        { id: CHECKPOINT, name: 'Main gate', scansPerMin: 10.5, medianGapS: 4, queueMin: 2 },
        { id: null, name: 'North gate', scansPerMin: 5, medianGapS: null, queueMin: null },
      ],
      devices: [],
      asOf: '2026-10-20T14:00:00Z',
    },
    scanIssues: {
      counts: [
        { result: 'duplicate', count: 6 },
        { result: 'invalid', count: 2 },
      ],
      duplicates: 6,
      refused: 2,
      recent: [
        {
          id: 'a1',
          result: 'duplicate',
          at: '2026-10-20T13:55:00Z',
          checkpoint: 'Main gate',
          device: 'Gate A iPad',
          orderId: null,
        },
      ],
      asOf: '2026-10-20T14:00:00Z',
    },
    devices: {
      devices: [
        {
          id: DEVICE,
          label: 'Gate A iPad',
          online: true,
          lastSeenAt: '2026-10-20T13:59:30Z',
          batteryPct: 81,
          queueDepth: 0,
          checkpoint: 'Main gate',
          kiosk: false,
          appVersion: '1.0.0',
          lastScanAt: '2026-10-20T13:59:00Z',
        },
      ],
      asOf: '2026-10-20T14:00:00Z',
    },
    alerts: {
      alerts: [
        {
          id: 'al1',
          rule: 'devicesOffline',
          severity: 'warning',
          state: 'open',
          count: 1,
          href: null,
          at: '2026-10-20T13:50:00Z',
        },
      ],
    },
  }) as unknown as OpsView;

/** A StaffApi whose every call is a jest mock; override what a test needs. */
export function fakeStaff(over: Partial<StaffApi> = {}): jest.Mocked<StaffApi> {
  const base: StaffApi = {
    overview: async () => overview(),
    guests: async () => snapshot(),
    recordArrivals: async (_e, arrivals) => ({
      results: arrivals.map((a) => ({ clientId: a.clientId, result: 'arrived' as const })),
    }),
    assistance: async () => [request()],
    raiseAssistance: async () => ({ requestId: 'r1', number: 8 }),
    workAssistance: async () => ({ state: 'assigned' }),
    pushStatus: async () => ({ subscribed: false, supervisor: false, platform: null }),
    registerPush: async () => {},
    unregisterPush: async () => {},
    manifestPage: async () => ({ salt: SALT, rows: [], cursor: null, complete: true }),
    checkIn: async () => ({
      result: 'admitted',
      holderName: 'Ada Lovelace',
      typeName: 'General admission',
      shortCode: 'ABCD2345',
      firstAdmittedAt: null,
    }),
  };
  const merged = { ...base, ...over };
  return Object.fromEntries(
    Object.entries(merged).map(([k, fn]) => [k, jest.fn(fn as never)]),
  ) as unknown as jest.Mocked<StaffApi>;
}

import type { LeadScanResult, PortalApi } from '../../src/tools/api';

export function fakePortal(over: Partial<PortalApi> = {}): jest.Mocked<PortalApi> {
  const base: PortalApi = {
    setup: async () => setup(),
    leads: async () => ({ leads: [lead()], scope: 'own' }),
    syncScans: async (scans) =>
      scans.map(
        (s): LeadScanResult => ({ scanId: s.scanId, status: 'captured', reason: null, lead: lead() }),
      ),
    updateLead: async () => {},
  };
  const merged = { ...base, ...over };
  return Object.fromEntries(
    Object.entries(merged).map(([k, fn]) => [k, jest.fn(fn as never)]),
  ) as unknown as jest.Mocked<PortalApi>;
}

import type { OpsApi } from '../../src/tools/api';

export function fakeOps(over: Partial<OpsApi> = {}): jest.Mocked<OpsApi> {
  const base: OpsApi = {
    ops: async () => opsView(),
    organizations: async () => [{ id: 'org-1', slug: 'harbor', name: 'Harbor Events' }],
    events: async () => [
      { id: EVENT, name: 'Harbor Summit', startsAt: '2026-10-20T13:00:00Z', timezone: 'America/New_York' },
    ],
  };
  const merged = { ...base, ...over };
  return Object.fromEntries(
    Object.entries(merged).map(([k, fn]) => [k, jest.fn(fn as never)]),
  ) as unknown as jest.Mocked<OpsApi>;
}
