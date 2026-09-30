import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Extra hosts allowed to invoke Server Actions (CSRF: Next compares Origin with the host). Same
 * origin always works, custom tenant domains included; this list is only for proxies that forward
 * their own host (comma-separated, e.g. `app.yayatoh.com,*.yayatoh.events`). Never `*`.
 */
const allowedOrigins = (process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s && s !== '*' && s !== '**');

/** Baseline for responses proxy.ts does not see (API routes, files); pages get more (proxy.ts). */
const baseline = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/**
 * Front-door hosts (M2.4a, ADR 0020): responses forwarded from the legacy app pass through
 * without the new app's baseline (its opener policy would break legacy popups), so the baseline
 * skips the legacy hosts whose origin is configured. Same env as `frontDoorConfig`.
 */
const legacyHosts = [
  ...(process.env.LEGACY_ORIGIN_URL
    ? (process.env.LEGACY_YAY_HOSTS ?? 'yayatoh.com,www.yayatoh.com').split(',')
    : []),
  ...(process.env.LEGACY_ABC_ORIGIN_URL
    ? (process.env.LEGACY_ABC_HOSTS ?? 'abc.yayatoh.com').split(',')
    : []),
]
  .map((h) => h.trim().toLowerCase())
  .filter((h) => /^[a-z0-9.-]+$/.test(h));
const notLegacyHost = legacyHosts.length
  ? [
      {
        type: 'host' as const,
        value: `^(?!(${legacyHosts.map((h) => h.replaceAll('.', '\\.')).join('|')})$).*$`,
      },
    ]
  : undefined;

const maxBodyBytes = Number(process.env.FRONT_DOOR_MAX_BODY);
const frontDoorMaxBody =
  Number.isFinite(maxBodyBytes) && maxBodyBytes >= 1024 * 1024 && maxBodyBytes <= 256 * 1024 * 1024
    ? maxBodyBytes
    : 64 * 1024 * 1024;

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    '@yayatoh/ui',
    '@yayatoh/contracts',
    '@yayatoh/kernel',
    '@yayatoh/db',
    '@yayatoh/platform',
    '@yayatoh/tenancy',
    '@yayatoh/billing',
    '@yayatoh/auth',
    '@yayatoh/events',
    '@yayatoh/ticketing',
    '@yayatoh/orders',
    '@yayatoh/payments',
    '@yayatoh/marketplace',
    '@yayatoh/api-v1',
    '@yayatoh/notifications',
    '@yayatoh/messaging',
    '@yayatoh/media',
  ],
  // sharp (media re-encoding) loads its native libvips build at runtime.
  serverExternalPackages: ['postgres', '@node-rs/argon2', 'sharp'],
  experimental: {
    taint: true,
    serverActions: { allowedOrigins },
    // The front door (M2.4a) forwards legacy uploads from proxy.ts, which sees a buffered copy of
    // the body up to this size: the same limit as FRONT_DOOR_MAX_BODY (bigger bodies get a 413).
    proxyClientMaxBodySize: frontDoorMaxBody,
  },
  async headers() {
    return [
      { source: '/:path*', headers: baseline, ...(notLegacyHost ? { has: notLegacyHost } : {}) },
      // The push service worker (M1.10e): browsers must see a new version at once.
      { source: '/push-sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      {
        // JSON, webhooks, downloads: nothing may render, frame or sniff them. The /v1 API reference
        // (an HTML page, M1.13) and email previews (M1.10d: framed by the console, inline styles
        // only) send their own strict policies; a second one here would block them.
        source: '/api/:path((?!v1/docs$|email-preview/|dev/mailbox/.).*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      ...(process.env.VERCEL_ENV === 'production' || process.env.HSTS === '1'
        ? [
            {
              source: '/:path*',
              headers: [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }],
            },
          ]
        : []),
    ];
  },
};

export default withNextIntl(config);
