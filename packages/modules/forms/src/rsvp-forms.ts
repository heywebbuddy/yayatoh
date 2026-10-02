import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { keyVault } from '@yayatoh/platform';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { writeVersionTx } from './forms.ts';
import { RSVP_FORM_KIND, RsvpFormDefinition } from './rsvp.ts';
import { formResponses, forms, formVersions } from './schema.ts';

/**
 * Storage of the `rsvp` kind (M4.1e). The guests module owns the flow (who is invited, attending,
 * the menu, the write-back to the guest) and calls these in its own commands' transactions: one
 * form per event, immutable versions, one response per guest (the newest answer replaces the
 * guest's earlier one, on whichever version it was given). Answers that are written back to the
 * guest (meal, dietary, accessibility) are not stored here; private answers are one KeyVault
 * envelope per response.
 */

const subjectOf = (eventId: string) =>
  ({ kind: RSVP_FORM_KIND, subjectType: 'event', subjectId: eventId }) as const;

/** The event's current RSVP questions (null: never published), in the caller's transaction. */
export async function currentRsvpFormTx(tx: TenantTx, eventId: string) {
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
  return row ? { ...row, definition: RsvpFormDefinition.parse(row.definition) } : null;
}

/**
 * Publish the next version of an event's RSVP questions (the caller checked the sub-events and
 * the menu). `expectedVersion`: the version the editor started from (0: none); a publish from an
 * older one is a `conflict` (`stale_version`).
 */
export async function publishRsvpFormTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  definition: RsvpFormDefinition,
  expectedVersion?: number,
): Promise<{ version: number; formId: string; versionId: string }> {
  return writeVersionTx(tx, ctx, subjectOf(eventId), RsvpFormDefinition.parse(definition), expectedVersion);
}

export interface RsvpResponse {
  readonly guestId: string;
  readonly version: number;
  readonly answers: Record<string, unknown>;
  /** Private answers (decrypted only when asked for). */
  readonly secret: Record<string, unknown>;
  readonly at: Date;
}

/**
 * The newest response of each of these guests to the event's RSVP questions. Private answers
 * are decrypted only with `secret: true` (the host's console and the private export); the party's
 * page never asks for them.
 */
export async function rsvpResponsesTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  guestIds: readonly string[],
  opts: { secret: boolean },
): Promise<Map<string, RsvpResponse>> {
  const out = new Map<string, RsvpResponse>();
  if (guestIds.length === 0) return out;
  const s = subjectOf(eventId);
  const rows = await tx
    .select({
      guestId: formResponses.respondentId,
      version: formVersions.version,
      answers: formResponses.answers,
      sensitiveCiphertext: formResponses.sensitiveCiphertext,
      at: formResponses.updatedAt,
    })
    .from(formResponses)
    .innerJoin(formVersions, eq(formVersions.id, formResponses.formVersionId))
    .innerJoin(forms, eq(forms.id, formVersions.formId))
    .where(
      and(
        eq(forms.kind, s.kind),
        eq(forms.subjectType, s.subjectType),
        eq(forms.subjectId, s.subjectId),
        eq(formResponses.respondentType, 'guest'),
        inArray(formResponses.respondentId, [...guestIds]),
      ),
    )
    .orderBy(desc(formVersions.version));
  const orgId = requireOrg(ctx);
  for (const r of rows) {
    if (out.has(r.guestId)) continue;
    const secret =
      opts.secret && r.sensitiveCiphertext
        ? (JSON.parse(
            new TextDecoder().decode(await keyVault().decrypt(orgId, r.sensitiveCiphertext)),
          ) as Record<string, unknown>)
        : {};
    out.set(r.guestId, {
      guestId: r.guestId,
      version: r.version,
      answers: r.answers as Record<string, unknown>,
      secret,
      at: r.at,
    });
  }
  return out;
}

/** Which of these guests have private answers stored (the page says "you told us already"). */
export async function rsvpSealedKeysTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  guestIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const all = await rsvpResponsesTx(tx, ctx, eventId, guestIds, { secret: true });
  return new Map([...all].map(([id, r]) => [id, new Set(Object.keys(r.secret))]));
}

/**
 * Replace these guests' responses with their new answers on the given version: `open` stored as
 * JSON, `secret` sealed in one envelope. A guest with no answer at all keeps no response.
 */
export async function replaceRsvpResponsesTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  versionId: string,
  entries: readonly {
    guestId: string;
    open: Record<string, unknown>;
    secret: Record<string, unknown>;
  }[],
): Promise<void> {
  if (entries.length === 0) return;
  const orgId = requireOrg(ctx);
  await deleteRsvpResponsesTx(
    tx,
    eventId,
    entries.map((e) => e.guestId),
  );
  const rows = [];
  for (const e of entries) {
    if (Object.keys(e.open).length === 0 && Object.keys(e.secret).length === 0) continue;
    rows.push({
      orgId,
      formVersionId: versionId,
      respondentType: 'guest',
      respondentId: e.guestId,
      answers: e.open,
      sensitiveCiphertext: Object.keys(e.secret).length
        ? await keyVault().encrypt(orgId, new TextEncoder().encode(JSON.stringify(e.secret)))
        : null,
    });
  }
  if (rows.length) await tx.insert(formResponses).values(rows);
}

/** Delete these guests' RSVP answers (the guest left the list, or answered again). */
export async function deleteRsvpResponsesTx(
  tx: TenantTx,
  eventId: string,
  guestIds: readonly string[],
): Promise<number> {
  if (guestIds.length === 0) return 0;
  const f = await tx
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.kind, RSVP_FORM_KIND), eq(forms.subjectType, 'event'), eq(forms.subjectId, eventId)));
  const formId = f[0]?.id;
  if (!formId) return 0;
  const versions = (
    await tx.select({ id: formVersions.id }).from(formVersions).where(eq(formVersions.formId, formId))
  ).map((v) => v.id);
  if (versions.length === 0) return 0;
  const gone = await tx
    .delete(formResponses)
    .where(
      and(
        eq(formResponses.respondentType, 'guest'),
        inArray(formResponses.respondentId, [...guestIds]),
        inArray(formResponses.formVersionId, versions),
      ),
    )
    .returning({ id: formResponses.id });
  return gone.length;
}

/** Every version's questions, newest first (the export labels questions only older ones had). */
export async function rsvpFormVersionsTx(tx: TenantTx, eventId: string) {
  const rows = await tx
    .select({ version: formVersions.version, definition: formVersions.definition })
    .from(formVersions)
    .innerJoin(forms, eq(forms.id, formVersions.formId))
    .where(and(eq(forms.kind, RSVP_FORM_KIND), eq(forms.subjectType, 'event'), eq(forms.subjectId, eventId)))
    .orderBy(desc(formVersions.version));
  return rows.map((r) => {
    const parsed = RsvpFormDefinition.safeParse(r.definition);
    if (!parsed.success) throw new DomainError('internal', 'Stored RSVP questions are invalid');
    return { version: r.version, definition: parsed.data };
  });
}
