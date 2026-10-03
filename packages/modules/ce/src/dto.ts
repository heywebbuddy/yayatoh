import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { CERTIFICATE_STATUSES } from './schema.ts';

export const SessionRuleDto = z.object({
  /** Hundredths of a credit. */
  credits: z.number().int(),
  minMinutes: z.number().int(),
  countInPerson: z.boolean(),
  countVirtual: z.boolean(),
});
export type SessionRuleDto = z.infer<typeof SessionRuleDto>;

export const CeSessionDto = z.object({
  sessionId: z.uuid(),
  title: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  /** Over: its credits can be calculated. */
  ended: z.boolean(),
  rule: SessionRuleDto.nullable(),
  /** Tickets this session's rule awarded credits to at the last calculation. */
  awarded: z.number().int().nonnegative(),
});
export type CeSessionDto = z.infer<typeof CeSessionDto>;

export const CeCertificateRowDto = z.object({
  id: z.uuid(),
  holderName: z.string(),
  code: z.string(),
  totalCredits: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  status: z.enum(CERTIFICATE_STATUSES),
  issuedAt: z.date(),
});
export type CeCertificateRowDto = z.infer<typeof CeCertificateRowDto>;

/** The organizer's CE page: settings, each session's rule, the certificates (event editors). */
export const CeSetupDto = z.object({
  eventId: z.uuid(),
  creditLabel: z.string().nullable(),
  accreditor: z.string().nullable(),
  calculatedAt: z.date().nullable(),
  sessions: z.array(CeSessionDto),
  certificates: z.array(CeCertificateRowDto),
});
export type CeSetupDto = z.infer<typeof CeSetupDto>;
export const ceSetupSerializer = defineSerializer('ce.setup', CeSetupDto);

export const CalculationDto = z.object({
  issued: z.number().int().nonnegative(),
  revised: z.number().int().nonnegative(),
  revoked: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  /** Tickets that attended something but reached no session's minimum. */
  below: z.number().int().nonnegative(),
  /** Sessions with a rule that have not ended yet (not counted). */
  pendingSessions: z.number().int().nonnegative(),
});
export type CalculationDto = z.infer<typeof CalculationDto>;

/** What the public verification page shows: never the full name, the address or the ticket. */
export const VerificationDto = z.object({
  code: z.string(),
  status: z.enum(CERTIFICATE_STATUSES),
  holder: z.string(),
  eventName: z.string(),
  orgName: z.string(),
  creditLabel: z.string().nullable(),
  accreditor: z.string().nullable(),
  totalCredits: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  issuedAt: z.date(),
  revisedAt: z.date(),
  timezone: z.string(),
  locale: z.string(),
});
export type VerificationDto = z.infer<typeof VerificationDto>;
export const verificationSerializer = defineSerializer('ce.verification', VerificationDto);
