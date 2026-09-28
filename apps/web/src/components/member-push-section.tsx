import { executeQuery } from '@yayatoh/kernel';
import { myPushDevicesQuery } from '@yayatoh/notifications';
import { Card } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import {
  removeMemberDeviceAction,
  subscribeMemberPushAction,
  unsubscribeMemberPushAction,
} from '@/app/[locale]/o/[org]/(org)/notifications/actions.ts';
import type { ConsoleData } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { webPushPublicKey } from '@/server/web-push.ts';
import { WebPushControl } from './web-push-control.tsx';

/**
 * The signed-in member's push opt-in for this org (M1.10e): on the preferences page with the
 * device list, on the inbox page as a compact opt-in.
 */
export async function MemberPushSection({
  data,
  org,
  locale,
  showDevices = true,
}: {
  data: ConsoleData;
  org: string;
  locale: string;
  showDevices?: boolean;
}) {
  const t = await getTranslations('webPush');
  const devices = await executeQuery(myPushDevicesQuery, {}, data.ctx, ports);
  const since = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  return (
    <section aria-labelledby="push-heading" className="flex flex-col gap-3">
      <h2 id="push-heading" className="text-section">
        {t('title')}
      </h2>
      <Card>
        <WebPushControl
          publicKey={webPushPublicKey()}
          devices={devices.map((d) => ({
            id: d.id,
            label: d.label,
            ref: d.ref,
            since: since.format(d.since),
          }))}
          subscribe={subscribeMemberPushAction.bind(null, org)}
          unsubscribe={unsubscribeMemberPushAction.bind(null, org)}
          remove={removeMemberDeviceAction.bind(null, org)}
          hint={t('memberHint', { org: data.org.name })}
          showDevices={showDevices}
        />
      </Card>
    </section>
  );
}
