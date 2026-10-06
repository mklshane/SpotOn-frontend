import type { HoursPeriod } from '@/api/types';
import { openStatusAt, validPeriod, type OpenStatus } from './directory-core';
import { t } from './i18n/core';

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 && h < 24 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12} ${period}` : `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** "9 AM" / "5:30 PM" for one "HH:MM" endpoint. */
export function formatTime(hhmm: string): string {
  return to12h(hhmm);
}

export function formatHours(period: HoursPeriod | null): string {
  // A malformed period ("9:00 AM" from a scraper) rendered as "9:NaN AM" - treat it as absent.
  if (!validPeriod(period)) return t('Hours unavailable');
  const p = period as HoursPeriod;
  // open === close encodes always-open (hospitals Google reports as "Open 24
  // hours"). openStatusAt reads it the same way.
  if (p.open === p.close) return t('Open 24 hours');
  return `${to12h(p.open)} – ${to12h(p.close)}`;
}

/**
 * "Mon–Fri 9 AM – 5 PM", or just "Hours unavailable" when there is no period.
 *
 * Pairing a day label with the fallback produced "Mon–Fri Hours unavailable", which reads as a
 * claim about weekday hours rather than an absence of data - so the label is dropped with it.
 */
export function formatHoursLine(label: string, period: HoursPeriod | null): string {
  return validPeriod(period) ? `${t(label)} ${formatHours(period)}` : formatHours(null);
}

/**
 * Open/closed right now plus when that changes today, evaluated in Manila time (the clinics'
 * wall clock) rather than the device's zone, including the overnight tail of yesterday's hours.
 */
export function openStatus(weekdayHours: HoursPeriod | null, weekendHours: HoursPeriod | null): OpenStatus {
  return openStatusAt(weekdayHours, weekendHours, new Date());
}

/** true = open, false = closed, null = no hours data to judge by. */
export function isOpenNow(weekdayHours: HoursPeriod | null, weekendHours: HoursPeriod | null): boolean | null {
  return openStatus(weekdayHours, weekendHours).open;
}

/** "Closes 5 PM" / "Opens 9 AM" / null - the context an Open/Closed badge needs to be useful. */
export function openChangeLabel(status: OpenStatus): string | null {
  if (!status.changesAt || status.open == null) return null;
  return status.open
    ? t('Closes {{time}}', { time: to12h(status.changesAt) })
    : t('Opens {{time}}', { time: to12h(status.changesAt) });
}
