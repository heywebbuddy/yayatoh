const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text for HTML content and attribute values. Every interpolated value goes through this. */
export const escapeHtml = (value: string | number) =>
  String(value).replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

/** Tagged template that escapes every interpolation unless it is already `SafeHtml`. */
export class SafeHtml {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? '';
  values.forEach((v, i) => {
    const part = Array.isArray(v)
      ? v.map((x) => (x instanceof SafeHtml ? x.value : escapeHtml(String(x)))).join('')
      : v instanceof SafeHtml
        ? v.value
        : v == null || v === false
          ? ''
          : escapeHtml(String(v));
    out += part + (strings[i + 1] ?? '');
  });
  return new SafeHtml(out);
}
