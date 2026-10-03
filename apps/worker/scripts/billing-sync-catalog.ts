// Mirror the billing provider's catalog (M6.6a): pnpm --filter @yayatoh/worker billing:sync-catalog
import { billingProviderFromEnv } from '@yayatoh/billing';
import { databaseAuditSink, setPlatformAuditSink } from '@yayatoh/db/platform';
import { syncBillingCatalog } from '../src/billing-catalog.ts';

// Every use lands in platform.access_log, like the staff console's.
setPlatformAuditSink(databaseAuditSink);
const result = await syncBillingCatalog(billingProviderFromEnv(process.env), 'staff:cli');
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
// One-shot CLI: exit rather than wait for idle pool connections to time out.
process.exit(0);
