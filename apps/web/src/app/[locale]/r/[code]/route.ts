import { trackedRedirect } from '@/server/redirector.ts';

/** Tracked links `/r/{code}` on the marketplace (M3.8a): any org's link. */
async function handle(request: Request, { params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  return trackedRedirect(request, decodeURIComponent(code), locale, null);
}

export const GET = handle;
export const HEAD = handle;
