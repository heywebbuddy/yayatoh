/**
 * The API reference from an OpenAPI 3.1 document (M6.3b): every operation, grouped by tag in the
 * document's order, with one-line types. Pure, so it is tested against the committed document.
 */
export type Json = Record<string, unknown>;

export interface DocParameter {
  readonly name: string;
  readonly in: string;
  readonly required: boolean;
  readonly description: string;
  readonly type: string;
}

export interface DocOperation {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly description: string;
  readonly parameters: readonly DocParameter[];
  readonly requestBody: string | null;
  readonly responses: readonly {
    readonly status: string;
    readonly description: string;
    readonly schema: string | null;
  }[];
  readonly auth: readonly string[];
}

export interface DocTag {
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly operations: readonly DocOperation[];
}

export interface DocField {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
}

export interface DocEvent {
  readonly type: string;
  readonly version: number;
  readonly anchor: string;
  readonly summary: string;
  readonly description: string;
  readonly fields: readonly DocField[];
  readonly example: string;
}

export interface SearchEntry {
  readonly kind: 'guide' | 'operation' | 'event';
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  /** Lower-cased text the search matches. */
  readonly text: string;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export const slugOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const refName = (s: unknown) =>
  s && typeof s === 'object' && typeof (s as Json).$ref === 'string'
    ? (String((s as Json).$ref)
        .split('/')
        .pop() ?? null)
    : null;

/** A one-line type for a JSON Schema node (`uuid`, `string`, `integer`, `"a" | "b"`, `Event[]`…). */
export function typeOf(node: unknown, components: Json = {}): string {
  if (!node || typeof node !== 'object') return 'any';
  const n = node as Json;
  const ref = refName(n);
  if (ref) {
    const target = (components[ref] ?? {}) as Json;
    return Array.isArray(target.enum)
      ? (target.enum as unknown[]).map((v) => JSON.stringify(v)).join(' | ')
      : ref;
  }
  if (Array.isArray(n.anyOf) || Array.isArray(n.oneOf)) {
    const parts = ((n.anyOf ?? n.oneOf) as unknown[]).map((x) => typeOf(x, components));
    return [...new Set(parts)].join(' | ');
  }
  if ('const' in n) return JSON.stringify(n.const);
  if (Array.isArray(n.enum)) return (n.enum as unknown[]).map((v) => JSON.stringify(v)).join(' | ');
  const t = Array.isArray(n.type) ? (n.type as string[]).join(' | ') : String(n.type ?? 'object');
  if (t === 'array') return `${typeOf(n.items, components)}[]`;
  if (t === 'string' && typeof n.format === 'string') return n.format;
  return t;
}

export interface OpenApiLike {
  readonly paths?: Record<string, Record<string, unknown>>;
  readonly tags?: readonly { name: string; description: string }[];
  readonly components?: { readonly schemas?: Json };
}

/** Every operation of the document, grouped by tag in the document's order. */
export function referenceFromDocument(doc: OpenApiLike): DocTag[] {
  const schemas = doc.components?.schemas ?? {};
  const byTag = new Map<string, DocOperation[]>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = (item as Record<string, Json | undefined>)[method];
      if (!op) continue;
      const params = ((op.parameters as Json[] | undefined) ?? []).map((p) => ({
        name: String(p.name),
        in: String(p.in),
        required: p.required === true,
        description: String(p.description ?? ''),
        type: typeOf(p.schema, schemas),
      }));
      const body = (op.requestBody as Json | undefined)?.content as Record<string, Json> | undefined;
      const bodySchema = body ? Object.values(body)[0]?.schema : undefined;
      const responses = Object.entries((op.responses as Record<string, Json>) ?? {}).map(([status, r]) => {
        const content = r.content as Record<string, Json> | undefined;
        const schema = content ? Object.values(content)[0]?.schema : undefined;
        return {
          status,
          description: String(r.description ?? ''),
          schema: schema ? typeOf(schema, schemas) : null,
        };
      });
      const security = ((op.security as Json[] | undefined) ?? []).flatMap((s) => Object.keys(s));
      const tag = ((op.tags as string[] | undefined) ?? ['other'])[0] ?? 'other';
      const list = byTag.get(tag) ?? [];
      list.push({
        id: String(op.operationId ?? `${method}-${path}`),
        method: method.toUpperCase(),
        path,
        summary: String(op.summary ?? ''),
        description: String(op.description ?? ''),
        parameters: params,
        requestBody: bodySchema ? typeOf(bodySchema, schemas) : null,
        responses,
        auth: [...new Set(security)],
      });
      byTag.set(tag, list);
    }
  }
  return (doc.tags ?? [])
    .filter((t) => byTag.has(t.name))
    .map((t) => ({
      name: t.name,
      slug: slugOf(t.name),
      description: t.description,
      operations: byTag.get(t.name) ?? [],
    }));
}
