/** True when a (possibly Drizzle-wrapped) error carries this Postgres SQLSTATE (and constraint). */
function isPgError(err: unknown, code: string, constraint?: string): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 3; depth++) {
    const pg = e as { code?: string; constraint_name?: string; cause?: unknown };
    if (pg.code === code) return constraint ? pg.constraint_name === constraint : true;
    e = pg.cause;
  }
  return false;
}

/** True when a (possibly Drizzle-wrapped) error is a Postgres unique violation (23505). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  return isPgError(err, '23505', constraint);
}

/** True when a (possibly Drizzle-wrapped) error is a Postgres foreign key violation (23503). */
export function isForeignKeyViolation(err: unknown, constraint?: string): boolean {
  return isPgError(err, '23503', constraint);
}
