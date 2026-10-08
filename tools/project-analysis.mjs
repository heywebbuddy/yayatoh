import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'docs', 'analysis');
fs.mkdirSync(output, { recursive: true });
const walk = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
const rel = p => path.relative(root, p).replaceAll('\\', '/');
const read = p => fs.readFileSync(p, 'utf8');
const uniq = a => [...new Set(a)].sort();
const matches = (s, re) => [...s.matchAll(re)].map(m => m[1]);
const sourceFiles = ['apps', 'packages', 'tools'].flatMap(d => walk(path.join(root, d))).filter(p => /\.(ts|tsx|mjs)$/.test(p) && !p.includes('canaries'));
const sources = new Map(sourceFiles.map(p => [rel(p), read(p)]));
const imports = s => uniq(matches(s, /(?:from\s*|import\s*|import\s*\()(['"][^'"]+['"])/g).map(x => x.slice(1, -1)));
const moduleImports = s => imports(s).filter(x => x.startsWith('@yayatoh/'));
const line = (s, i) => s.slice(0, i).split('\n').length;
const operations = s => [...s.matchAll(/(?:tenantCommand|tenantQuery|defineCommand|defineQuery)(?:<[^;]*?>)?\s*\(\s*\{\s*name:\s*['"]([^'"]+)['"]/g)].map(m => ({ name: m[1], line: line(s, m.index), permission: (s.slice(m.index, m.index + 1500).match(/permission:\s*['"]([^'"]+)['"]/) || [])[1] || null, entitlement: (s.slice(m.index, m.index + 1500).match(/entitlement:\s*['"]([^'"]+)['"]/) || [])[1] || null }));
const modules = fs.readdirSync(path.join(root, 'packages/modules')).sort().map(name => {
  const prefix = `packages/modules/${name}/`;
  const files = [...sources.keys()].filter(p => p.startsWith(prefix));
  const src = files.filter(p => p.includes('/src/'));
  const text = src.map(p => sources.get(p)).join('\n');
  const pkg = JSON.parse(read(path.join(root, prefix, 'package.json')));
  const invariantPath = path.join(root, prefix, 'MODULE.md');
  return { name, tier: pkg.yayatoh?.tier, files: files.length, sourceFiles: src.length, testFiles: files.filter(p => /\.(?:int\.)?test\.tsx?$/.test(p)).length, dependencies: Object.keys(pkg.dependencies || {}).filter(x => x.startsWith('@yayatoh/')), sourceImports: uniq(src.flatMap(p => moduleImports(sources.get(p)))), operations: src.flatMap(p => operations(sources.get(p)).map(o => ({ ...o, file: p }))), events: uniq(matches(text, /type:\s*['"]([a-z][a-z0-9_.-]+)['"]/g)), tables: uniq(matches(text, /tenantTable\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]/g)), invariants: fs.existsSync(invariantPath) ? read(invariantPath) : '', sourcePaths: src };
});
const resolveImport = (file, spec) => {
  let base;
  if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  else if (spec.startsWith('@/')) base = `${file.startsWith('apps/admin/') ? 'apps/admin' : 'apps/web'}/src/${spec.slice(2)}`;
  else return null;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(p => sources.has(p)) || null;
};
const trace = file => {
  const seen = new Set();
  const go = (p, depth) => { if (seen.has(p) || depth > 12) return; seen.add(p); for (const spec of imports(sources.get(p) || '')) { const next = resolveImport(p, spec); if (next) go(next, depth + 1); } };
  go(file, 0);
  // Shared composition roots connect all modules; exclude them from panel-specific module attribution.
  const featureFiles = [...seen].filter(p => !/\/(ports|data-subjects|sso-seed)\.ts$/.test(p));
  return { localFiles: [...seen].sort(), modules: uniq(featureFiles.flatMap(p => moduleImports(sources.get(p)))), invokedOperations: uniq(featureFiles.flatMap(p => matches(sources.get(p), /(?:executeCommand|executeQuery)\(\s*([A-Za-z_$][\w$]*)/g))) };
};
const routes = [...sources.keys()].filter(p => /^apps\/(web|admin)\/src\/app\//.test(p) && /\/(page\.tsx|route\.ts)$/.test(p)).sort().map(file => {
  const app = file.split('/')[1];
  const s = sources.get(file);
  const route = '/' + file.split('/src/app/')[1].replace(/(?:^|\/)(?:page\.tsx|route\.ts)$/, '').split('/').filter(x => x && !/^\(.*\)$/.test(x)).join('/');
  const kind = file.endsWith('page.tsx') ? 'page' : 'endpoint';
  const surface = app === 'admin' ? (route.startsWith('/api') ? 'admin API' : 'platform administration') : route.includes('/api/dev') || route.includes('/dev/') ? 'development' : route.startsWith('/api') ? 'web API' : route.includes('/o/[org]/e/[event]') ? 'event console' : route.includes('/o/[org]') ? 'organization console' : /\/(scan|door|kiosk)(\/|$)/.test(route) ? 'onsite tools' : /\/(portal|speaker|exhibitor)/.test(route) ? 'participant portals' : /\/(t|e|guest|rsvp|seat-finder|find|watch|network|my-tickets|order|ticket|register|checkout|invoice)\//.test(route) ? 'public and attendee' : 'public and account';
  const details = trace(file);
  return { app, kind, surface, route, file, directImports: imports(s), directModules: moduleImports(s), serverFiles: details.localFiles.filter(p => p.includes('/server/')), connectedModules: details.modules, invokedOperations: details.invokedOperations, guardCalls: uniq(matches(s, /\b(loadConsole\w*|loadEvent\w*|require\w+|notFound|redirect|verify\w+)\s*\(/g)), methods: uniq(matches(s, /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) };
});
const jobs = [...sources].filter(([p]) => p.startsWith('apps/worker/src/')).flatMap(([file,s]) => [...s.matchAll(/name:\s*['"]([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)['"]/g)].map(m => ({ name:m[1], file, line:line(s,m.index) })));
const tests = [...sources.keys()].filter(p => /(?:\.test\.|\.spec\.)/.test(p));
const openapi = JSON.parse(read(path.join(root,'apps/api/openapi.json')));
const apiOperations = Object.entries(openapi.paths || {}).flatMap(([route, item]) => Object.entries(item).filter(([method]) => ['get','post','put','patch','delete','head','options'].includes(method)).map(([method, op]) => ({ route, method: method.toUpperCase(), operationId: op.operationId, summary: op.summary, description: op.description, tags: op.tags, security: op.security || openapi.security || [] })));
const connections = [...sources].filter(([p]) => p.startsWith('packages/modules/') && p.includes('/src/')).flatMap(([file,s]) => [...s.matchAll(/(?:types|events):\s*\[([^\]]+)\]/g)].flatMap(m => matches(m[1], /['"]([^'"]+@\d+)['"]/g).map(event => ({ file, event, line: line(s,m.index) }))));
const inventory = { generated: '2026-10-08', method: 'Static source inventory. Import tracing is lexical and bounded to 12 local import levels; it does not prove runtime reachability. Operation metadata is heuristic. Shared ports are excluded from panel module attribution.', counts: { sourceFiles: sources.size, modules: modules.length, webPages: routes.filter(r => r.app === 'web' && r.kind === 'page').length, adminPages: routes.filter(r => r.app === 'admin' && r.kind === 'page').length, webEndpoints: routes.filter(r => r.app === 'web' && r.kind === 'endpoint').length, adminEndpoints: routes.filter(r => r.app === 'admin' && r.kind === 'endpoint').length, apiV1Operations: apiOperations.length, testFiles: tests.length, operations: modules.reduce((n,m) => n + m.operations.length,0) }, modules, routes, apiOperations, connections, jobs, tests };
fs.writeFileSync(path.join(output, 'project-inventory.json'), JSON.stringify(inventory,null,2) + '\n');
const md = ['# Yayatoh panel and endpoint inventory', '', 'Each entry lists a source route, its local server dependencies, and domain operations detected through imports. Paths include the locale placeholder where present. Import connections are static evidence, not proof that every imported operation executes on this route.', ''];
for (const surface of uniq(routes.map(r => r.surface))) {
  md.push(`## ${surface}`, '');
  for (const r of routes.filter(r => r.surface === surface)) {
    md.push(`### ${r.app} ${r.route}`, '', `- Type: ${r.kind}${r.methods.length ? ` (${r.methods.join(', ')})` : ''}.`, `- Source: [${r.file}](../../${r.file}).`, `- Direct domain imports: ${r.directModules.join(', ') || 'none; local helpers or presentation'}.`, `- Connected packages: ${r.connectedModules.join(', ') || 'none detected'}.`, `- Server files: ${r.serverFiles.map(p => `[${p.split('/').at(-1)}](../../${p})`).join(', ') || 'none detected'}.`, `- Operations in local dependency chain: ${r.invokedOperations.join(', ') || 'none detected'}.`, `- Direct guard calls: ${r.guardCalls.join(', ') || 'none detected; may be enforced by layout or helpers'}.`, '');
  }
}
fs.writeFileSync(path.join(output, 'panel-inventory.md'), md.join('\n'));
const mm = ['# Yayatoh feature and module inventory', '', 'Includes every module invariant document, declared package connections, detected commands and queries, emitted event type literals, tables and source tests. Invariant documents sometimes contain historical milestone wording; code remains the implementation evidence.', ''];
for (const m of modules) {
  mm.push(`## ${m.name}`, '', `Tier ${m.tier}; ${m.sourceFiles} source files; ${m.testFiles} test files.`, '', `Declared connections: ${m.dependencies.join(', ')}.`, '', `Source imports: ${m.sourceImports.join(', ')}.`, '', `Tables detected: ${m.tables.join(', ') || 'see schema source'}.`, '', `Event type literals detected: ${m.events.join(', ') || 'none detected'}.`, '', '### Commands and queries', '', '| Operation | Permission | Entitlement | Source |', '|---|---|---|---|');
  for (const o of m.operations) mm.push(`| ${o.name} | ${o.permission || 'dynamic or not captured'} | ${o.entitlement || 'null or not captured'} | [source](../../${o.file}#L${o.line}) |`);
  mm.push('', '### Feature rules and lifecycle', '', m.invariants.replace(/^# /gm, '#### ').replace(/^## /gm, '##### '), '', '### Source index', '', ...m.sourcePaths.map(p => `- [${p}](../../${p})`), '');
}
fs.writeFileSync(path.join(output, 'feature-inventory.md'), mm.join('\n'));
const apiMd = ['# Yayatoh public API and background flow inventory', '', 'The API operations below come from the committed OpenAPI document. They are separate from the Next.js route-file counts. Event subscription literals and worker names are static detections and may omit dynamically assembled registrations.', '', '## Public API operations', '', '| Method | Path | Operation | Description |', '|---|---|---|---|', ...apiOperations.map(o => `| ${o.method} | ${o.route} | ${o.operationId || ''} | ${(o.summary || o.description || '').replaceAll('\n',' ').replaceAll('|','/')} |`), '', '## Event subscription literals', '', ...connections.map(c => `- ${c.event}: [${c.file}](../../${c.file}#L${c.line})`), '', '## Worker name literals', '', ...jobs.map(j => `- ${j.name}: [${j.file}](../../${j.file}#L${j.line})`), '', '## Test source index', '', ...tests.map(p => `- [${p}](../../${p})`), ''];
fs.writeFileSync(path.join(output, 'api-and-worker-inventory.md'),apiMd.join('\n'));
console.log(JSON.stringify(inventory.counts));
console.log(JSON.stringify(Object.fromEntries(uniq(routes.map(r => r.surface)).map(s => [s,routes.filter(r => r.surface === s).length]))));
