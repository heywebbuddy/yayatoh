/** True when a (possibly Drizzle-wrapped) error is a Postgres unique violation (23505). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 3; depth++) {
    const pg = e as { code?: string; constraint_name?: string; cause?: unknown };
    if (pg.code === '23505') return constraint ? pg.constraint_name === constraint : true;
    e = pg.cause;
  }
  return false;
}
