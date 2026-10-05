import { type Ctx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  archiveFileQuery,
  eraseSubjectCommand,
  exportSubjectCommand,
  openRequestCommand,
  unzip,
} from '@yayatoh/privacy';
import { ports } from '../ports.ts';

/** Open an erasure request for the address and fulfil it at once (tests). */
export async function eraseNow(email: string, ctx: Ctx) {
  const { requestId } = await executeCommand(openRequestCommand, { email, kind: 'erasure' }, ctx, ports);
  return executeCommand(eraseSubjectCommand, { requestId, confirm: email }, ctx, ports);
}

/** Open an access request, build the archive and read it back: module → its JSON document. */
export async function exportNow(email: string, ctx: Ctx) {
  const { requestId } = await executeCommand(openRequestCommand, { email, kind: 'access' }, ctx, ports);
  const result = await executeCommand(exportSubjectCommand, { requestId }, ctx, ports);
  const file = await executeQuery(archiveFileQuery, { requestId }, ctx, ports);
  const entries = unzip(file.bytes);
  const modules: Record<string, Record<string, unknown>> = {};
  for (const [path, bytes] of entries) {
    const m = /^data\/([a-z-]+)\.json$/.exec(path);
    if (m) modules[m[1] as string] = JSON.parse(new TextDecoder().decode(bytes));
  }
  return { requestId, result, file, entries, modules };
}
