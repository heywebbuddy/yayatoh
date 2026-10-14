/**
 * Reads the scanner's state in React (M7.4b): the engine's status as an external store, so a screen
 * re-renders when the queue, the list or the flags change and at no other time.
 */
import { useSyncExternalStore } from 'react';
import type { EngineStatus, ScanEngine } from './engine';

export function useEngineStatus(engine: ScanEngine): EngineStatus {
  return useSyncExternalStore(
    engine.subscribe.bind(engine),
    () => engine.status,
    () => engine.status,
  );
}
