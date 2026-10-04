import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { EXPORT_COLUMNS, exportLeadsCommand } from '@yayatoh/leads';
import { problemFor, problemResponse } from '@yayatoh/platform/http';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing.ts';
import { currentPortalPrincipal, portalRequestCtx } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';
import { requestHost } from '@/server/request-origin.ts';

/**
 * The exhibitor admin's lead export (M5.6b): a CSV of the allowlist with translated headers.
 * Without a fresh sign-in (step-up) it sends the admin to confirm with an emailed code first.
 */
export async function GET(req: Request): Promise<Response> {
  const asked = new URL(req.url).searchParams.get('locale') ?? 'en';
  const locale = (routing.locales as readonly string[]).includes(asked) ? asked : 'en';
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const { origin } = await requestHost();
  const principal = await currentPortalPrincipal();
  if (!principal) return Response.redirect(`${origin}${prefix}/event-portal`, 303);
  const t = await getTranslations({ locale, namespace: 'leads.export.columns' });
  try {
    const out = await executeCommand(
      exportLeadsCommand,
      { headers: EXPORT_COLUMNS.map((c) => t(c)) },
      await portalRequestCtx(principal),
      ports,
    );
    const slug =
      out.exhibitorName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'exhibitor';
    return new Response(out.csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="leads-${slug}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    if (isDomainError(err) && err.code === 'step_up_required')
      return Response.redirect(`${origin}${prefix}/event-portal/confirm`, 303);
    return problemResponse(problemFor(err));
  }
}
