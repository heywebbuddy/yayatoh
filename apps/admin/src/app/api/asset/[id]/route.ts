import { readAsset } from '@/server/platform-content.ts';
import { currentStaff } from '@/server/staff.ts';

/** Preview of an uploaded platform image or video, for signed-in staff only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const staff = await currentStaff();
  if (!staff || staff === 'signed_out' || !staff.can('content'))
    return new Response('Not found', { status: 404 });
  const asset = await readAsset(staff.actor, (await params).id);
  if (!asset) return new Response('Not found', { status: 404 });
  return new Response(asset.bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      'content-type': asset.contentType,
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
