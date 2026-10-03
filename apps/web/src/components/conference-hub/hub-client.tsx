'use client';

import { Alert, Button, buttonClass, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import type { FeedActionState } from './types.ts';

type FeedAction = (prev: FeedActionState, form: FormData) => Promise<FeedActionState>;

/**
 * The personal calendar feed (M5.10a): subscribe (webcal), download, copy the link, and "Replace
 * the link" behind a confirmation (every earlier link stops working). `url` is absolute.
 */
export function CalendarFeedTools({ url, rotate }: { url: string; rotate: FeedAction }) {
  const t = useTranslations('conferenceHub.calendar');
  const te = useTranslations();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, formAction, pending] = useActionState(rotate, { ok: false, code: null });
  useEffect(() => {
    if (result.ok) setConfirming(false);
  }, [result]);
  const webcal = url.replace(/^https?:/, 'webcal:');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <a href={webcal} className={buttonClass('primary', 'md')}>
          {t('subscribe')}
        </a>
        <a href={url} download="schedule.ics" className={buttonClass('secondary', 'md')}>
          {t('download')}
        </a>
      </div>
      <Input
        id="hub-feed-url"
        label={t('linkLabel')}
        readOnly
        value={url}
        dir="ltr"
        className="font-mono"
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard?.writeText(url).catch(() => undefined);
            setCopied(true);
          }}
        >
          {t('copy')}
        </Button>
        {confirming ? null : (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            {t('replace')}
          </Button>
        )}
      </div>
      {confirming ? (
        <form action={formAction}>
          <Alert tone="warning" title={t('replaceConfirmTitle')}>
            <p className="m-0">{t('replaceConfirmBody')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={pending}>
                {t('replaceConfirm')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t('cancel')}
              </Button>
            </div>
          </Alert>
        </form>
      ) : null}
      {!result.ok && result.code ? <Alert title={te(errorMessageKey(result.code))} /> : null}
      <p role="status" className="m-0 text-caption text-ink-2">
        {result.ok ? t('replaced') : copied ? t('copied') : null}
      </p>
    </div>
  );
}

/** Chromium's install prompt event (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * "Add to home screen" (M5.10a). Registers the hub's service worker for this hub only (its scope
 * is the hub's path), so the last copy opens offline at the venue. Where the browser offers its
 * install prompt (Chromium) the button opens it; elsewhere the steps are written out.
 */
export function HubInstall({ scope }: { scope: string }) {
  const t = useTranslations('conferenceHub.install');
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker.register('/conference-hub-sw.js', { scope }).catch(() => undefined);
    setInstalled(window.matchMedia?.('(display-mode: standalone)').matches ?? false);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setPrompt(null);
      setDone(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [scope]);
  if (installed) return <p className="m-0 text-body font-semibold text-ink">{t('installed')}</p>;
  return (
    <div className="flex flex-col gap-2">
      {prompt ? (
        <div>
          <Button
            variant="secondary"
            onClick={async () => {
              await prompt.prompt();
              const choice = await prompt.userChoice;
              setPrompt(null);
              if (choice.outcome === 'accepted') setDone(true);
            }}
          >
            {t('button')}
          </Button>
        </div>
      ) : null}
      <p role="status" className="m-0 text-body text-ink">
        {done ? t('done') : null}
      </p>
      {done ? null : <p className="m-0 text-caption text-ink-2">{t('help')}</p>}
    </div>
  );
}

/** Says so when the phone is offline and the page is the saved copy. */
export function HubOffline() {
  const t = useTranslations('conferenceHub');
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  if (!offline) return null;
  return <Alert tone="info" title={t('offline')} />;
}
