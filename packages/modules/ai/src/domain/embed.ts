/**
 * Matchmaking embeddings (M6.12b). Every provider returns unit vectors of this many dimensions
 * (the column is `vector(512)`); a reply of another size or with non-finite numbers is unusable.
 */
export const EMBEDDING_DIMENSIONS = 512;
/** Profiles embedded per provider call (one call = one credit). */
export const EMBED_BATCH = 64;

/** L2-normalize; a zero vector stays zero. */
export function normalize(v: readonly number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? v.map((x) => x / norm) : v.map(() => 0);
}

export function validEmbedding(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length === EMBEDDING_DIMENSIONS &&
    v.every((x) => typeof x === 'number' && Number.isFinite(x)) &&
    v.some((x) => x !== 0)
  );
}

/** FNV-1a 32-bit (deterministic, dependency-free). */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const STOP = new Set(['and', 'the', 'for', 'with', 'of', 'in', 'a', 'an', 'to', 'at', 'on', 'my', 'i']);

/**
 * The fake embedder (dev, CI, previews): hashed bag of words, so profiles that share words
 * (interests, job titles) come out close and the tests can predict the order. Not a language
 * model; never used in production.
 */
export function fakeEmbedding(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));
  for (const w of words) {
    const h = fnv(w);
    const i = h % EMBEDDING_DIMENSIONS;
    v[i] = (v[i] ?? 0) + ((h & 0x100) === 0 ? 1 : -1);
  }
  if (words.length === 0) v[0] = 1;
  return normalize(v);
}
