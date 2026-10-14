/**
 * One scan from code to screen (M7.4b): ignore the camera repeating the QR it still sees, decide
 * through the engine, show the verdict, play its sound and vibration, and ask for a send. The verdict
 * clears itself after a few seconds so the next person at the door sees a ready screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanEngine } from '../engine';
import { ScanUnavailableError } from '../engine';
import type { Feedback } from '../feedback';
import type { Scheduler } from '../scheduler';
import type { Direction, ScanOutcome } from '../types';
import { viewFor } from '../verdicts';

/** The camera reports the QR it sees many times a second: the same code within this window is one scan. */
export const REPEAT_WINDOW_MS = 3_000;
/** How long a verdict stays on screen with no new scan. */
export const VERDICT_HOLD_MS = 6_000;

export interface ScanFlowOptions {
  readonly engine: ScanEngine;
  readonly scheduler: Scheduler | null;
  readonly feedback: Feedback;
  readonly direction: Direction;
  readonly now?: () => number;
}

export function useScanFlow({ engine, scheduler, feedback, direction, now = Date.now }: ScanFlowOptions) {
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const last = useRef<{ code: string; at: number } | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const submit = useCallback(
    async (raw: string, source: 'camera' | 'manual' = 'camera') => {
      const code = raw.trim();
      if (!code) return;
      const at = now();
      const prev = last.current;
      if (source === 'camera' && prev && prev.code === code && at - prev.at < REPEAT_WINDOW_MS) return;
      last.current = { code, at };
      try {
        const result = await engine.scan(code, { direction });
        if (!live.current) return;
        setUnavailable(false);
        setOutcome(result);
        feedback.play(viewFor(result.verdict));
        scheduler?.kick();
      } catch (e) {
        if (e instanceof ScanUnavailableError && live.current) setUnavailable(true);
        else throw e;
      }
    },
    [engine, scheduler, feedback, direction, now],
  );

  useEffect(() => {
    if (!outcome) return;
    const timer = setTimeout(() => setOutcome(null), VERDICT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [outcome]);

  return { outcome, unavailable, submit, clear: () => setOutcome(null) };
}
