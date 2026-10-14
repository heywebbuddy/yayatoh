import type { ManifestHeader, ManifestRow, OfflineVerdict } from '@yayatoh/checkin-engine';

/** The server's answer for a synced scan (`SCAN_RESULTS` in the check-in module). */
export type ServerResult =
  | 'admitted'
  | 'duplicate'
  | 'invalid'
  | 'void'
  | 'wrong_event'
  | 'not_today'
  | 'wrong_date'
  | 'outside_window'
  | 'duplicate_offline'
  | 'superseded'
  | 'provisional'
  | 'granted'
  | 'no_access'
  | 'wrong_checkpoint'
  | 'balance_due'
  | 'entered'
  | 'scanned_out'
  | 'not_in_room'
  | 'not_enrolled'
  | 'admission_level'
  | 'capacity';

/** Everything a verdict screen can show: the engine's offline verdicts and the server's late ones. */
export type VerdictId = OfflineVerdict | ServerResult;

export type Direction = 'in' | 'out';

/** A scan waiting in the outbox, as `POST /v1/scans/batch` takes it. */
export interface QueuedScan {
  readonly scanId: string;
  readonly code: string;
  readonly deviceTs: string;
  readonly clockOffsetMs: number;
  readonly verdict: string;
  readonly checkpointId?: string;
  readonly direction?: Direction;
}

/** An outbox row: the wire scan plus what the screen needs to describe it after sync. */
export interface OutboxEntry extends QueuedScan {
  readonly ticketId: string | null;
  readonly holderName: string | null;
}

/** Where and when a ticket was first admitted on this device. */
export interface AdmissionInfo {
  readonly at: string;
  readonly checkpointId: string | null;
}

export interface ScanOutcome {
  readonly scanId: string;
  readonly verdict: VerdictId;
  readonly ticketId: string | null;
  readonly holderName: string | null;
  readonly typeName: string | null;
  /** For a duplicate: when and where this device first admitted the ticket, when it knows. */
  readonly firstAdmission: { readonly at: string; readonly checkpointName: string | null } | null;
  /** Milliseconds from the code arriving to the verdict being decided (the 300 ms budget). */
  readonly elapsedMs: number;
}

/** A scan the server judged differently from the phone once it synced (a duplicate across doors). */
export interface FlaggedScan {
  readonly scanId: string;
  readonly ticketId: string | null;
  readonly holderName: string | null;
  readonly localVerdict: string;
  readonly serverResult: string;
  readonly scannedAt: string;
  readonly foundAt: string;
  readonly dismissed: boolean;
}

export interface ManifestPage {
  readonly header: ManifestHeader;
  readonly rows: readonly ManifestRow[];
  readonly cursor: string | null;
  readonly complete: boolean;
}

export interface SyncResponse {
  readonly results: readonly {
    readonly scanId: string;
    readonly result: string;
    readonly stored: boolean;
    readonly openSignals?: number;
  }[];
  readonly duplicatesOffline: number;
}

/** Fills a buffer with cryptographically secure random bytes (`expo-crypto` on a phone). */
export type RandomBytes = (length: number) => Uint8Array;
