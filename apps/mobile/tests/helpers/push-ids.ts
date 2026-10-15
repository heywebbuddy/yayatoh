import type { IncomingPush } from '../../src/push/port';

export const TICKET_ID = '11111111-1111-4111-8111-111111111111';
export const ORDER_ID = '22222222-2222-4222-8222-222222222222';

export const push = (path: string | null, over: Partial<IncomingPush> = {}): IncomingPush => ({
  id: `n-${Math.random().toString(36).slice(2)}`,
  title: 'Summit 2026',
  body: 'The start time changed',
  data: path === null ? {} : { path },
  ...over,
});
