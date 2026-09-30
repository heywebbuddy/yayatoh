import { withoutTenant } from '@yayatoh/db';
import { sql } from 'drizzle-orm';

/**
 * One /v1 request for app-version telemetry (M1.15): route pattern × method × client × version,
 * counted per UTC day. No tenant, user or IP is recorded.
 */
export async function recordApiUsage(u: {
  route: string;
  method: string;
  client: string;
  appVersion: string;
}): Promise<void> {
  await withoutTenant((tx) =>
    tx.execute(sql`select platform.record_api_usage(${u.route}, ${u.method}, ${u.client}, ${u.appVersion})`),
  );
}
