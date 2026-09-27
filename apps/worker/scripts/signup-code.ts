// Create an invite-only signup code: pnpm --filter @yayatoh/worker signup-code -- --uses 1 --days 14 --note "Acme"
import { parseArgs } from 'node:util';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { createSignupCode } from '../src/signup-codes.ts';

const { values } = parseArgs({
  options: {
    uses: { type: 'string', default: '1' },
    days: { type: 'string', default: '14' },
    note: { type: 'string', default: '' },
    code: { type: 'string' },
    by: { type: 'string', default: 'staff:cli' },
    json: { type: 'boolean', default: false },
  },
});
setPlatformAuditSink(async (a) => {
  process.stderr.write(`${JSON.stringify({ audit: 'platform_reader', actor: a.actor, reason: a.reason })}\n`);
});
const r = await createSignupCode({
  code: values.code,
  maxUses: Number(values.uses),
  days: Number(values.days),
  note: values.note ?? '',
  createdBy: values.by ?? 'staff:cli',
});
process.stdout.write(
  values.json ? `${JSON.stringify(r)}\n` : `${r.code} (expires ${r.expiresAt.toISOString()})\n`,
);
// One-shot CLI: exit rather than wait for idle pool connections to time out.
process.exit(0);
