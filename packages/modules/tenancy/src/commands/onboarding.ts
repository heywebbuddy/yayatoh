import type { TenantTx } from '@yayatoh/db';
import { actorId, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PLATFORM_AGREEMENTS } from '../domain/agreements.ts';
import {
  missingOnboardingSteps,
  type OnboardingStep,
  REQUIRED_ONBOARDING_STEPS,
  type SignupMode,
} from '../domain/onboarding.ts';
import {
  agreementAcceptances,
  ONBOARDING_STEPS,
  ORG_STATUSES,
  organizations,
  orgOnboarding,
  SIGNUP_MODES,
} from '../schema.ts';

export const ONBOARDING_COMPLETED = 'org.onboarding_completed';

const STEP_COLUMN = {
  terms: orgOnboarding.termsAt,
  privacy: orgOnboarding.privacyAt,
  brand: orgOnboarding.brandAt,
  event: orgOnboarding.eventAt,
  payouts: orgOnboarding.payoutsAt,
  team: orgOnboarding.teamAt,
} as const satisfies Record<OnboardingStep, unknown>;

const STEP_KEY = {
  terms: 'termsAt',
  privacy: 'privacyAt',
  brand: 'brandAt',
  event: 'eventAt',
  payouts: 'payoutsAt',
  team: 'teamAt',
} as const satisfies Record<OnboardingStep, keyof typeof orgOnboarding.$inferSelect>;

/** The org's onboarding row, created with the org (M3.11a). */
export async function startOnboardingTx(
  tx: TenantTx,
  orgId: string,
  mode: SignupMode,
  now: Date,
  done: readonly OnboardingStep[] = [],
): Promise<void> {
  const steps = Object.fromEntries(done.map((s) => [STEP_KEY[s], now]));
  await tx
    .insert(orgOnboarding)
    .values({ orgId, signupMode: mode, ...steps })
    .onConflictDoNothing();
}

/**
 * Record that an onboarding step was done (M3.11a), inside the transaction of the command that
 * did it, so progress is exactly as durable as the change itself. The first time counts: later
 * calls keep it. Orgs created before onboarding existed have no row, and nothing happens.
 * Other modules call this down the tiers (events: first event; payments: payouts active).
 */
export async function markOnboardingStepTx(tx: TenantTx, step: OnboardingStep, now: Date): Promise<void> {
  const col = STEP_COLUMN[step];
  await tx
    .update(orgOnboarding)
    .set({ [STEP_KEY[step]]: sql`coalesce(${col}, ${now.toISOString()}::timestamptz)`, updatedAt: now })
    .where(sql`${col} is null`);
}

const StepsDto = z.object(
  Object.fromEntries(ONBOARDING_STEPS.map((s) => [s, z.date().nullable()])) as Record<
    OnboardingStep,
    z.ZodNullable<z.ZodDate>
  >,
);

export const OnboardingDto = z.object({
  /** False for orgs created before onboarding progress was recorded (the checklist reads live facts). */
  tracked: z.boolean(),
  signupMode: z.enum(SIGNUP_MODES).nullable(),
  status: z.enum(ORG_STATUSES),
  steps: StepsDto,
  /** Whether the terms of the current version are accepted (a new version must be accepted again). */
  termsCurrent: z.boolean(),
  required: z.array(z.enum(ONBOARDING_STEPS)),
  missing: z.array(z.enum(ONBOARDING_STEPS)),
  completedAt: z.date().nullable(),
});
export type Onboarding = z.infer<typeof OnboardingDto>;

async function onboardingTx(tx: TenantTx, orgId: string): Promise<Onboarding> {
  const [org] = await tx
    .select({ status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) throw new DomainError('not_found');
  const [row] = await tx.select().from(orgOnboarding).where(eq(orgOnboarding.orgId, orgId));
  const [tos] = await tx
    .select({ id: agreementAcceptances.id })
    .from(agreementAcceptances)
    .where(
      and(
        eq(agreementAcceptances.document, 'platform_tos'),
        eq(agreementAcceptances.version, PLATFORM_AGREEMENTS.platform_tos.version),
      ),
    )
    .limit(1);
  const termsCurrent = Boolean(tos);
  const steps = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s, row?.[STEP_KEY[s]] ?? null])) as Record<
    OnboardingStep,
    Date | null
  >;
  const done = Object.fromEntries(
    ONBOARDING_STEPS.map((s) => [s, s === 'terms' ? termsCurrent : steps[s] !== null]),
  ) as Record<OnboardingStep, boolean>;
  return {
    tracked: Boolean(row),
    signupMode: (row?.signupMode as SignupMode | undefined) ?? null,
    status: org.status as Onboarding['status'],
    steps,
    termsCurrent,
    required: [...REQUIRED_ONBOARDING_STEPS],
    missing: missingOnboardingSteps(done),
    completedAt: row?.completedAt ?? null,
  };
}

/** The org's onboarding progress (the org home's checklist). */
export const onboardingQuery = tenantQuery({
  name: 'tenancy.onboarding',
  input: z.object({}),
  output: OnboardingDto,
  entitlement: null,
  permission: 'org:read',
  handler: ({ ctx, tx }) => onboardingTx(tx, requireOrg(ctx)),
});

/**
 * Finish onboarding (M3.11a): once the required steps are done, a `limited` self-serve org
 * becomes `active` (guest messaging opens up). Refused with `invalid_state` /
 * `onboarding_incomplete` (and the missing steps) before that. Idempotent: a finished org answers
 * with its current state. Emits `org.onboarding_completed@1`; audited with from/to.
 */
export const completeOnboardingCommand = tenantCommand({
  name: 'tenancy.completeOnboarding',
  input: z.object({}),
  output: z.object({
    from: z.enum(ORG_STATUSES),
    status: z.enum(ORG_STATUSES),
    changed: z.boolean(),
    completedAt: z.date(),
  }),
  entitlement: null,
  permission: 'org:update',
  handler: async ({ ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const state = await onboardingTx(tx, orgId);
    if (!state.tracked) throw new DomainError('not_found', 'This organization has no onboarding to finish');
    if (state.completedAt)
      return { from: state.status, status: state.status, changed: false, completedAt: state.completedAt };
    if (state.missing.length > 0)
      throw new DomainError('invalid_state', 'Finish the required setup steps first', {
        reason: 'onboarding_incomplete',
        missing: state.missing,
      });
    // Only a limited org is promoted; staff decisions (suspended, terminated) are never undone here
    // (the org gate refuses those orgs' members before this handler runs anyway).
    const to = state.status === 'limited' ? 'active' : state.status;
    if (to !== state.status)
      await tx
        .update(organizations)
        .set({ status: to, updatedAt: ctx.now })
        .where(eq(organizations.id, orgId));
    await tx
      .update(orgOnboarding)
      .set({ completedAt: ctx.now, completedBy: actorId(ctx.actor), updatedAt: ctx.now })
      .where(eq(orgOnboarding.orgId, orgId));
    emit({
      type: ONBOARDING_COMPLETED,
      version: 1,
      aggregateType: 'organization',
      aggregateId: orgId,
      payload: { orgId, from: state.status, to },
    });
    return { from: state.status, status: to, changed: to !== state.status, completedAt: ctx.now };
  },
  audit: (_input, r) => ({
    action: 'org.onboarding_complete',
    targetType: 'organization',
    targetId: null,
    data: { from: r.from, to: r.status },
  }),
});
