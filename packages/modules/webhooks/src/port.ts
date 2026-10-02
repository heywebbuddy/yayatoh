/**
 * The `WebhookPublisher` port (M6.3b, research 21 §3.4): outbound webhooks are delivered by Svix
 * (application = org, endpoint, event type, message), which owns retries, the dead-letter store,
 * replay, signing secrets and the embeddable customer portal. Two adapters: `svixPublisher` (the
 * REST API; switched on with the owner's Svix account, owner inbox) and `fakePublisher` (dev,
 * preview and CI: deliveries are recorded and signed, never sent).
 *
 * Every call names the org (`appId` is the org id), and an adapter only ever touches that
 * application's endpoints and messages: an endpoint id from another org is `not_found`.
 */

export interface EndpointSpec {
  readonly url: string;
  readonly description: string;
  /** Public event types it receives; empty means every subscribable type. */
  readonly eventTypes: readonly string[];
  readonly disabled: boolean;
}

export type AttemptStatus = 'succeeded' | 'failed' | 'pending';

/** One delivery attempt of one message to one endpoint (newest first in lists). */
export interface DeliveryAttempt {
  readonly attemptId: string;
  readonly messageId: string;
  /** Our idempotency id for the message (the outbox event id, or the test send's id). */
  readonly eventId: string | null;
  readonly eventType: string;
  readonly status: AttemptStatus;
  /** The endpoint's HTTP answer; 0 when it could not be reached. */
  readonly responseStatus: number;
  readonly attemptedAt: Date;
  /** `manual` for a resend or recovery, `scheduled` for the first try and automatic retries. */
  readonly trigger: 'scheduled' | 'manual';
  /** When the next automatic retry is due (failed attempts that have retries left). */
  readonly nextAttemptAt: Date | null;
}

export interface SendMessageInput {
  readonly eventType: string;
  /** Idempotency: the same id is one message, however many times it is sent. */
  readonly eventId: string;
  readonly payload: Record<string, unknown>;
}

export interface WebhookEventTypeSpec {
  readonly name: string;
  readonly description: string;
  readonly schemaVersion: number;
  readonly schema: Record<string, unknown>;
  readonly example: Record<string, unknown>;
}

export class WebhookProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_found' | 'invalid' | 'unavailable',
  ) {
    super(message);
  }
}

export interface WebhookPublisher {
  readonly name: 'svix' | 'fake';
  /** Create the org's application if needed (idempotent). */
  ensureApplication(appId: string, name: string): Promise<void>;
  /** Register or update the catalog's event types (idempotent). */
  syncEventTypes(types: readonly WebhookEventTypeSpec[]): Promise<void>;
  /** `uid` is our endpoint row id, so a retried create finds the same endpoint. */
  createEndpoint(appId: string, uid: string, spec: EndpointSpec): Promise<{ providerEndpointId: string }>;
  updateEndpoint(appId: string, providerEndpointId: string, spec: EndpointSpec): Promise<void>;
  deleteEndpoint(appId: string, providerEndpointId: string): Promise<void>;
  endpointSecret(appId: string, providerEndpointId: string): Promise<string>;
  /** A new secret; the previous one keeps signing alongside it for 24 hours. */
  rotateSecret(appId: string, providerEndpointId: string): Promise<void>;
  /** Fan a message out to the app's endpoints that subscribe to its type. */
  sendMessage(appId: string, input: SendMessageInput): Promise<{ messageId: string }>;
  /** Send one message to one endpoint only (the console's test button). */
  sendTest(
    appId: string,
    providerEndpointId: string,
    input: SendMessageInput,
  ): Promise<{ messageId: string }>;
  listAttempts(appId: string, providerEndpointId: string, limit: number): Promise<DeliveryAttempt[]>;
  /** Send a message to an endpoint again now (replay). */
  resendMessage(appId: string, providerEndpointId: string, messageId: string): Promise<void>;
  /** Resend every failed message to the endpoint since a time (recovery after an outage). */
  recoverFailed(appId: string, providerEndpointId: string, since: Date): Promise<void>;
  /** A short-lived link to the provider's customer portal for this app, and its origin (CSP). */
  portalAccess(appId: string): Promise<{ url: string; origin: string }>;
}

/** Svix's retry schedule after the first attempt (research 21 §3.3): about 28 hours in all. */
export const RETRY_SCHEDULE_SECONDS = [5, 300, 1800, 7200, 18000, 36000, 36000] as const;
