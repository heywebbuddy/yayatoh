import {
  PostIncidentInput,
  postFakeIncident,
  UpdateIncidentInput,
  updateFakeIncident,
} from '@yayatoh/platform';
import { type NextRequest, NextResponse } from 'next/server';
import { devAuthEnabled } from '@/server/session.ts';
import { getStatusPage } from '@/server/status.ts';

/**
 * Dev/CI only (M3.11b): open or update an incident in the fake status page, as staff do from the
 * admin console, so web e2e can check the status page and the banners. 404 unless dev auth is on
 * and the fake provider is in use.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled() || getStatusPage()?.provider !== 'fake')
    return new NextResponse(null, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.id) {
    const input = UpdateIncidentInput.safeParse(body);
    if (!input.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
    return NextResponse.json({ updated: await updateFakeIncident(input.data) });
  }
  const input = PostIncidentInput.safeParse(body);
  if (!input.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  return NextResponse.json({ id: await postFakeIncident(input.data, 'dev:e2e') });
}
