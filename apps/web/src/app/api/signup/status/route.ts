import { currentPlanKey } from '@yayatoh/billing';
import { myOrgBySlug } from '@/server/self-serve.ts';
import { ownAuthSession } from '@/server/session.ts';

/** The plan of an organization the signed-in person belongs to (the sign-up payment page polls it). */
export async function GET(req: Request): Promise<Response> {
  const session = await ownAuthSession();
  const slug = new URL(req.url).searchParams.get('org') ?? '';
  const org = session ? await myOrgBySlug(session.user.id, slug) : null;
  if (!org)
    return Response.json({ planKey: null }, { status: 404, headers: { 'cache-control': 'no-store' } });
  return Response.json(
    { planKey: await currentPlanKey(org.orgId) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
