import path from 'node:path';

type Context = { originModulePath: string; resolveRequest: jest.Mock };
type Config = {
  resolver: { resolveRequest?: (c: Context, name: string, platform: string | null) => unknown };
};

const { singletonReact, packageNameOf, SINGLETONS } = require('../metro.cjs') as {
  singletonReact: (config: Config, appDir: string) => Config;
  packageNameOf: (name: string) => string | undefined;
  SINGLETONS: Set<string>;
};

const appDir = '/repo/apps/mobile';
const requester = '/repo/packages/ui/src/index.ts';

function resolve(moduleName: string, config: Config = { resolver: {} }) {
  const resolveRequest = jest.fn().mockReturnValue({ type: 'empty' });
  singletonReact(config, appDir).resolver.resolveRequest?.(
    { originModulePath: requester, resolveRequest },
    moduleName,
    'ios',
  );
  return resolveRequest.mock.calls[0] as [Context, string, string | null];
}

describe('one React for the whole bundle (metro.cjs)', () => {
  it('pins react and react-native to the app, whoever imports them', () => {
    expect([...SINGLETONS].sort()).toEqual(['react', 'react-native']);
    for (const name of [
      'react',
      'react/jsx-runtime',
      'react-native',
      'react-native/Libraries/Core/InitializeCore',
    ]) {
      const [context, moduleName] = resolve(name);
      expect(context.originModulePath).toBe(path.join(appDir, 'package.json'));
      expect(moduleName).toBe(name);
    }
  });

  it('leaves everything else to the normal lookup', () => {
    for (const name of [
      'react-native-screens',
      'react-dom',
      'react-test-renderer',
      'expo-router',
      '@yayatoh/sdk',
      './react',
    ]) {
      const [context] = resolve(name);
      expect(context.originModulePath).toBe(requester);
    }
  });

  it('keeps a resolver that was already configured', () => {
    const previous = jest.fn().mockReturnValue({ type: 'empty' });
    const config: Config = { resolver: { resolveRequest: previous as never } };
    singletonReact(config, appDir).resolver.resolveRequest?.(
      { originModulePath: requester, resolveRequest: jest.fn() },
      'react',
      'android',
    );
    expect(previous).toHaveBeenCalledTimes(1);
    expect((previous.mock.calls[0] as [Context])[0].originModulePath).toBe(path.join(appDir, 'package.json'));
  });

  it('names packages from deep imports', () => {
    expect(packageNameOf('react/jsx-dev-runtime')).toBe('react');
    expect(packageNameOf('@react-native/assets-registry/registry')).toBe('@react-native/assets-registry');
    expect(packageNameOf('./react')).toBeUndefined();
    expect(packageNameOf('/abs/react')).toBeUndefined();
  });
});
