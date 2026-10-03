import { EVENT_CATALOG, EVENT_GROUPS, webhooksRuntime } from '@yayatoh/webhooks';
import type { EventTypeGroup } from '@/components/webhooks/endpoint-form.tsx';

/** Subscribable event types by group, in catalog order (meta events are sent on request only). */
export const TYPE_GROUPS: readonly EventTypeGroup[] = EVENT_GROUPS.filter((g) => g !== 'meta').map(
  (group) => ({
    group,
    types: EVENT_CATALOG.filter((e) => e.group === group).map((e) => e.type),
  }),
);

/** What a test send can carry: `webhook.test` first, then every event's example. */
export const TEST_TYPES: readonly string[] = [
  'webhook.test',
  ...EVENT_CATALOG.filter((e) => e.group !== 'meta').map((e) => e.type),
];

/** False on a deployment without a publisher (production before the Svix account). */
export const webhooksAvailable = () => webhooksRuntime().publisher !== null;
