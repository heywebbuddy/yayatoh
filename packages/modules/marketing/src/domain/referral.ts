import { cleanUtmValue, type Utm } from './utm.ts';
import { REFERRAL_MEDIUM } from './touches.ts';

/**
 * Referral landings (M6.2b): a page request without UTM values or a click id whose `Referer` is
 * another site counts as a touch from that site (source = its host, medium `referral`). Our own
 * hosts and the payment pages a buyer comes back from are not referrals. Only the host is kept
 * (never the path or query: they can carry personal data).
 */
const NOT_REFERRERS = [
  /(^|\.)stripe\.com$/,
  /(^|\.)paypal\.com$/,
  /(^|\.)paypal\.me$/,
  /(^|\.)squareup\.com$/,
];

export function referralUtm(referer: string | null | undefined, ownHost: string): Utm | null {
  if (!referer || referer.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const own = ownHost.toLowerCase().split(':')[0]?.replace(/^www\./, '') ?? '';
  // Our own host and its parent or child hosts (abc.yayatoh.com and yayatoh.com) are not referrers.
  if (!host || host === own || host.endsWith(`.${own}`) || own.endsWith(`.${host}`)) return null;
  if (NOT_REFERRERS.some((re) => re.test(host))) return null;
  const source = cleanUtmValue(host);
  return source ? { source, medium: REFERRAL_MEDIUM, campaign: null, content: null, term: null } : null;
}
