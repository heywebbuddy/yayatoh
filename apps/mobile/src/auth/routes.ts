import type { Href, useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

/** The routes this increment owns. Typed routes only know them once Expo has generated its types. */
export const PATHS = {
  welcome: '/welcome',
  email: '/email',
  code: '/code',
  password: '/password',
  twoFactor: '/two-factor',
  linkProof: '/link-proof',
  deleted: '/account/deleted',
  tickets: '/tickets',
  discover: '/discover',
  account: '/account',
  language: '/account/language',
  deleteAccount: '/account/delete',
  notifications: '/account/notifications',
} as const;

export type Path = (typeof PATHS)[keyof typeof PATHS];

export const href = (path: Path): Href => path as Href;
export const go = (router: Router, path: Path) => router.push(href(path));
export const replace = (router: Router, path: Path) => router.replace(href(path));
