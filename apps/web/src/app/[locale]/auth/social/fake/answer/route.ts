import { fakeRelayEmail, fakeSubject, isSocialProvider, signFakeCode } from '@yayatoh/auth';
import { type NextRequest, NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { localizedPath } from '@/lib/seo/urls.ts';
import { requestHost } from '@/server/request-origin.ts';
import { fakeSocialSecret, socialMode, socialRedirectUri } from '@/server/social.ts';

export const dynamic = 'force-dynamic';

/**
 * The fake consent page's answer (dev, preview and CI only; M1.2f), a plain form POST like a real
 * provider's page: "Continue" sends the browser back to our callback with a signed code for the
 * person typed in; "Cancel" with the provider's `access_denied`. "Email verified" off stands for
 * a provider account whose address the provider never confirmed; "Hide my email" (Apple) gives a
 * private relay address. Only our own callback for that provider can receive a code.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (socialMode() !== 'fake') return new NextResponse('Not found', { status: 404 });
  const form = await req.formData();
  const provider = String(form.get('provider') ?? '');
  const state = String(form.get('state') ?? '').slice(0, 100);
  const nonce = String(form.get('nonce') ?? '').slice(0, 100);
  const redirectUri = String(form.get('redirect_uri') ?? '');
  if (!isSocialProvider(provider) || !state || !nonce || redirectUri !== socialRedirectUri(provider))
    return new NextResponse('Not found', { status: 404 });
  const back = new URL(redirectUri);
  back.searchParams.set('state', state);
  if (form.get('answer') === 'cancel') {
    back.searchParams.set('error', 'access_denied');
    return leave(back, locale);
  }
  const hide = provider === 'apple' && form.get('hide') === 'yes';
  const typed = String(form.get('email') ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 254);
  const name = String(form.get('name') ?? '')
    .trim()
    .slice(0, 200);
  if (!hide && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) {
    const again = new URL(localizedPath(locale, '/auth/social/fake'), (await requestHost()).origin);
    for (const [k, v] of Object.entries({ provider, state, nonce, redirect_uri: redirectUri, name }))
      if (v) again.searchParams.set(k, v);
    again.searchParams.set('error', 'email_required');
    return NextResponse.redirect(again, 303);
  }
  const email = hide ? fakeRelayEmail() : typed;
  const code = signFakeCode(fakeSocialSecret(), {
    provider,
    // The same person gets the same id each time; a hidden email keeps the typed person's id.
    subject: fakeSubject(provider, typed || email),
    email,
    emailVerified: hide || form.get('verified') === 'yes',
    name,
    nonce,
    redirectUri,
  });
  back.searchParams.set('code', code);
  return leave(back, locale);
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/**
 * Back to the callback as a new navigation (a meta refresh), not a redirect of this form post: a
 * real provider's page is another origin, and our CSP's `form-action 'self'` would otherwise stop
 * the callback's own redirect on to a tenant site. A link is there too.
 */
async function leave(to: URL, locale: string) {
  const t = await getTranslations({ locale, namespace: 'fakeSocial' });
  const href = escapeHtml(to.toString());
  const html = `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${href}"><title>${escapeHtml(t('metaTitle'))}</title></head><body><main><a href="${href}">${escapeHtml(t('continue'))}</a></main></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
