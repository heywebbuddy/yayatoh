'use client';

import { useEffect } from 'react';

/**
 * Tells the front door that this page is a 404 (M2.4a "watch"). Rendered by the not-found page on
 * front-door hosts only; the not-found boundary is prepared for every page, so the count can only
 * be taken once it is actually shown. The server re-checks the host and route before counting.
 */
export function FrontDoorBeacon() {
  useEffect(() => {
    const body = JSON.stringify({ path: window.location.pathname });
    if (!navigator.sendBeacon?.('/api/front-door/not-found', body))
      void fetch('/api/front-door/not-found', { method: 'POST', body, keepalive: true }).catch(() => {});
  }, []);
  return null;
}
