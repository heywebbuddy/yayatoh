import type { Tone } from '@yayatoh/ai/ui';

/** M6.12b: the result of one AI call, as the panel shows it. */
export interface AiComposeResult<T> {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
  readonly fields?: readonly string[];
  readonly retryMinutes?: number;
  readonly balance?: number;
  readonly value?: T;
}

export interface AiComposeKit {
  readonly id: string;
  readonly name: string;
  readonly tone: Tone;
  readonly isDefault: boolean;
}

export interface AiComposeSetup {
  /** False when no AI provider is configured for this deployment. */
  readonly enabled: boolean;
  readonly balance: number;
  readonly allowance: number;
  readonly kits: readonly AiComposeKit[];
}

export interface AiComposeValues {
  readonly tone: Tone;
  readonly brandKitId: string;
  readonly brief: string;
  readonly eventId: string;
}

/** A segment definition in a URL (`?suggestion=`): base64url of its JSON (browser and server). */
export function encodeSuggestion(definition: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(definition));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSuggestion(raw: string): unknown {
  try {
    const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
