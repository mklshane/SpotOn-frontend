/**
 * Display formatting for UserProfile fields.
 *
 * Kept separate from `src/lib/profile.ts` (which imports the API client) so the offline
 * Screening Summary Report can format a patient block without pulling network code into
 * its dependency graph.
 */

export const SEX_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  intersex: 'Intersex',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
};

export const SKIN_TYPE_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function computeAge(dob: string | null | undefined): number | null {
  if (!dob) return null;
  // Parse "YYYY-MM-DD" as a local date, not `new Date(dob)`'s UTC-midnight
  // parsing — the latter can roll the birth date back a day in timezones
  // behind UTC once read back via local getMonth()/getDate().
  const [y, m, d] = dob.split('-').map(Number);
  if (!y || !m || !d) return null;
  const birth = new Date(y, m - 1, d);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

export function skinTypeLabel(type: number | null | undefined): string {
  if (type == null || type < 1 || type > 6) return '—';
  return `Type ${SKIN_TYPE_ROMAN[type - 1]}`;
}

/** "male" -> "Male". Null when unset, so callers can pick their own placeholder. */
export function sexLabel(sex: string | null | undefined): string | null {
  if (!sex) return null;
  return SEX_LABELS[sex] ?? null;
}

/**
 * "1985-03-14" -> "March 14, 1985". Field-wise, not Intl — a date-only string has no
 * timezone and must never be shifted by one.
 */
export function formatLongDate(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return null;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
