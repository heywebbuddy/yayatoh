'use client';

import { buttonClass } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/**
 * "Use my location" (M6.14a): asks the browser for its position and submits the search form with
 * `near=me` and the coordinates (rounded to about 1 km; they only go into the URL). Without
 * permission the visitor is told to pick a city instead (the "Near" list is the alternative).
 */
export function LocateButton({ formId }: { formId: string }) {
  const t = useTranslations('market.search');
  const [state, setState] = useState<'idle' | 'busy' | 'denied'>('idle');
  const locate = () => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement) || !('geolocation' in navigator)) {
      setState('denied');
      return;
    }
    setState('busy');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const data = new FormData(form);
        data.set('near', 'me');
        data.set('lat', pos.coords.latitude.toFixed(2));
        data.set('lng', pos.coords.longitude.toFixed(2));
        data.delete('page');
        const q = new URLSearchParams();
        for (const [k, v] of data.entries()) if (typeof v === 'string' && v !== '') q.set(k, v);
        window.location.assign(`${form.action}?${q.toString()}`);
      },
      () => setState('denied'),
      { maximumAge: 300_000, timeout: 10_000 },
    );
  };
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={locate} disabled={state === 'busy'} className={buttonClass('secondary')}>
        {state === 'busy' ? t('locating') : t('useLocation')}
      </button>
      <p role="status" className="text-caption text-ink-2">
        {state === 'denied' ? t('locationDenied') : ''}
      </p>
    </div>
  );
}
