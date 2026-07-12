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

/** "2026-07-17T08:00:00Z" (or a plain date) -> "Jul 17, 2026". */
export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Whole days elapsed since an ISO date/timestamp (0 for today, NaN if unparsable). */
export function daysSince(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return Number.NaN;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

/** Display name for a facility: hospitals with a confirmed dermatology
 * department get it appended as a clarification, e.g.
 * "Bethany Hospital (Dermatology Clinic)". The stored name is never mutated. */
export function facilityDisplayName(f: {
  name: string;
  department_info?: { has_derm_department?: boolean | null; department_name?: string | null } | null;
}): string {
  const d = f.department_info;
  if (d?.has_derm_department && d.department_name && !f.name.includes(d.department_name)) {
    return `${f.name} (${d.department_name})`;
  }
  return f.name;
}

/** "dermatology_clinic" -> "Dermatology Clinic". Used everywhere a raw taxonomy tag
 * (facility type or service) would otherwise leak into the UI. */
export function humanizeTag(tag: string): string {
  return tag
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
