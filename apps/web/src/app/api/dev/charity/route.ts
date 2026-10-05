import {
  charityProfileQuery,
  exemptProblem,
  recordedExemptOrgLookup,
  verifyCharityCommand,
} from '@yayatoh/donations';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only (M4.8b): verify an org's charity profile as staff would in the admin app, against
 * the recorded IRS fixture (`org=<slug>`). The admin e2e covers the staff screens; this lets the
 * web suite reach receipts and the ticket-page notice quickly. 404 unless dev auth is on.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'staff:dev' } });
  const profile = await executeQuery(charityProfileQuery, {}, ctx, ports);
  if (!profile) return NextResponse.json({ error: 'no_profile' }, { status: 409 });
  const record = await recordedExemptOrgLookup().lookup(profile.sponsorEin ?? profile.ein);
  const problem = exemptProblem(record);
  if (problem || !record) return NextResponse.json({ error: problem }, { status: 409 });
  const r = await executeCommand(verifyCharityCommand, { version: profile.version, irs: record }, ctx, ports);
  return NextResponse.json(r);
}
