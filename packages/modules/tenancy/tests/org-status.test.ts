import { describe, expect, it } from 'vitest';
import {
  isOrgLive,
  nextOrgStatus,
  orgStatusActions,
  orgWriteRefusal,
  restoredOrgStatus,
} from '../src/index.ts';

describe('org status transitions (M1.3f)', () => {
  it('suspend, reactivate and terminate move between the right states only', () => {
    expect(nextOrgStatus('active', 'suspend')).toBe('suspended');
    expect(nextOrgStatus('limited', 'suspend')).toBe('suspended');
    expect(nextOrgStatus('suspended', 'suspend')).toBeNull();
    expect(nextOrgStatus('suspended', 'reactivate')).toBe('active');
    expect(nextOrgStatus('active', 'reactivate')).toBeNull();
    for (const from of ['active', 'limited', 'suspended'])
      expect(nextOrgStatus(from, 'terminate')).toBe('terminated');
    // Terminated is final from the console.
    for (const action of ['suspend', 'reactivate', 'terminate'] as const)
      expect(nextOrgStatus('terminated', action)).toBeNull();
  });

  it('offers exactly the allowed actions', () => {
    expect(orgStatusActions('active')).toEqual(['suspend', 'terminate']);
    expect(orgStatusActions('suspended')).toEqual(['reactivate', 'terminate']);
    expect(orgStatusActions('terminated')).toEqual([]);
    expect(isOrgLive('active')).toBe(true);
    expect(isOrgLive('limited')).toBe(true);
    expect(isOrgLive('suspended')).toBe(false);
  });
});

describe('writes while suspended or terminated', () => {
  const w = (status: string, command: string, extra: Partial<Parameters<typeof orgWriteRefusal>[0]> = {}) =>
    orgWriteRefusal({ status, actorType: 'user', role: 'admin', command, ...extra });

  it('live orgs refuse nothing; platform actors are never refused', () => {
    expect(w('active', 'tenancy.updateOrganization')).toBeNull();
    expect(w('suspended', 'tenancy.updateOrganization', { actorType: 'system' })).toBeNull();
    expect(w('terminated', 'tenancy.updateOrganization', { actorType: 'system' })).toBeNull();
  });

  it('a suspended org is read-only except the door, ticket holders, exports and personal actions', () => {
    expect(w('suspended', 'tenancy.updateOrganization')).toBe('org_suspended');
    expect(w('suspended', 'orders.startCheckout', { actorType: 'anonymous', role: null })).toBe(
      'org_suspended',
    );
    expect(w('suspended', 'events.transitionEvent', { actorType: 'api_key', role: null })).toBe(
      'org_suspended',
    );
    for (const c of [
      'checkin.scanTicket',
      'checkin.undoAdmission',
      'ticketing.giveTicket',
      'ticketing.claimTicket',
    ])
      expect(w('suspended', c)).toBeNull();
    expect(w('suspended', 'reports.startAttendeeExport', { category: 'export', role: 'viewer' })).toBeNull();
    expect(w('suspended', 'notifications.markInboxRead')).toBeNull();
    expect(w('suspended', 'orders.startRefund', { category: 'money' })).toBe('org_suspended');
  });

  it('a terminated org keeps only personal and safety actions and the owners’ exports', () => {
    expect(w('terminated', 'checkin.scanTicket')).toBe('org_terminated');
    expect(w('terminated', 'ticketing.giveTicket', { actorType: 'anonymous', role: null })).toBe(
      'org_terminated',
    );
    expect(w('terminated', 'platform.auditCsv', { category: 'export', role: 'owner' })).toBeNull();
    expect(w('terminated', 'platform.auditCsv', { category: 'export', role: 'admin' })).toBe(
      'org_terminated',
    );
    expect(w('terminated', 'notifications.markInboxRead', { role: 'viewer' })).toBeNull();
    expect(w('terminated', 'messaging.contactReport', { actorType: 'anonymous', role: null })).toBeNull();
  });
});

describe('restoring a terminated org (M1.13d)', () => {
  it('goes back to the status the termination recorded, only from terminated and only with a record', () => {
    for (const back of ['active', 'limited', 'suspended'])
      expect(restoredOrgStatus('terminated', { fromStatus: back })).toBe(back);
    expect(restoredOrgStatus('terminated', null)).toBeNull();
    expect(restoredOrgStatus('terminated', { fromStatus: 'terminated' })).toBeNull();
    for (const current of ['active', 'limited', 'suspended'])
      expect(restoredOrgStatus(current, { fromStatus: 'active' })).toBeNull();
  });
});
