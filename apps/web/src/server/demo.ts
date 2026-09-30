import 'server-only';
import { type DemoEvent, demoEvent, publicDemoEvent } from '@/demo/events.ts';
import { devAuthEnabled } from './dev.ts';

/** Demo metrics for a seeded showcase event — dev/preview only, never production. */
export function demoOverlay(orgSlug: string, eventSlug: string): DemoEvent | undefined {
  return devAuthEnabled() ? demoEvent(orgSlug, eventSlug) : undefined;
}

export function publicDemoOverlay(eventSlug: string): DemoEvent | undefined {
  return devAuthEnabled() ? publicDemoEvent(eventSlug) : undefined;
}
