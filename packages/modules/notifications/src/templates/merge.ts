/**
 * Merge fields (M3.6b): `{{first_name}}` or `{{first_name|there}}` (a fallback when the value is
 * empty). Only the fields listed here exist; the editor refuses anything else. Values come from
 * the recipient at send time and are escaped for HTML; fallbacks are the organizer's own text
 * (escaped with the rest of the document when it was rendered).
 *
 * System tokens (`{{@unsubscribe}}`, `{{@origin}}`) are written by the renderer, never typed:
 * the per-message unsubscribe link and the app origin for tracked links.
 */
export const MERGE_FIELDS = ['first_name', 'last_name', 'name', 'email', 'org_name'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export const SYSTEM_TOKENS = ['unsubscribe', 'origin'] as const;
export type SystemToken = (typeof SYSTEM_TOKENS)[number];

const TOKEN = /\{\{\s*(@?[a-z_]+)\s*(?:\|([^{}]{0,60}))?\}\}/g;
const ANY_BRACES = /\{\{[^}]*\}\}/g;

/** Unknown or malformed merge fields in organizer text (system tokens count as unknown there). */
export function mergeProblems(text: string): string[] {
  const bad = new Set<string>();
  for (const m of text.matchAll(ANY_BRACES)) {
    const token = [...m[0].matchAll(TOKEN)][0];
    const field = token?.[1];
    if (!token || token[0] !== m[0] || !field || !(MERGE_FIELDS as readonly string[]).includes(field))
      bad.add(m[0]);
  }
  return [...bad];
}

export type MergeValues = Partial<Record<MergeField, string | null>> & {
  readonly system?: Partial<Record<SystemToken, string>>;
};

/** First name and last name from a full name (the crm keeps one name). */
export function splitName(name: string | null | undefined): { first: string; last: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

/** Values for one recipient. */
export function recipientValues(r: {
  name?: string | null;
  email?: string | null;
  orgName: string;
}): Record<MergeField, string> {
  const { first, last } = splitName(r.name);
  return {
    first_name: first,
    last_name: last,
    name: (r.name ?? '').trim(),
    email: (r.email ?? '').trim(),
    org_name: r.orgName,
  };
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/**
 * Replace merge fields and system tokens. `html: true` escapes recipient values (the fallback is
 * already escaped document text); unknown tokens are left as they are.
 */
export function applyMerge(text: string, values: MergeValues, opts: { html?: boolean } = {}): string {
  return text.replace(TOKEN, (whole, field: string, fallback: string | undefined) => {
    if (field.startsWith('@')) {
      const v = values.system?.[field.slice(1) as SystemToken];
      return v === undefined ? whole : opts.html ? escapeHtml(v) : v;
    }
    if (!(MERGE_FIELDS as readonly string[]).includes(field)) return whole;
    const v = (values[field as MergeField] ?? '').trim();
    if (v) return opts.html ? escapeHtml(v) : v;
    return (fallback ?? '').trim();
  });
}
