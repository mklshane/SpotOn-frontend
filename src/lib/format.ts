export function formatFee(pesos: number): string {
  return `₱${pesos.toLocaleString('en-PH')}`;
}

export function formatFeeRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null && min !== max) {
    return `${formatFee(min)}–${formatFee(max)}`;
  }
  return formatFee((min ?? max) as number);
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** "dermatology_clinic" -> "Dermatology Clinic". Used everywhere a raw taxonomy tag
 * (facility type or service) would otherwise leak into the UI. */
export function humanizeTag(tag: string): string {
  return tag
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
