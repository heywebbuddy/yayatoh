import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  acceptAgreementCommand,
  agreementsQuery,
  createOrganization,
  getOrganizationQuery,
  legalPagesQuery,
  PLATFORM_AGREEMENTS,
  publicLegalPage,
  setLegalPageCommand,
  updateOrganizationCommand,
} from '@yayatoh/tenancy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('organization settings (M1.3a)', () => {
  it('publishing needs the current platform terms accepted (click-wrap by a person)', async () => {
    const owner = uuidv7();
    const org = await createOrganization(
      userCtx(owner),
      { slug: `fresh-${owner.slice(-8)}`, name: 'Fresh' },
      ports,
    );
    const ctx = userCtx(owner, org.id);
    const e = await executeCommand(
      createEventCommand,
      { name: 'First', timezone: 'UTC', startsAt: '2027-12-01T18:00:00Z', endsAt: '2027-12-01T23:00:00Z' },
      ctx,
      ports,
    );
    await expect(
      executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, ctx, ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'terms_not_accepted' } });
    expect((await executeQuery(agreementsQuery, {}, ctx, ports)).every((x) => x.acceptedAt === null)).toBe(
      true,
    );
    // An outdated version is refused; a system actor can't accept for the org.
    await expect(
      executeCommand(acceptAgreementCommand, { document: 'platform_tos', version: '2020-01' }, ctx, ports),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      executeCommand(
        acceptAgreementCommand,
        { document: 'platform_tos', version: PLATFORM_AGREEMENTS.platform_tos.version },
        systemCtx(org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await executeCommand(
      acceptAgreementCommand,
      { document: 'platform_tos', version: PLATFORM_AGREEMENTS.platform_tos.version },
      ctx,
      ports,
    );
    const status = await executeQuery(agreementsQuery, {}, ctx, ports);
    expect(status.find((x) => x.document === 'platform_tos')).toMatchObject({ acceptedBy: owner });
    await expect(
      executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, ctx, ports),
    ).resolves.toMatchObject({ status: 'published' });
  });

  it('viewers cannot accept terms or change settings', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(
      executeCommand(
        acceptAgreementCommand,
        { document: 'dpa', version: PLATFORM_AGREEMENTS.dpa.version },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(updateOrganizationCommand, { name: 'Hijack' }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('brand colour, currency and country are settings; colours are normalized and validated', async () => {
    await executeCommand(
      updateOrganizationCommand,
      { brandColor: '#1A6B5C', currency: 'EUR', country: 'IE' },
      a.ctx(),
      ports,
    );
    expect(await executeQuery(getOrganizationQuery, {}, a.ctx(), ports)).toMatchObject({
      brandColor: '#1a6b5c',
      currency: 'EUR',
      country: 'IE',
    });
    await expect(
      executeCommand(updateOrganizationCommand, { brandColor: 'red' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await executeCommand(updateOrganizationCommand, { brandColor: null }, a.ctx(), ports);
    expect((await executeQuery(getOrganizationQuery, {}, a.ctx(), ports)).brandColor).toBeNull();
  });

  it('legal pages: set, read publicly by slug, remove with an empty body; per org', async () => {
    await executeCommand(
      setLegalPageCommand,
      { kind: 'privacy', body: '  We keep your data safe.  ' },
      a.ctx(),
      ports,
    );
    const page = await publicLegalPage(a.org.slug, 'privacy');
    expect(page).toMatchObject({ body: 'We keep your data safe.', orgName: a.org.name });
    expect(await publicLegalPage(b.org.slug, 'privacy')).toBeNull();
    expect(await publicLegalPage('no-such-org', 'privacy')).toBeNull();
    expect((await executeQuery(legalPagesQuery, {}, b.ctx(), ports)).map((p) => p.body)).not.toContain(
      'We keep your data safe.',
    );
    await executeCommand(setLegalPageCommand, { kind: 'privacy', body: '' }, a.ctx(), ports);
    expect(await publicLegalPage(a.org.slug, 'privacy')).toBeNull();
    await expect(
      executeCommand(
        setLegalPageCommand,
        { kind: 'terms', body: 'x' },
        createCtx({ orgId: a.org.id }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
