// The matchers `expo-router/testing-library` adds to `expect` (it ships them without types).
export {};

declare global {
  namespace jest {
    interface Matchers<R> {
      toHavePathname(expected: string): R;
      toHavePathnameWithParams(expected: string): R;
    }
  }
}
