// Platform staff (owner-approved list only):
//   pnpm --filter @yayatoh/worker staff -- --email sam@example.com --role support
//   pnpm --filter @yayatoh/worker staff -- --email sam@example.com --revoke
import { parseArgs } from 'node:util';
import { databaseAuditSink, setPlatformAuditSink } from '@yayatoh/db/platform';
import { type StaffRole, setStaff } from '../src/staff.ts';

const { values } = parseArgs({
  // pnpm forwards a literal `--` separator; drop it.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    email: { type: 'string' },
    role: { type: 'string', default: 'support' },
    revoke: { type: 'boolean', default: false },
    by: { type: 'string', default: 'staff:cli' },
  },
});
if (!values.email) throw new Error('--email is required');
setPlatformAuditSink(databaseAuditSink);
const id = await setStaff({
  email: values.email,
  role: values.revoke ? null : (values.role as StaffRole),
  by: values.by ?? 'staff:cli',
});
process.stdout.write(`${values.revoke ? 'revoked' : `staff (${values.role})`}: ${values.email} → ${id}\n`);
// One-shot CLI: exit rather than wait for idle pool connections to time out.
process.exit(0);
