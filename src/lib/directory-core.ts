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
 * A dialable number in the form Filipinos write it, for button labels: "0917 547 7622",
 * "(02) 8894 3952", "(043) 773 6800". Listings spell the same number a dozen ways
 * ("0437564386", "+63 43 756-4386"); the label should not. Unrecognised shapes come back as-is.
 */
export function formatPhone(dial: string): string {
  const m = /^\+63(\d+)$/.exec(dial);
  if (!m) return dial;
  const n = m[1];
  if (n.length === 10 && n.startsWith('9')) return `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  if (n.length === 9 && n.startsWith('2')) return `(02) ${n.slice(1, 5)} ${n.slice(5)}`;
  if (n.length === 9) return `(0${n.slice(0, 2)}) ${n.slice(2, 5)} ${n.slice(5)}`;
  return `0${n}`;
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

// ---- schedules -----------------------------------------------------------------------------

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "03:00 PM" -> "3 PM", "10:30 AM" -> "10:30 AM"; anything else unchanged. */
function shortTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(t.trim());
  if (!m) return t.trim();
  const h = String(Number(m[1]));
  return m[2] === '00' ? `${h} ${m[3].toUpperCase()}` : `${h}:${m[2]} ${m[3].toUpperCase()}`;
}

/** "Mon, Tue, Wed, Fri" -> "Mon–Wed, Fri": runs of 3+ consecutive days collapse. */
function dayRuns(idx: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    if (j - i >= 2) out.push(`${DAY_SHORT[idx[i]]}–${DAY_SHORT[idx[j]]}`);
    else for (let k = i; k <= j; k++) out.push(DAY_SHORT[idx[k]]);
    i = j + 1;
  }
  return out.join(', ');
}

/** "Monday", "Mon", "Thurs" -> 0..6, else -1. */
function dayIndex(word: string): number {
  const w = word.trim().toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return -1;
  return DAYS.findIndex((d) => d.toLowerCase().startsWith(w.slice(0, 3)) && d.toLowerCase().startsWith(w));
}

/** "Monday to Wednesday, Saturday" / "Tuesday and Thursday" / "Friday" -> day indexes, else null. */
function parseDays(text: string): number[] | null {
  const out: number[] = [];
  for (const item of text.split(/,|\band\b|&/i).map((x) => x.trim()).filter(Boolean)) {
    const range = /^(\w+\.?)\s*(?:to|-|–)\s*(\w+\.?)$/i.exec(item);
    if (range) {
      const [a, b] = [dayIndex(range[1]), dayIndex(range[2])];
      if (a < 0 || b < 0) return null;
      for (let d = a; ; d = (d + 1) % 7) {
        out.push(d);
        if (d === b) break;
      }
    } else {
      const d = dayIndex(item);
      if (d < 0) return null;
      out.push(d);
    }
  }
  return out.length ? out : null;
}

const RANGE = /^(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)$/i;

/** "10:00 AM - 03:00 PM, 04:00 PM - 06:00 PM" -> "10 AM–3 PM, 4–6 PM"; null if not times. */
function parseHours(text: string): string | null {
  if (/^by appointment$/i.test(text.trim())) return 'By appointment';
  const parts = text.split(',').map((x) => x.trim());
  const out: string[] = [];
  for (const part of parts) {
    const r = RANGE.exec(part);
    if (!r) return null;
    const [a, b] = [shortTime(r[1]), shortTime(r[2])];
    out.push(a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`);
  }
  return out.join(', ');
}

/**
 * The stored schedule as one short line. Both shapes in the data are read:
 *   "Monday | 10:00 AM - 03:00 PM; Tuesday | 10:00 AM - 03:00 PM"           (hospital rosters)
 *   "Monday to Tuesday, Thursday to Saturday | 11:00 AM - 03:00 PM | (By Appointment)"  (SeriousMD)
 * Days that share hours are grouped and 3+ consecutive days become a range: "Mon–Fri · 10 AM–3 PM",
 * "Mon, Wed · 1–5 PM; Sat · 9 AM–12 PM". Bracketed notes ("By appointment", "first Saturday of
 * the month only") are kept; loose text - contact numbers, secretaries' names - is dropped, since
 * the Call button carries the number. A second listing ("| Also listed: …") becomes a hint.
 * Returns null when no day + hours pair can be read, so callers show the raw text instead.
 */
export function compactSchedule(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const [main, ...also] = raw.split(/\s*\|\s*Also listed:\s*/i);
  const groups = new Map<string, number[]>();
  const notes: string[] = [];
  let days: number[] | null = null;
  for (const seg of main.split(/[|;]/).map((x) => x.trim()).filter(Boolean)) {
    const d = parseDays(seg);
    if (d) {
      days = d;
      continue;
    }
    const h = parseHours(seg);
    if (h && days) {
      groups.set(h, [...(groups.get(h) ?? []), ...days]);
      days = null;
      continue;
    }
    const note = /^\((.*)\)$/.exec(seg);
    if (note) {
      const n = note[1].trim();
      if (n && !notes.some((x) => x.toLowerCase() === n.toLowerCase())) notes.push(n);
    }
    // anything else (phone numbers, "Kindly message …") is dropped
  }
  if (!groups.size) return null;
  const line = [...groups.entries()]
    .sort((x, y) => Math.min(...x[1]) - Math.min(...y[1]))
    .map(([hours, ds]) => `${dayRuns([...new Set(ds)].sort((a, b) => a - b))} · ${hours}`)
    .join('; ');
  const extra = [...notes, also.length ? 'other hours also listed' : null].filter(Boolean);
  return extra.length ? `${line} (${extra.join('; ')})` : line;
}

/** doctor_facility.schedule_days bit for a JS weekday (0 = Sunday): Mon=1 … Sun=64. */
export function scheduleDayBit(jsDay: number): number {
  return jsDay === 0 ? 64 : 1 << (jsDay - 1);
}

// ---- what a listing may claim --------------------------------------------------------------

/**
 * Services shown on a listing. Oncology, histopathology and immunohistochemistry tags came from
 * keyword sweeps of whole hospitals, not from a skin clinic - in a dermatology app they read as
 * "treats skin cancer here". A hospital with no dermatologist on record shows none at all.
 */
const NOT_SKIN_SERVICES = new Set(['oncology_treatment', 'histopathology', 'immunohistochemistry']);
export function displayServices(services: string[], hospitalWithoutDerm: boolean): string[] {
  if (hospitalWithoutDerm) return [];
  return services.filter((s) => !NOT_SKIN_SERVICES.has(s));
}

/**
 * True when a doctor's `city` actually holds a clinic name ("Dermcare Skin Clinic",
 * "St Lukes Global Room 1102") - about a fifth of PDS imports. Such a value must not be
 * shown as the doctor's location.
 */
export function looksLikePlaceName(city: string | null | undefined): boolean {
  return !!city && /clinic|hospital|medical|cent(er|re)|derm|skin|room|bldg|building|floor|tower|plaza|mall|@|\d{3,}/i.test(city);
}

/** For list cards, which only have the row: a hospital with no dermatologist on record. */
export function isHospitalWithoutDerm(f: { type?: string | null; derm_status?: string | null }): boolean {
  const hospital = f.type === 'private_hospital' || f.type === 'government_hospital' || f.type === 'medical_center';
  return hospital && f.derm_status !== 'has_derm_doctors';
}
