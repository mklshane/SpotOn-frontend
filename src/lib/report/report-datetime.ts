/**
 * Date/time labels for the Screening Summary Report, in Philippine time.
 *
 * Deliberately Intl-free. `toLocaleString(…, { timeZone: 'Asia/Manila' })` depends on the
 * ICU data bundled with the JS engine — Hermes on Android ships a reduced set and can
 * silently ignore the zone. The Philippines has never observed DST in the app's lifetime,
 * so a fixed +08:00 shift is exact rather than an approximation.
 */

const PHT_OFFSET_MIN = 8 * 60;

const MONTHS_SHORT = [
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

/** Shifts an instant so the UTC field getters read out Philippine wall-clock values. */
function toPht(iso: string): Date | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + PHT_OFFSET_MIN * 60_000);
}

/** ISO instant -> "May 13, 2026". */
export function phtDateLabel(iso: string): string {
  const d = toPht(iso);
  if (!d) return '—';
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** ISO instant -> "09:42 AM PHT". */
export function phtTimeLabel(iso: string): string {
  const d = toPht(iso);
  if (!d) return '—';
  const h24 = d.getUTCHours();
  const meridiem = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${String(h12).padStart(2, '0')}:${mm} ${meridiem} PHT`;
}

/** ISO instant -> "2026-05-13", for the exported filename. */
export function phtFileStamp(iso: string): string {
  const d = toPht(iso);
  if (!d) return 'undated';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}
