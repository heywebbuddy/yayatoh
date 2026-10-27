import 'server-only';
import {
  parseFaqText,
  parseLinksText,
  parseScheduleText,
  type SectionKind,
  SectionTextError,
} from '@yayatoh/events';
import type { FormState } from '@/lib/form-state.ts';
import { textOrNull } from './form.ts';

/**
 * A page section's content from its form (list-shaped kinds are edited as plain text): the event
 * content page (M1.4d) and the template builder (U6) share it.
 */
/** The structured row editors post their content as one JSON field (`payload`). */
function payload(form: FormData): unknown {
  const raw = form.get('payload');
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function sectionContentFrom(kind: SectionKind, form: FormData): unknown {
  const text = (k: string) => String(form.get(k) ?? '');
  switch (kind) {
    case 'text':
      return { markdown: text('markdown') };
    case 'video':
      return payload(form) ?? { url: text('url'), caption: textOrNull(form, 'caption') };
    case 'faq':
      return payload(form) ?? { items: parseFaqText(text('faq')) };
    case 'schedule':
      return payload(form) ?? { items: parseScheduleText(text('schedule')) };
    case 'links':
      return payload(form) ?? { items: parseLinksText(text('links')) };
    case 'location':
      return {
        address: text('address').trim(),
        directions: text('directions'),
        mapUrl: textOrNull(form, 'mapUrl'),
      };
  }
}

/** A line of list-shaped text that failed to parse, as the section form shows it. */
export function sectionTextError(err: unknown): FormState | null {
  return err instanceof SectionTextError
    ? { ok: false, code: 'validation_failed', fields: ['content'], reason: err.reason, line: err.line }
    : null;
}
