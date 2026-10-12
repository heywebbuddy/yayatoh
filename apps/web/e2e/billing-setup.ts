import { adminClient } from '@yayatoh/db/testing';

/**
 * Puts the Free and Pro plans on sale in the e2e database, as staff would in the admin console's
 * plan editor (managed locally, so a catalog sync keeps them): the test billing portal offers only
 * plans on sale. Run by the global setup; idempotent.
 */
const admin = adminClient();
try {
  await admin`update billing.plan_catalog set active = true, managed_locally = true
    where plan_key in ('tier_free', 'tier_pro')`;
  await admin`update billing.plan_prices set active = true where plan_key in ('tier_free', 'tier_pro')`;
} finally {
  await admin.end();
}
