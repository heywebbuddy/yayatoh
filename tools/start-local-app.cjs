const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseEnv } = require('node:util');

// Keep secrets in the supplied env directory; no copies are written into this checkout.
const root = resolve(__dirname, '..');
const app = process.argv[2];
const settingsRoot = resolve(process.argv[3] || root);
const commands = {
  web: ['node_modules/next/dist/bin/next', 'dev', '--port', '3000'],
  admin: ['node_modules/next/dist/bin/next', 'dev', '--port', '3001'],
  api: ['src/server.ts'],
  worker: ['src/main.ts'],
};
if (!Object.hasOwn(commands, app)) throw new Error('Choose web, admin, api or worker');
const readEnv = (name) => {
  const path = resolve(settingsRoot, name);
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
};
const provider = { ...readEnv('.env'), ...process.env };
const local = readEnv('.env.local');
const env = {
  ...provider,
  ...local,
  NODE_ENV: 'development',
  YAYATOH_DEV_AUTH: '0',
  ADMIN_AUTH_URL: 'http://localhost:3001',
  BETTER_AUTH_URL: 'http://localhost:3000',
  NEXT_PUBLIC_APP_ORIGIN: 'http://localhost:3000',
};
for (const name of [
  'DATABASE_URL',
  'ADMIN_DATABASE_URL',
  'MIGRATOR_DATABASE_URL',
  'PLATFORM_READER_DATABASE_URL',
  'JOBS_DATABASE_URL',
]) {
  if (!local[name] || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(local[name]).hostname)) {
    throw new Error(`${name} must use a local database in .env.local`);
  }
}
for (const name of [
  'EMAIL_PROVIDER',
  'AWS_SES_REGION',
  'AWS_SES_ACCESS_KEY_ID',
  'AWS_SES_SECRET_ACCESS_KEY',
  'AWS_SES_SESSION_TOKEN',
  'SES_CONFIGURATION_SET',
  'SES_SNS_TOPIC_ARN',
]) {
  if (provider[name]?.trim()) env[name] = provider[name];
}
if (app === 'api') env.PORT = '4000';
const child = spawn(process.execPath, commands[app], {
  cwd: resolve(root, 'apps', app),
  env,
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
