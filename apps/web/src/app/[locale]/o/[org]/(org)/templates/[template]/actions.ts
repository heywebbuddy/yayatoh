'use server';

import { SECTION_KINDS, type SectionKind } from '@yayatoh/events';
import { executeCommand, moneyFromDecimal } from '@yayatoh/kernel';
import {
  addTemplateChecklistItemCommand,
  addTemplateSectionCommand,
  addTemplateTicketTypeCommand,
  moveTemplateSectionCommand,
  removeTemplateChecklistItemCommand,
  removeTemplateSectionCommand,
  removeTemplateTicketTypeCommand,
  updateTemplateCommand,
} from '@yayatoh/templates';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';
import { sectionContentFrom, sectionTextError } from '@/server/section-content.ts';

/**
 * U6 template builder: each part of a template (settings, ticket types, page sections and
 * checklist) is edited on its own form; every change is one command on the stored snapshot.
 */

const done = (org: string, id: string) => {
  revalidatePath(`/o/${org}/templates/${id}`);
  revalidatePath(`/o/${org}/templates`);
};

const text = (form: FormData, key: string) => String(form.get(key) ?? '');

export async function updateTemplateAction(
  org: string,
  templateId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  const hours = Number(text(form, 'hours').trim() || '0');
  const minutes = Number(text(form, 'minutes').trim() || '0');
  try {
    await executeCommand(
      updateTemplateCommand,
      {
        templateId,
        name: text(form, 'name'),
        description: textOrNull(form, 'description'),
        visibility: text(form, 'visibility'),
        timezone: text(form, 'timezone'),
        currency: text(form, 'currency'),
        durationMinutes: hours * 60 + minutes,
        tagline: textOrNull(form, 'tagline'),
        venueName: textOrNull(form, 'venueName'),
        city: textOrNull(form, 'city'),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    const f = failure(err);
    return f.fields?.includes('durationMinutes') ? { ...f, fields: [...f.fields, 'duration'] } : f;
  }
  done(org, templateId);
  return success();
}

export async function addTicketTypeAction(
  org: string,
  templateId: string,
  currency: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  let priceMinor: number;
  try {
    priceMinor = moneyFromDecimal(text(form, 'price').trim() || '0', currency).amount;
  } catch {
    return { ok: false, code: 'validation_failed', fields: ['price'] };
  }
  try {
    await executeCommand(
      addTemplateTicketTypeCommand,
      {
        templateId,
        name: text(form, 'name'),
        description: textOrNull(form, 'description'),
        priceMinor,
        quantityTotal: Number(text(form, 'quantity').trim() || 'NaN'),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    const f = failure(err);
    return f.fields?.includes('quantityTotal') ? { ...f, fields: [...f.fields, 'quantity'] } : f;
  }
  done(org, templateId);
  return success();
}

export async function removeTicketTypeAction(org: string, templateId: string, key: string): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(removeTemplateTicketTypeCommand, { templateId, key }, data.ctx, ports);
  done(org, templateId);
}

export async function addSectionAction(
  org: string,
  templateId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  const kind = text(form, 'kind') as SectionKind;
  if (!SECTION_KINDS.includes(kind)) return { ok: false, code: 'validation_failed', fields: ['kind'] };
  try {
    await executeCommand(
      addTemplateSectionCommand,
      { templateId, kind, title: text(form, 'title'), content: sectionContentFrom(kind, form) },
      data.ctx,
      ports,
    );
  } catch (err) {
    return sectionTextError(err) ?? failure(err);
  }
  done(org, templateId);
  return success();
}

export async function removeSectionAction(org: string, templateId: string, index: number): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(removeTemplateSectionCommand, { templateId, index }, data.ctx, ports);
  done(org, templateId);
}

export async function moveSectionAction(
  org: string,
  templateId: string,
  index: number,
  direction: 'up' | 'down',
): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(moveTemplateSectionCommand, { templateId, index, direction }, data.ctx, ports);
  done(org, templateId);
}

export async function addChecklistItemAction(
  org: string,
  templateId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      addTemplateChecklistItemCommand,
      { templateId, title: text(form, 'title') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, templateId);
  return success();
}

export async function removeChecklistItemAction(
  org: string,
  templateId: string,
  index: number,
): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(removeTemplateChecklistItemCommand, { templateId, index }, data.ctx, ports);
  done(org, templateId);
}
