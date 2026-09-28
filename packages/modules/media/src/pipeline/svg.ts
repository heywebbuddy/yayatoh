/**
 * SVG sanitizer (M1.4e). Parses the document with a small, strict XML tokenizer that never
 * expands entities, then rebuilds it from an allowlist of elements and attributes.
 *
 * What never survives:
 * - `<script>`, `<foreignObject>`, animation elements (`<set>`/`<animate*>` can rewrite `href`),
 *   `<feImage>`, `<iframe>`/`<object>`/`<embed>` and every other unknown element (with its subtree);
 * - `on*` handlers and every other attribute not on the allowlist;
 * - links and references that leave the document: `href`/`xlink:href` must be a local `#id`
 *   (an `<image>` may also carry a `data:` PNG/JPEG/GIF/WebP), CSS `url()` must be `#id`,
 *   `@import`/`@font-face` rules are dropped, and so is any value with a URL scheme
 *   (`javascript:`, `data:`, `http:` …) once whitespace and control characters are removed;
 * - the DOCTYPE and its internal subset: entities are never defined, so `&lol9;` expands to
 *   nothing (no "billion laughs"); only the five XML entities and numeric references decode;
 * - processing instructions (`<?xml-stylesheet?>`), comments and `<a>` wrappers (children kept).
 *
 * The result is re-serialized with escaping, so no markup can be smuggled through text.
 */

export class SvgRejected extends Error {
  readonly reason: 'svg_malformed' | 'svg_too_complex' | 'svg_not_svg';
  constructor(reason: 'svg_malformed' | 'svg_too_complex' | 'svg_not_svg') {
    super(reason);
    this.reason = reason;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const MAX_NODES = 20_000;
const MAX_DEPTH = 128;

const FE = [
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
];
const ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'symbol',
  'use',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'filter',
  'style',
  'image',
  ...FE,
]);
/** Dropped, but their children are kept. */
const UNWRAP = new Set(['a', 'switch']);

const ATTRIBUTES = new Set(
  `id class style transform viewBox preserveAspectRatio width height x y x1 x2 y1 y2 cx cy r rx ry
  fx fy fr d points pathLength fill fill-opacity fill-rule stroke stroke-width stroke-linecap
  stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity
  color display visibility overflow clip-path clip-rule mask filter marker-start marker-mid
  marker-end markerWidth markerHeight markerUnits refX refY orient offset stop-color stop-opacity
  gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform
  clipPathUnits maskUnits maskContentUnits filterUnits primitiveUnits in in2 result mode type
  values operator k1 k2 k3 k4 order kernelMatrix divisor bias targetX targetY edgeMode
  kernelUnitLength preserveAlpha surfaceScale diffuseConstant specularConstant specularExponent
  lighting-color flood-color flood-opacity stdDeviation dx dy radius scale xChannelSelector
  yChannelSelector baseFrequency numOctaves seed stitchTiles tableValues slope intercept amplitude
  exponent azimuth elevation pointsAtX pointsAtY pointsAtZ limitingConeAngle z font-family
  font-size font-style font-weight font-variant font-stretch text-anchor dominant-baseline
  alignment-baseline baseline-shift letter-spacing word-spacing text-decoration writing-mode
  direction unicode-bidi textLength lengthAdjust startOffset method spacing rotate
  shape-rendering text-rendering image-rendering color-interpolation color-interpolation-filters
  paint-order vector-effect mix-blend-mode isolation version xml:space xml:lang lang href
  xlink:href xmlns xmlns:xlink role aria-label aria-hidden focusable media`
    .split(/\s+/)
    .filter(Boolean),
);

type Node =
  | { kind: 'el'; name: string; attrs: [string, string][]; children: Node[] }
  | { kind: 'text'; text: string };

const NAME = /^[A-Za-z_][\w.:-]*/;

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_][\w.-]*);/g, (_m, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      // Control characters and invalid code points become nothing.
      if (!Number.isFinite(code) || code > 0x10ffff || (code < 0x20 && ![9, 10, 13].includes(code)))
        return '';
      if (code >= 0xd800 && code <= 0xdfff) return '';
      return String.fromCodePoint(code);
    }
    const known: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    // Entities are never defined (the DOCTYPE is discarded): an unknown one is dropped.
    return known[ref] ?? '';
  });
}

/** Tokenize and build a tree. Malformed markup is rejected rather than guessed at. */
function parse(src: string, removed: string[]): Node[] {
  const root: Node[] = [];
  const stack: Extract<Node, { kind: 'el' }>[] = [];
  let count = 0;
  let i = 0;
  const add = (n: Node) => {
    if (++count > MAX_NODES) throw new SvgRejected('svg_too_complex');
    (stack.length ? (stack[stack.length - 1] as Extract<Node, { kind: 'el' }>).children : root).push(n);
  };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      add({ kind: 'text', text: decodeEntities(src.slice(i)) });
      break;
    }
    if (lt > i) add({ kind: 'text', text: decodeEntities(src.slice(i, lt)) });
    i = lt;
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end < 0) throw new SvgRejected('svg_malformed');
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      if (end < 0) throw new SvgRejected('svg_malformed');
      add({ kind: 'text', text: src.slice(i + 9, end) });
      i = end + 3;
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE (with any internal subset of entity declarations): skipped, never interpreted.
      let depth = 0;
      let quote: string | null = null;
      let j = i + 2;
      for (; j < src.length; j++) {
        const c = src[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      if (j >= src.length) throw new SvgRejected('svg_malformed');
      removed.push('!doctype');
      i = j + 1;
    } else if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      if (end < 0) throw new SvgRejected('svg_malformed');
      if (!src.startsWith('<?xml ', i)) removed.push('?pi');
      i = end + 2;
    } else if (src.startsWith('</', i)) {
      const m = NAME.exec(src.slice(i + 2));
      const end = src.indexOf('>', i);
      if (!m || end < 0) throw new SvgRejected('svg_malformed');
      const open = stack.pop();
      if (!open || open.name !== m[0] || src.slice(i + 2 + m[0].length, end).trim())
        throw new SvgRejected('svg_malformed');
      i = end + 1;
    } else {
      const m = NAME.exec(src.slice(i + 1));
      if (!m) throw new SvgRejected('svg_malformed');
      const el: Extract<Node, { kind: 'el' }> = { kind: 'el', name: m[0], attrs: [], children: [] };
      let j = i + 1 + m[0].length;
      let selfClosing = false;
      for (;;) {
        while (j < src.length && /\s/.test(src[j] as string)) j++;
        if (j >= src.length) throw new SvgRejected('svg_malformed');
        if (src.startsWith('/>', j)) {
          selfClosing = true;
          j += 2;
          break;
        }
        if (src[j] === '>') {
          j++;
          break;
        }
        const an = NAME.exec(src.slice(j));
        if (!an) throw new SvgRejected('svg_malformed');
        j += an[0].length;
        while (j < src.length && /\s/.test(src[j] as string)) j++;
        if (src[j] !== '=') throw new SvgRejected('svg_malformed');
        j++;
        while (j < src.length && /\s/.test(src[j] as string)) j++;
        const q = src[j];
        if (q !== '"' && q !== "'") throw new SvgRejected('svg_malformed');
        const close = src.indexOf(q, j + 1);
        if (close < 0) throw new SvgRejected('svg_malformed');
        const raw = src.slice(j + 1, close);
        if (raw.includes('<')) throw new SvgRejected('svg_malformed');
        el.attrs.push([an[0], decodeEntities(raw)]);
        j = close + 1;
      }
      add(el);
      if (!selfClosing) {
        if (stack.length >= MAX_DEPTH) throw new SvgRejected('svg_too_complex');
        stack.push(el);
      }
      i = j;
    }
  }
  if (stack.length) throw new SvgRejected('svg_malformed');
  return root;
}

/** Whitespace and control characters removed, lower-cased: how browsers read a URL scheme. */
const squash = (v: string) => v.replace(/[\s\p{Cc}]+/gu, '').toLowerCase();
const LOCAL_REF = /^#[A-Za-z_][\w.:-]*$/;
const DATA_RASTER = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/;

/**
 * Keep only harmless CSS: no escapes (they hide keywords), no at-rules that load things, every
 * `url()` local. Returns null when the text can't be made safe.
 */
export function sanitizeCss(css: string): string | null {
  let s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (s.includes('\\') || s.includes('<')) return null;
  const lower = squash(s);
  if (/expression\(|javascript:|vbscript:|-moz-binding|behavior:|@import|@font-face|@namespace/.test(lower)) {
    s = s
      .replace(/@import[^;]*;?/gi, '')
      .replace(/@namespace[^;]*;?/gi, '')
      .replace(/@font-face\s*\{[^}]*\}/gi, '');
    if (/expression\(|javascript:|vbscript:|-moz-binding|behavior:|@import|@font-face/.test(squash(s)))
      return null;
  }
  return s.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, _q: string, target: string) =>
    LOCAL_REF.test(target.trim()) ? m : 'none',
  );
}

export interface SanitizedSvg {
  readonly svg: string;
  /** What was removed (element and attribute names), for logs and tests. */
  readonly removed: readonly string[];
}

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');

function cleanAttr(el: string, name: string, value: string, removed: string[]): string | null {
  if (!ATTRIBUTES.has(name)) {
    removed.push(`@${name}`);
    return null;
  }
  if (name === 'xmlns') return SVG_NS;
  if (name === 'xmlns:xlink') return XLINK_NS;
  if (name === 'href' || name === 'xlink:href') {
    const v = value.trim();
    if (LOCAL_REF.test(v)) return v;
    if (el === 'image' && DATA_RASTER.test(v)) return v.replace(/\s+/g, '');
    removed.push(`@${name}`);
    return null;
  }
  if (name === 'style') {
    const css = sanitizeCss(value);
    if (css === null) removed.push('@style');
    return css;
  }
  const flat = squash(value);
  if (HAS_SCHEME.test(flat) || flat.includes('javascript:') || flat.includes('vbscript:')) {
    removed.push(`@${name}`);
    return null;
  }
  if (/url\(/i.test(value)) {
    const css = sanitizeCss(value);
    if (css === null || css !== value) {
      removed.push(`@${name}`);
      return null;
    }
  }
  return value;
}

function serialize(nodes: Node[], removed: string[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'text') {
      out += escText(n.text);
      continue;
    }
    if (UNWRAP.has(n.name)) {
      removed.push(n.name);
      out += serialize(n.children, removed);
      continue;
    }
    if (!ELEMENTS.has(n.name)) {
      removed.push(n.name);
      continue;
    }
    if (n.name === 'style') {
      const css = sanitizeCss(n.children.map((c) => (c.kind === 'text' ? c.text : '')).join(''));
      if (css === null) removed.push('style');
      else out += `<style>${escText(css)}</style>`;
      continue;
    }
    const attrs: string[] = [];
    let href = false;
    for (const [name, value] of n.attrs) {
      const v = cleanAttr(n.name, name, value, removed);
      if (v === null) continue;
      if (name === 'href' || name === 'xlink:href') href = true;
      attrs.push(`${name}="${escAttr(v)}"`);
    }
    // A reference element without a safe target has nothing to show.
    if ((n.name === 'use' || n.name === 'image') && !href) {
      removed.push(n.name);
      continue;
    }
    const inner = serialize(n.children, removed);
    out += `<${n.name}${attrs.length ? ` ${attrs.join(' ')}` : ''}${inner ? `>${inner}</${n.name}>` : '/>'}`;
  }
  return out;
}

/** Sanitize an SVG document (UTF-8 bytes or text). Throws `SvgRejected` when it can't be parsed. */
export function sanitizeSvg(input: Uint8Array | string): SanitizedSvg {
  let src: string;
  if (typeof input === 'string') src = input;
  else {
    try {
      src = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      throw new SvgRejected('svg_malformed');
    }
  }
  const removed: string[] = [];
  const nodes = parse(src.replace(/^\uFEFF/, ''), removed);
  const roots = nodes.filter((n) => n.kind === 'el');
  const onlyWhitespace = nodes.every((n) => n.kind === 'el' || !n.text.trim());
  const root = roots[0];
  if (roots.length !== 1 || !root || root.kind !== 'el' || root.name !== 'svg' || !onlyWhitespace)
    throw new SvgRejected('svg_not_svg');
  // The root always declares the SVG namespace (and XLink when an xlink:href survives).
  root.attrs = root.attrs.filter(([n]) => n !== 'xmlns' && n !== 'xmlns:xlink');
  root.attrs.unshift(['xmlns', SVG_NS]);
  let body = serialize([root], removed);
  if (body.includes(' xlink:href="')) body = body.replace(/^<svg /, `<svg xmlns:xlink="${XLINK_NS}" `);
  return { svg: body, removed };
}
