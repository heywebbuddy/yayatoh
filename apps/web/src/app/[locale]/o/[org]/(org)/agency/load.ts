import 'server-only';
import { agencyV2Enabled } from '@yayatoh/agency-ops';
import { roleCan } from '@yayatoh/tenancy';
import { notFound } from 'next/navigation';
import { loadConsole } from '@/server/console.ts';

/**
 * The agency pages (M6.7a) exist only in an agency org with the `agency` entitlement (P6-13);
 * anywhere else they are a 404. `canRead`: the member's role opens them (`agency:read`).
 */
export async function loadAgency(org: string) {
  const data = await loadConsole(org);
  if (data.org.kind !== 'agency' || !data.modules.has('agency')) notFound();
  return { data, canRead: roleCan(data.role, 'agency:read') };
}

/**
 * Agency v2 pages (M6.8b: Library, Campaigns, Team): behind the platform switch `agency_v2`;
 * a 404 while it is off. `canManage`: publishing, teams and handover (`agency:manage`);
 * `canFanOut`: campaign fan-out (`agency:campaigns`).
 */
export async function loadAgencyV2(org: string) {
  const base = await loadAgency(org);
  if (!(await agencyV2Enabled())) notFound();
  return {
    ...base,
    canManage: roleCan(base.data.role, 'agency:manage'),
    canFanOut: roleCan(base.data.role, 'agency:campaigns'),
  };
}
