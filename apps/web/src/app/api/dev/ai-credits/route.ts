import { adjustCreditsCommand } from '@yayatoh/ai';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: set an org's AI credit balance (an audited `adjust` entry), so e2e can test the
 * out-of-credits state and keep reruns within the allowance. 404 unless dev auth is on.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const balance = Number(form.get('balance'));
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  if (!Number.isInteger(balance) || balance < 0)
    return NextResponse.json({ error: 'bad_balance' }, { status: 400 });
  const res = await executeCommand(
    adjustCreditsCommand,
    { balance, reason: 'dev/e2e reset' },
    createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev-ai-credits' } }),
    ports,
  );
  return NextResponse.json(res);
}
