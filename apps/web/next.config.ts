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
  ],
  serverExternalPackages: ['postgres', '@node-rs/argon2'],
  experimental: { taint: true, serverActions: { allowedOrigins } },
  async headers() {
    return [
      { source: '/:path*', headers: baseline },
      {
        // JSON, webhooks, downloads: nothing may render, frame or sniff them.
        source: '/api/:path*',
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
