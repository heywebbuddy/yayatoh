import { createHash } from 'node:crypto';
import { type DsarSigner, verifyDsarSignature } from './signing.ts';
import type { ModuleExport } from './subject.ts';
import { unzip, type ZipEntry, zip } from './zip.ts';

/**
 * The access-request archive (M6.1c): one ZIP with a JSON file per module (`data/<module>.json`),
 * the person's files (`files/<module>/<name>`), a manifest listing every file with its SHA-256,
 * the manifest's Ed25519 signature (`manifest.sig`) and the public key to check it
 * (`signing-key.pem`). Nothing in it is a token, hash or provider id: the modules' export
 * allowlists decide what goes in.
 */
export const ARCHIVE_FORMAT = 'yayatoh.dsar-archive/1';

const enc = new TextEncoder();
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export interface ArchiveManifest {
  readonly format: typeof ARCHIVE_FORMAT;
  readonly requestId: string;
  readonly controller: string;
  readonly subject: { readonly email: string };
  readonly generatedAt: string;
  readonly modules: readonly { readonly module: string; readonly path: string; readonly records: number }[];
  readonly files: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[];
  readonly signature: { readonly algorithm: 'Ed25519'; readonly keyId: string };
}

const README = (m: ArchiveManifest) =>
  [
    `Personal data held by ${m.controller}`,
    '',
    `This archive answers a data-subject access request (${m.requestId}), generated ${m.generatedAt}.`,
    '',
    '- data/<module>.json: what each part of the platform holds about you, as JSON.',
    '- files/<module>/: files you uploaded or that were made about you.',
    '- manifest.json: every file in this archive with its SHA-256 checksum.',
    '- manifest.sig: an Ed25519 signature of manifest.json; signing-key.pem is the public key that checks it.',
    '',
    'Money amounts are in minor units of their currency (e.g. cents). Card numbers are never stored.',
    '',
  ].join('\n');

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'file';

export async function buildArchive(input: {
  readonly requestId: string;
  readonly controller: string;
  readonly email: string;
  readonly generatedAt: Date;
  readonly modules: readonly ModuleExport[];
  readonly signer: DsarSigner;
}): Promise<{ readonly bytes: Uint8Array; readonly manifest: ArchiveManifest; readonly files: number }> {
  const content: ZipEntry[] = [];
  const modules: ArchiveManifest['modules'][number][] = [];
  let fileCount = 0;
  for (const m of input.modules) {
    const path = `data/${m.module}.json`;
    content.push({
      path,
      data: enc.encode(`${JSON.stringify({ module: m.module, ...m.sections }, null, 2)}\n`),
    });
    modules.push({ module: m.module, path, records: m.records });
    const used = new Set<string>();
    for (const f of m.files) {
      const bytes = await f.read();
      if (!bytes) continue;
      let name = safeName(f.name);
      for (let i = 2; used.has(name); i++) name = `${i}-${safeName(f.name)}`;
      used.add(name);
      content.push({ path: `files/${m.module}/${name}`, data: bytes });
      fileCount++;
    }
  }
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    requestId: input.requestId,
    controller: input.controller,
    subject: { email: input.email },
    generatedAt: input.generatedAt.toISOString(),
    modules,
    files: content.map((e) => ({ path: e.path, bytes: e.data.length, sha256: sha256(e.data) })),
    signature: { algorithm: 'Ed25519', keyId: input.signer.keyId },
  };
  const manifestBytes = enc.encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const signature = await input.signer.sign(manifestBytes);
  const bytes = zip([
    { path: 'README.txt', data: enc.encode(README(manifest)) },
    { path: 'manifest.json', data: manifestBytes },
    { path: 'manifest.sig', data: enc.encode(`${signature}\n`) },
    { path: 'signing-key.pem', data: enc.encode(input.signer.publicKeyPem) },
    ...content,
  ]);
  return { bytes, manifest, files: fileCount };
}

/**
 * Checks an archive: the manifest's signature against the key inside (and, when given, the key
 * we expect), and every listed file's checksum. Returns the problems found (empty: intact).
 */
export function verifyArchive(bytes: Uint8Array, expectedKeyPem?: string): string[] {
  const entries = unzip(bytes);
  const manifest = entries.get('manifest.json');
  const sig = entries.get('manifest.sig');
  const key = entries.get('signing-key.pem');
  if (!manifest || !sig || !key) return ['manifest, signature or key missing'];
  const pem = new TextDecoder().decode(key);
  const problems: string[] = [];
  if (expectedKeyPem && pem.trim() !== expectedKeyPem.trim()) problems.push('unexpected signing key');
  if (!verifyDsarSignature(pem, manifest, new TextDecoder().decode(sig).trim()))
    problems.push('bad manifest signature');
  const m = JSON.parse(new TextDecoder().decode(manifest)) as ArchiveManifest;
  for (const f of m.files) {
    const data = entries.get(f.path);
    if (!data) problems.push(`${f.path} missing`);
    else if (sha256(data) !== f.sha256) problems.push(`${f.path} changed`);
  }
  return problems;
}
