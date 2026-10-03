import 'server-only';
import { certificateLinksQuery } from '@yayatoh/ce';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { ports } from './ports.ts';

/**
 * CE certificates on the web (M6.9b). The org comes from the URL (or the order's manage link),
 * never from a header; the certificate's signed link proves the rest.
 */
const localePrefix = (locale: string) => (locale === 'en' ? '' : `/${locale}`);

/** A certificate's PDF (the holder's signed link), in the page's language. */
export const certificatePath = (locale: string, orgId: string, token: string) =>
  `${localePrefix(locale)}/certificates/${orgId}/${encodeURIComponent(token)}`;

/** The public verification page of a code. */
export const verifyPath = (locale: string, orgId: string, code: string) =>
  `${localePrefix(locale)}/certificates/${orgId}/verify/${code}`;

/** The order page's "Download your CE certificate" links: issued certificates of its tickets. */
export async function certificateLinksForOrder(
  target: { orgId: string; eventId: string },
  ticketIds: readonly string[],
  locale: string,
): Promise<Map<string, string>> {
  if (ticketIds.length === 0) return new Map();
  const links = await executeQuery(
    certificateLinksQuery,
    { eventId: target.eventId, ticketIds: [...ticketIds] },
    createCtx({ orgId: target.orgId }),
    ports,
  ).catch((err) => {
    if (isDomainError(err)) return [] as { ticketId: string; token: string }[];
    throw err;
  });
  return new Map(links.map((l) => [l.ticketId, certificatePath(locale, target.orgId, l.token)]));
}
