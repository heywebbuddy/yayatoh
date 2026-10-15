import { looksLikeEnrolmentLink } from '../device/link';

/**
 * Links that open the app from outside (M7.4a). An enrolment link (`/scan#e=…&k=…`) is handled by
 * the link listener in the root layout, which reads the key from the whole URL; the router itself
 * must not open the scanner for it, so it lands on the gate instead.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return looksLikeEnrolmentLink(path) ? '/' : path;
}
