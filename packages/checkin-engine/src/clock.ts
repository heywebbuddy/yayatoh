/**
 * The device's clock offset (server time − device time) from one request: the server stamped
 * `serverTime` somewhere between the device sending the request (`sentAt`) and reading the
 * answer (`receivedAt`), so the true offset lies in [serverTime − receivedAt, serverTime − sentAt].
 * The estimate is the value in that interval closest to zero: a clock the measurement cannot
 * prove wrong is not corrected, and a wrong one is corrected only by what is proven. Offline
 * first-wins compares corrected times across devices, so a correction that is only network or
 * server latency would reorder scans a moment apart on two devices with good clocks.
 */
export function clockOffsetMs(sample: { serverTime: number; sentAt: number; receivedAt: number }): number {
  const sentAt = Math.min(sample.sentAt, sample.receivedAt);
  const receivedAt = Math.max(sample.sentAt, sample.receivedAt);
  const low = sample.serverTime - receivedAt;
  const high = sample.serverTime - sentAt;
  if (low > 0) return low;
  if (high < 0) return high;
  return 0;
}
