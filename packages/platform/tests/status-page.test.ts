import { describe, expect, it, vi } from 'vitest';
import {
  betterStackImpact,
  betterStackSnapshot,
  betterStackStatusPage,
  fakeIncident,
  impactStatus,
  incidentBanner,
  mapBetterStackStatus,
  PostIncidentInput,
  type StatusIncident,
  snapshotFromIncidents,
  worstStatus,
} from '../src/status-page.ts';

const NOW = new Date('2026-09-28T12:00:00Z');
const incident = (over: Partial<StatusIncident>): StatusIncident => ({
  id: 'i1',
  title: 'Checkout errors',
  impact: 'minor',
  status: 'investigating',
  active: true,
  components: ['checkout'],
  startedAt: new Date('2026-09-28T11:00:00Z'),
  resolvedAt: null,
  updates: [],
  ...over,
});
const COMPONENTS = [
  { key: 'checkout', name: 'Checkout' },
  { key: 'checkin', name: 'Check-in' },
  { key: 'api', name: 'API' },
];

describe('status mapping (M3.11b)', () => {
  it('orders states by severity; nothing is operational', () => {
    expect(worstStatus([])).toBe('operational');
    expect(worstStatus(['operational', 'maintenance'])).toBe('maintenance');
    expect(worstStatus(['maintenance', 'degraded', 'operational'])).toBe('degraded');
    expect(worstStatus(['degraded', 'major_outage', 'partial_outage'])).toBe('major_outage');
  });

  it('maps an incident impact to the state of the components it names', () => {
    expect(impactStatus('minor')).toBe('degraded');
    expect(impactStatus('major')).toBe('partial_outage');
    expect(impactStatus('critical')).toBe('major_outage');
    expect(impactStatus('maintenance')).toBe('maintenance');
  });

  it('derives component and overall states from open incidents only', () => {
    const s = snapshotFromIncidents(
      'fake',
      COMPONENTS,
      [
        incident({ id: 'a', impact: 'minor', components: ['checkout'] }),
        incident({ id: 'b', impact: 'critical', components: ['checkout', 'api'] }),
        incident({ id: 'c', impact: 'critical', components: ['checkin'], status: 'resolved', active: false }),
        // A scheduled maintenance window hasn't started: no effect yet.
        incident({ id: 'd', impact: 'maintenance', components: ['checkin'], status: 'scheduled' }),
      ],
      NOW,
    );
    expect(Object.fromEntries(s.components.map((c) => [c.key, c.status]))).toEqual({
      checkout: 'major_outage',
      checkin: 'operational',
      api: 'major_outage',
    });
    expect(s.overall).toBe('major_outage');
    // Open incidents first, newest first; then closed ones.
    expect(s.incidents.map((i) => i.id).at(-1)).toBe('c');
  });

  it('all quiet: operational with no banner', () => {
    const s = snapshotFromIncidents('fake', COMPONENTS, [], NOW);
    expect(s.overall).toBe('operational');
    expect(incidentBanner(s)).toBeNull();
    expect(incidentBanner(null)).toBeNull();
  });

  it('the banner shows the most severe open incident and counts the rest; not scheduled maintenance', () => {
    const s = snapshotFromIncidents(
      'fake',
      COMPONENTS,
      [
        incident({ id: 'm', impact: 'maintenance', status: 'in_progress', title: 'Database upgrade' }),
        incident({ id: 'x', impact: 'major', title: 'Scanner sync slow' }),
        incident({ id: 's', impact: 'critical', status: 'scheduled', title: 'Later' }),
        incident({ id: 'r', impact: 'critical', status: 'resolved', active: false, title: 'Old' }),
      ],
      NOW,
    );
    expect(incidentBanner(s)).toEqual({ title: 'Scanner sync slow', impact: 'major', status: 'investigating', others: 1 });
    const onlyMaintenance = snapshotFromIncidents(
      'fake',
      COMPONENTS,
      [incident({ impact: 'maintenance', status: 'in_progress', title: 'Upgrade' })],
      NOW,
    );
    expect(incidentBanner(onlyMaintenance)).toMatchObject({ impact: 'maintenance', others: 0 });
  });

  it('reads fake rows defensively: unknown values and components dropped, updates newest first', () => {
    const i = fakeIncident({
      id: 'f1',
      title: 'Payments delayed',
      impact: 'bogus',
      status: 'resolved',
      components: ['payments', 'not-a-component'],
      updates: [
        { status: 'investigating', body: 'Looking', at: '2026-09-28T10:00:00Z' },
        { status: 'resolved', body: 'Fixed', at: '2026-09-28T11:00:00Z' },
        { status: 'nope', body: 'x', at: 'garbage' },
      ],
      started_at: '2026-09-28T10:00:00Z',
      resolved_at: '2026-09-28T11:00:00Z',
    });
    expect(i).toMatchObject({ impact: 'minor', status: 'resolved', active: false, components: ['payments'] });
    expect(i.updates.map((u) => u.body)).toEqual(['Fixed', 'Looking']);
    expect(fakeIncident({ ...base(), updates: 'not an array' }).updates).toEqual([]);
  });

  it('validates posted incidents', () => {
    expect(PostIncidentInput.safeParse({ title: 'x', impact: 'minor', body: 'y' }).success).toBe(true);
    expect(PostIncidentInput.safeParse({ title: '', impact: 'minor', body: 'y' }).success).toBe(false);
    expect(PostIncidentInput.safeParse({ title: 'x', impact: 'meh', body: 'y' }).success).toBe(false);
    expect(PostIncidentInput.safeParse({ title: 'x', impact: 'minor', body: 'y', components: ['mars'] }).success).toBe(
      false,
    );
  });
});

function base() {
  return {
    id: 'b',
    title: 't',
    impact: 'minor',
    status: 'investigating',
    components: null,
    updates: [],
    started_at: '2026-09-28T10:00:00Z',
    resolved_at: null,
  };
}

describe('Better Stack mapping (M3.11b)', () => {
  it('maps resource states; unknown states are ignored, not outages', () => {
    expect(mapBetterStackStatus('operational')).toBe('operational');
    expect(mapBetterStackStatus('degraded')).toBe('degraded');
    expect(mapBetterStackStatus('downtime')).toBe('major_outage');
    expect(mapBetterStackStatus('maintenance')).toBe('maintenance');
    expect(mapBetterStackStatus('paused')).toBeNull();
    expect(mapBetterStackStatus(undefined)).toBeNull();
    expect(betterStackImpact('maintenance', 'operational')).toBe('maintenance');
    expect(betterStackImpact('manual', 'downtime')).toBe('critical');
    expect(betterStackImpact('manual', 'degraded')).toBe('minor');
  });

  const resources = {
    data: [
      { id: 11, type: 'status_page_resource', attributes: { public_name: 'Checkout', status: 'downtime' } },
      { id: 12, type: 'status_page_resource', attributes: { public_name: 'Scanner', status: 'paused' } },
      { broken: true },
    ],
  };
  const reports = {
    data: [
      {
        id: 'r1',
        attributes: {
          title: 'Checkout down',
          report_type: 'manual',
          aggregate_state: 'downtime',
          starts_at: '2026-09-28T11:00:00Z',
          ends_at: null,
          affected_resources: [{ status_page_resource_id: 11, status: 'downtime' }],
        },
      },
      {
        id: 'r2',
        attributes: {
          title: 'Planned upgrade',
          report_type: 'maintenance',
          aggregate_state: 'maintenance',
          starts_at: '2026-09-29T02:00:00Z',
          ends_at: '2026-09-29T03:00:00Z',
          affected_resources: [],
        },
      },
      {
        id: 'r3',
        attributes: {
          title: 'Old incident',
          report_type: 'manual',
          aggregate_state: 'degraded',
          starts_at: '2026-08-01T00:00:00Z',
          ends_at: '2026-08-01T01:00:00Z',
          affected_resources: [],
        },
      },
      {
        id: 'r4',
        attributes: {
          title: 'Resolved yesterday',
          report_type: 'manual',
          aggregate_state: 'degraded',
          starts_at: '2026-09-27T09:00:00Z',
          ends_at: '2026-09-27T10:00:00Z',
          affected_resources: [],
        },
      },
    ],
  };
  const updates = new Map<string, unknown>([
    [
      'r1',
      {
        data: [
          { attributes: { message: 'Investigating', published_at: '2026-09-28T11:05:00Z' } },
          { attributes: { message: 'Found it', published_at: '2026-09-28T11:30:00Z' } },
        ],
      },
    ],
  ]);

  it('builds a snapshot: components, open and recent incidents, scheduled maintenance, history window', () => {
    const s = betterStackSnapshot(resources, reports, updates, NOW);
    expect(s.provider).toBe('betterstack');
    expect(s.components).toEqual([
      { key: '11', name: 'Checkout', status: 'major_outage' },
      { key: '12', name: 'Scanner', status: 'operational' },
    ]);
    expect(s.overall).toBe('major_outage');
    expect(s.incidents.map((i) => [i.id, i.status, i.active])).toEqual([
      ['r2', 'scheduled', true],
      ['r1', 'investigating', true],
      ['r4', 'resolved', false],
    ]);
    expect(s.incidents.find((i) => i.id === 'r1')?.updates.map((u) => u.body)).toEqual(['Found it', 'Investigating']);
    expect(incidentBanner(s)).toMatchObject({ title: 'Checkout down', impact: 'critical', others: 0 });
  });

  it('tolerates junk documents', () => {
    const s = betterStackSnapshot(null, { data: 'nope' }, new Map(), NOW);
    expect(s).toMatchObject({ overall: 'operational', components: [], incidents: [] });
  });

  it('the adapter sends the token, reads updates and caches for the TTL', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
      const u = String(url);
      const body = u.endsWith('/resources')
        ? resources
        : u.endsWith('/status-reports')
          ? reports
          : u.includes('/status-reports/r1/status-updates')
            ? updates.get('r1')
            : { data: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const port = betterStackStatusPage({ token: 'tok', statusPageId: 'p 1', fetch: fetchMock as never, ttlMs: 60_000 });
    const s = await port.snapshot();
    expect(s.incidents.length).toBe(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://uptime.betterstack.com/api/v2/status-pages/p%201/resources');
    const calls = fetchMock.mock.calls.length;
    await port.snapshot();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('the adapter fails loudly on HTTP errors (the web shows "status unavailable")', async () => {
    const port = betterStackStatusPage({
      token: 't',
      statusPageId: 'p',
      fetch: (async () => new Response('no', { status: 401 })) as never,
    });
    await expect(port.snapshot()).rejects.toThrow('HTTP 401');
  });
});
