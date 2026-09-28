import { withTenant } from '@yayatoh/db';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import {
  createNotifier,
  QUOTA_CHANNELS,
  type QuotaChannel,
  setQuotaLimitCommand,
} from '@yayatoh/notifications';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only (M3.5a), 404 unless dev auth is on:
 * - `action=quota`: set an org's monthly quota for a channel (what staff do in the console), so
 *   e2e can show the quota-reached state without sending thousands of messages;
 * - `action=sends`: queue `count` event updates to `{local}+{n}.{tag}@example.test`, which the
 *   drain then sends through the fake provider (e.g. `complaint+…` reports a complaint each).
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev-messaging' } });
  const action = form.get('action');
  if (action === 'quota') {
    const channel = String(form.get('channel') ?? '') as QuotaChannel;
    const raw = String(form.get('limit') ?? '');
    if (!QUOTA_CHANNELS.includes(channel) || !/^(\d+|default)$/.test(raw))
      return NextResponse.json({ error: 'bad_quota' }, { status: 400 });
    return NextResponse.json(
      await executeCommand(
        setQuotaLimitCommand,
        { channel, monthlyLimit: raw === 'default' ? null : Number(raw), reason: 'dev/e2e' },
        ctx,
        ports,
      ),
    );
  }
  if (action === 'sends') {
    const count = Number(form.get('count'));
    const local = String(form.get('local') ?? '');
    const tag = String(form.get('tag') ?? '');
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 500 ||
      !/^[a-z]{1,20}$/.test(local) ||
      !/^[a-z0-9]{1,24}$/.test(tag)
    )
      return NextResponse.json({ error: 'bad_sends' }, { status: 400 });
    const notifier = createNotifier();
    const queued = await withTenant(ctx, async (tx) => {
      let n = 0;
      for (let i = 0; i < count; i += 1)
        n += (
          await notifier.enqueue(tx, {
            kind: 'attendees.message',
            to: { email: `${local}+${i}.${tag}@example.test` },
            params: { subject: `Update ${i}`, body: 'Dev send', name: 'Guest', eventName: 'Dev event' },
            dedupeKey: `dev-sends:${tag}:${i}`,
          })
        ).queued;
      return n;
    });
    return NextResponse.json({ queued });
  }
  return NextResponse.json({ error: 'bad_action' }, { status: 400 });
}
