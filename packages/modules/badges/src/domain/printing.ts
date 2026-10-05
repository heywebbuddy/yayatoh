/**
 * M5.5b printing rules (pure: no database, no Node APIs). Printers per event, the print log's
 * kinds and reasons, and the heartbeat watchdog's decisions.
 */

/** How a printer is reached (P5-2): the browser's print dialog (AirPrint too), or PrintNode. */
export const PRINTER_ADAPTERS = ['browser', 'printnode'] as const;
export type PrinterAdapter = (typeof PRINTER_ADAPTERS)[number];

/** `unknown` until the first heartbeat; `offline` once silent for `PRINTER_OFFLINE_AFTER_MS`. */
export const PRINTER_STATUSES = ['unknown', 'online', 'offline'] as const;
export type PrinterStatus = (typeof PRINTER_STATUSES)[number];

/** A printer silent this long is offline (the acceptance's 90 s). */
export const PRINTER_OFFLINE_AFTER_MS = 90_000;
/** How often a print station page sends its heartbeat (three chances inside the window). */
export const STATION_HEARTBEAT_MS = 30_000;

export const PRINT_KINDS = ['print', 'reprint'] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];

/** Why a badge is printed again. A first print's reason is always `first_print`. */
export const REPRINT_REASONS = [
  'damaged',
  'lost',
  'details_changed',
  'misprint',
  'printer_problem',
  'other',
] as const;
export type ReprintReason = (typeof REPRINT_REASONS)[number];
export const PRINT_REASONS = ['first_print', ...REPRINT_REASONS] as const;
export type PrintReason = (typeof PRINT_REASONS)[number];

/**
 * `sent`: handed to the browser (its print dialog) or accepted by PrintNode; `queued`: logged,
 * waiting for PrintNode to accept it; `failed`: PrintNode (or the render) refused it. A failed job
 * never counts as a print, so the next attempt is still a first print.
 */
export const PRINT_JOB_STATUSES = ['queued', 'sent', 'failed'] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

/** Where the print was asked for. `kiosk` arrives with M5.5c. */
export const PRINT_SOURCES = ['desk', 'attendee_page', 'kiosk'] as const;
export type PrintSource = (typeof PRINT_SOURCES)[number];

export const MAX_PRINT_NOTE = 200;
export const MAX_PRINTERS_PER_EVENT = 50;
/** A browser print job's PDF opens for this long after the job (the print dialog is right away). */
export const PRINT_PDF_TTL_MS = 30 * 60_000;

/** A badge already printed (a job that did not fail) is printed again: a reprint. */
export const printKindFor = (priorPrints: number): PrintKind => (priorPrints > 0 ? 'reprint' : 'print');

export type ReasonProblem = 'reason_required' | 'reason_not_allowed' | 'note_required' | null;

/**
 * Whether a print request's reason fits its kind: a reprint needs one of `REPRINT_REASONS` (and a
 * note when it is `other`); a first print takes none (it is logged as `first_print`).
 */
export function reasonProblem(
  kind: PrintKind,
  reason: string | null | undefined,
  note: string | null | undefined,
): ReasonProblem {
  if (kind === 'print') return reason && reason !== 'first_print' ? 'reason_not_allowed' : null;
  if (!reason || !(REPRINT_REASONS as readonly string[]).includes(reason)) return 'reason_required';
  if (reason === 'other' && !note?.trim()) return 'note_required';
  return null;
}

export interface PrinterPulse {
  readonly status: PrinterStatus;
  readonly lastSeenAt: Date | null;
  readonly archived: boolean;
}

/** The moment a printer counts as offline: its last heartbeat plus the window. */
export const offlineAt = (lastSeenAt: Date) => new Date(lastSeenAt.getTime() + PRINTER_OFFLINE_AFTER_MS);

/**
 * Whether the watchdog turns this printer offline now. Only an online printer goes offline (one
 * transition, so one event) and only once it has been silent for the whole window; a printer that
 * never sent a heartbeat stays `unknown`.
 */
export function goesQuiet(p: PrinterPulse, now: Date): boolean {
  if (p.archived || p.status !== 'online' || !p.lastSeenAt) return false;
  return offlineAt(p.lastSeenAt).getTime() <= now.getTime();
}

/** A heartbeat brings a printer (back) online; true when that is a change worth an event. */
export const comesOnline = (p: PrinterPulse): boolean => !p.archived && p.status !== 'online';
