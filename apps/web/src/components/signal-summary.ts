import type { FraudSignalDto } from '@yayatoh/checkin';

type T = (key: string, values?: Record<string, string | number>) => string;

/** Severity as a status dot (ADR 0018: dots, never filled badges). */
export const SEVERITY_DOT = { high: 'danger', medium: 'warning', low: 'neutral' } as const;

/**
 * The " · …" tail that says what a signal is about: who, where, and the numbers that tripped it
 * (door screen and fraud list share it).
 */
export function signalSummary(s: FraudSignalDto, t: T, nameOf: (userId: string) => string): string {
  const parts: string[] = [];
  if (s.holderName) parts.push(s.holderName);
  if (s.kind === 'impossible_travel' && s.fromCheckpointName && s.checkpointName)
    parts.push(t('signals.travel', { from: s.fromCheckpointName, to: s.checkpointName }));
  else if (s.checkpointName) parts.push(s.checkpointName);
  if (s.deviceLabel) parts.push(s.deviceLabel);
  else if (s.userId) parts.push(nameOf(s.userId));
  const d = s.detail;
  if (s.kind === 'device_velocity' && d.count !== null && d.limit !== null)
    parts.push(t('signals.rate', { count: d.count, limit: d.limit }));
  if (s.kind === 'rejected_burst' && d.count !== null && d.windowSeconds !== null)
    parts.push(t('signals.refused', { count: d.count, seconds: d.windowSeconds }));
  if (s.kind === 'impossible_travel' && d.distanceM !== null && d.seconds !== null && d.kmh !== null)
    parts.push(t('signals.speed', { metres: d.distanceM, seconds: d.seconds, kmh: d.kmh }));
  return parts.map((p) => ` · ${p}`).join('');
}
