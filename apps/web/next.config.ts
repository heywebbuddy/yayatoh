import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@yayatoh/ui', '@yayatoh/contracts', '@yayatoh/kernel'],
  experimental: { taint: true },
};

export default withNextIntl(config);
