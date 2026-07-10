import type { HoursPeriod } from '@/api/types';

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12} ${period}` : `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

export function formatHours(period: HoursPeriod | null): string {
  if (!period) return 'Hours unavailable';
  return `${to12h(period.open)} – ${to12h(period.close)}`;
}

/** true = open, false = closed, null = no hours data to judge by. Handles
 * overnight ranges (close time earlier than open time). */
export function isOpenNow(weekdayHours: HoursPeriod | null, weekendHours: HoursPeriod | null): boolean | null {
  const now = new Date();
  const day = now.getDay(); // 0 Sun .. 6 Sat
  const period = day === 0 || day === 6 ? weekendHours : weekdayHours;
  if (!period) return null;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = period.open.split(':').map(Number);
  const [closeH, closeM] = period.close.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  if (closeMinutes <= openMinutes) return minutes >= openMinutes || minutes < closeMinutes;
  return minutes >= openMinutes && minutes < closeMinutes;
}
