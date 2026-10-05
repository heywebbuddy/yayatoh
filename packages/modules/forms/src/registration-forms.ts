import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import {
  defineSubscriber,
  keyVault,
  type Notifier,
  signLinkToken,
  tenantCommand,
  tenantQuery,
  verifyLinkToken,
} from '@yayatoh/platform';
import { and, asc, desc, eq, gt, gte, isNull, like, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AnswerError } from './definition.ts';
import { writeVersionTx } from './forms.ts';
import {
  checkRegistrationAnswers,
  computePath,
  JOB_TITLE_MAX,
  REGISTRATION_FIELD_TYPES,
  REGISTRATION_FORM_KIND,
  type RegistrationCheck,
  RegistrationFormDefinition,
  RegistrationTypeId,
  respondentPage,
} from './registration.ts';
import { companies, formResponses, forms, formVersions, jobTitles, respondents } from './schema.ts';

/** Signed respondent links: `<respondentId>~<hmac>` (M1.5f link rules; nothing secret stored). */
export const RESPONDENT_PURPOSE = 'forms.respondent';
/** A draft (and its link) lives this many days after the last save, then is purged. */
export const DRAFT_DAYS = 14;
/** Resume emails one respondent can ask for (each save-and-email counts). */
export const MAX_RESUME_SENDS = 5;
const DAY_MS = 86_400_000;

export const respondentToken = (respondentId: string) => signLinkToken(RESPONDENT_PURPOSE, respondentId);
export const resumeDedupeKey = (respondentId: string, send: number) => `form-resume:${respondentId}:${send}`;

const subjectOf = (eventId: string) =>
  ({ kind: REGISTRATION_FORM_KIND, subjectType: 'event', subjectId: eventId }) as const;

// ---------------------------------------------------------------------------------------------
// Organizer side: versioned definitions, the job title list

/** The event's current registration form version, in the caller's tenant transaction. */
export async function currentRegistrationFormTx(tx: TenantTx, eventId: string) {
  const s = subjectOf(eventId);
  const [row] = await tx
    .select({
      formId: forms.id,
      versionId: formVersions.id,
      version: formVersions.version,
      definition: formVersions.definition,
    })
    .from(forms)
    .innerJoin(
      formVersions,
      and(eq(formVersions.formId, forms.id), eq(formVersions.version, forms.currentVersion)),
    )
    .where(
      and(eq(forms.kind, s.kind), eq(forms.subjectType, s.subjectType), eq(forms.subjectId, s.subjectId)),
    );
  return row ? { ...row, definition: RegistrationFormDefinition.parse(row.definition) } : null;
}

const EventRef = z.object({ eventId: z.uuid() });

/**
 * Publish the next version of an event's registration form. Versions are immutable: respondents
 * who already started keep answering the version they started on.
 */
export const publishRegistrationFormCommand = tenantCommand({
  name: 'forms.publishRegistrationForm',
  input: EventRef.extend({
    definition: RegistrationFormDefinition,
    /**
     * The version the editor started from (0: no form yet). A publish from an older version is a
     * `conflict` (`stale_version`), so two editors never silently overwrite each other.
     */
    expectedVersion: z.int().min(0).optional(),
  }),
  output: z.object({ version: z.int() }),
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const r = await writeVersionTx(
      tx,
      ctx,
      subjectOf(input.eventId),
      input.definition,
      input.expectedVersion,
    );
    return { version: r.version, formId: r.formId };
  },
  audit: (input, r) => ({
    action: 'form.publish',
    targetType: 'form',
    targetId: r?.formId ?? null,
    data: {
      kind: REGISTRATION_FORM_KIND,
      subjectId: input.eventId,
      version: r?.version,
      pages: input.definition.pages.length,
      fields: input.definition.pages.reduce((n, p) => n + p.fields.length, 0),
    },
  }),
});

export const RegistrationFormDto = z
  .object({
    version: z.int(),
    definition: RegistrationFormDefinition,
    /** Respondents who submitted, and drafts in progress (counts only). */
    submitted: z.int(),
    inProgress: z.int(),
  })
  .nullable();

export const getRegistrationFormQuery = tenantQuery({
  name: 'forms.getRegistrationForm',
  input: EventRef,
  output: RegistrationFormDto,
  entitlement: 'registration',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const f = await currentRegistrationFormTx(tx, input.eventId);
    if (!f) return null;
    const [c] = await tx
      .select({
        submitted: sql<number>`count(*) filter (where ${respondents.submittedAt} is not null)::int`,
        inProgress: sql<number>`count(*) filter (where ${respondents.submittedAt} is null and ${gt(respondents.expiresAt, ctx.now)})::int`,
      })
      .from(respondents)
      .where(eq(respondents.formId, f.formId));
    return {
      version: f.version,
      definition: f.definition,
      submitted: c?.submitted ?? 0,
      inProgress: c?.inProgress ?? 0,
    };
  },
});

/** The org's job title list, in order. */
export async function jobTitlesTx(tx: TenantTx): Promise<string[]> {
  const rows = await tx
    .select({ label: jobTitles.label })
    .from(jobTitles)
    .orderBy(asc(jobTitles.position), asc(jobTitles.label));
  return rows.map((r) => r.label);
}

export const listJobTitlesQuery = tenantQuery({
  name: 'forms.listJobTitles',
  input: z.object({}),
  output: z.array(z.string()),
  entitlement: 'registration',
  permission: 'events:read',
  handler: async ({ tx }) => jobTitlesTx(tx),
});

const JobTitle = z.string().trim().min(1).max(JOB_TITLE_MAX);

/** Replace the org's job title list (the order given is the order shown). */
export const setJobTitlesCommand = tenantCommand({
  name: 'forms.setJobTitles',
  input: z.object({
    titles: z
      .array(JobTitle)
      .max(100)
      .refine((l) => new Set(l.map((t) => t.toLowerCase())).size === l.length, 'Job titles must be unique'),
  }),
  output: z.object({ count: z.int() }),
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await tx.delete(jobTitles);
    if (input.titles.length > 0)
      await tx.insert(jobTitles).values(input.titles.map((label, position) => ({ orgId, label, position })));
    return { count: input.titles.length };
  },
  audit: (_input, r) => ({
    action: 'form.job_titles',
    targetType: 'organization',
    targetId: null,
    data: { count: r?.count },
  }),
});

// ---------------------------------------------------------------------------------------------
// Company suggestions

/** How many respondents must have named a company before others are offered it. */
export const COMPANY_SUGGESTION_MIN = 2;

const normCompany = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Companies named by at least two submitted respondents that start with `prefix` (2+ letters), at
 * most `limit`, most used first. The caller merges the org's public companies (exhibitors,
 * sponsors) from their own modules' exports.
 */
export async function companySuggestionsTx(tx: TenantTx, prefix: string, limit = 8): Promise<string[]> {
  const p = normCompany(prefix);
  if (p.length < 2) return [];
  const escaped = p.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await tx
    .select({ name: companies.name })
    .from(companies)
    .where(and(like(companies.nameNorm, `${escaped}%`), gte(companies.respondents, COMPANY_SUGGESTION_MIN)))
    .orderBy(desc(companies.respondents), asc(companies.name))
    .limit(Math.min(Math.max(limit, 1), 20));
  return rows.map((r) => r.name);
}

/** Public read after the caller resolved the org server-side (respondent link or event slug). */
export async function publicCompanySuggestions(orgId: string, prefix: string): Promise<string[]> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'forms.companies' } });
  return withTenant(ctx, (tx) => companySuggestionsTx(tx, prefix));
}

// ---------------------------------------------------------------------------------------------
// Respondent side

export const RESPONDENT_STATES = ['open', 'submitted', 'expired'] as const;
type RespondentRow = typeof respondents.$inferSelect;

const stateOf = (r: RespondentRow, now: Date) =>
  r.submittedAt ? 'submitted' : r.expiresAt <= now ? 'expired' : 'open';

/** Respondent link → (org, respondent), through a SECURITY DEFINER function (ids only). */
export async function respondentRef(token: string): Promise<{ orgId: string; respondentId: string } | null> {
  if (token.length > 200) return null;
  const respondentId = verifyLinkToken(RESPONDENT_PURPOSE, token);
  if (!respondentId) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string }>(sql`select org_id from forms.respondent_org(${respondentId}::uuid)`),
  );
  return rows[0] ? { orgId: rows[0].org_id, respondentId } : null;
}

async function versionDefinitionTx(tx: TenantTx, versionId: string): Promise<RegistrationFormDefinition> {
  const [v] = await tx
    .select({ definition: formVersions.definition })
    .from(formVersions)
    .where(eq(formVersions.id, versionId));
  if (!v) throw new DomainError('internal');
  return RegistrationFormDefinition.parse(v.definition);
}

/** The draft so far: the stored answers with the sensitive ones decrypted. */
async function draftAnswers(orgId: string, r: RespondentRow): Promise<Record<string, unknown>> {
  const secret = r.sensitiveCiphertext
    ? (JSON.parse(new TextDecoder().decode(await keyVault().decrypt(orgId, r.sensitiveCiphertext))) as object)
    : {};
  return { ...(r.answers as Record<string, unknown>), ...secret };
}

/** Split answers into the open JSON and the sealed envelope (sensitive questions). */
async function sealAnswers(orgId: string, def: RegistrationFormDefinition, answers: Record<string, unknown>) {
  const sensitive = new Set(def.pages.flatMap((p) => p.fields.filter((f) => f.sensitive).map((f) => f.key)));
  const open: Record<string, unknown> = {};
  const secret: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) (sensitive.has(k) ? secret : open)[k] = v;
  return {
    open,
    sealed: Object.keys(secret).length
      ? await keyVault().encrypt(orgId, new TextEncoder().encode(JSON.stringify(secret)))
      : null,
  };
}

const OptionDto = z.object({ value: z.string(), label: z.string() });
/** A question as the respondent sees it (no registration type lists: other types stay unseen). */
const RespondentFieldDto = z.object({
  key: z.string(),
  type: z.enum(REGISTRATION_FIELD_TYPES),
  label: z.string(),
  help: z.string().nullable(),
  required: z.boolean(),
  sensitive: z.boolean(),
  options: z.array(OptionDto),
  min: z.int().nullable(),
  max: z.int().nullable(),
  showIf: z.unknown().nullable(),
  consent: z.object({ term: z.string(), version: z.int() }).nullable(),
});
export const RespondentPageDto = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  fields: z.array(RespondentFieldDto),
  context: z.record(z.string(), z.unknown()),
});
export type RespondentPageDto = z.infer<typeof RespondentPageDto>;

/**
 * The respondent's view (allowlisted): only the current page of their path, with this
 * registration type's questions and their own answers to it. Other pages, other types' questions
 * and other people's answers never leave the server.
 */
export const PublicRespondentDto = z.object({
  state: z.enum(RESPONDENT_STATES),
  eventName: z.string(),
  name: z.string(),
  registrationTypeId: z.string(),
  step: z.int(),
  steps: z.int(),
  first: z.boolean(),
  last: z.boolean(),
  page: RespondentPageDto.nullable(),
  values: z.record(z.string(), z.unknown()),
  jobTitles: z.array(z.string()),
  expiresAt: z.date(),
});
export type PublicRespondentDto = z.infer<typeof PublicRespondentDto>;

export type EventNameOf = (tx: TenantTx, eventId: string) => Promise<string | null>;

export async function publicRespondent(
  token: string,
  deps: { eventName: EventNameOf; now?: Date },
): Promise<PublicRespondentDto | null> {
  const ref = await respondentRef(token);
  if (!ref) return null;
  const now = deps.now ?? new Date();
  const ctx = createCtx({ orgId: ref.orgId, actor: { type: 'system', name: 'forms.respondent' } });
  return withTenant(ctx, async (tx) => {
    const [r] = await tx.select().from(respondents).where(eq(respondents.id, ref.respondentId));
    if (!r) return null;
    const [f] = await tx.select({ subjectId: forms.subjectId }).from(forms).where(eq(forms.id, r.formId));
    const eventName = f ? await deps.eventName(tx, f.subjectId) : null;
    if (eventName === null) return null;
    const state = stateOf(r, now);
    const base = {
      state,
      eventName,
      name: r.name,
      registrationTypeId: r.registrationTypeId,
      expiresAt: r.expiresAt,
    };
    const closed = {
      ...base,
      step: 0,
      steps: 0,
      first: true,
      last: true,
      page: null,
      values: {},
      jobTitles: [],
    };
    if (state !== 'open') return PublicRespondentDto.parse(closed);
    const def = await versionDefinitionTx(tx, r.formVersionId);
    const answers = await draftAnswers(ref.orgId, r);
    const path = computePath(def, r.registrationTypeId, answers);
    const at = Math.max(
      0,
      path.findIndex((p) => p.page.key === r.pageKey),
    );
    const key = path[at]?.page.key;
    const page = key ? respondentPage(def, r.registrationTypeId, answers, key) : null;
    if (!page) return PublicRespondentDto.parse(closed);
    const onPage = new Set(page.fields.map((x) => x.key));
    return PublicRespondentDto.parse({
      ...base,
      step: at + 1,
      steps: path.length,
      first: at === 0,
      last: at === path.length - 1,
      page,
      values: Object.fromEntries(Object.entries(answers).filter(([k]) => onPage.has(k))),
      jobTitles: page.fields.some((x) => x.type === 'job_title') ? await jobTitlesTx(tx) : [],
    });
  });
}

const Answers = z.record(z.string().max(40), z.unknown()).refine((a) => Object.keys(a).length <= 100);

/**
 * Start a registration form (public): one respondent row per person, on the current version,
 * for the registration type the caller supplies (the Wave 2 registration flow, or the stand-in
 * type picker). Returns the respondent's signed link.
 */
export const startRegistrationFormCommand = tenantCommand({
  name: 'forms.startRegistrationForm',
  input: EventRef.extend({
    registrationTypeId: RegistrationTypeId,
    name: z.string().trim().min(1).max(120),
    email: z.email().max(254),
    locale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .default('en'),
  }),
  output: z.object({ token: z.string() }),
  entitlement: 'registration',
  permission: 'public:registration_form',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const f = await currentRegistrationFormTx(tx, input.eventId);
    if (!f) throw new DomainError('not_found', 'This event has no registration form', { reason: 'no_form' });
    const path = computePath(f.definition, input.registrationTypeId, {});
    if (path.length === 0)
      throw new DomainError('invalid_state', 'No questions for this registration type', {
        reason: 'no_questions',
      });
    const [row] = await tx
      .insert(respondents)
      .values({
        orgId,
        formId: f.formId,
        formVersionId: f.versionId,
        registrationTypeId: input.registrationTypeId,
        name: input.name,
        email: input.email.trim(),
        locale: input.locale,
        pageKey: path[0]?.page.key ?? null,
        expiresAt: new Date(ctx.now.getTime() + DRAFT_DAYS * DAY_MS),
      })
      .returning({ id: respondents.id });
    if (!row) throw new DomainError('internal');
    return { id: row.id, version: f.version };
  },
  present: (r) => ({ token: respondentToken(r.id) }),
  audit: (input, r) => ({
    action: 'form.respondent.start',
    targetType: 'form_respondent',
    targetId: r?.id ?? null,
    data: { eventId: input.eventId, version: r?.version, registrationTypeId: input.registrationTypeId },
  }),
});

type Mode = 'draft' | 'next' | 'submit';

/** A stable reason for each answer problem (the respondent's page localizes it). */
function answerReason(message: string): string {
  if (message === 'Not on your path') return 'hidden_answer';
  if (message === 'Required') return 'required';
  if (message === 'Unknown question') return 'unknown_question';
  if (message === 'Too long') return 'too_long';
  if (/^(Number expected|Whole number|At least|At most)/.test(message)) return 'number';
  if (/^Choose/.test(message)) return 'choose';
  return 'form_invalid';
}

/**
 * Load the respondent behind a link (locked), merge what they sent with their draft and let the
 * server recompute the path. What they send may answer any question on their path; anything off
 * it is rejected naming the question. Stored draft answers that fell off the path (the person
 * changed an earlier answer) are dropped.
 */
async function applyAnswersTx(
  tx: TenantTx,
  ctx: Ctx,
  input: { token: string; pageKey: string; answers: Record<string, unknown> },
  mode: Mode,
): Promise<{ r: RespondentRow; def: RegistrationFormDefinition; check: RegistrationCheck }> {
  const id = verifyLinkToken(RESPONDENT_PURPOSE, input.token);
  if (!id) throw new DomainError('not_found', 'Unknown link');
  const [r] = await tx.select().from(respondents).where(eq(respondents.id, id)).for('update');
  if (!r) throw new DomainError('not_found', 'Unknown link');
  const state = stateOf(r, ctx.now);
  if (state === 'submitted')
    throw new DomainError('conflict', 'This form was already submitted', { reason: 'already_submitted' });
  if (state === 'expired')
    throw new DomainError('invalid_state', 'This link has expired', { reason: 'expired' });
  const def = await versionDefinitionTx(tx, r.formVersionId);
  const stored = await draftAnswers(requireOrg(ctx), r);
  if (!computePath(def, r.registrationTypeId, stored).some((p) => p.page.key === input.pageKey))
    throw new DomainError('invalid_state', 'This page is not on your path', { reason: 'page_not_on_path' });
  let check: RegistrationCheck;
  try {
    check = checkRegistrationAnswers(
      def,
      { ...stored, ...input.answers },
      {
        registrationTypeId: r.registrationTypeId,
        requirePages: mode === 'submit' ? 'all' : mode === 'next' ? [input.pageKey] : [],
        dropHidden: (k) => !Object.hasOwn(input.answers, k),
      },
    );
  } catch (err) {
    if (err instanceof AnswerError)
      throw new DomainError('validation_failed', err.message, {
        reason: answerReason(err.message),
        field: err.field,
      });
    throw err;
  }
  return { r, def, check };
}

const PageInput = z.object({
  token: z.string().min(10).max(200),
  pageKey: z.string().min(1).max(40),
  answers: Answers,
});

/**
 * Save the respondent's page (public, by link) and move: `next` (the page's required questions
 * must be answered), `back`, `stay`, or `email` (save and email the resume link, capped per
 * respondent). Every save slides the draft's expiry.
 */
export const saveRegistrationPageCommand = tenantCommand({
  name: 'forms.saveRegistrationPage',
  input: PageInput.extend({ intent: z.enum(['next', 'back', 'stay', 'email']) }),
  output: z.object({ pageKey: z.string(), emailed: z.boolean() }),
  entitlement: 'registration',
  permission: 'public:registration_form',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const { r, def, check } = await applyAnswersTx(
      tx,
      ctx,
      input,
      input.intent === 'next' ? 'next' : 'draft',
    );
    const at = check.path.findIndex((p) => p.page === input.pageKey);
    const target =
      input.intent === 'next'
        ? (check.path[at + 1]?.page ?? input.pageKey)
        : input.intent === 'back'
          ? (check.path[at - 1]?.page ?? input.pageKey)
          : input.pageKey;
    const emailing = input.intent === 'email';
    if (emailing && r.resumeSends >= MAX_RESUME_SENDS)
      throw new DomainError('rate_limited', 'Too many resume emails', { reason: 'resume_limit' });
    const { open, sealed } = await sealAnswers(orgId, def, check.answers);
    await tx
      .update(respondents)
      .set({
        answers: open,
        sensitiveCiphertext: sealed,
        pageKey: target,
        expiresAt: new Date(ctx.now.getTime() + DRAFT_DAYS * DAY_MS),
        resumeSends: emailing ? r.resumeSends + 1 : r.resumeSends,
        updatedAt: ctx.now,
      })
      .where(eq(respondents.id, r.id));
    if (emailing)
      emit({
        type: 'form.resume_requested',
        version: 1,
        aggregateType: 'form_respondent',
        aggregateId: r.id,
        payload: { orgId, respondentId: r.id, send: r.resumeSends + 1 },
      });
    return { pageKey: target, emailed: emailing, id: r.id };
  },
  present: (r) => ({ pageKey: r.pageKey, emailed: r.emailed }),
  audit: (input, r) => ({
    action: 'form.respondent.save',
    targetType: 'form_respondent',
    targetId: r?.id ?? null,
    data: { intent: input.intent, pageKey: r?.pageKey },
  }),
});

/** Records a checked consent box in the crm ledger (crm's `recordTermConsentTx`, wired by the apps). */
export type RecordConsent = (
  tx: TenantTx,
  ctx: Ctx,
  entry: { email: string; name: string | null; term: string; version: number; evidence: string },
) => Promise<unknown>;

/**
 * Submit the respondent's form (public, by link). The server recomputes the whole path: every
 * required question on it must be answered, anything off it is rejected. The answers become one
 * `form_responses` row pinned to the version the person answered; each checked consent box is
 * recorded in the consent ledger with its term version (unchecked records nothing); companies
 * named are counted for suggestions. The draft is emptied and the link then shows "submitted".
 */
export function submitRegistrationFormCommand(deps: { recordConsent: RecordConsent }) {
  return tenantCommand({
    name: 'forms.submitRegistrationForm',
    input: PageInput,
    output: z.object({ ok: z.boolean() }),
    entitlement: 'registration',
    permission: 'public:registration_form',
    handler: async ({ input, ctx, tx, emit }) => {
      const orgId = requireOrg(ctx);
      const { r, def, check } = await applyAnswersTx(tx, ctx, input, 'submit');
      const { open, sealed } = await sealAnswers(orgId, def, check.answers);
      const [version] = await tx
        .select({ version: formVersions.version })
        .from(formVersions)
        .where(eq(formVersions.id, r.formVersionId));
      await tx.insert(formResponses).values({
        orgId,
        formVersionId: r.formVersionId,
        respondentType: 'form_respondent',
        respondentId: r.id,
        answers: open,
        sensitiveCiphertext: sealed,
      });
      for (const c of check.consents)
        await deps.recordConsent(tx, ctx, {
          email: r.email,
          name: r.name,
          term: c.term,
          version: c.version,
          evidence: `registration_form:${r.formId}:v${version?.version ?? 0}:${c.key}`,
        });
      const named = new Map<string, string>();
      for (const p of def.pages)
        for (const f of p.fields) {
          const v = open[f.key];
          if (f.type === 'company' && typeof v === 'string' && v) named.set(normCompany(v), v);
        }
      for (const [nameNorm, name] of named)
        await tx
          .insert(companies)
          .values({ orgId, name, nameNorm, respondents: 1 })
          .onConflictDoUpdate({
            target: [companies.orgId, companies.nameNorm],
            set: { respondents: sql`${companies.respondents} + 1`, updatedAt: ctx.now },
          });
      await tx
        .update(respondents)
        .set({
          answers: {},
          sensitiveCiphertext: null,
          pageKey: null,
          submittedAt: ctx.now,
          updatedAt: ctx.now,
        })
        .where(eq(respondents.id, r.id));
      const [form] = await tx.select({ eventId: forms.subjectId }).from(forms).where(eq(forms.id, r.formId));
      emit({
        type: 'form.registration_submitted',
        version: 1,
        aggregateType: 'form_respondent',
        aggregateId: r.id,
        payload: {
          orgId,
          respondentId: r.id,
          eventId: form?.eventId ?? null,
          registrationTypeId: r.registrationTypeId,
          version: version?.version ?? null,
        },
      });
      return { ok: true, id: r.id, consents: check.consents.length };
    },
    present: () => ({ ok: true }),
    audit: (_input, r) => ({
      action: 'form.respondent.submit',
      targetType: 'form_respondent',
      targetId: r?.id ?? null,
      data: { consents: r?.consents ?? 0 },
    }),
  });
}

// ---------------------------------------------------------------------------------------------
// Resume emails and the draft purge

const ResumePayload = z.object({ orgId: z.uuid(), respondentId: z.uuid(), send: z.int().min(1) });

/**
 * Emails the respondent their resume link through the notifications dispatcher
 * (`forms.resume`, transactional: they asked for it). Nothing is sent once the form is submitted
 * or the draft has expired.
 */
export function registrationResumeMailer(deps: {
  notifier: Notifier;
  appOrigin: string;
  eventName: EventNameOf;
}) {
  return defineSubscriber({
    name: 'forms.resume-mailer',
    events: ['form.resume_requested@1'],
    handle: async (tx, event) => {
      const p = ResumePayload.parse(event.payload);
      const [r] = await tx.select().from(respondents).where(eq(respondents.id, p.respondentId));
      if (!r || r.submittedAt || r.expiresAt <= new Date()) return;
      const [f] = await tx.select({ eventId: forms.subjectId }).from(forms).where(eq(forms.id, r.formId));
      const eventName = f ? await deps.eventName(tx, f.eventId) : null;
      if (!f || eventName === null) return;
      await deps.notifier.enqueue(tx, {
        kind: 'forms.resume',
        to: { email: r.email, name: r.name, locale: r.locale },
        params: {
          url: `${deps.appOrigin}/registration-form/${respondentToken(r.id)}`,
          name: r.name,
          eventName,
          days: DRAFT_DAYS,
        },
        dedupeKey: resumeDedupeKey(r.id, p.send),
        eventId: f.eventId,
      });
    },
  });
}

/** Delete drafts that expired unsubmitted (the daily retention pass); returns how many. */
export async function purgeExpiredDraftsTx(tx: TenantTx, now: Date): Promise<number> {
  const rows = await tx
    .delete(respondents)
    .where(and(isNull(respondents.submittedAt), lte(respondents.expiresAt, now)))
    .returning({ id: respondents.id });
  return rows.length;
}

/** The event a respondent's form belongs to, after their own link resolved the org. */
export async function respondentEventId(ref: {
  orgId: string;
  respondentId: string;
}): Promise<string | null> {
  const ctx = createCtx({ orgId: ref.orgId, actor: { type: 'system', name: 'forms.respondent' } });
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ eventId: forms.subjectId })
      .from(respondents)
      .innerJoin(forms, eq(forms.id, respondents.formId))
      .where(eq(respondents.id, ref.respondentId));
    return row?.eventId ?? null;
  });
}

/** Whether a published event has a registration form (the public start page). */
export async function hasRegistrationForm(orgId: string, eventId: string): Promise<boolean> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'forms.public' } });
  return withTenant(ctx, async (tx) => (await currentRegistrationFormTx(tx, eventId)) !== null);
}
