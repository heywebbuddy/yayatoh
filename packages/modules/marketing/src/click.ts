/**
 * Pure helpers for the web edge (proxy, redirector, checkout hook): no database access, so the
 * proxy can import them without the module's commands.
 */
export { isLikelyBot } from './domain/bots.ts';
export {
  CLICK_COOKIE,
  CLICK_COOKIE_MAX_AGE_S,
  CLICK_PARAM,
  pseudonym,
  signClickId,
  uuidv7Time,
  verifyClickToken,
} from './domain/click-token.ts';
export { type DestinationProblem, destinationProblem, redirectTarget } from './domain/destination.ts';
export {
  cleanUtmValue,
  decodeUtmCookie,
  encodeUtmCookie,
  nextUtmCookie,
  UTM_COOKIE,
  UTM_KEYS,
  type Utm,
  type UtmCookie,
  type UtmTouch,
  utmFromParams,
} from './domain/utm.ts';
export { DAY_MS, DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS } from './domain/window.ts';
export { referralUtm } from './domain/referral.ts';
