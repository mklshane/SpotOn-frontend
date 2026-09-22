import type { Coords } from '@/hooks/use-location';

/**
 * Current temperature + UV for the Learn and Home tabs. Two free, keyless sources:
 * Open-Meteo first, MET Norway as the fallback. Online-only by design: nothing is
 * persisted, because stale weather shown offline would be misleading.
 */
export type WeatherSource = 'open-meteo' | 'met-norway';

export type Conditions = {
  tempC: number;
  uv: number;
  /** Null when the source can't say (MET Norway only forecasts forward, so after dark). */
  uvMaxToday: number | null;
  isDay: boolean;
  source: WeatherSource;
  fetchedAt: number;
};

export type UvLevel = 'low' | 'moderate' | 'high' | 'veryHigh' | 'extreme';

/** Metro Manila - shown until the user opts in to location. */
export const DEFAULT_COORDS: Coords = { latitude: 14.5995, longitude: 120.9842 };

export const CONDITIONS_TTL_MS = 15 * 60_000;
const TIMEOUT_MS = 6_000;

const cache = new Map<string, Conditions>();
const inflight = new Map<string, Promise<Conditions>>();
const cacheKey = ({ latitude, longitude }: Coords) => `${latitude.toFixed(2)},${longitude.toFixed(2)}`;

export function getCachedConditions(coords: Coords): Conditions | undefined {
  const hit = cache.get(cacheKey(coords));
  return hit && Date.now() - hit.fetchedAt < CONDITIONS_TTL_MS ? hit : undefined;
}

async function getJson(url: string, headers?: Record<string, string>): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fromOpenMeteo({ latitude, longitude }: Coords): Promise<Conditions> {
  const body = await getJson(
    'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
      '&current=temperature_2m,uv_index,is_day&daily=uv_index_max&timezone=auto&forecast_days=1'
  );
  const tempC = body?.current?.temperature_2m;
  const uv = body?.current?.uv_index;
  const uvMax = body?.daily?.uv_index_max?.[0];
  if (typeof tempC !== 'number' || typeof uv !== 'number') {
    throw new Error('Open-Meteo: malformed response');
  }
  return {
    tempC,
    uv,
    uvMaxToday: typeof uvMax === 'number' ? uvMax : uv,
    isDay: body.current.is_day !== 0,
    source: 'open-meteo',
    fetchedAt: Date.now(),
  };
}

type MetEntry = {
  time: string;
  data: {
    instant: { details: { air_temperature?: number; ultraviolet_index_clear_sky?: number } };
    next_1_hours?: { summary?: { symbol_code?: string } };
  };
};

/**
 * MET Norway's hourly forecast. Its UV is the clear-sky index, so it reads a little
 * high under cloud, which is the safe direction for sun advice. Their terms require
 * an identifying User-Agent (browsers ignore it, which MET tolerates).
 */
async function fromMetNorway({ latitude, longitude }: Coords): Promise<Conditions> {
  const body = await getJson(
    `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`,
    { 'User-Agent': 'SpotOn/1.0 (skin-cancer screening app)' }
  );
  const series: MetEntry[] = body?.properties?.timeseries ?? [];
  const now = Date.now();
  // The first entry is the current hour; pick the closest in case the cache is a little old.
  const current = series.reduce<MetEntry | undefined>(
    (best, e) =>
      !best || Math.abs(Date.parse(e.time) - now) < Math.abs(Date.parse(best.time) - now) ? e : best,
    undefined
  );
  const tempC = current?.data.instant.details.air_temperature;
  const uv = current?.data.instant.details.ultraviolet_index_clear_sky;
  if (typeof tempC !== 'number' || typeof uv !== 'number') {
    throw new Error('MET Norway: malformed response');
  }

  const symbol = current?.data.next_1_hours?.summary?.symbol_code ?? '';
  const hour = new Date().getHours();
  const isDay = symbol.endsWith('_night') ? false : symbol.endsWith('_day') ? true : uv > 0 || (hour >= 6 && hour < 18);

  // Only the remaining hours are available, so after dark there's no peak to report.
  const today = new Date().toDateString();
  const remaining = series
    .filter((e) => new Date(e.time).toDateString() === today)
    .map((e) => e.data.instant.details.ultraviolet_index_clear_sky)
    .filter((v): v is number => typeof v === 'number');
  const uvMaxToday = isDay ? Math.max(uv, ...remaining) : null;

  return { tempC, uv, uvMaxToday, isDay, source: 'met-norway', fetchedAt: Date.now() };
}

export async function fetchConditions(coords: Coords): Promise<Conditions> {
  const cached = getCachedConditions(coords);
  if (cached) return cached;

  // Home and Learn mount together; share one request instead of racing two.
  const key = cacheKey(coords);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = fetchWithFallback(coords).finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

// Open-Meteo's single host is unreliable from some PH networks: connections stall for
// 15-20s or time out outright, while MET Norway answers in ~1s. So hedge: ask Open-Meteo,
// and if it hasn't answered within HEDGE_MS, ask MET Norway too; first good answer wins.
// If both fail, one more round after a brief pause.
const HEDGE_MS = 2_500;

function hedged(coords: Coords): Promise<Conditions> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let failures = 0;
    let started = 1;
    let lastError: unknown;
    const run = (source: (c: Coords) => Promise<Conditions>) =>
      source(coords).then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(hedge);
          resolve(value);
        },
        (error) => {
          lastError = error;
          failures += 1;
          // Open-Meteo failed fast (before the hedge fired) - don't wait, go straight to MET.
          if (started === 1) {
            clearTimeout(hedge);
            started = 2;
            run(fromMetNorway);
          } else if (failures === 2 && !settled) {
            reject(lastError);
          }
        }
      );
    const hedge = setTimeout(() => {
      if (settled || started === 2) return;
      started = 2;
      run(fromMetNorway);
    }, HEDGE_MS);
    run(fromOpenMeteo);
  });
}

async function fetchWithFallback(coords: Coords): Promise<Conditions> {
  let conditions: Conditions;
  try {
    conditions = await hedged(coords);
  } catch {
    await new Promise((r) => setTimeout(r, 1_500));
    conditions = await hedged(coords);
  }
  cache.set(cacheKey(coords), conditions);
  return conditions;
}

/** WHO UV index bands. */
export function uvLevel(uv: number): UvLevel {
  const v = Math.round(uv);
  if (v <= 2) return 'low';
  if (v <= 5) return 'moderate';
  if (v <= 7) return 'high';
  if (v <= 10) return 'veryHigh';
  return 'extreme';
}
