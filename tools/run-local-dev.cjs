const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { parseEnv } = require('node:util');

// Doppler provides email settings; explicit local overrides keep development services local.
const root = resolve(__dirname, '..');
const local = parseEnv(readFileSync(resolve(root, '.env.local'), 'utf8'));
const emailNames = [
  'EMAIL_PROVIDER',
  'AWS_SES_REGION',
  'AWS_SES_ACCESS_KEY_ID',
  'AWS_SES_SECRET_ACCESS_KEY',
  'AWS_SES_SESSION_TOKEN',
  'SES_CONFIGURATION_SET',
  'SES_SNS_TOPIC_ARN',
];
const env = { ...process.env, ...local, NODE_ENV: 'development' };
const inheritedPath = env.PATH || env.Path || '';
delete env.Path;
env.PATH = `${dirname(process.execPath)};${inheritedPath}`;
for (const name of emailNames) {
  if (process.env[name]) env[name] = process.env[name];
  else delete env[name];
}
const databaseNames = [
  'DATABASE_URL',
  'ADMIN_DATABASE_URL',
  'MIGRATOR_DATABASE_URL',
  'PLATFORM_READER_DATABASE_URL',
  'JOBS_DATABASE_URL',
];
for (const name of databaseNames) {
  if (!local[name] || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(local[name]).hostname)) {
    throw new Error(`${name} must point to the local database in .env.local`);
  }
}
if (
  env.EMAIL_PROVIDER !== 'ses' ||
  emailNames.filter((name) => name !== 'AWS_SES_SESSION_TOKEN').some((name) => !env[name]?.trim())
) {
  throw new Error('Doppler must supply EMAIL_PROVIDER=ses and all required SES settings');
}
process.stdout.write('Starting local development with local databases and Doppler SES email settings.\n');
const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm dev'], {
  cwd: root,
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
