import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  own: vi.fn(),
  session: vi.fn(),
  guest: vi.fn(),
  orders: vi.fn(),
  host: vi.fn(),
  access: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/server/dashboard-access.ts', () => ({ dashboardAccess: mocks.access }));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('@yayatoh/crm', () => ({ contactIdByEmailTx: vi.fn() }));
vi.mock('@yayatoh/db', () => ({ withTenant: vi.fn() }));
vi.mock('@yayatoh/notifications', () => ({ preferencesPath: vi.fn() }));
vi.mock('@yayatoh/tenancy', () => ({ organizationPublicTx: vi.fn() }));
vi.mock('@yayatoh/orders', () => ({ guestOrders: mocks.orders }));
vi.mock('../src/server/guest.ts', () => ({ currentGuestSession: mocks.guest }));
vi.mock('../src/server/request-origin.ts', () => ({ requestHost: mocks.host }));
vi.mock('../src/server/session.ts', () => ({
  ownAuthSession: mocks.own,
  getSession: mocks.session,
  sessionOrgScope: (s: { ssoOrgId: string | null }) => s.ssoOrgId,
}));

const { loadAttendee } = await import('../src/server/attendee.ts');

beforeEach(() => {
  vi.resetAllMocks();
  mocks.own.mockResolvedValue(null);
  mocks.session.mockResolvedValue(null);
  mocks.guest.mockResolvedValue(null);
  mocks.orders.mockResolvedValue([]);
  mocks.host.mockResolvedValue({ kind: 'dev' });
  mocks.access.mockResolvedValue({ kind: 'attendee', href: '/attendee' });
});

describe('Attendee identity access', () => {
  it('blocks organizers even with a verified account and attendee guest cookie', async () => {
    mocks.access.mockResolvedValue({ kind: 'organizer', href: '/o/ratnesh-events' });
    mocks.own.mockResolvedValue({ user: { email: 'owner@example.com', emailVerified: true } });
    mocks.guest.mockResolvedValue({ email: 'buyer@example.com' });
    expect((await loadAttendee()).identity).toBeNull();
    expect(mocks.orders).not.toHaveBeenCalled();
    expect(mocks.guest).not.toHaveBeenCalled();
  });
  it('never lists cross-organization bookings on an organizer-owned domain', async () => {
    mocks.host.mockResolvedValue({ kind: 'tenant' });
    mocks.own.mockResolvedValue({ user: { email: 'owner@example.com', emailVerified: true } });
    expect((await loadAttendee()).identity).toBeNull();
    expect(mocks.orders).not.toHaveBeenCalled();
  });
  it('does not look up purchases for anonymous or unverified accounts', async () => {
    expect((await loadAttendee()).identity).toBeNull();
    mocks.own.mockResolvedValue({ user: { email: 'unverified@example.com', emailVerified: false } });
    expect((await loadAttendee()).identity).toBeNull();
    expect(mocks.orders).not.toHaveBeenCalled();
  });
  it('uses the verified account email, never a different guest email', async () => {
    mocks.own.mockResolvedValue({
      user: { id: 'user', email: 'owner@example.com', name: 'Owner', emailVerified: true },
    });
    mocks.session.mockResolvedValue({ ssoOrgId: null });
    mocks.guest.mockResolvedValue({ email: 'another@example.com' });
    expect((await loadAttendee()).identity?.kind).toBe('account');
    expect(mocks.orders).toHaveBeenCalledWith('owner@example.com', null);
    expect(mocks.guest).not.toHaveBeenCalled();
  });
  it('keeps SSO account purchases scoped to the signing organization', async () => {
    mocks.own.mockResolvedValue({ user: { id: 'user', email: 'owner@example.com', emailVerified: true } });
    mocks.session.mockResolvedValue({ ssoOrgId: 'one-organization' });
    await loadAttendee();
    expect(mocks.orders).toHaveBeenCalledWith('owner@example.com', 'one-organization');
  });
  it('blocks impersonation even when a guest cookie is present', async () => {
    mocks.session.mockResolvedValue({ impersonation: { id: 'staff' } });
    mocks.guest.mockResolvedValue({ email: 'buyer@example.com' });
    expect((await loadAttendee()).identity).toBeNull();
    expect(mocks.orders).not.toHaveBeenCalled();
  });
  it('allows a host-verified marketplace guest to see their own bookings', async () => {
    mocks.guest.mockResolvedValue({ email: 'buyer@example.com' });
    expect((await loadAttendee()).identity?.kind).toBe('guest');
    expect(mocks.guest).toHaveBeenCalledWith(null);
    expect(mocks.orders).toHaveBeenCalledWith('buyer@example.com', null);
  });
});
