'use client';

import { useEffect, useState } from 'react';

/** Whether the visitor prefers reduced motion (false on the server and until mounted). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches), []);
  return reduced;
}
