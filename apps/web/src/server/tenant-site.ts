import 'server-only';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The `[org]` root param of a tenant-site route (an org id the proxy resolved from the host). */
export const tenantOrgParam = (org: string): string | null => (UUID.test(org) ? org : null);
