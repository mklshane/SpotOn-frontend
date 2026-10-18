/**
 * Directory text that needs the active language. directory-core.ts and concerns.ts stay
 * import-free (they are compiled standalone by scripts/test-directory-core.mjs), so their English
 * schedule output is translated here, at the display site.
 */
import { formatScheduleDays } from './concerns';
import type { DermSummary } from './directory-core';
import { compactSchedule, scheduleDayBit, zonedDayMinutes } from './directory-core';
import { formatSchedule } from './format';
import { t } from './i18n/core';

/** Literal t() calls so the i18n coverage guard sees every token. */
function tokens(): Record<string, string> {
  return {
    Mon: t('Mon'),
    Tue: t('Tue'),
    Wed: t('Wed'),
    Thu: t('Thu'),
    Fri: t('Fri'),
    Sat: t('Sat'),
    Sun: t('Sun'),
    Daily: t('Daily'),
    'By appointment': t('By appointment'),
    'other hours also listed': t('other hours also listed'),
  };
}

const TOKEN_RE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Daily)\b|by appointment|other hours also listed/gi;

/** Translate the app-generated words in a schedule line; the data's own notes are left as written. */
export function localizeSchedule(text: string): string {
  const map = tokens();
  return text.replace(TOKEN_RE, (m) => {
    const key = /^by appointment$/i.test(m) ? 'By appointment' : m;
    return map[key] ?? m;
  });
}

/** "Tue, Thu, Sat" from a schedule_days bitmask, translated; null when unknown. */
export function scheduleDaysText(mask: number | null | undefined): string | null {
  const days = formatScheduleDays(mask);
  return days ? localizeSchedule(days) : null;
}

/**
 * One doctor↔clinic schedule for display: the compact form (translated) when it parses, else the
 * raw listing text untouched - day-name replacement on free text would turn "Sun Life Bldg" into
 * "Lin Life Bldg".
 */
export function scheduleText(schedule: string | null | undefined, days: number | null | undefined): string | null {
  if (schedule) {
    const compact = compactSchedule(schedule);
    return compact ? localizeSchedule(compact) : formatSchedule(schedule);
  }
  return scheduleDaysText(days);
}

/** Today's bit in the doctor_facility.schedule_days mask, in clinic (Manila) time. */
export function todayScheduleBit(at: Date = new Date()): number {
  return scheduleDayBit(zonedDayMinutes(at).day);
}

/** "3 dermatologists · in today" / "1 dermatologist" for a list card; null when none linked. */
export function dermSummaryLine(summary: DermSummary | undefined, todayBit: number): string | null {
  if (!summary?.count) return null;
  const count = summary.count === 1 ? t('1 dermatologist') : t('{{count}} dermatologists', { count: summary.count });
  return summary.daysMask & todayBit ? t('{{count}} · in today', { count }) : count;
}

/**
 * A doctor's room for display. Only a bare room code gets the "Room" prefix ("329", "B-12");
 * listings often already say what it is ("Room 305", "Hall B 231", "SPECIALTY CLINIC"), which
 * read as "Room Room 305" / "Room SPECIALTY CLINIC" before.
 */
export function roomText(room: string): string {
  const r = room.trim();
  if (/^(room|rm)\b/i.test(r)) return r.replace(/^(room|rm)\b\.?\s*/i, t('Room') + ' ');
  return /^[A-Z]?-?\d+[A-Z]?$/i.test(r) ? t('Room {{room}}', { room: r }) : r;
}
