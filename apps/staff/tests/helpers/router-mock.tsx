/**
 * A stand-in for `expo-router` in component tests: the hooks return controllable values, and
 * `Redirect` renders where it would have sent the person so a test can read it.
 */
import { Text } from 'react-native';

export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
};
export const state = { params: {} as Record<string, string | undefined>, pathname: '/' };

export const resetRouter = () => {
  for (const fn of Object.values(router)) fn.mockReset();
  state.params = {};
  state.pathname = '/';
};

export const useRouter = () => router;
export const useLocalSearchParams = () => state.params;
export const usePathname = () => state.pathname;
export const Redirect = ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>;
export const Stack = () => null;
