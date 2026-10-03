import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import {
  MAX_QUALIFIERS,
  NOTES_MAX,
  QUALIFIER_MAX,
  RATINGS,
  SHARED_FIELDS,
  SYNC_BATCH_MAX,
} from './domain/rules.ts';

/** M5.6b lead retrieval DTOs: every payload is one of these allowlists. */

export const LicenseStanding = z.enum(['licensed', 'unlicensed', 'over_allowance']);
export const CaptureStateDto = z.enum(['not_open', 'open', 'closed']);

/** What the Scan PWA's lead mode and the portal's Leads section need to know about the person. */
export const LeadSetupDto = z.object({
  eventName: z.string(),
  timezone: z.string(),
  exhibitorName: z.string(),
  role: z.enum(['exhibitor_admin', 'exhibitor_staff']),
  email: z.string(),
  license: LicenseStanding,
  termsAccepted: z.boolean(),
  termsVersion: z.int(),
  capture: z.object({
    state: CaptureStateDto,
    opensAt: z.date(),
    closesAt: z.date(),
    accessUntil: z.date(),
    accessOpen: z.boolean(),
  }),
  qualifiers: z.array(z.string()),
  teamVisibility: z.boolean(),
  /** Admin only: how many leads the exhibitor has (0 for staff). */
  leadCount: z.int(),
});
export type LeadSetupDto = z.infer<typeof LeadSetupDto>;
export const leadSetupSerializer = defineSerializer('leads.setup', LeadSetupDto);

/** A lead as the exhibitor's people see it (P5-8 allowlist; never phone, address or ids of people). */
export const LeadDto = z.object({
  id: z.uuid(),
  name: z.string(),
  jobTitle: z.string(),
  company: z.string(),
  email: z.string().nullable(),
  /** The stamp: what the scan shared, under which email consent version, and a withdrawal. */
  sharedFields: z.array(z.enum(SHARED_FIELDS)),
  emailConsentVersion: z.int().nullable(),
  emailWithdrawnAt: z.date().nullable(),
  rating: z.enum(RATINGS).nullable(),
  qualifiers: z.array(z.string()),
  notes: z.string(),
  capturedAt: z.date(),
  lastScannedAt: z.date(),
  scans: z.int(),
  scannedByMe: z.boolean(),
  /** Who in the team scanned it first (their portal email), shown to the admin and in team mode. */
  scannedBy: z.string().nullable(),
});
export type LeadDto = z.infer<typeof LeadDto>;
export const leadSerializer = defineSerializer('leads.lead', LeadDto);

export const LeadListDto = z.object({ leads: z.array(LeadDto), scope: z.enum(['all', 'team', 'own']) });
export type LeadListDto = z.infer<typeof LeadListDto>;

export const ScanInput = z.object({
  scanId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  code: z.string().trim().min(1).max(400),
  capturedAt: z.coerce.date(),
  offline: z.boolean().default(false),
  rating: z.enum(RATINGS).nullable().optional(),
  qualifiers: z.array(z.string().max(QUALIFIER_MAX)).max(MAX_QUALIFIERS).optional(),
  notes: z.string().max(NOTES_MAX).optional(),
});
export type ScanInput = z.infer<typeof ScanInput>;

export const SyncInput = z.object({ scans: z.array(ScanInput).min(1).max(SYNC_BATCH_MAX) });

export const SCAN_REFUSALS = ['invalid', 'wrong_event', 'not_open', 'closed'] as const;

export const ScanResultDto = z.object({
  scanId: z.string(),
  status: z.enum(['captured', 'rescanned', 'refused']),
  reason: z.enum(SCAN_REFUSALS).nullable(),
  lead: LeadDto.nullable(),
});
export type ScanResultDto = z.infer<typeof ScanResultDto>;
export const SyncResultDto = z.object({ results: z.array(ScanResultDto) });
export const syncResultSerializer = defineSerializer('leads.sync', SyncResultDto);

/** The attendee's view: who scanned their badge (exhibitor names and dates only). */
export const WhoScannedMeDto = z.object({
  emailSharing: z.boolean(),
  scans: z.array(
    z.object({
      leadId: z.uuid(),
      exhibitorName: z.string(),
      capturedAt: z.date(),
      emailShared: z.boolean(),
      emailWithdrawn: z.boolean(),
    }),
  ),
});
export type WhoScannedMeDto = z.infer<typeof WhoScannedMeDto>;
export const whoScannedMeSerializer = defineSerializer('leads.whoScannedMe', WhoScannedMeDto);

/** One CSV export row (the allowlist of the export). */
export const LeadExportRow = z.object({
  name: z.string(),
  jobTitle: z.string(),
  company: z.string(),
  email: z.string(),
  rating: z.string(),
  qualifiers: z.string(),
  notes: z.string(),
  capturedAt: z.string(),
  scannedBy: z.string(),
  scans: z.int(),
  sharedFields: z.string(),
  emailConsentVersion: z.string(),
});
export const leadExportRowSerializer = defineSerializer('leads.exportRow', LeadExportRow);
