import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

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
    '@yayatoh/payments',
    '@yayatoh/reports',
    '@yayatoh/pdf',
    '@yayatoh/orders',
    '@yayatoh/ticketing',
    '@yayatoh/events',
    '@yayatoh/checkin',
    '@yayatoh/attendees',
    '@yayatoh/crm',
    '@yayatoh/forms',
    '@yayatoh/csv',
    '@yayatoh/messaging',
    '@yayatoh/notifications',
  ],
  serverExternalPackages: ['postgres', '@node-rs/argon2'],
  experimental: { taint: true },
  async headers() {
    return [
      {
        // Pages get the strict CSP from src/proxy.ts; API routes (auth, the CSP report endpoint,
        // evidence downloads) must never render, frame or be sniffed.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
          },
          { key: 'X-Frame-Options', value: 'DENY' },
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
