/** `expo-router` for component tests: a recording router and `useFocusEffect` as an effect. */
import { useEffect } from 'react';

export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

export const routerMock = {
  useRouter: () => router,
  useLocalSearchParams: () => ({}),
  useFocusEffect: (effect: () => undefined | (() => void)) => {
    // The focus callback is a stable `useCallback` in the screens.
    // biome-ignore lint/correctness/useExhaustiveDependencies: mirrors the real hook's contract
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
  Stack: { Screen: () => null },
};

export const resetRouter = () => {
  for (const fn of Object.values(router)) fn.mockClear();
  router.canGoBack.mockReturnValue(true);
};
