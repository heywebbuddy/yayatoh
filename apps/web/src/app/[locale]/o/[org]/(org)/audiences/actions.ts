'use server';

import { suggestAudience } from '@yayatoh/ai';
import {
  AUDIENCE_EXPORT_COLUMNS,
  type AudiencePreviewDto,
  audienceExportBulk,
  CONSENT_WORDS,
  deleteSegmentCommand,
  previewAudienceQuery,
  saveSegmentCommand,
} from '@yayatoh/audiences';
import { SegmentDefinition } from '@yayatoh/audiences/client';
import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import type { AudienceSuggestion } from '@/components/audience-ai-panel.tsx';
import { redirect } from '@/i18n/navigation.ts';
import type { AiComposeResult } from '@/lib/ai-compose.ts';
import { aiDrafter } from '@/server/ai.ts';
import { aiCall } from '@/server/ai-compose.ts';
import { runBulkInline } from '@/server/bulk.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type PreviewResult =
  | { readonly ok: true; readonly preview: AudiencePreviewDto }
  | { readonly ok: false; readonly code: string };

const parseDefinition = (json: string) => {
  try {
    return SegmentDefinition.safeParse(JSON.parse(json));
  } catch {
    return SegmentDefinition.safeParse(null);
  }
};

/** The builder's live count and first matches (allowlisted fields only). */
export async function previewAudienceAction(org: string, definitionJson: string): Promise<PreviewResult> {
  const data = await loadConsole(org);
  const def = parseDefinition(definitionJson);
  if (!def.success) return { ok: false, code: 'validation_failed' };
  try {
    const preview = await executeQuery(
      previewAudienceQuery,
      { definition: def.data, limit: 10 },
      data.ctx,
      ports,
    );
    return { ok: true, preview };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { ok: false, code: err.code };
  }
}

/** A chosen event's ticket types (the builder loads them when an event is picked). */
export async function eventTicketTypesAction(
  org: string,
  eventId: string,
): Promise<{ id: string; name: string }[]> {
  const data = await loadConsole(org);
  if (!/^[0-9a-f-]{36}$/.test(eventId)) return [];
  try {
    const types = await executeQuery(listTicketTypesQuery, { eventId }, data.ctx, ports);
    return types.map((t) => ({ id: t.id, name: t.name }));
  } catch (err) {
    if (isDomainError(err)) return [];
    throw err;
  }
}

export interface SaveAudienceState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly field?: string;
}

export async function saveAudienceAction(
  org: string,
  segmentId: string | null,
  _prev: SaveAudienceState,
  form: FormData,
): Promise<SaveAudienceState> {
  const data = await loadConsole(org);
  const def = parseDefinition(String(form.get('definition') ?? ''));
  if (!def.success) return { ok: false, code: 'validation_failed', field: 'definition' };
  let id: string;
  try {
    ({ id } = await executeCommand(
      saveSegmentCommand,
      { segmentId, name: String(form.get('name') ?? ''), definition: def.data },
      data.ctx,
      ports,
    ));
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const issue = Array.isArray(err.details?.issues)
      ? (err.details.issues[0] as { path?: string } | undefined)
      : undefined;
    const field = typeof err.details?.field === 'string' ? err.details.field : issue?.path;
    return field ? { ok: false, code: err.code, field: String(field) } : { ok: false, code: err.code };
  }
  revalidatePath(`/o/${org}/audiences`);
  redirect({ href: `/o/${org}/audiences/${id}?saved=1`, locale: await getLocale() });
  return { ok: true, code: null };
}

export async function deleteAudienceAction(org: string, segmentId: string): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(deleteSegmentCommand, { segmentId }, data.ctx, ports);
  revalidatePath(`/o/${org}/audiences`);
  redirect({ href: `/o/${org}/audiences`, locale: await getLocale() });
}

/**
 * Export a saved audience as CSV through the bulk-export path (step-up, audit, never while staff
 * act as a member). Small exports finish in this request; the page then offers the download.
 */
export async function exportAudienceAction(org: string, segmentId: string): Promise<{ code: string | null }> {
  const data = await loadConsole(org);
  const t = await getTranslations('audiences.exportColumns');
  let operationId: string;
  try {
    ({ operationId } = await executeCommand(
      audienceExportBulk.start,
      {
        selection: { filter: { segmentId } },
        params: {
          headers: Object.fromEntries(AUDIENCE_EXPORT_COLUMNS.map((c) => [c, t(c)])),
          consent: Object.fromEntries(CONSENT_WORDS.map((c) => [c, t(`consent.${c}`)])),
        },
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { code: err.code };
  }
  await runBulkInline(data.org.id, operationId);
  redirect({ href: `/o/${org}/audiences/${segmentId}?export=${operationId}`, locale: await getLocale() });
  return { code: null };
}

/** M6.12b: suggest an audience with AI (a segment to review in the builder; nothing is saved). */
export async function suggestAudienceAction(
  org: string,
  brief: unknown,
): Promise<AiComposeResult<AudienceSuggestion>> {
  const data = await loadConsole(org);
  return aiCall({ orgId: data.org.id, userId: data.session.userId, key: 'audience' }, async () => {
    const res = await suggestAudience(data.ctx, ports, aiDrafter(), {
      brief: typeof brief === 'string' ? brief : '',
      locale: await getLocale(),
    });
    return {
      value: { explanation: res.explanation, definition: res.definition, count: res.count },
      balance: res.balance,
    };
  });
}
