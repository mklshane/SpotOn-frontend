/**
 * Pure helpers behind the directory's Call / Website / Book / "Open now" affordances.
 *
 * Zero imports on purpose, like tps-core.ts: scripts/test-directory-core.mjs compiles this file
 * standalone and pins the phone, URL and opening-hours behaviour against real directory data.
 */

/** One dialable number pulled out of a free-text phone field. */
export type PhoneOption = {
  /** As written in the listing, trimmed - what the user sees. */
  display: string;
  /** What goes after `tel:` - E.164 (+63…) when the number is recognisably Philippine. */
  dial: string;
};

/**
 * Split a listing's phone field into separately dialable numbers.
 *
 * About 2% of listings hold several numbers in one field ("0917-547-7622, 7982572, 0976 002 1552",
 * "(0977) 855-5769, (02) 7900-1316"). Stripping every non-digit used to fuse them into one long
 * invalid number, so tapping Call did nothing useful. Extensions ("loc. 12") are dropped - a dialer
 * can't use them and they used to be glued onto the number too.
 */
export function splitPhones(raw: string | null | undefined): PhoneOption[] {
  if (!raw) return [];
  const out: PhoneOption[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;/|]|\s+(?:or|and|at)\s+/i)) {
    const display = part
      .replace(/\s*(?:loc(?:al)?|ext(?:ension)?|x)\.?\s*\d+\s*$/i, '')
      .trim();
    const dial = toDialable(display);
    if (!dial || seen.has(dial)) continue;
    seen.add(dial);
    out.push({ display, dial });
  }
  return out;
}

/**
 * One number → a `tel:` target. PH mobile/landline with a trunk 0 become +63…; numbers already in
 * +63/63 form are kept; a bare 7-8 digit local number is left as-is (the dialer applies the caller's
 * own area code, which is the best we can do without knowing the clinic's). Null when there are
 * too few digits to be a phone number.
 */
export function toDialable(part: string): string | null {
  const plus = part.trim().startsWith('+');
  const digits = part.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (plus) return `+${digits}`;
  if (digits.startsWith('63') && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith('0') && digits.length >= 9) return `+63${digits.slice(1)}`;
  return digits;
}

/**
 * A listing URL → something safe to open, or null. Adds a missing scheme ("www.clinic.ph"),
 * rejects anything but http(s) (mailto:, javascript:, tel: in a website field) and strings that
 * don't parse. A null means the UI should hide the button rather than show one that does nothing.
 */
export function normalizeUrl(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s || /\s/.test(s)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname.includes('.')) return null;
  return url.toString();
}

export type HoursPeriodLike = { open: string; close: string };

/** "HH:MM" → minutes since midnight, or null for anything else ("9:00 AM" used to render 9:NaN). */
export function parseHHMM(s: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s?.trim() ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** A period only if both ends parse - a half-valid period must not answer "open now". */
export function validPeriod<T extends HoursPeriodLike>(p: T | null | undefined): T | null {
  return p && parseHHMM(p.open) != null && parseHHMM(p.close) != null ? p : null;
}

/** The directory's clinics are all in the Philippines; their hours are Manila wall-clock time. */
export const CLINIC_TIME_ZONE = 'Asia/Manila';

/** Day of week (0 Sun .. 6 Sat) and minutes since midnight of `at`, in `timeZone`. */
export function zonedDayMinutes(at: Date, timeZone: string = CLINIC_TIME_ZONE): { day: number; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    const hour = Number(get('hour')) % 24;
    const minute = Number(get('minute'));
    if (day >= 0 && Number.isFinite(hour) && Number.isFinite(minute)) {
      return { day, minutes: hour * 60 + minute };
    }
  } catch {
    // Hermes without full Intl time-zone data: fall through to a fixed UTC+8 offset (PH has no DST).
  }
  const shifted = new Date(at.getTime() + 8 * 3_600_000);
  return { day: shifted.getUTCDay(), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

export type OpenStatus = {
  /** true open, false closed, null = no usable hours for today. */
  open: boolean | null;
  /** When `open` flips next today, "HH:MM": closing time if open, opening time if not yet open. */
  changesAt: string | null;
};

/**
 * Is the clinic open at `at` (Manila time)? Handles open-24-hours (open === close), overnight
 * periods (close earlier than open), and the overnight tail of YESTERDAY's period - Friday
 * 20:00-02:00 is still open at Saturday 01:00, which the old same-day-only check called Closed.
 */
export function openStatusAt(
  weekdayHours: HoursPeriodLike | null,
  weekendHours: HoursPeriodLike | null,
  at: Date,
  timeZone: string = CLINIC_TIME_ZONE,
): OpenStatus {
  const { day, minutes } = zonedDayMinutes(at, timeZone);
  const periodFor = (d: number) => validPeriod(d === 0 || d === 6 ? weekendHours : weekdayHours);
  const today = periodFor(day);
  const yesterday = periodFor((day + 6) % 7);

  if (yesterday) {
    const o = parseHHMM(yesterday.open)!;
    const c = parseHHMM(yesterday.close)!;
    if (c < o && minutes < c) return { open: true, changesAt: yesterday.close };
  }
  if (!today) return { open: null, changesAt: null };

  const o = parseHHMM(today.open)!;
  const c = parseHHMM(today.close)!;
  if (o === c) return { open: true, changesAt: null }; // open 24 hours
  if (c < o) {
    return minutes >= o ? { open: true, changesAt: null } : { open: false, changesAt: today.open };
  }
  if (minutes >= o && minutes < c) return { open: true, changesAt: today.close };
  return { open: false, changesAt: minutes < o ? today.open : null };
}

/** Great-circle distance in metres. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
