/**
 * Where the Tickets screens send the person (M7.3b). Routes the other Wave 3 builders own
 * (Discover, sign-in) are built here from their path strings, because Expo Router's typed routes
 * only know the files that exist on this branch.
 */
import { ROUTES } from '@yayatoh/mobile-core';
import type { Href } from 'expo-router';

const href = (value: unknown): Href => value as Href;

export const hrefs = {
  tickets: (): Href => href('/tickets'),
  ticket: (id: string): Href => href({ pathname: ROUTES.ticket, params: { id } }),
  transfer: (id: string): Href => href({ pathname: '/tickets/[id]/transfer', params: { id } }),
  refund: (id: string): Href => href({ pathname: '/tickets/[id]/refund', params: { id } }),
  claim: (token: string): Href => href({ pathname: ROUTES.claim, params: { token } }),
  /** The Discover tab (M7.3c). */
  discover: (): Href => href('/discover'),
  /** The welcome and sign-in flow (M7.3a). */
  signIn: (): Href => href('/welcome'),
};
