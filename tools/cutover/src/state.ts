import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CutoverState } from './types.ts';

/**
 * The state file: every step's status, attempts and timings, T−0 and the flip. Written after each
 * step (atomically: a temp file renamed over it), so a crash or a pause resumes where it stopped.
 * Local to the operator's machine (`.cutover/`, git-ignored); it holds no secrets.
 */
export function loadState(path: string): CutoverState | null {
  if (!existsSync(path)) return null;
  const s = JSON.parse(readFileSync(path, 'utf8')) as CutoverState;
  if (s.version !== 1) throw new Error(`unsupported state file version in ${path}`);
  return s;
}

export function saveState(path: string, state: CutoverState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, path);
}
