import { randomBytes } from 'node:crypto';
import { attendeeImportAction, attendeeLabelAction } from '@yayatoh/attendees';
import { billingEntitlements } from '@yayatoh/billing';
import { eventRolesOf } from '@yayatoh/events';
import {
  bulkStepCommand,
  createCommandPorts,
  localKeyVault,
  runBulkOperation,
  setKeyVault,
} from '@yayatoh/platform';
import { attendeeExportAction } from '@yayatoh/reports';
import { createOrgAuthorizer } from '@yayatoh/tenancy';

/** The same composition the apps use: billing entitlements + tenancy authorizer. */
export const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: createOrgAuthorizer({ eventRoles: eventRolesOf }),
});

// Tests get a per-run local key vault (ticket signing keys are envelope-encrypted).
setKeyVault(localKeyVault(randomBytes(32).toString('hex')));

/** The bulk actions the apps register, and the step command built from them. */
export const BULK_ACTIONS = [attendeeLabelAction, attendeeImportAction, attendeeExportAction] as const;
export const bulkStep = bulkStepCommand(BULK_ACTIONS);
export const runBulk = (orgId: string, operationId: string, budgetMs?: number) =>
  runBulkOperation(bulkStep, ports, orgId, operationId, budgetMs);
