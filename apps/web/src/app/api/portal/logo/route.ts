import { isDomainError } from '@yayatoh/kernel';
import { MAX_UPLOAD_BYTES, uploadExhibitorLogoFromPortal } from '@yayatoh/media';
import { revalidatePath, revalidateTag } from 'next/cache';
import { routing } from '@/i18n/routing.ts';
import { scopeTag } from '@/lib/cache-keys.ts';
import { currentPortalPrincipal, portalCtx } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';
import { requestHost } from '@/server/request-origin.ts';

/** Room for the multipart envelope and the text fields around the file. */
const ENVELOPE_BYTES = 64 * 1024;

/**
 * An exhibitor admin's logo from the portal (M5.4a): a plain form post (works without script),
 * answered with a redirect back to the portal carrying the outcome. The principal comes from the
 * portal session cookie; the command re-checks it and always writes that exhibitor's logo.
 */
export async function POST(req: Request): Promise<Response> {
  const origin = (await requestHost()).origin;
  const back = (locale: string, result: string) =>
    Response.redirect(`${origin}/${locale}/exhibitor?logo=${result}#logo-heading`, 303);
  const length = Number(req.headers.get('content-length') ?? 'NaN');
  const principal = await currentPortalPrincipal();
  if (!principal) return Response.redirect(`${origin}/en/exhibitor/signed-out`, 303);
  if (!Number.isFinite(length) || length > MAX_UPLOAD_BYTES + ENVELOPE_BYTES) return back('en', 'too_large');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return back('en', 'failed');
  }
  const asked = String(form.get('locale') ?? 'en');
  const locale = (routing.locales as readonly string[]).includes(asked) ? asked : 'en';
  const file = form.get('file');
  const alt = String(form.get('alt') ?? '').trim();
  if (!(file instanceof File) || file.size === 0) return back(locale, 'file');
  if (file.size > MAX_UPLOAD_BYTES) return back(locale, 'too_large');
  if (!alt) return back(locale, 'alt');
  try {
    await uploadExhibitorLogoFromPortal(
      portalCtx(principal, locale),
      { principal, alt, file: new Uint8Array(await file.arrayBuffer()) },
      ports,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = (err.details as { reason?: string; field?: string } | undefined) ?? {};
    return back(locale, reason.field === 'alt' ? 'alt' : reason.field === 'file' ? 'unsupported' : 'failed');
  }
  // The public event page and exhibitor map show the new logo.
  revalidatePath('/', 'layout');
  revalidateTag(scopeTag({ org: principal.orgId }), { expire: 0 });
  return back(locale, 'saved');
}
