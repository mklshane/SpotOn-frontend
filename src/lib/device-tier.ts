import * as Device from 'expo-device';
import { useSyncExternalStore } from 'react';

/**
 * Coarse device capability tier, resolved once at startup.
 *
 * The live detector (scan/capture.tsx) is the heaviest thing the app does: a per-frame native
 * downscale plus a TFLite pass plus a YOLO decode in JS. On a current phone that fits comfortably
 * in a 12 fps budget; on a 3–4 GB budget Android it does not, and the whole UI janks. Rather than
 * tuning for the worst device and making good ones feel sluggish, the camera reads this tier and
 * scales its cadence, its analysis resolution, and its decorative animations.
 *
 * Deliberately two-valued. A finer scale would imply a precision we can't justify — `totalMemory`
 * and `deviceYearClass` are the only signals available before the camera starts, and neither
 * measures the thing we actually care about (sustained CPU under thermal load).
 */
export type DeviceTier = 'low' | 'high';

const GB = 1024 * 1024 * 1024;

/**
 * Below this reported RAM the device is treated as low-end. Note Android's `totalMem` reports
 * what the kernel can address, which lands a few hundred MB *under* the nominal spec — so a
 * phone marketed as "4 GB" reports ~3.7 GB and correctly falls on the low side of this line.
 * iOS reports `physicalMemory` exactly, so a 4 GB iPhone sits on the high side.
 */
const LOW_MEMORY_BYTES = 4 * GB;

/** Facebook's device-year-class: roughly "this device performs like a flagship from year N". */
const LOW_YEAR_CLASS = 2019;

function resolveTier(): DeviceTier {
  // Simulators report the host machine's specs, which say nothing about the target device.
  if (!Device.isDevice) return 'high';

  const mem = Device.totalMemory;
  if (typeof mem === 'number' && mem > 0 && mem < LOW_MEMORY_BYTES) return 'low';

  const year = Device.deviceYearClass;
  if (typeof year === 'number' && year > 0 && year < LOW_YEAR_CLASS) return 'low';

  // Unknown on both signals → assume capable. Under-tiering a weak phone costs some smoothness;
  // over-tiering a good one permanently degrades the experience for everyone we can't measure.
  return 'high';
}

const detected = resolveTier();

let override: DeviceTier | null = null;
const listeners = new Set<() => void>();

/** The resolved tier, honouring any dev override. */
export function getDeviceTier(): DeviceTier {
  return override ?? detected;
}

/** What the hardware actually reports, ignoring any override — for the dev HUD. */
export const DETECTED_TIER: DeviceTier = detected;

/**
 * Force a tier at runtime (`__DEV__` only). Testing happens on a current iPhone, so this is the
 * only way to exercise the low-end code path before it reaches a low-end Android.
 */
export function setDeviceTierOverride(tier: DeviceTier | null): void {
  if (!__DEV__) return;
  if (override === tier) return;
  override = tier;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive tier — re-renders when a dev override flips it. */
export function useDeviceTier(): DeviceTier {
  return useSyncExternalStore(subscribe, getDeviceTier, getDeviceTier);
}

/** One-line summary of what drove the decision, for the dev HUD. */
export function describeDeviceTier(): string {
  const mem = Device.totalMemory;
  const gb = typeof mem === 'number' && mem > 0 ? `${(mem / GB).toFixed(1)}GB` : 'mem?';
  const year = Device.deviceYearClass ?? '?';
  return `${getDeviceTier()}${override ? ' (forced)' : ''} · ${gb} · yc${year}`;
}
