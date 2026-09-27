/**
 * drizzle-kit emits `ENABLE ROW LEVEL SECURITY` but has no FORCE. Add FORCE right after each
 * ENABLE so table owners are subject to the tenant policy too. Idempotent.
 */
export function forceRowLevelSecurity(migrationSql: string): string {
  return migrationSql.replace(
    /ALTER TABLE ((?:"[^"]+"\.)?"[^"]+") ENABLE ROW LEVEL SECURITY;(?!--> statement-breakpoint\nALTER TABLE \1 FORCE)/g,
    'ALTER TABLE $1 ENABLE ROW LEVEL SECURITY;--> statement-breakpoint\nALTER TABLE $1 FORCE ROW LEVEL SECURITY;',
  );
}
