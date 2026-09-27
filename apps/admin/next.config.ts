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
  ],
  serverExternalPackages: ['postgres', '@node-rs/argon2'],
  experimental: { taint: true },
};

export default withNextIntl(config);
