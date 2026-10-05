import type { TenantTx } from '@yayatoh/db';
import {
  createPortalAccountTx,
  type PortalPrincipal,
  portalAccountsTx,
  portalPrincipalTx,
  revokePortalAccountTx,
  safeHref,
  sanitizeMarkdown,
} from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { changeDiff, changedValues, PROFILE_FIELDS, SESSION_FIELDS, staleFields } from './domain/portal.ts';
import {
  ProposalResultDto as ProposalResult,
  type ProposalResultDto,
  SpeakerAccessDto,
  SpeakerChangeDto,
} from './portal-dto.ts';
import { sessionSpeakers, sessions, speakers } from './schema.ts';
import { speakerChanges } from './schema-portal.ts';
import { eventOf } from './shared.ts';

/**
 * M5.3a speaker portal, organizer and speaker sides of the profile: portal invitations (P5-7) and
 * proposed changes the organizer approves. Organizer commands need `events:write` (reads
 * `events:read`); speaker commands need `portal:speaker` and re-check the portal account and its
 * speaker in the transaction. Everything needs the `speakers` module (P5-1).
 */

const Text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null));
const Markdown = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => sanitizeMarkdown(v, max))
    .default('');
const WebUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https?:\/\//i.test(v) && safeHref(v) !== null, 'must be an http(s) link');

/** What a speaker may propose for their profile (the same rules as the organizer's form). */
export const ProfileProposalInput = z.object({
  name: z.string().trim().min(1).max(120),
  title: Text(120),
  company: Text(120),
  bio: Markdown(5000),
  links: z
    .array(z.object({ label: z.string().trim().min(1).max(120), url: WebUrl }))
    .max(10)
    .default([]),
});
export type ProfileProposalInput = z.input<typeof ProfileProposalInput>;

export const SessionProposalInput = z.object({
  sessionId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  description: Markdown(5000),
});
export type SessionProposalInput = z.input<typeof SessionProposalInput>;

/* -------------------------------------------------------------------- shared checks ---- */

/** The speaker principal of a portal command, with their (approved) speaker row. */
export async function speakerPrincipalTx(tx: TenantTx, ctx: Ctx) {
  const p = await portalPrincipalTx(tx, ctx);
  if (p.role !== 'speaker' || p.subjectKind !== 'speaker') throw new DomainError('forbidden');
  const [speaker] = await tx
    .select()
    .from(speakers)
    .where(and(eq(speakers.id, p.subjectId), eq(speakers.eventId, p.eventId)));
  // The speaker row was deleted: the account opens nothing.
  if (!speaker) throw new DomainError('forbidden');
  return { principal: p, speaker };
}

/** A session of the principal's event that the speaker speaks in, or `not_found` (guessed ids too). */
async function ownSessionTx(tx: TenantTx, p: PortalPrincipal, sessionId: string) {
  const [row] = await tx
    .select({ s: sessions })
    .from(sessions)
    .innerJoin(
      sessionSpeakers,
      and(eq(sessionSpeakers.sessionId, sessions.id), eq(sessionSpeakers.speakerId, p.subjectId)),
    )
    .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, p.eventId)));
  if (!row) throw new DomainError('not_found');
  return row.s;
}

const profileOf = (s: typeof speakers.$inferSelect) => ({
  name: s.name,
  title: s.title,
  company: s.company,
  bio: s.bio,
  links: s.links as { label: string; url: string }[],
});
const sessionFieldsOf = (s: typeof sessions.$inferSelect) => ({ title: s.title, description: s.description });

/** Replace the speaker's pending change for the same target (profile or one session). */
async function putPendingTx(
  tx: TenantTx,
  ctx: Ctx,
  row: {
    eventId: string;
    speakerId: string;
    sessionId: string | null;
    proposed: Record<string, unknown>;
    base: Record<string, unknown>;
    photoFileId: string | null;
    submittedBy: string;
  },
): Promise<{ id: string; carriedPhoto: string | null }> {
  const target = row.sessionId
    ? eq(speakerChanges.sessionId, row.sessionId)
    : sql`${speakerChanges.sessionId} is null`;
  const [old] = await tx
    .update(speakerChanges)
    .set({ status: 'superseded', decidedAt: ctx.now, updatedAt: ctx.now })
    .where(and(eq(speakerChanges.speakerId, row.speakerId), eq(speakerChanges.status, 'pending'), target))
    .returning({ photoFileId: speakerChanges.photoFileId });
  const [created] = await tx
    .insert(speakerChanges)
    .values({ orgId: requireOrg(ctx), status: 'pending', ...row })
    .returning({ id: speakerChanges.id });
  if (!created) throw new DomainError('internal');
  return { id: created.id, carriedPhoto: old?.photoFileId ?? null };
}

/* ------------------------------------------------------------------- speaker side ---- */

/**
 * The speaker proposes profile changes. Nothing public changes until the organizer approves; a
 * pending photo proposal is kept when only the text changes.
 */
export const proposeProfileChangeCommand = tenantCommand({
  name: 'program.proposeProfileChange',
  input: ProfileProposalInput,
  output: ProposalResult,
  entitlement: 'speakers',
  permission: 'portal:speaker',
  handler: async ({ input, ctx, tx }): Promise<ProposalResultDto> => {
    const { principal, speaker } = await speakerPrincipalTx(tx, ctx);
    const base = profileOf(speaker);
    const changed = changeDiff(PROFILE_FIELDS, base, input).map((c) => c.field);
    const [pendingPhoto] = await tx
      .select({ photoFileId: speakerChanges.photoFileId })
      .from(speakerChanges)
      .where(
        and(
          eq(speakerChanges.speakerId, speaker.id),
          eq(speakerChanges.status, 'pending'),
          sql`${speakerChanges.sessionId} is null`,
        ),
      );
    const photo = pendingPhoto?.photoFileId ?? null;
    if (changed.length === 0 && !photo)
      throw new DomainError('validation_failed', 'Nothing changed', { reason: 'no_change' });
    const r = await putPendingTx(tx, ctx, {
      eventId: principal.eventId,
      speakerId: speaker.id,
      sessionId: null,
      proposed: changedValues(PROFILE_FIELDS, base, input),
      base,
      photoFileId: photo,
      submittedBy: principal.accountId,
    });
    return { changeId: r.id, changed };
  },
  audit: (_input, r) => ({
    action: 'program.speaker_change.propose',
    targetType: 'speaker_change',
    targetId: r.changeId,
    data: { fields: r.changed },
  }),
});

export const proposeSessionChangeCommand = tenantCommand({
  name: 'program.proposeSessionChange',
  input: SessionProposalInput,
  output: ProposalResult,
  entitlement: 'speakers',
  permission: 'portal:speaker',
  handler: async ({ input, ctx, tx }): Promise<ProposalResultDto> => {
    const { principal, speaker } = await speakerPrincipalTx(tx, ctx);
    const session = await ownSessionTx(tx, principal, input.sessionId);
    const base = sessionFieldsOf(session);
    const proposed = { title: input.title, description: input.description };
    const changed = changeDiff(SESSION_FIELDS, base, proposed).map((c) => c.field);
    if (changed.length === 0)
      throw new DomainError('validation_failed', 'Nothing changed', { reason: 'no_change' });
    const r = await putPendingTx(tx, ctx, {
      eventId: principal.eventId,
      speakerId: speaker.id,
      sessionId: session.id,
      proposed: changedValues(SESSION_FIELDS, base, proposed),
      base,
      photoFileId: null,
      submittedBy: principal.accountId,
    });
    return { changeId: r.id, changed };
  },
  audit: (input, r) => ({
    action: 'program.speaker_change.propose',
    targetType: 'speaker_change',
    targetId: r.changeId,
    data: { sessionId: input.sessionId, fields: r.changed },
  }),
});

/**
 * A proposed photo (media stored the file, checked as an image): attach it to the speaker's
 * pending profile change, creating one when there is none. Called by media's portal upload
 * command inside its transaction, after `speakerPrincipalTx`.
 */
export async function proposeSpeakerPhotoTx(
  tx: TenantTx,
  ctx: Ctx,
  fileId: string,
): Promise<{ changeId: string; replacedFileId: string | null }> {
  const { principal, speaker } = await speakerPrincipalTx(tx, ctx);
  const [pending] = await tx
    .select()
    .from(speakerChanges)
    .where(
      and(
        eq(speakerChanges.speakerId, speaker.id),
        eq(speakerChanges.status, 'pending'),
        sql`${speakerChanges.sessionId} is null`,
      ),
    );
  if (pending) {
    await tx
      .update(speakerChanges)
      .set({ photoFileId: fileId, updatedAt: ctx.now })
      .where(eq(speakerChanges.id, pending.id));
    return { changeId: pending.id, replacedFileId: pending.photoFileId };
  }
  const base = profileOf(speaker);
  const r = await putPendingTx(tx, ctx, {
    eventId: principal.eventId,
    speakerId: speaker.id,
    sessionId: null,
    proposed: {},
    base,
    photoFileId: fileId,
    submittedBy: principal.accountId,
  });
  return { changeId: r.id, replacedFileId: null };
}

/* ------------------------------------------------------------------ organizer side ---- */

export const inviteSpeakerCommand = tenantCommand({
  name: 'program.inviteSpeaker',
  input: z.object({
    eventId: z.uuid(),
    speakerId: z.uuid(),
    email: z.email().trim().toLowerCase().max(254),
  }),
  output: z.object({ accountId: z.uuid(), status: z.string() }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await eventOf(tx, input.eventId);
    const [speaker] = await tx
      .select({ id: speakers.id })
      .from(speakers)
      .where(and(eq(speakers.id, input.speakerId), eq(speakers.eventId, input.eventId)));
    if (!speaker) throw new DomainError('not_found');
    const r = await createPortalAccountTx(tx, ctx, {
      eventId: input.eventId,
      role: 'speaker',
      subjectId: speaker.id,
      email: input.email,
    });
    emit(r.event);
    return { accountId: r.account.id, status: r.account.status };
  },
  // No address in the audit row: the account id is enough to find it.
  audit: (input, r) => ({
    action: 'program.speaker.portal_invite',
    targetType: 'event',
    targetId: input.eventId,
    data: { speakerId: input.speakerId, accountId: r.accountId },
  }),
});

export const revokeSpeakerAccessCommand = tenantCommand({
  name: 'program.revokeSpeakerAccess',
  input: z.object({ eventId: z.uuid(), accountId: z.uuid() }),
  output: z.object({ revoked: z.boolean() }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await revokePortalAccountTx(tx, ctx, { ...input, subjectKind: 'speaker' });
    return { revoked: true };
  },
  audit: (input) => ({
    action: 'program.speaker.portal_revoke',
    targetType: 'event',
    targetId: input.eventId,
    data: { accountId: input.accountId },
  }),
});

/** Every speaker's portal accounts (the organizer's access panel). */
export const speakerAccessQuery = tenantQuery({
  name: 'program.speakerAccess',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(SpeakerAccessDto),
  entitlement: 'speakers',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const accounts = await portalAccountsTx(tx, input.eventId, 'speaker', ctx.now);
    const ids = [...new Set(accounts.map((a) => a.subjectId))];
    return ids.map((speakerId) => ({
      speakerId,
      accounts: accounts.filter((a) => a.subjectId === speakerId),
    }));
  },
});

type ChangeRow = typeof speakerChanges.$inferSelect;

async function changeDtos(tx: TenantTx, rows: readonly ChangeRow[]): Promise<SpeakerChangeDto[]> {
  if (rows.length === 0) return [];
  const speakerRows = await tx
    .select()
    .from(speakers)
    .where(inArray(speakers.id, [...new Set(rows.map((r) => r.speakerId))]));
  const sessionIds = [...new Set(rows.flatMap((r) => (r.sessionId ? [r.sessionId] : [])))];
  const sessionRows = sessionIds.length
    ? await tx.select().from(sessions).where(inArray(sessions.id, sessionIds))
    : [];
  return rows.map((r) => {
    const sp = speakerRows.find((s) => s.id === r.speakerId);
    const se = r.sessionId ? sessionRows.find((s) => s.id === r.sessionId) : undefined;
    const fields = r.sessionId ? SESSION_FIELDS : PROFILE_FIELDS;
    const base = r.base as Record<string, unknown>;
    const proposed = r.proposed as Record<string, unknown>;
    const current = se ? sessionFieldsOf(se) : sp ? profileOf(sp) : {};
    return SpeakerChangeDto.parse({
      id: r.id,
      speakerId: r.speakerId,
      speakerName: sp?.name ?? '',
      sessionId: r.sessionId,
      sessionTitle: se?.title ?? null,
      status: r.status,
      changes: changeDiff(fields, base, proposed),
      photoFileId: r.photoFileId,
      stale: r.status === 'pending' ? staleFields(fields, base, proposed, current) : [],
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      note: r.note,
    });
  });
}

/** Pending changes first (oldest first), then the 50 most recent decisions. */
export const speakerChangesQuery = tenantQuery({
  name: 'program.speakerChanges',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ pending: z.array(SpeakerChangeDto), decided: z.array(SpeakerChangeDto) }),
  entitlement: 'speakers',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    await eventOf(tx, input.eventId);
    const pending = await tx
      .select()
      .from(speakerChanges)
      .where(and(eq(speakerChanges.eventId, input.eventId), eq(speakerChanges.status, 'pending')))
      .orderBy(asc(speakerChanges.createdAt));
    const decided = await tx
      .select()
      .from(speakerChanges)
      .where(
        and(
          eq(speakerChanges.eventId, input.eventId),
          ne(speakerChanges.status, 'pending'),
          ne(speakerChanges.status, 'superseded'),
        ),
      )
      .orderBy(desc(speakerChanges.decidedAt))
      .limit(50);
    return { pending: await changeDtos(tx, pending), decided: await changeDtos(tx, decided) };
  },
});

/** `program.speaker_change.decided@1`: media applies an approved photo to the speaker. */
export function speakerChangeDecided(c: {
  id: string;
  eventId: string;
  speakerId: string;
  decision: 'approved' | 'rejected';
  photoFileId: string | null;
}): DomainEvent {
  return {
    type: 'program.speaker_change.decided',
    version: 1,
    aggregateType: 'speaker_change',
    aggregateId: c.id,
    payload: {
      changeId: c.id,
      eventId: c.eventId,
      speakerId: c.speakerId,
      decision: c.decision,
      photoFileId: c.photoFileId,
    },
  };
}

/**
 * Approve or reject a pending change. Approval writes only the changed fields (sanitized again)
 * to the speaker or session and is refused when the organizer changed one of them since the
 * proposal (`stale`), so an approval never silently overwrites an edit. Audited with the fields.
 */
export const decideSpeakerChangeCommand = tenantCommand({
  name: 'program.decideSpeakerChange',
  input: z.object({
    eventId: z.uuid(),
    changeId: z.uuid(),
    decision: z.enum(['approve', 'reject']),
    note: Text(500),
  }),
  output: z.object({ status: z.enum(['approved', 'rejected']), fields: z.array(z.string()) }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const [row] = await tx
      .select()
      .from(speakerChanges)
      .where(and(eq(speakerChanges.id, input.changeId), eq(speakerChanges.eventId, input.eventId)))
      .for('update');
    if (!row) throw new DomainError('not_found');
    if (row.status !== 'pending')
      throw new DomainError('invalid_state', 'Already decided', { reason: 'already_decided' });
    const fields = row.sessionId ? SESSION_FIELDS : PROFILE_FIELDS;
    const base = row.base as Record<string, unknown>;
    const proposed = row.proposed as Record<string, unknown>;
    const values = changedValues(fields, base, proposed);
    if (input.decision === 'approve') {
      if (row.sessionId) {
        const [se] = await tx.select().from(sessions).where(eq(sessions.id, row.sessionId));
        if (!se) throw new DomainError('not_found');
        if (staleFields(fields, base, proposed, sessionFieldsOf(se)).length > 0)
          throw new DomainError('conflict', 'Changed since', { reason: 'stale' });
        const v = SessionProposalInput.partial().omit({ sessionId: true }).parse(values);
        if (Object.keys(v).length)
          await tx
            .update(sessions)
            .set({ ...v, updatedAt: ctx.now })
            .where(eq(sessions.id, se.id));
      } else {
        const [sp] = await tx.select().from(speakers).where(eq(speakers.id, row.speakerId));
        if (!sp) throw new DomainError('not_found');
        if (staleFields(fields, base, proposed, profileOf(sp)).length > 0)
          throw new DomainError('conflict', 'Changed since', { reason: 'stale' });
        const v = ProfileProposalInput.partial().parse(values);
        if (Object.keys(v).length)
          await tx
            .update(speakers)
            .set({ ...v, updatedAt: ctx.now })
            .where(eq(speakers.id, sp.id));
      }
    }
    const status = input.decision === 'approve' ? 'approved' : 'rejected';
    await tx
      .update(speakerChanges)
      .set({
        status,
        decidedAt: ctx.now,
        decidedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        note: input.note,
        updatedAt: ctx.now,
      })
      .where(eq(speakerChanges.id, row.id));
    emit(
      speakerChangeDecided({
        id: row.id,
        eventId: row.eventId,
        speakerId: row.speakerId,
        decision: status,
        photoFileId: row.photoFileId,
      }),
    );
    return { status, fields: [...Object.keys(values), ...(row.photoFileId ? ['photo'] : [])] } as const;
  },
  audit: (input, r) => ({
    action: `program.speaker_change.${r.status === 'approved' ? 'approve' : 'reject'}`,
    targetType: 'speaker_change',
    targetId: input.changeId,
    data: { eventId: input.eventId, fields: r.fields },
  }),
});

/* ----------------------------------------------------------------- the portal page ---- */

export async function portalChangeSummaries(tx: TenantTx, speakerId: string) {
  // The latest change per target, pending or decided (the speaker sees the outcome).
  const rows = await tx
    .select()
    .from(speakerChanges)
    .where(and(eq(speakerChanges.speakerId, speakerId), ne(speakerChanges.status, 'superseded')))
    .orderBy(desc(speakerChanges.createdAt));
  const latest = new Map<string, ChangeRow>();
  for (const r of rows) {
    const key = r.sessionId ?? 'profile';
    if (!latest.has(key)) latest.set(key, r);
  }
  const summary = (r: ChangeRow | undefined) =>
    r
      ? {
          id: r.id,
          status: r.status as ChangeRow['status'],
          changes: changeDiff(
            r.sessionId ? SESSION_FIELDS : PROFILE_FIELDS,
            r.base as Record<string, unknown>,
            r.proposed as Record<string, unknown>,
          ),
          hasPhoto: r.photoFileId !== null,
          note: r.note,
          createdAt: r.createdAt,
          decidedAt: r.decidedAt,
        }
      : null;
  return { of: (key: string) => summary(latest.get(key)) };
}
