import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp } from './make.ts';
import { buildModel, type OpenApiDoc } from './model.ts';
import { n8nCredentials, n8nNode, n8nTrigger } from './n8n.ts';
import { validateApps } from './validate.ts';

export { MAKE_APP_NAME, makeApp } from './make.ts';
export * from './model.ts';
export { n8nCredentials, n8nNode, n8nTrigger } from './n8n.ts';
export {
  MakeAppSchema,
  N8nCredentialsSchema,
  N8nNodeSchema,
  N8nTriggerSchema,
  validateApps,
} from './validate.ts';

export const ROOT = join(import.meta.dirname, '../../..');
export const OPENAPI_PATH = join(ROOT, 'apps/api/openapi.json');
export const GENERATED_DIR = join(import.meta.dirname, '../generated');

/** The checked-in files, by path below `generated/`. */
export const GENERATED_FILES = {
  make: 'make/yayatoh.make-app.json',
  n8nNode: 'n8n/Yayatoh.node.json',
  n8nTrigger: 'n8n/YayatohTrigger.node.json',
  n8nCredentials: 'n8n/YayatohApi.credentials.json',
} as const;

export function readOpenApi(path = OPENAPI_PATH): OpenApiDoc & { info: { version: string } } {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Generate every app file from the OpenAPI document (pure: the same document, the same bytes). */
export function generateApps(doc: OpenApiDoc & { info: { version: string } }) {
  const model = buildModel(doc);
  const version = doc.info.version;
  const files = {
    make: makeApp(model, version),
    n8nNode: n8nNode(model, version),
    n8nTrigger: n8nTrigger(model, version),
    n8nCredentials: n8nCredentials(),
  };
  const text = Object.fromEntries(
    Object.entries(files).map(([k, v]) => [k, `${JSON.stringify(v, null, 2)}\n`]),
  ) as Record<keyof typeof files, string>;
  return { model, files, text, problems: validateApps(doc, model, files) };
}
