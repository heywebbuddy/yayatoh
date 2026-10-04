import 'server-only';
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
