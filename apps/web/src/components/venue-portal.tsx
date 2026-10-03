'use client';

import { Alert, Button, Card, Input, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { UseSharedState } from '@/app/[locale]/o/[org]/(org)/seating-library/actions.ts';
import type { PartnerState } from '@/app/[locale]/o/[org]/(org)/venue-portal/actions.ts';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** Add a partner organizer by its address (M6.14b venue portal). */
export function PartnerForm({
  action,
}: {
  action: (prev: PartnerState, form: FormData) => Promise<PartnerState>;
}) {
  const t = useTranslations('venuePortal');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' } as PartnerState);
  const fieldError = state.kind === 'error' && state.reason ? t(`errors.${state.reason}`) : undefined;
  return (
    <Card className="flex flex-col gap-4">
      <h3 className="text-card">{t('addPartner')}</h3>
      <form action={formAction} noValidate className="flex flex-col gap-4">
        <Input
          name="slug"
          maxLength={120}
          autoComplete="off"
          spellCheck={false}
          label={t('partnerSlug')}
          hint={t('partnerSlugHint')}
          error={fieldError}
        />
        <div>
          <Button type="submit" disabled={pending}>
            {t('addPartnerSubmit')}
          </Button>
        </div>
      </form>
      <div aria-live="polite">
        {state.kind === 'added' ? (
          <Alert tone="success" title={t('added', { slug: state.slug })} />
        ) : state.kind === 'error' && !state.reason ? (
          <Alert title={tr(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Copy a venue's shared plan into one of the org's events (M6.14b, copy-on-use). The venue then
 * sees the event's name, date and status; the event keeps its own copy.
 */
export function UseSharedForm({
  org,
  plans,
  events,
  action,
}: {
  org: string;
  plans: readonly { readonly layoutId: string; readonly label: string }[];
  events: readonly { readonly id: string; readonly name: string }[];
  action: (prev: UseSharedState, form: FormData) => Promise<UseSharedState>;
}) {
  const t = useTranslations('seatingLibrary.shared');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' } as UseSharedState);
  const err = (f: 'layoutId' | 'eventId') =>
    state.kind === 'error' && state.field === f ? t(`errors.${f}`) : undefined;
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          name="layoutId"
          label={t('plan')}
          defaultValue={plans[0]?.layoutId ?? ''}
          error={err('layoutId')}
        >
          {plans.map((p) => (
            <option key={p.layoutId} value={p.layoutId}>
              {p.label}
            </option>
          ))}
        </Select>
        <Select name="eventId" label={t('event')} defaultValue="" error={err('eventId')}>
          <option value="">{t('chooseEvent')}</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
      </div>
      <p className="text-caption text-ink-2">{t('privacy')}</p>
      <div>
        <Button type="submit" disabled={pending}>
          {t('use')}
        </Button>
      </div>
      <div aria-live="polite">
        {state.kind === 'used' ? (
          <div className="flex flex-col gap-2">
            <Alert tone="success" title={t('used', { event: state.eventName, venue: state.venueName })} />
            <Link
              href={`/o/${org}/e/${state.eventSlug}/seating`}
              className="text-body underline underline-offset-2"
            >
              {t('openSeating', { event: state.eventName })}
            </Link>
          </div>
        ) : state.kind === 'error' && !state.field ? (
          <Alert
            title={
              state.reason && t.has(`errors.${state.reason}`)
                ? t(`errors.${state.reason}`)
                : tr(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
    </form>
  );
}
