import { safeHref, sanitizeMarkdown } from '@yayatoh/events';

/**
 * Pure rules for the M2.2d content transforms: legacy HTML (Eventmie/Voyager rich text) → the
 * platform's Markdown subset, speaker links, private info, custom sections, sponsor levels, CMS
 * slugs and the legacy tag URLs. Everything returned here is also re-validated by the tables'
 * CHECKs and the module's own Zod schemas on read.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
};

/** Decode HTML character references (named, decimal and hex); unknown names stay as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, ref: string) => {
    if (ref[0] === '#') {
      const code =
        ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : '';
    }
    return ENTITIES[ref.toLowerCase()] ?? m;
  });
}

/**
 * Legacy rich text (HTML from the Eventmie/Voyager editors, or plain text) → the Markdown subset
 * (paragraphs, `##`/`###` headings, lists, bold, italic, code, http(s)/mailto links). Scripts,
 * styles and every other tag are dropped (their text kept, except script/style bodies); links to
 * anything but http(s)/mailto keep their text only. The result is sanitized (control and bidi
 * characters stripped) and capped at `max`. The subset has no backslash escapes, so legacy text is
 * carried as written (a rare `*pair*` in plain legacy text renders as emphasis).
 */
export function htmlToMarkdown(input: string | null | undefined, max = 10_000): string {
  if (!input) return '';
  let s = String(input).replace(/\r\n?/g, '\n');
  if (!/<[a-z!/]/i.test(s)) return sanitizeMarkdown(decodeEntities(s), max);
  s = s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|template)\b[^>]*\/?>/gi, '');
  const out: string[] = [];
  let line = '';
  const lists: ('ul' | 'ol')[] = [];
  const counters: number[] = [];
  const hrefs: (string | null)[] = [];
  const flush = () => {
    const t = line.replace(/[ \t]+/g, ' ').trim();
    if (t) out.push(t);
    line = '';
  };
  const block = () => {
    flush();
    if (out.length && out[out.length - 1] !== '') out.push('');
  };
  const re = /<\s*(\/)?\s*([a-z0-9]+)([^>]*)>|([^<]+)|(<)/gi;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m[4] !== undefined || m[5] !== undefined) {
      const text = decodeEntities(m[4] ?? '<').replace(/\s+/g, ' ');
      line += text;
      continue;
    }
    const closing = Boolean(m[1]);
    const tag = (m[2] ?? '').toLowerCase();
    const attrs = m[3] ?? '';
    switch (tag) {
      case 'p':
      case 'div':
      case 'section':
      case 'article':
      case 'blockquote':
      case 'table':
      case 'tr':
        block();
        break;
      case 'br':
        flush();
        break;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        block();
        if (!closing) line = tag === 'h1' || tag === 'h2' ? '## ' : '### ';
        break;
      case 'ul':
      case 'ol':
        block();
        if (closing) {
          lists.pop();
          counters.pop();
        } else {
          lists.push(tag);
          counters.push(0);
        }
        break;
      case 'li':
        flush();
        if (!closing) {
          const kind = lists[lists.length - 1] ?? 'ul';
          if (kind === 'ol') {
            const n = (counters[counters.length - 1] ?? 0) + 1;
            counters[counters.length - 1] = n;
            line = `${n}. `;
          } else line = '- ';
        }
        break;
      case 'strong':
      case 'b':
        line += '**';
        break;
      case 'em':
      case 'i':
        line += '*';
        break;
      case 'code':
        line += '`';
        break;
      case 'a':
        if (!closing) {
          const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
          const target = href ? safeHref(decodeEntities(href[1] ?? href[2] ?? href[3] ?? '')) : null;
          hrefs.push(target);
          if (target) line += '[';
        } else {
          const target = hrefs.pop();
          if (target) line += `](${target.replace(/\)/g, '%29').replace(/\s/g, '%20')})`;
        }
        break;
      default:
        break;
    }
  }
  flush();
  const md = out
    .join('\n')
    // Empty emphasis left by empty tags, and emphasis markers with nothing inside.
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/\[\]\([^)]*\)/g, '')
    .replace(/^(#{2,3}|-|\d+\.)\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
  return sanitizeMarkdown(md, max);
}

/** Plain one-line text (titles, names): tags dropped, entities decoded, whitespace collapsed. */
export function plainLine(input: string | null | undefined, max: number): string {
  if (!input) return '';
  const t = decodeEntities(String(input).replace(/<[^>]*>/g, ' '))
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...t].slice(0, max).join('').trim();
}

/** An http(s) URL the program tables accept (`^https?://`, parsable), or null. */
export function webUrl(input: string | null | undefined): string | null {
  const v = (input ?? '').trim();
  if (!/^https?:\/\//i.test(v) || v.length > 500) return null;
  return safeHref(v);
}

const LINK_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  twitter: 'X (Twitter)',
  x: 'X (Twitter)',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  website: 'Website',
};

/**
 * Legacy social links (`{"linkedin": "https://…"}`, `["https://…"]` or `[{"label","url"}]`, as the
 * legacy speaker form and tags stored them) → `[{ label, url }]`, http(s) only, at most 10.
 * `dropped` counts the links the new platform refuses (javascript:, relative, no scheme).
 */
export function speakerLinks(input: unknown): { links: { label: string; url: string }[]; dropped: number } {
  const links: { label: string; url: string }[] = [];
  let dropped = 0;
  const add = (label: string, raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim()) return;
    const url = webUrl(raw);
    if (!url) {
      dropped++;
      return;
    }
    if (links.length >= 10 || links.some((l) => l.url === url)) return;
    const key = label.trim().toLowerCase();
    links.push({ label: plainLine(LINK_LABELS[key] ?? label, 120) || 'Link', url });
  };
  let v = input;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === 'string') add(new URL(webUrl(item) ?? 'https://link.invalid').hostname, item);
      else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        add(String(o.label ?? o.name ?? o.type ?? 'Link'), o.url ?? o.href ?? o.link);
      }
    }
  } else if (v && typeof v === 'object')
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) add(k, raw);
  return { links, dropped };
}

const PRIVATE_LABELS: [string, string][] = [
  ['wifi', 'Wi-Fi'],
  ['parking', 'Parking'],
  ['shuttle', 'Shuttle'],
  ['contact', 'Contact'],
  ['program', 'Program'],
  ['notes', 'Notes'],
  ['custom_sections', 'More'],
];

function privateValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return htmlToMarkdown(v, 4000);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v))
    return v
      .map((x) => privateValue(x).replace(/\n+/g, ' '))
      .filter(Boolean)
      .map((x) => `- ${x}`)
      .join('\n');
  if (typeof v === 'object')
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => {
        const val = privateValue(x).replace(/\n+/g, ' ');
        return val ? `${plainLine(k, 60)}: ${val}` : '';
      })
      .filter(Boolean)
      .join('; ');
  return '';
}

/**
 * The legacy `events.private_info` JSON (wifi, parking, shuttle, contact, program, notes, visuals,
 * custom_sections — what only ticket holders may read) → the holder-only Markdown body. Known keys
 * in a fixed order with a bold label, then any other key; `visuals` (image paths) are media and are
 * listed in the media manifest instead. Empty → ''.
 */
export function privateInfoMarkdown(input: unknown): string {
  let v = input;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return '';
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '';
  const o = v as Record<string, unknown>;
  const known = new Set([...PRIVATE_LABELS.map(([k]) => k), 'visuals']);
  const parts: string[] = [];
  const push = (label: string, raw: unknown) => {
    const val = privateValue(raw);
    if (!val) return;
    parts.push(val.includes('\n') ? `**${label}**\n\n${val}` : `**${label}:** ${val}`);
  };
  for (const [k, label] of PRIVATE_LABELS) push(label, o[k]);
  for (const [k, raw] of Object.entries(o)) if (!known.has(k)) push(plainLine(k, 60), raw);
  return sanitizeMarkdown(parts.join('\n\n'), 10_000);
}

/** The legacy sponsor level of an exhibitor → the sponsor tier and its order (1 first). */
export const SPONSOR_TIERS: Record<string, { name: string; position: number }> = {
  platinum: { name: 'Platinum', position: 1 },
  gold: { name: 'Gold', position: 2 },
  silver: { name: 'Silver', position: 3 },
  bronze: { name: 'Bronze', position: 4 },
};
export const sponsorTier = (level: string | null | undefined) =>
  SPONSOR_TIERS[(level ?? '').trim().toLowerCase()] ?? null;

export interface LegacySectionItem {
  readonly title: string | null;
  readonly content: string | null;
  readonly active: boolean;
}

/**
 * A legacy custom section (`event_custom_sections` + items) → an event page section (M1.4d):
 * an `accordion` becomes an FAQ (question = item title, answer = content; items missing either are
 * skipped); `cards` and `list` become a text section with a bulleted list. Inactive items are
 * skipped. Null when nothing usable is left.
 */
export function sectionFromLegacy(
  displayType: string,
  items: readonly LegacySectionItem[],
):
  | { kind: 'faq'; content: { items: { question: string; answer: string }[] }; skipped: number }
  | {
      kind: 'text';
      content: { markdown: string };
      skipped: number;
    }
  | null {
  const live = items.filter((i) => i.active);
  let skipped = items.length - live.length;
  if (displayType === 'accordion') {
    const faq: { question: string; answer: string }[] = [];
    for (const i of live) {
      const question = plainLine(i.title, 300);
      const answer = htmlToMarkdown(i.content, 4000);
      if (!question || !answer || faq.length >= 50) skipped++;
      else faq.push({ question, answer });
    }
    return faq.length ? { kind: 'faq', content: { items: faq }, skipped } : null;
  }
  const lines: string[] = [];
  for (const i of live) {
    const title = plainLine(i.title, 200);
    const body = htmlToMarkdown(i.content, 1000).replace(/\s*\n+\s*/g, ' ');
    if (!title && !body) {
      skipped++;
      continue;
    }
    lines.push(`- ${title ? `**${title}**` : ''}${title && body ? ' — ' : ''}${body}`);
  }
  const markdown = sanitizeMarkdown(lines.join('\n'), 10_000);
  return markdown ? { kind: 'text', content: { markdown }, skipped } : null;
}

/**
 * The legacy performer/speaker tag page's path segment: the route is `/events/{event}/tag_{title}`
 * with the title's spaces as hyphens (legacy views), percent-encoded as a browser sends it.
 */
export function legacyTagPathSegment(title: string): string {
  return `tag_${encodeURIComponent(title.trim().replace(/ /g, '-'))}`;
}

/**
 * Can a legacy path segment be matched exactly as a browser sends it? Unreserved characters, the
 * sub-delimiters browsers leave as typed (`!'()*`) and well-formed percent escapes only.
 */
export const urlSafeSegment = (s: string) =>
  /^[A-Za-z0-9._~%!'()*-]+$/.test(s) && !/%(?![0-9A-F]{2})/i.test(s);
