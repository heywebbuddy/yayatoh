/**
 * A deliberately small Markdown subset for organizer text (sections, announcements, private
 * info). It parses to a tree the web app renders as React elements, so raw HTML can never reach
 * the page: `<script>` stays literal text, and only http(s) and mailto links survive.
 *
 * Supported: paragraphs, `##`/`###` headings, `-`/`*` and `1.` lists, **bold**, *italic* or
 * _italic_, `code` and [links](https://…).
 */
export type MdInline =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'strong'; readonly c: readonly MdInline[] }
  | { readonly t: 'em'; readonly c: readonly MdInline[] }
  | { readonly t: 'code'; readonly v: string }
  | { readonly t: 'link'; readonly href: string; readonly c: readonly MdInline[] };

export type MdBlock =
  | { readonly t: 'p'; readonly c: readonly MdInline[] }
  | { readonly t: 'h'; readonly level: 2 | 3; readonly c: readonly MdInline[] }
  | { readonly t: 'ul' | 'ol'; readonly items: readonly (readonly MdInline[])[] };

export const MARKDOWN_MAX_LENGTH = 10_000;

/**
 * Normalize organizer text before it is stored: unify newlines, drop control characters (other
 * than newline and tab) and bidi overrides, trim, cap the length.
 */
export function sanitizeMarkdown(src: string, max = MARKDOWN_MAX_LENGTH): string {
  return (
    src
      .replace(/\r\n?/g, '\n')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '')
      .trim()
      .slice(0, max)
  );
}

/** Only these link targets are kept; anything else (javascript:, data:, relative) renders as text. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(h)) return h;
  try {
    const u = new URL(h);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const INLINE =
  /\*\*([^*\n]+?)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*([^*\n]+?)\*|(?<![\p{L}\p{N}])_([^_\n]+?)_(?![\p{L}\p{N}])/u;

export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  let rest = src;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push({ t: 'text', v: rest });
      break;
    }
    if (m.index > 0) out.push({ t: 'text', v: rest.slice(0, m.index) });
    const [whole, strong, code, linkText, href, em1, em2] = m;
    if (strong !== undefined) out.push({ t: 'strong', c: parseInline(strong) });
    else if (code !== undefined) out.push({ t: 'code', v: code });
    else if (linkText !== undefined && href !== undefined) {
      const safe = safeHref(href);
      out.push(safe ? { t: 'link', href: safe, c: parseInline(linkText) } : { t: 'text', v: linkText });
    } else out.push({ t: 'em', c: parseInline(em1 ?? em2 ?? '') });
    rest = rest.slice(m.index + whole.length);
  }
  // Merge adjacent text nodes (keeps the tree small and tests readable).
  return out.reduce<MdInline[]>((acc, n) => {
    const last = acc[acc.length - 1];
    if (n.t === 'text' && last?.t === 'text') acc[acc.length - 1] = { t: 'text', v: last.v + n.v };
    else acc.push(n);
    return acc;
  }, []);
}

export function parseMarkdown(src: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: MdInline[][] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ')) });
    para = [];
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of sanitizeMarkdown(src).split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({
        t: 'h',
        level: (heading[1] as string).length === 3 ? 3 : 2,
        c: parseInline(heading[2] as string),
      });
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d{1,3}[.)]\s+(.+)$/.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const kind = bullet ? 'ul' : 'ol';
      if (para.length || (list && list.t !== kind)) flush();
      list ??= { t: kind, items: [] };
      list.items.push(parseInline(item[1] as string));
      continue;
    }
    if (list) flush();
    para.push(line);
  }
  flush();
  return blocks;
}

/** Plain text of a parsed document (search, previews, meta descriptions). */
export function markdownToPlainText(src: string): string {
  const inline = (c: readonly MdInline[]): string =>
    c.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : inline(n.c))).join('');
  return parseMarkdown(src)
    .map((b) => (b.t === 'p' || b.t === 'h' ? inline(b.c) : b.items.map(inline).join(' ')))
    .join(' ');
}
