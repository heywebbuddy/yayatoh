/** The request header proxy.ts sets (and strips from clients) on front-door requests it serves. */
export const FRONT_DOOR_ROUTE_HEADER = 'x-front-door-route';

export const flushInterval = () => {
  const n = Number(process.env.FRONT_DOOR_FLUSH_MS);
  return Number.isFinite(n) && n >= 0 ? n : 5_000;
};
