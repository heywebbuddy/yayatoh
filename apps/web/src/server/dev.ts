/** The persona shortcuts (/dev/login, /api/dev/*) are on only when explicitly enabled and never in production. */
export function devAuthEnabled(): boolean {
  return process.env.YAYATOH_DEV_AUTH === '1' && process.env.VERCEL_ENV !== 'production';
}
