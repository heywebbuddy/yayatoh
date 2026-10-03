import { tvBoard } from '@/server/tv.ts';

export const dynamic = 'force-dynamic';

/**
 * The TV board's data (M3.3a), re-read by the screen every few seconds. The display link's token
 * is the only credential (no session); a revoked link answers 404 at its next refresh.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const board = await tvBoard(token);
  const headers = {
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer',
  };
  if (!board) return Response.json({ error: 'not_found' }, { status: 404, headers });
  return Response.json(board, { headers });
}
