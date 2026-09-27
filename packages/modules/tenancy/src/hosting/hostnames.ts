/** The apex tenant sites live under until they add a custom domain (roadmap §4.2, owner D2). */
export function tenantApex(): string {
  return (process.env.TENANT_APEX ?? 'yayatoh.events').toLowerCase();
}

export const managedHostname = (slug: string) => `${slug}.${tenantApex()}`;

/** Hosts organizers may not add themselves (platform hosts; `abc.yayatoh.com` is added by staff). */
export function reservedHostname(host: string): boolean {
  const suffixes = ['yayatoh.com', tenantApex(), 'vercel.app', 'localhost'];
  return suffixes.some((s) => host === s || host.endsWith(`.${s}`));
}

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Normalize what an organizer typed ("https://Tickets.Example.com/", "tickets.example.com.") to
 * an ASCII hostname (IDN → punycode), or null when it is not a usable domain name: at least two
 * labels, a letter TLD, no IP address, no port, no path.
 */
export function normalizeHostname(input: string): string | null {
  let raw = input.trim().toLowerCase();
  if (!raw || raw.length > 300) return null;
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  if (/[/?#@:\s]/.test(raw.replace(/\/$/, ''))) return null;
  raw = raw.replace(/\/$/, '').replace(/\.$/, '');
  let host: string;
  try {
    host = new URL(`http://${raw}`).hostname;
  } catch {
    return null;
  }
  if (host.length > 253) return null;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  const tld = labels.at(-1) ?? '';
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return null;
  return host;
}
