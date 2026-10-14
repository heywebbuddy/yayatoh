/**
 * The calls the door tools make (M7.4c), behind three small interfaces so every screen is tested
 * with a fake and no network: the device's `/v1/staff/*` routes (device token `yyd_…`), the
 * exhibitor rep's `/v1/portal/leads/*` routes (portal bearer `yyp_…`) and the organizer's read-only
 * `/v1/orgs/{org}/events/{event}/ops` view (member session). All go through `@yayatoh/sdk`.
 */
import type { ManifestRow } from '@yayatoh/checkin-engine';
import { type Schemas, unwrap, type YayatohClient } from '@yayatoh/sdk';

export type StaffOverview = Schemas['StaffOverview'];
export type GuestSnapshot = Schemas['GuestSnapshot'];
export type AssistanceRequest = Schemas['AssistanceRequest'];
export type AssistanceAction = Schemas['StaffAssistanceAction'];
export type StaffAssistanceReason = Schemas['StaffAssistanceReason'];
export type StaffAlertKind = Schemas['StaffAlertKind'];
export type NativePushRequest = Schemas['StaffNativePushRequest'];
export type PushStatus = Schemas['StaffPushStatus'];
export type GuestArrival = Schemas['GuestArrivalsRequest']['arrivals'][number];
export type GuestArrivalResult = Schemas['GuestArrivalsResult']['results'][number]['result'];
export type ScanResult = Schemas['ScanResult'];
export type OpsView = Schemas['OpsView'];
export type LeadSetup = Schemas['LeadSetup'];
export type Lead = Schemas['Lead'];
export type LeadList = Schemas['LeadList'];
export type LeadRating = 'hot' | 'warm' | 'cold';
export type LeadScan = Schemas['LeadScan'];
/** The generated type of `lead` is `Lead & (Record<string, never> | null)`: say plainly what it is. */
export interface LeadScanResult {
  readonly scanId: string;
  readonly status: Schemas['LeadScanStatus'];
  readonly reason: Schemas['LeadScanRefusal'];
  readonly lead: Lead | null;
}

/** The door verdict of an online check-in (`POST /v1/checkins`). */
export interface DoorVerdict {
  readonly result: ScanResult;
  readonly holderName: string | null;
  readonly typeName: string | null;
  readonly shortCode: string | null;
  /** For a duplicate: when the ticket was first admitted today. */
  readonly firstAdmittedAt: string | null;
}

export interface ManifestPage {
  readonly salt: string;
  readonly rows: readonly ManifestRow[];
  readonly cursor: string | null;
  readonly complete: boolean;
}

export interface StaffApi {
  overview(eventId: string): Promise<StaffOverview>;
  guests(eventId: string): Promise<GuestSnapshot>;
  recordArrivals(eventId: string, arrivals: readonly GuestArrival[]): Promise<GuestArrivalsOutcome>;
  assistance(eventId: string): Promise<readonly AssistanceRequest[]>;
  raiseAssistance(input: {
    eventId: string;
    reason: StaffAssistanceReason;
    note?: string;
    checkpointId?: string | null;
  }): Promise<{ requestId: string; number: number }>;
  workAssistance(input: {
    eventId: string;
    requestId: string;
    action: AssistanceAction;
  }): Promise<{ state: AssistanceRequest['state'] }>;
  pushStatus(): Promise<PushStatus>;
  registerPush(body: NativePushRequest): Promise<void>;
  unregisterPush(): Promise<void>;
  manifestPage(eventId: string, cursor?: string): Promise<ManifestPage>;
  checkIn(input: {
    eventId: string;
    code: string;
    checkpointId?: string | null;
    idempotencyKey: string;
  }): Promise<DoorVerdict>;
}

export interface GuestArrivalsOutcome {
  readonly results: readonly { readonly clientId: string; readonly result: GuestArrivalResult }[];
}

/** Sent to `PATCH /v1/portal/leads/{id}`. */
export interface LeadEdit {
  readonly rating: LeadRating | null;
  readonly qualifiers: readonly string[];
  readonly notes: string;
}

export interface PortalApi {
  setup(): Promise<LeadSetup>;
  leads(): Promise<LeadList>;
  syncScans(scans: readonly LeadScan[]): Promise<readonly LeadScanResult[]>;
  updateLead(leadId: string, edit: LeadEdit): Promise<void>;
}

export interface OrgChoice {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface EventChoice {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string;
  readonly timezone: string;
}

export interface OpsApi {
  ops(org: string, eventId: string): Promise<OpsView>;
  organizations(): Promise<readonly OrgChoice[]>;
  events(org: string): Promise<readonly EventChoice[]>;
}

const eventPath = (eventId: string) => ({ params: { path: { eventId } } });

/** The `/v1/staff/*` routes over a client signed with the device token. */
export function createStaffApi(client: YayatohClient): StaffApi {
  return {
    overview: (eventId) => unwrap(client.GET('/v1/staff/events/{eventId}/overview', eventPath(eventId))),
    guests: (eventId) => unwrap(client.GET('/v1/staff/events/{eventId}/guests', eventPath(eventId))),
    async recordArrivals(eventId, arrivals) {
      return unwrap(
        client.POST('/v1/staff/guest-arrivals', { body: { eventId, arrivals: [...arrivals] } }),
      );
    },
    async assistance(eventId) {
      const r = await unwrap(client.GET('/v1/staff/events/{eventId}/assistance', eventPath(eventId)));
      return r.requests;
    },
    raiseAssistance: (input) =>
      unwrap(
        client.POST('/v1/staff/assistance', {
          body: {
            eventId: input.eventId,
            reason: input.reason,
            ...(input.note ? { note: input.note } : {}),
            ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
          },
        }),
      ),
    workAssistance: (input) =>
      unwrap(
        client.POST('/v1/staff/assistance/{requestId}/{action}', {
          params: { path: { requestId: input.requestId, action: input.action } },
          body: { eventId: input.eventId },
        }),
      ),
    pushStatus: () => unwrap(client.GET('/v1/staff/push')),
    async registerPush(body) {
      await unwrap(client.PUT('/v1/staff/push', { body }));
    },
    async unregisterPush() {
      await unwrap(client.DELETE('/v1/staff/push'));
    },
    async manifestPage(eventId, cursor) {
      const page = await unwrap(
        client.GET('/v1/events/{eventId}/manifest', {
          params: { path: { eventId }, query: { limit: 2000, ...(cursor ? { cursor } : {}) } },
        }),
      );
      return {
        salt: page.header.salt,
        rows: page.rows as unknown as readonly ManifestRow[],
        cursor: page.cursor,
        complete: page.complete,
      };
    },
    async checkIn(input) {
      const v = await unwrap(
        client.POST('/v1/checkins', {
          params: { header: { 'idempotency-key': input.idempotencyKey } },
          body: {
            eventId: input.eventId,
            code: input.code,
            ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
          },
        }),
      );
      return {
        result: v.result,
        holderName: v.ticket?.holderName ?? null,
        typeName: v.ticket?.typeName ?? null,
        shortCode: v.ticket?.shortCode ?? null,
        firstAdmittedAt: v.firstAdmittedAt,
      };
    },
  };
}

/** The `/v1/portal/leads/*` routes over a client signed with the rep's portal bearer token. */
export function createPortalApi(client: YayatohClient): PortalApi {
  return {
    setup: () => unwrap(client.GET('/v1/portal/leads/setup')),
    leads: () => unwrap(client.GET('/v1/portal/leads')),
    async syncScans(scans) {
      const r = await unwrap(client.POST('/v1/portal/leads/scans', { body: { scans: [...scans] } }));
      return r.results as unknown as readonly LeadScanResult[];
    },
    async updateLead(leadId, edit) {
      await unwrap(
        client.PATCH('/v1/portal/leads/{leadId}', {
          params: { path: { leadId } },
          body: { rating: edit.rating, qualifiers: [...edit.qualifiers], notes: edit.notes },
        }),
      );
    },
  };
}

/** The organizer's read-only event-day view over a client signed with their member session. */
export function createOpsApi(client: YayatohClient): OpsApi {
  return {
    async organizations() {
      const r = await unwrap(client.GET('/v1/me/organizations'));
      return r.data.map((o) => ({ id: o.id, slug: o.slug, name: o.name }));
    },
    async events(org) {
      const r = await unwrap(client.GET('/v1/orgs/{org}/events', { params: { path: { org }, query: { limit: 50 } } }));
      return r.data.map((e) => ({ id: e.id, name: e.name, startsAt: e.startsAt, timezone: e.timezone }));
    },
    ops: (org, eventId) =>
      unwrap(client.GET('/v1/orgs/{org}/events/{eventId}/ops', { params: { path: { org, eventId } } })),
  };
}
