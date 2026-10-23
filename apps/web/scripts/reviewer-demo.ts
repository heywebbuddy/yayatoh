import { checkDemoTarget, DemoRefused } from './reviewer-demo-guard.ts';

/**
 * Entry point of `pnpm reviewer-demo` (M7.5a). The guard runs first and the script itself is
 * loaded only afterwards, so a production environment is refused by name before any import can
 * open a connection or read a key. See `reviewer-demo-run.ts` for what the demo creates.
 */
const target = process.argv
  .slice(2)
  .find((a) => a.startsWith('--target='))
  ?.slice('--target='.length);

try {
  checkDemoTarget(target, process.env);
} catch (err) {
  if (err instanceof DemoRefused) {
    console.error(`reviewer-demo: ${err.message}`);
    process.exit(2);
  }
  throw err;
}

await import('./reviewer-demo-run.ts');
