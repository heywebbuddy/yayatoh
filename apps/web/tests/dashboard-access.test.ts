import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), organizations: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('@yayatoh/tenancy', () => ({ myOrganizations: mocks.organizations }));
vi.mock('../src/server/session.ts', () => ({
  getSession: mocks.session,
  sessionOrgScope: (s: { ssoOrgId?: string; impersonation?: { orgId: string } }) =>
    s.impersonation?.orgId ?? s.ssoOrgId,
}));
const { dashboardAccess } = await import('../src/server/dashboard-access.ts');
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId: 'user' });
  mocks.organizations.mockResolvedValue([]);
});
it('does not query memberships for signed-out visitors', async () => {
  mocks.session.mockResolvedValue(null);
  expect((await dashboardAccess()).kind).toBe('anonymous');
  expect(mocks.organizations).not.toHaveBeenCalled();
});
it('routes accounts without organization membership to the attendee dashboard', async () => {
  expect(await dashboardAccess()).toEqual({ kind: 'attendee', href: '/attendee' });
});
it('routes organization owners directly to their console', async () => {
  mocks.organizations.mockResolvedValue([{ orgId: 'one', slug: 'ratnesh-events', role: 'owner' }]);
  expect(await dashboardAccess()).toEqual({ kind: 'organizer', href: '/o/ratnesh-events' });
  expect(mocks.organizations).toHaveBeenCalledWith('user');
});
it('respects the organization scope of SSO sessions', async () => {
  mocks.session.mockResolvedValue({ userId: 'user', ssoOrgId: 'two' });
  mocks.organizations.mockResolvedValue([
    { orgId: 'one', slug: 'one' },
    { orgId: 'two', slug: 'two' },
  ]);
  expect((await dashboardAccess()).href).toBe('/o/two');
});
it('never falls back to attendee access for a restricted organization session', async () => {
  mocks.session.mockResolvedValue({ userId: 'user', impersonation: { orgId: 'one' } });
  expect(await dashboardAccess()).toEqual({ kind: 'organizer', href: '/o' });
});
