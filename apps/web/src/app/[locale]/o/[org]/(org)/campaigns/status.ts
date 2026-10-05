import type { CampaignStatus } from '@yayatoh/campaigns/client';
import type { Status } from '@yayatoh/ui';

/** Status dot tone per campaign status. */
export const STATUS_TONE: Readonly<Record<CampaignStatus, Status>> = {
  draft: 'neutral',
  scheduled: 'info',
  sending: 'warning',
  paused: 'warning',
  sent: 'success',
  cancelled: 'danger',
};
