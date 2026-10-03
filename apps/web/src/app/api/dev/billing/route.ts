import { billingEnabled, billingUsageMeter, reportOrgUsage, USAGE_EVENTS } from '@yayatoh/billing';
import { enrollDeviceCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { consumeEvent, recentEventsTx } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { getBillingProvider } from '@/server/billing.ts';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only (M6.6b): enroll `devices` scan devices through the real command (each emits
 * `device.enrolled`), then run the billing usage meter over the org's recent usage events and,
 * with billing on, report them to the (fake) provider, as the worker would. 404 unless dev auth
 * is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const devices = Number(form.get('devices') ?? 0);
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  if (!Number.isInteger(devices) || devices < 0 || devices > 10)
    return NextResponse.json({ error: 'bad_devices' }, { status: 400 });
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev-billing' } });
  for (let i = 0; i < devices; i++)
    await executeCommand(enrollDeviceCommand, { label: `Dev door ${i + 1}` }, ctx, ports);
  const meter = billingUsageMeter();
  const events = await withTenant(ctx, (tx) =>
    recentEventsTx(
      tx,
      org.orgId,
      USAGE_EVENTS.map((k) => k.split('@')[0] as string),
      24 * 3600_000,
    ),
  );
  let metered = 0;
  for (const e of events) if (await consumeEvent(meter, e)) metered += 1;
  const reported = billingEnabled() ? await reportOrgUsage(org.orgId, getBillingProvider(), ports) : null;
  return NextResponse.json({ metered, reported });
}
