import {
  type BadgePrinter,
  pollPrintNodePrinters,
  setPrintNodeCommand,
  watchQuietPrinters,
} from '@yayatoh/badges';
import { PRINTER_OFFLINE_AFTER_MS } from '@yayatoh/badges/client';
import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { createCommandPorts } from '@yayatoh/platform';
import { orgAuthorizer, orgStatusGate, resolveOrgSlug } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: orgAuthorizer,
  orgGate: orgStatusGate,
});

/** How often the leader looks for silent printers (an offline event lands within 5 s of the 90 s). */
export const PRINTER_WATCHDOG_MS = 5_000;
/** How often the leader asks PrintNode about its printers (three reports inside the 90 s window). */
export const PRINTNODE_POLL_MS = 30_000;

/**
 * The printer watchdog (M5.5b). Orgs with an online printer silent for 90 s at `now` are found
 * through a SECURITY DEFINER function (org ids only, platform_reader, audited); each org's step
 * turns those printers offline once and emits `badges.printer_offline@1`. One org's failure
 * never stops the others; `onlyOrgs` limits it to some orgs (tests).
 */
export async function runPrinterWatchdog(
  now: Date = new Date(),
  onlyOrgs?: ReadonlySet<string>,
): Promise<{ orgs: number; offline: number }> {
  const rows = await withPlatformReader(
    { actor: 'system:printer-watchdog', reason: 'find orgs with silent printers' },
    (tx) =>
      tx.execute<{ org_id: string }>(
        sql`select org_id from badges.orgs_with_quiet_printers(${now.toISOString()}::timestamptz, ${PRINTER_OFFLINE_AFTER_MS})`,
      ),
  );
  const orgs = rows.map((r) => r.org_id).filter((o) => !onlyOrgs || onlyOrgs.has(o));
  let offline = 0;
  for (const orgId of orgs) {
    try {
      offline += (await watchQuietPrinters(orgId, ports, { now })).length;
    } catch (err) {
      console.error('printer watchdog', orgId, err);
    }
  }
  return { orgs: orgs.length, offline };
}

/**
 * The PrintNode poll (M5.5b): for each org with PrintNode on and a PrintNode printer, ask PrintNode
 * which printers are online and record those as heard from. A PrintNode outage for an org is
 * silence (the watchdog turns its printers offline after 90 s).
 */
export async function pollPrintNode(
  printNode: BadgePrinter,
  now: Date = new Date(),
  onlyOrgs?: ReadonlySet<string>,
): Promise<{ orgs: number; heard: number }> {
  const rows = await withPlatformReader(
    { actor: 'system:printnode-poll', reason: 'find orgs with PrintNode printers' },
    (tx) => tx.execute<{ org_id: string }>(sql`select org_id from badges.orgs_with_printnode_printers()`),
  );
  const orgs = rows.map((r) => r.org_id).filter((o) => !onlyOrgs || onlyOrgs.has(o));
  let heard = 0;
  for (const orgId of orgs) {
    try {
      heard += (await pollPrintNodePrinters(orgId, ports, printNode, { now })).heard;
    } catch (err) {
      console.error('printnode poll', orgId, err);
    }
  }
  return { orgs: orgs.length, heard };
}

/**
 * Switch PrintNode on or off for an org (platform staff, once the org's PrintNode child account is
 * open with the org id as its creator reference; `pnpm --filter @yayatoh/worker printnode`).
 */
export async function setOrgPrintNode(
  slug: string,
  enabled: boolean,
  by = 'staff:cli',
): Promise<{ orgId: string; printnodeEnabled: boolean }> {
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`unknown org: ${slug}`);
  const r = await executeCommand(
    setPrintNodeCommand,
    { enabled },
    createCtx({ orgId: org.orgId, actor: { type: 'system', name: by } }),
    ports,
  );
  return { orgId: org.orgId, ...r };
}
