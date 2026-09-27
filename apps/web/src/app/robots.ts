import type { MetadataRoute } from 'next';

/**
 * Crawlers stay out of the console and of pages reached by secret links (M1.14a; per-host
 * sitemaps and canonical rules come with SEO continuity, roadmap §7.7).
 */
export default function robots(): MetadataRoute.Robots {
  const privatePaths = [
    '/o/',
    '/api/',
    '/orders/',
    '/my-tickets/',
    '/claim/',
    '/invite/',
    '/checkout/',
    '/scan',
    '/dev/',
    '/portal/',
    '/sign-in',
    '/signup',
    '/connect/',
  ];
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: privatePaths }],
  };
}
