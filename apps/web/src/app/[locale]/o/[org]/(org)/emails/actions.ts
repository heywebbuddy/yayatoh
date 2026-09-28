'use server';

import { LOCALES } from '@yayatoh/contracts';
import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  checkOverrideCopy,
  EMAIL_KINDS,
  type MessageKind,
  previewTemplateQuery,
  setTemplateOverrideCommand,
  storeEmailPreviewCommand,
} from '@yayatoh/notifications';
import { revalidatePath } from 'next/cache';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type TemplateField = 'subject' | 'intro';
export type TemplateProblem = 'invalid_syntax' | 'unknown_placeholder' | 'too_long';

export interface TemplateEditorState {
  readonly saved: 'saved' | 'reset' | null;
  readonly errors: Partial<Record<TemplateField, TemplateProblem>>;
  readonly code: string | null;
  readonly values: { readonly subject: string; readonly intro: string };
}

export interface TemplatePreview {
  readonly src: string | null;
  readonly subject: string | null;
  readonly errors: Partial<Record<TemplateField, TemplateProblem>>;
}

const LIMITS: Record<TemplateField, number> = { subject: 200, intro: 2000 };

function target(
  kind: string,
  locale: string,
): { kind: MessageKind; locale: (typeof LOCALES)[number] } | null {
  return (EMAIL_KINDS as readonly string[]).includes(kind) && (LOCALES as readonly string[]).includes(locale)
    ? { kind: kind as MessageKind, locale: locale as (typeof LOCALES)[number] }
    : null;
}

/** The same checks the command makes, run as the person types (ICU syntax, placeholders, length). */
function problems(kind: MessageKind, locale: string, values: Record<TemplateField, string>) {
  const errors: Partial<Record<TemplateField, TemplateProblem>> = {};
  for (const field of ['subject', 'intro'] as const) {
    const copy = values[field].trim();
    if (!copy) continue;
    if (copy.length > LIMITS[field]) errors[field] = 'too_long';
    else {
      const p = checkOverrideCopy(kind, locale, copy);
      if (p === 'invalid_syntax' || p === 'unknown_placeholder') errors[field] = p;
    }
  }
  return errors;
}

/**
 * Live preview of the draft (or the saved copy): rendered with sample data and the org's brand,
 * stored for ten minutes and framed from its own URL (its own CSP, M1.10d). Invalid copy is not
 * rendered; its problems come back instead.
 */
export async function previewTemplateAction(
  org: string,
  kind: string,
  locale: string,
  subject: string,
  intro: string,
): Promise<TemplatePreview> {
  const data = await loadConsole(org);
  const t = target(kind, locale);
  if (!t) return { src: null, subject: null, errors: {} };
  const values = { subject: String(subject).slice(0, 5000), intro: String(intro).slice(0, 5000) };
  const errors = problems(t.kind, t.locale, values);
  if (Object.keys(errors).length) return { src: null, subject: null, errors };
  const r = await executeQuery(
    previewTemplateQuery,
    { ...t, subject: values.subject.trim() || null, intro: values.intro.trim() || null },
    data.ctx,
    ports,
  );
  const stored = await executeCommand(storeEmailPreviewCommand, { html: r.html }, data.ctx, ports);
  return { src: `/api/email-preview/${data.org.slug}/${stored.id}`, subject: r.subject, errors: {} };
}

/** Save the org's subject and opening paragraph for one kind and language, or reset to the default. */
export async function saveTemplateAction(
  org: string,
  kind: string,
  locale: string,
  _prev: TemplateEditorState,
  form: FormData,
): Promise<TemplateEditorState> {
  const data = await loadConsole(org);
  const reset = form.get('intent') === 'reset';
  const values = reset
    ? { subject: '', intro: '' }
    : { subject: String(form.get('subject') ?? ''), intro: String(form.get('intro') ?? '') };
  const t = target(kind, locale);
  if (!t) return { saved: null, errors: {}, code: 'not_found', values };
  const errors = problems(t.kind, t.locale, values);
  if (Object.keys(errors).length) return { saved: null, errors, code: 'validation_failed', values };
  try {
    await executeCommand(
      setTemplateOverrideCommand,
      { ...t, subject: values.subject.trim() || null, intro: values.intro.trim() || null },
      data.ctx,
      ports,
    );
  } catch (err) {
    if (isDomainError(err) && err.code === 'validation_failed') {
      const field = err.details?.field as TemplateField | undefined;
      const reason = err.details?.reason as TemplateProblem | undefined;
      if (field && reason) return { saved: null, errors: { [field]: reason }, code: err.code, values };
    }
    return { saved: null, errors: {}, code: isDomainError(err) ? err.code : 'internal', values };
  }
  revalidatePath(`/o/${org}/emails`);
  return { saved: reset ? 'reset' : 'saved', errors: {}, code: null, values };
}
