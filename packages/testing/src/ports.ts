import { randomBytes } from 'node:crypto';
import { billingEntitlements } from '@yayatoh/billing';
import { createCommandPorts, localKeyVault, setKeyVault } from '@yayatoh/platform';
import { orgAuthorizer } from '@yayatoh/tenancy';

/** The same composition the apps use: billing entitlements + tenancy authorizer. */
export const ports = createCommandPorts({ entitlements: billingEntitlements, authorizer: orgAuthorizer });

// Tests get a per-run local key vault (ticket signing keys are envelope-encrypted).
setKeyVault(localKeyVault(randomBytes(32).toString('hex')));
