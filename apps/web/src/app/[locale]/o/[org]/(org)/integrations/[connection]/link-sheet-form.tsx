'use client';

import { Alert, Button, Card, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { LinkSheetState } from '../connector-actions.ts';

/**
 * Link an event's attendee list to a new Google Sheet (M6.4b): pick the event, then the sheet is
 * created with the mapping's columns and filled by the next sync. Validation is inline.
 */
export function LinkSheetForm({
  events,
  action,
}: {
  events: readonly { id: string; label: string }[];
  action: (prev: LinkSheetState, form: FormData) => Promise<LinkSheetState>;
}) {
  const t = useTranslations('integrations.sheets');
  const tErr = useTranslations('integrations.errorsFeedback');
  const [state, formAction, pending] = useActionState(action, { status: 'idle' } as LinkSheetState);
  const [event, setEvent] = useState('');
  const inline = state.status === 'error' && state.code === 'choose_event';
  const general =
    state.status === 'error' && !inline
      ? state.code === 'already_linked'
        ? t('alreadyLinked')
        : tErr.has(state.code ?? '')
          ? tErr(state.code ?? 'internal')
          : tErr('internal')
      : null;
  return (
    <Card className="flex flex-col gap-3">
      <form
        action={formAction}
        aria-labelledby="link-sheet-heading"
        className="flex flex-col gap-3"
        noValidate
      >
        <h3 id="link-sheet-heading" className="m-0 text-body font-bold">
          {t('linkTitle')}
        </h3>
        <div aria-live="polite" className="empty:hidden">
          {general ? <Alert tone="danger" title={general} /> : null}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            id="sheet-event"
            name="event"
            label={t('event')}
            value={event}
            onValueChange={setEvent}
            error={inline ? t('chooseEvent') : undefined}
          >
            <option value="" hidden>
              {t('pickEvent')}
            </option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={pending}>
            {pending ? t('linking') : t('link')}
          </Button>
        </div>
        <p className="m-0 text-caption text-ink-2">{t('linkHelp')}</p>
      </form>
    </Card>
  );
}
