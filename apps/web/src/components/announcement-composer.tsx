'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { ComposerState } from '@/app/[locale]/o/[org]/e/[event]/marketing/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const INITIAL: ComposerState = {
  step: 'edit',
  values: { subject: '', body: '', channels: ['email'] },
  errors: {},
  code: null,
};

/**
 * Compose → preview (the email as attendees will see it, and how many get it) → send. Errors sit
 * next to their fields; the outcome is announced. Native controls throughout (keyboard first).
 */
export function AnnouncementComposer({
  action,
}: {
  action: (prev: ComposerState, form: FormData) => Promise<ComposerState>;
}) {
  const t = useTranslations('announcements');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const v = state.values;
  const hidden = (
    <>
      <input type="hidden" name="subject" value={v.subject} />
      <input type="hidden" name="body" value={v.body} />
      {v.channels.map((c) => (
        <input key={c} type="hidden" name="channel" value={c} />
      ))}
    </>
  );

  if (state.step === 'preview')
    return (
      <form action={formAction} className="flex flex-col gap-4" aria-label={t('previewTitle')}>
        {hidden}
        <input type="hidden" name="key" value={state.key} />
        <div role="status" className="text-body font-medium">
          {t('willReach', { count: state.preview.recipients })}
        </div>
        <iframe
          title={t('previewFrame', { subject: state.preview.subject })}
          src={state.preview.src}
          sandbox=""
          className="h-[420px] w-full rounded-card border border-zinc-200"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="intent" value="send" disabled={pending}>
            {t('send', { count: state.preview.recipients })}
          </Button>
          <Button type="submit" name="intent" value="edit" variant="secondary" disabled={pending}>
            {t('edit')}
          </Button>
        </div>
      </form>
    );

  const err = state.errors;
  return (
    <form action={formAction} className="flex flex-col gap-4" aria-label={t('composeTitle')} noValidate>
      <div role="status" aria-live="polite">
        {state.sentTo !== undefined ? (
          <p className="text-body font-medium">{t('sent', { count: state.sentTo })}</p>
        ) : null}
      </div>
      {state.code === 'no_recipients' || state.code === 'messaging_paused' ? (
        <Alert title={t(`errors.${state.code}`)} />
      ) : state.code && state.code !== 'validation_failed' ? (
        <Alert title={tr(errorMessageKey(state.code))} />
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="announcement-subject" className="text-caption text-zinc-600">
          {t('subject')}
        </label>
        <input
          id="announcement-subject"
          name="subject"
          defaultValue={v.subject}
          maxLength={150}
          aria-invalid={err.subject ? true : undefined}
          aria-describedby={err.subject ? 'announcement-subject-error' : undefined}
          className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
        />
        {err.subject ? (
          <p id="announcement-subject-error" className="text-caption text-pink-700">
            {t('errors.subjectRequired')}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="announcement-body" className="text-caption text-zinc-600">
          {t('message')}
        </label>
        <textarea
          id="announcement-body"
          name="body"
          defaultValue={v.body}
          rows={6}
          maxLength={5000}
          aria-invalid={err.body ? true : undefined}
          aria-describedby={err.body ? 'announcement-body-error' : undefined}
          className="rounded-card border border-zinc-200 bg-white px-4 py-3 text-body"
        />
        {err.body ? (
          <p id="announcement-body-error" className="text-caption text-pink-700">
            {t('errors.messageRequired')}
          </p>
        ) : null}
      </div>
      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={err.channels ? 'announcement-channels-error' : undefined}
      >
        <legend className="text-caption text-zinc-600">{t('channels')}</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {(['email', 'push'] as const).map((c) => (
            <label key={c} className="flex min-h-6 items-center gap-2 text-body">
              <input
                type="checkbox"
                name="channel"
                value={c}
                defaultChecked={v.channels.includes(c)}
                className="size-5 accent-zinc-900"
              />
              {t(`channel.${c}`)}
            </label>
          ))}
        </div>
        <p className="text-caption text-zinc-500">{t('pushHint')}</p>
        {err.channels ? (
          <p id="announcement-channels-error" className="text-caption text-pink-700">
            {t('errors.channelRequired')}
          </p>
        ) : null}
      </fieldset>
      <Button type="submit" name="intent" value="preview" disabled={pending} className="self-start">
        {t('preview')}
      </Button>
    </form>
  );
}
