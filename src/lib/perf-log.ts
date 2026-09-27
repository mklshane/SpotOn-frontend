/**
 * Release-safe stage timing for the capture -> result flow. Off unless the bundle was built with
 * EXPO_PUBLIC_PERF_LOG=1 (inlined at bundle time, so a normal build pays one constant branch).
 * Lines reach logcat as ReactNativeJS even in a release APK:
 *   adb logcat -v time ReactNativeJS:V '*:S' | grep '\[perf\]'
 */
export const PERF_LOG = process.env.EXPO_PUBLIC_PERF_LOG === '1';

const marks = new Map<string, number>();

/** Start (or restart) a named clock that later stages measure against. */
export function perfMark(name: string): void {
  if (PERF_LOG) marks.set(name, Date.now());
}

/** ms since `perfMark(name)`, or -1 when the mark was never set. */
export function perfSince(name: string): number {
  const at = marks.get(name);
  return at === undefined ? -1 : Date.now() - at;
}

export function perfLog(stage: string, ms: number, extra = ''): void {
  if (!PERF_LOG) return;
  console.log(`[perf] ${stage} ${Math.round(ms)}ms${extra ? ' ' + extra : ''}`);
}
