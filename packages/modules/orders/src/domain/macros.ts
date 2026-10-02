/**
 * Support macros (M3.10c): saved replies with merge fields, e.g. "Hi {{buyer_name}}, your tickets
 * for {{event_name}}…". Only the fields below exist; a template naming any other is refused when
 * it is saved, so a macro never sends a raw `{{…}}` to a buyer.
 */
export const MERGE_FIELDS = [
  'buyer_name',
  'buyer_email',
  'event_name',
  'event_date',
  'order_ref',
  'ticket_count',
  'recipient_name',
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeValues = Readonly<Record<MergeField, string>>;

const FIELD_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Merge fields a template uses that do not exist (empty: the template is valid). */
export function unknownMergeFields(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(FIELD_RE))
    if (!(MERGE_FIELDS as readonly string[]).includes(m[1] ?? '')) out.add(m[1] ?? '');
  // A brace pair that is not a well-formed field is refused too.
  const stripped = template.replace(FIELD_RE, '');
  if (stripped.includes('{{') || stripped.includes('}}')) out.add('{{');
  return [...out];
}

/** Fill a template's merge fields (values are plain text; the email template escapes them). */
export function renderMacro(template: string, values: MergeValues): string {
  return template.replace(FIELD_RE, (_, name: string) =>
    (MERGE_FIELDS as readonly string[]).includes(name) ? values[name as MergeField] : '',
  );
}

/** The order's short reference as buyers see it (the last 8 characters of its id, upper case). */
export const orderRef = (orderId: string) => orderId.replace(/-/g, '').slice(-8).toUpperCase();
