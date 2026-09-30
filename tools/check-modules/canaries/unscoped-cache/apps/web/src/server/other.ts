// Canary: a 'use cache' function with no org key.
export async function events() {
  'use cache';
  return [];
}
