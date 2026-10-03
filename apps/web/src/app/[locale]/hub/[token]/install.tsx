'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/** Chromium's install prompt event (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * "Add to home screen" for the party's hub (M4.7a). Registers the hub's service worker for this
 * party's page only (its scope is the page's own path), so the last copy opens offline on the day.
 * Where the browser offers its install prompt (Chromium) the button opens it; elsewhere (Safari,
 * Firefox) the steps are written out. Already installed: says so.
 */
export function HubInstall({ scope }: { scope: string }) {
  const t = useTranslations('hub');
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker.register('/hub-sw.js', { scope }).catch(() => undefined);
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
            type="button"
            variant="primary"
            onClick={async () => {
              await prompt.prompt();
              const choice = await prompt.userChoice;
              setPrompt(null);
              if (choice.outcome === 'accepted') setDone(true);
            }}
          >
            {t('install')}
          </Button>
        </div>
      ) : null}
      <p role="status" className="m-0 text-body text-ink">
        {done ? t('installDone') : null}
      </p>
      {done ? null : <p className="m-0 text-caption text-ink-2">{t('installHelp')}</p>}
    </div>
  );
}

/** Says so when the phone is offline and the page is the saved copy (the service worker's). */
export function HubOffline() {
  const t = useTranslations('hub');
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
