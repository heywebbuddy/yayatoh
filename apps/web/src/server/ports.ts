import { billingEntitlements } from '@yayatoh/billing';
import { eventRolesOf } from '@yayatoh/events';
import {
  createCommandPorts,
  localKeyVault,
  registerDataSubjectContributors,
  setKeyVault,
} from '@yayatoh/platform';
import { createOrgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import { DATA_SUBJECT_CONTRIBUTORS } from './data-subjects.ts';

/** Composition root for the web transport (Server Actions / RSC). Same ports as /v1. */
export const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: createOrgAuthorizer({ eventRoles: eventRolesOf }),
  // A suspended or terminated org is read-only for its members and the public (M1.3f).
  orgGate: orgStatusGate,
});

// AWS KMS arrives with the owner's AWS account; until then dev/preview/CI use the local vault.
const localKms = process.env.LOCAL_KMS_KEY;
if (localKms) setKeyVault(localKeyVault(localKms));

// M6.1c: data-subject requests run every module's contributor (find, export, erase).
registerDataSubjectContributors(DATA_SUBJECT_CONTRIBUTORS);
