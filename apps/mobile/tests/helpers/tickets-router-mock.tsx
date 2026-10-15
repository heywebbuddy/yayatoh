/** `expo-router` for component tests: a recording router and `useFocusEffect` as an effect. */
import { useEffect } from 'react';

export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

/** Where a `Redirect` was asked to go, in order. */
export const redirects: unknown[] = [];

export const routerMock = {
  useRouter: () => router,
  useLocalSearchParams: () => ({}),
  useFocusEffect: (effect: () => undefined | (() => void)) => {
    // The focus callback is a stable `useCallback` in the screens.
    useEffect(effect, [effect]);
  },
  Redirect: ({ href }: { href: unknown }) => {
    redirects.push(href);
    return null;
  },
  Link: ({ children }: { children: unknown }) => children,
  Stack: { Screen: () => null },
};

export const resetRouter = () => {
  redirects.length = 0;
  for (const fn of Object.values(router)) fn.mockClear();
  router.canGoBack.mockReturnValue(true);
};
