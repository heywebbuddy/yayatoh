import { normalizeEmail } from '@yayatoh/crm';
import { tenantQuery } from '@yayatoh/platform';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DSAR_KINDS, dsarRequests } from './schema.ts';
import { collectSubjectExportTx, resolveDataSubjectTx, summarizeExport } from './subject.ts';

/**
 * Data-subject requests (M1.14c, M6.1c; roadmap §10 Privacy). The org is the controller for its
 * attendees and buyers; Yayatoh is the processor and gives the org's owners and admins the tools:
 * find a person across every module, export everything held about them and erase them.
 */

export const DsarEmail = z.string().trim().toLowerCase().max(320).pipe(z.email());

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The request records' key for a person: SHA-256 of the normalized address. */
export const subjectRefOf = (emailNorm: string) => sha256Hex(normalizeEmail(emailNorm));

/** `jane@example.com` → `j•••@example.com` (enough to recognise, not to contact). */
export function maskEmail(emailNorm: string): string {
  const [local = '', domain = ''] = emailNorm.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** Records per module (`orders: 3` …): counts only, never values. */
export const DsarSummary = z.record(z.string(), z.int());
export type DsarSummary = z.infer<typeof DsarSummary>;

export const DsarHistoryDto = z.object({
  id: z.uuid(),
  kind: z.enum(DSAR_KINDS),
  status: z.string(),
  createdAt: z.date(),
  completedAt: z.date().nullable(),
});

/**
 * Find a person: what each module holds about this email (counts only), the open request if
 * there is one, and earlier requests.
 */
export const findSubjectQuery = tenantQuery({
  name: 'privacy.findSubject',
  input: z.object({ email: DsarEmail }),
  output: z.object({
    email: z.string(),
    found: z.boolean(),
    summary: DsarSummary,
    openRequestId: z.uuid().nullable(),
    history: z.array(DsarHistoryDto),
  }),
  entitlement: 'core',
  permission: 'privacy:manage',
  handler: async ({ input, ctx, tx }) => {
    const email = normalizeEmail(input.email);
    const subject = await resolveDataSubjectTx(tx, ctx, email);
    const summary = summarizeExport(await collectSubjectExportTx(tx, ctx, subject));
    // The request records themselves are not "data held" for the search.
    delete summary.privacy;
    const history = await tx
      .select()
      .from(dsarRequests)
      .where(eq(dsarRequests.subjectRef, await subjectRefOf(email)))
      .orderBy(desc(dsarRequests.createdAt))
      .limit(20);
    return {
      email,
      found: Object.values(summary).some((n) => n > 0),
      summary,
      openRequestId: history.find((h) => h.status === 'open')?.id ?? null,
      history: history.map((h) => ({
        id: h.id,
        kind: h.kind as (typeof DSAR_KINDS)[number],
        status: h.status,
        createdAt: h.createdAt,
        completedAt: h.completedAt,
      })),
    };
  },
});
