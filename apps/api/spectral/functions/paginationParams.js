// A GET whose 200 JSON body has `nextCursor` is a cursor page: it must take a `cursor` query
// parameter and a `limit` query parameter (integer, minimum 1, maximum ≤ 100). A GET that
// takes `cursor` without returning `nextCursor` is flagged too (a page without a next link),
// unless it returns a `cursor` of its own (a sync protocol, like the scanner manifest).
// Runs on the resolved document, so `$ref`s are already followed.
const MAX_LIMIT = 100;

export default function paginationParams(op, _opts, ctx) {
  const results = [];
  const schema = op?.responses?.['200']?.content?.['application/json']?.schema;
  const paged = Boolean(schema?.properties?.nextCursor);
  const params = (op?.parameters ?? []).filter((p) => p?.in === 'query');
  const byName = (n) => params.find((p) => p.name === n);
  const at = (...rest) => [...ctx.path, ...rest];
  const cursor = byName('cursor');
  const limit = byName('limit');
  if (paged) {
    if (!cursor)
      results.push({ message: 'A cursor page needs a `cursor` query parameter', path: at('parameters') });
    if (!limit)
      results.push({ message: 'A cursor page needs a `limit` query parameter', path: at('parameters') });
    else {
      const s = limit.schema ?? {};
      const type = Array.isArray(s.type) ? s.type : [s.type];
      if (!type.includes('integer') && !type.includes('number'))
        results.push({ message: '`limit` must be an integer', path: at('parameters') });
      if (typeof s.minimum !== 'number' || s.minimum < 1)
        results.push({ message: '`limit` needs `minimum: 1`', path: at('parameters') });
      if (typeof s.maximum !== 'number' || s.maximum > MAX_LIMIT)
        results.push({
          message: `\`limit\` needs a \`maximum\` of at most ${MAX_LIMIT}`,
          path: at('parameters'),
        });
    }
  } else if (cursor && schema && !schema.properties?.cursor) {
    results.push({
      message: 'Takes `cursor` but the response has no `nextCursor`',
      path: at('responses', '200'),
    });
  }
  return results;
}
