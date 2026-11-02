import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

const KEYS = ['ai_insights', 'ai_support_assist', 'ai_translate'] as const;

/** Dev/CI only: grant an org the AI1 features, which roll out org by org. 404 unless dev auth is on. */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const slug = String((await req.formData()).get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev-ai-features' } });
  for (const moduleKey of KEYS)
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey, effect: 'grant', reason: 'dev/e2e' },
      ctx,
      ports,
    );
  return NextResponse.json({ ok: true });
}
