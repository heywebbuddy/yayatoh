import { widgetParams, widgetResponse } from '@/server/command-center.ts';

export const dynamic = 'force-dynamic';

/**
 * One Command Center widget's data (M3.2a): the board re-reads a widget here when its realtime
 * channel says something changed. The widget's loader applies the registry's rules, so asking for
 * a widget directly is refused exactly like the layout hides it (the door role gets 403 for sales).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ org: string; event: string; widget: string }> },
) {
  const { org, event, widget } = await params;
  const r = await widgetResponse(org, event, widget, widgetParams(new URL(req.url).searchParams));
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
}
