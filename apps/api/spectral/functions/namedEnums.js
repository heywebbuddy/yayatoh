// Every `enum` with more than one value must be a named component schema
// (`#/components/schemas/<Name>`), never inline in a property, parameter or response.
// A single-value enum is a constant (a literal), not a choice list, and may stay inline.
export default function namedEnums(doc) {
  const results = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      for (const [i, v] of node.entries()) walk(v, [...path, i]);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.enum) && node.enum.length > 1) {
      const named = path.length === 3 && path[0] === 'components' && path[1] === 'schemas';
      if (!named)
        results.push({
          message: `Inline enum (${node.enum.slice(0, 3).join(', ')}…): name it with .openapi('Name')`,
          path,
        });
    }
    for (const [k, v] of Object.entries(node)) walk(v, [...path, k]);
  };
  walk(doc, []);
  return results;
}
