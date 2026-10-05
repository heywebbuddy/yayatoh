import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CHARITY_STATUSES, EXEMPT_KINDS, normalizeEin } from './domain/receipts.ts';
import { exemptProblem } from './exempt-orgs/lookup.ts';
import { charityProfiles } from './schema.ts';

type ProfileRow = typeof charityProfiles.$inferSelect;

const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const CharityProfileInput = z.object({
  legalName: z.string().trim().min(1).max(200),
  ein: z.string().trim().max(20),
  exemptKind: z.enum(EXEMPT_KINDS),
  sponsorName: OptionalText(200),
  sponsorEin: OptionalText(20),
  address: OptionalText(300),
});
export type CharityProfileInput = z.input<typeof CharityProfileInput>;

/** The org's charity profile as its own console sees it (staff's review note included). */
export const CharityProfileDto = z.object({
  legalName: z.string(),
  ein: z.string(),
  exemptKind: z.enum(EXEMPT_KINDS),
  sponsorName: z.string().nullable(),
  sponsorEin: z.string().nullable(),
  address: z.string().nullable(),
  status: z.enum(CHARITY_STATUSES),
  version: z.int(),
  submittedAt: z.date(),
  reviewedAt: z.date().nullable(),
  reviewNote: z.string().nullable(),
});
export type CharityProfileDto = z.infer<typeof CharityProfileDto>;

const toDto = (r: ProfileRow): CharityProfileDto =>
  CharityProfileDto.parse({
    legalName: r.legalName,
    ein: r.ein,
    exemptKind: r.exemptKind,
    sponsorName: r.sponsorName,
    sponsorEin: r.sponsorEin,
    address: r.address,
    status: r.status,
    version: r.version,
    submittedAt: r.submittedAt,
    reviewedAt: r.reviewedAt,
    reviewNote: r.status === 'rejected' ? r.reviewNote : null,
  });

/** The org's charity profile row, if it has one (inside its tenant transaction). */
export async function charityProfileTx(tx: TenantTx, forUpdate = false): Promise<ProfileRow | null> {
  const q = tx.select().from(charityProfiles);
  const [row] = forUpdate ? await q.for('update') : await q;
  return row ?? null;
}

const invalid = (field: string, reason = field) =>
  new DomainError('validation_failed', 'Check this field', { field, reason });

/**
 * Save the org's charity profile (owners and admins). Any change sends it to staff review again
 * (`pending`, next version): receipts turn tax-deductible only once staff verified exactly what
 * prints on them. Saving the same details again changes nothing.
 */
export const saveCharityProfileCommand = tenantCommand({
  name: 'donations.saveCharityProfile',
  input: CharityProfileInput,
  output: CharityProfileDto,
  entitlement: 'donations',
  permission: 'org:update',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const ein = normalizeEin(input.ein);
    if (!ein) throw invalid('ein');
    const sponsored = input.exemptKind === 'fiscal_sponsor';
    if (sponsored && !input.sponsorName) throw invalid('sponsorName');
    const sponsorEin = sponsored ? normalizeEin(input.sponsorEin ?? '') : null;
    if (sponsored && !sponsorEin) throw invalid('sponsorEin');
    const next = {
      legalName: input.legalName,
      ein,
      exemptKind: input.exemptKind,
      sponsorName: sponsored ? input.sponsorName : null,
      sponsorEin,
      address: input.address,
    };
    const current = await charityProfileTx(tx, true);
    if (
      current &&
      current.legalName === next.legalName &&
      current.ein === next.ein &&
      current.exemptKind === next.exemptKind &&
      current.sponsorName === next.sponsorName &&
      current.sponsorEin === next.sponsorEin &&
      current.address === next.address
    )
      return toDto(current);
    const review = {
      status: 'pending',
      submittedAt: ctx.now,
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: null,
      irsName: null,
      irsCity: null,
      irsState: null,
      irsDeductibility: null,
      updatedAt: ctx.now,
    };
    const [row] = current
      ? await tx
          .update(charityProfiles)
          .set({ ...next, ...review, version: current.version + 1 })
          .where(eq(charityProfiles.id, current.id))
          .returning()
      : await tx
          .insert(charityProfiles)
          .values({ orgId, ...next, ...review, version: 1 })
          .returning();
    if (!row) throw new DomainError('internal');
    emit({
      type: 'donations.charity_submitted',
      version: 1,
      aggregateType: 'charity_profile',
      aggregateId: row.id,
      payload: { orgId, profileId: row.id, version: row.version },
    });
    return toDto(row);
  },
  audit: (input, r) => ({
    action: 'donations.charity.save',
    targetType: 'charity_profile',
    targetId: null,
    data: { legalName: input.legalName, ein: r.ein, exemptKind: r.exemptKind, version: r.version },
  }),
});

/** The org's charity profile (null until saved). */
export const charityProfileQuery = tenantQuery({
  name: 'donations.charityProfile',
  input: z.object({}),
  output: CharityProfileDto.nullable(),
  entitlement: 'donations',
  permission: 'org:read',
  handler: async ({ tx }) => {
    const row = await charityProfileTx(tx);
    return row ? toDto(row) : null;
  },
});

/** What the IRS list said about the EIN staff checked (the admin app looks it up through the port). */
export const IrsRecordInput = z.object({
  ein: z.string(),
  name: z.string().trim().min(1).max(200),
  city: z.string().trim().max(100),
  state: z.string().trim().max(10),
  subsection: z.string().max(4),
  deductibility: z.string().max(4),
  status: z.string().max(4),
});

/**
 * Staff verify a charity profile (platform actor; audited) after checking it against the IRS
 * exempt-organization list. Only the version they reviewed: a profile changed meanwhile is
 * refused (`stale`). The record must be the profile's EIN (the fiscal sponsor's, for a sponsored
 * project) and eligible: a 501(c)(3) to which contributions are deductible, exemption in force.
 */
export const verifyCharityCommand = tenantCommand({
  name: 'donations.verifyCharity',
  input: z.object({
    version: z.int().min(1),
    irs: IrsRecordInput,
    note: OptionalText(500),
  }),
  output: z.object({ status: z.enum(CHARITY_STATUSES), version: z.int() }),
  entitlement: null,
  permission: 'platform:charity.verify',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const row = await charityProfileTx(tx, true);
    if (!row) throw new DomainError('not_found', 'No charity profile');
    if (row.version !== input.version)
      throw new DomainError('conflict', 'The profile changed meanwhile', { reason: 'stale' });
    if (row.status === 'verified') return { status: 'verified' as const, version: row.version };
    const checked = row.exemptKind === 'fiscal_sponsor' ? row.sponsorEin : row.ein;
    if (input.irs.ein !== checked)
      throw new DomainError('validation_failed', 'The IRS record is for another EIN', {
        reason: 'ein_mismatch',
      });
    const problem = exemptProblem(input.irs);
    if (problem) throw new DomainError('invalid_state', 'Not eligible', { reason: problem });
    const by = ctx.actor.type === 'system' ? ctx.actor.name : 'system';
    await tx
      .update(charityProfiles)
      .set({
        status: 'verified',
        reviewedAt: ctx.now,
        reviewedBy: by,
        reviewNote: input.note,
        irsName: input.irs.name,
        irsCity: input.irs.city || null,
        irsState: input.irs.state || null,
        irsDeductibility: input.irs.deductibility,
        updatedAt: ctx.now,
      })
      .where(eq(charityProfiles.id, row.id));
    emit({
      type: 'donations.charity_verified',
      version: 1,
      aggregateType: 'charity_profile',
      aggregateId: row.id,
      payload: { orgId, profileId: row.id, version: row.version },
    });
    return { status: 'verified' as const, version: row.version };
  },
  audit: (input) => ({
    action: 'donations.charity.verify',
    targetType: 'charity_profile',
    targetId: null,
    data: { version: input.version, ein: input.irs.ein, irsName: input.irs.name, note: input.note },
  }),
});

/**
 * Staff reject a charity profile, or withdraw a verification (platform actor; audited), with a
 * note the org sees. Receipts issued from then on are plain "not tax-deductible" ones.
 */
export const rejectCharityCommand = tenantCommand({
  name: 'donations.rejectCharity',
  input: z.object({ version: z.int().min(1), note: z.string().trim().min(3).max(500) }),
  output: z.object({ status: z.enum(CHARITY_STATUSES), version: z.int() }),
  entitlement: null,
  permission: 'platform:charity.verify',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const row = await charityProfileTx(tx, true);
    if (!row) throw new DomainError('not_found', 'No charity profile');
    if (row.version !== input.version)
      throw new DomainError('conflict', 'The profile changed meanwhile', { reason: 'stale' });
    await tx
      .update(charityProfiles)
      .set({
        status: 'rejected',
        reviewedAt: ctx.now,
        reviewedBy: ctx.actor.type === 'system' ? ctx.actor.name : 'system',
        reviewNote: input.note,
        updatedAt: ctx.now,
      })
      .where(eq(charityProfiles.id, row.id));
    emit({
      type: 'donations.charity_rejected',
      version: 1,
      aggregateType: 'charity_profile',
      aggregateId: row.id,
      payload: { orgId, profileId: row.id, version: row.version },
    });
    return { status: 'rejected' as const, version: row.version };
  },
  audit: (input) => ({
    action: 'donations.charity.reject',
    targetType: 'charity_profile',
    targetId: null,
    data: { version: input.version, note: input.note },
  }),
});

/** A charity profile in the staff review list (platform_reader read across orgs; allowlisted). */
export const CharityForReviewDto = z.object({
  orgId: z.uuid(),
  orgName: z.string(),
  orgSlug: z.string(),
  legalName: z.string(),
  ein: z.string(),
  exemptKind: z.enum(EXEMPT_KINDS),
  sponsorName: z.string().nullable(),
  sponsorEin: z.string().nullable(),
  address: z.string().nullable(),
  status: z.enum(CHARITY_STATUSES),
  version: z.int(),
  submittedAt: z.date(),
  reviewedAt: z.date().nullable(),
  reviewNote: z.string().nullable(),
  irsName: z.string().nullable(),
});
export type CharityForReviewDto = z.infer<typeof CharityForReviewDto>;

/**
 * Charity profiles for staff review (the admin app, through platform_reader: audited by the
 * caller). `pending` first-come first-served; `reviewed` newest first. One org: `orgId`.
 */
export async function charitiesForReviewTx(
  tx: TenantTx,
  filter: { readonly status?: 'pending' | 'reviewed'; readonly orgId?: string; readonly limit?: number },
): Promise<CharityForReviewDto[]> {
  const where = filter.orgId
    ? sql`p.org_id = ${filter.orgId}`
    : filter.status === 'reviewed'
      ? sql`p.status <> 'pending'`
      : sql`p.status = 'pending'`;
  const rows = await tx.execute<{
    org_id: string;
    org_name: string;
    org_slug: string;
    legal_name: string;
    ein: string;
    exempt_kind: string;
    sponsor_name: string | null;
    sponsor_ein: string | null;
    address: string | null;
    status: string;
    version: number;
    submitted_at: string;
    reviewed_at: string | null;
    review_note: string | null;
    irs_name: string | null;
  }>(sql`
    select p.org_id, o.name as org_name, o.slug as org_slug, p.legal_name, p.ein, p.exempt_kind,
      p.sponsor_name, p.sponsor_ein, p.address, p.status, p.version, p.submitted_at, p.reviewed_at,
      p.review_note, p.irs_name
    from donations.charity_profiles p
    join tenancy.organizations o on o.id = p.org_id
    where ${where}
    order by ${filter.status === 'reviewed' ? sql`p.reviewed_at desc` : sql`p.submitted_at`}
    limit ${filter.limit ?? 100}`);
  return rows.map((r) =>
    CharityForReviewDto.parse({
      orgId: r.org_id,
      orgName: r.org_name,
      orgSlug: r.org_slug,
      legalName: r.legal_name,
      ein: r.ein,
      exemptKind: r.exempt_kind,
      sponsorName: r.sponsor_name,
      sponsorEin: r.sponsor_ein,
      address: r.address,
      status: r.status,
      version: r.version,
      submittedAt: new Date(r.submitted_at),
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null,
      reviewNote: r.review_note,
      irsName: r.irs_name,
    }),
  );
}
