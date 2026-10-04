import 'server-only';
import {
  type BadgePrinter,
  kioskSettingsQuery,
  printingSetupQuery,
  printNodeFromEnv,
  sendPrintJob,
} from '@yayatoh/badges';
import { type Ctx, executeQuery } from '@yayatoh/kernel';
import { loadBadgesPage } from './badges.ts';
import { getPdfRenderer } from './pdf.ts';
import { ports } from './ports.ts';

let printNode: BadgePrinter | null | undefined;

/** PrintNode for this server (M5.5b): the fake in dev and CI, the real one only when switched on. */
export function getPrintNode(): BadgePrinter | null {
  if (printNode === undefined) printNode = printNodeFromEnv();
  return printNode;
}

/**
 * The printing pages (M5.5b): the Badges page's gate (conference profile, `badges` module), the
 * event's printers, and what the member may do. Desk work (printing, station heartbeats) needs
 * `attendees:write`; adding and archiving printers `events:write`; the print log `attendees:read`.
 */
export async function loadPrintingPage(org: string, event: string) {
  const page = await loadBadgesPage(org, event);
  const printing = await executeQuery(printingSetupQuery, { eventId: page.ev.id }, page.data.ctx, ports);
  // M5.5c: kiosk self-print settings.
  const kiosk = await executeQuery(kioskSettingsQuery, { eventId: page.ev.id }, page.data.ctx, ports);
  return { ...page, printing, kiosk, canPrint: page.canPrintOne, platformPrintNode: getPrintNode() !== null };
}

/** Hand a queued PrintNode job over now (render, submit, record): the desk sees the outcome at once. */
export const sendPrintJobNow = (ctx: Ctx, jobId: string) =>
  sendPrintJob({ ports, renderer: getPdfRenderer(), printNode: getPrintNode() }, ctx, jobId);
