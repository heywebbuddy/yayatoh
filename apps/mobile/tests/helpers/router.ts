// A stand-in for expo-router in component tests: `jest.mock('expo-router', () => require('./helpers/router').routerModule)`.
export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  back: jest.fn(),
  setParams: jest.fn(),
  canGoBack: jest.fn(() => true),
};

export const searchParams: { current: Record<string, string | string[] | undefined> } = { current: {} };

export const routerModule = {
  useRouter: () => router,
  useLocalSearchParams: () => searchParams.current,
  Tabs: Object.assign(() => null, { Screen: () => null }),
};

export function resetRouter(): void {
  for (const fn of Object.values(router)) (fn as jest.Mock).mockClear();
  router.canGoBack.mockReturnValue(true);
  searchParams.current = {};
}
