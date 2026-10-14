// Metro helpers for the two Expo apps (M7.1b, ADR 0025). CommonJS because Metro loads
// `metro.config.js` with `require`; no dependency, so a test can load it without Metro.
const path = require('node:path');

/** Packages that must exist once in a bundle: a second copy breaks hooks and native views. */
const SINGLETONS = new Set(['react', 'react-native']);

/** `react/jsx-runtime` -> `react`; `@scope/pkg/x` -> `@scope/pkg`; relative paths -> undefined. */
function packageNameOf(moduleName) {
  if (moduleName.startsWith('.') || moduleName.startsWith('/')) return undefined;
  const [first, second] = moduleName.split('/');
  return first?.startsWith('@') ? `${first}/${second}` : first;
}

/**
 * Makes `react` and `react-native` resolve from the app's own directory whichever file asks.
 *
 * The workspace holds two Reacts: the web's (19.3, root catalog) and Expo's (19.2.3, `mobile`
 * catalog). Metro resolves a package's imports from that package's own `node_modules`, so a
 * universal package that ever lists `react` as a dev dependency would drag the web's copy into the
 * bundle next to Expo's. This forces the app's copy instead.
 */
function singletonReact(config, appDir) {
  const origin = path.join(appDir, 'package.json');
  const previous = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const next = previous ?? ((ctx, name, plat) => ctx.resolveRequest(ctx, name, plat));
    const name = packageNameOf(moduleName);
    if (name && SINGLETONS.has(name)) {
      return next({ ...context, originModulePath: origin }, moduleName, platform);
    }
    return next(context, moduleName, platform);
  };
  return config;
}

module.exports = { SINGLETONS, packageNameOf, singletonReact };
