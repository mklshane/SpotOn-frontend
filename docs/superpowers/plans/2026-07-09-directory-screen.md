# Directory Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SpotOn Directory tab end-to-end per `docs/DIRECTORY_SCREEN.md`: a Clinics segment (full-screen MapLibre map + draggable bottom-sheet list, offline-first) and an Online Booking segment (searchable doctor list → booking links), plus clinic/doctor detail screens.

**Architecture:** `src/app/(tabs)/directory.tsx` owns segment/search state and a floating top overlay; it renders either `ClinicsView` (map + `@gorhom/bottom-sheet` list, reading from `nearbyFacilities`/`listFacilities`) or `DoctorsView` (plain list, reading from `listDoctors`). All data comes from the **already-existing** offline SQLite mirror (`src/data/repositories.ts` — do not modify the schema or sync layer). The native map is defensively guarded (`src/lib/maplibre.ts`) so the app runs before a dev build exists; it degrades to a list until `expo prebuild` links the native module.

**Tech Stack:** Expo SDK 56, `@maplibre/maplibre-react-native` 11.x, `expo-location`, `@react-native-community/netinfo`, `@gorhom/bottom-sheet` 5.x (on top of the already-installed `react-native-reanimated` 4 / `react-native-gesture-handler` 2), `expo-sqlite` (existing), `expo-router`.

---

## Before you start — read this

**This project has no test runner** (no jest/vitest, no `test` script beyond two Node smoke scripts). Verification is `npx tsc --noEmit`, `npx expo lint`, and `npx expo export --platform ios` (bundles cleanly), exactly as `docs/DIRECTORY_SCREEN.md` §9 prescribes. Each task below ends with those checks instead of a TDD red/green cycle — that's this codebase's actual convention, not a shortcut.

**Two deliberate deviations from `docs/DIRECTORY_SCREEN.md`, both forced by the current repo state (verified by reading the code, not assumed):**

1. **No `facility_type` / `booking_url` fields.** `src/api/types.ts:28-29` already has a comment: *"booking_url / facility_type exist in the DB but are not yet exposed by the /sync schema — add them server-side when needed."* The backend repo isn't part of this checkout, so we can't add them. We use the existing `type` field (e.g. `"dermatology_clinic"`) run through a new `humanizeTag()` helper (→ "Dermatology Clinic") everywhere the doc says "practice type" or "specialization fallback" — this satisfies the doc's "never the raw facility_type" rule without a new column. Clinic detail's action row is **Call / Website** plus a tappable address row for directions — no "Book online" button, since there's no `booking_url` to open.
2. **No live device/simulator verification in this session.** `@maplibre/maplibre-react-native` and `expo-location` are native modules — they only work after `npx expo prebuild && npx expo run:ios` (or `run:android`/EAS), which needs Xcode/Android SDK and a device or simulator. That's not available here. Every task's automated verification is `tsc`/`lint`/`export`. Task 17 ends with the manual on-device checklist from `docs/DIRECTORY_SCREEN.md` §9 for **you** to run after a dev build — do not claim those items are verified without actually running them.

**MapLibre React Native API note:** the doc's prose (`MapView`, `GeoJSONSource`, `Marker`, `Camera`) is close but the installed package (`@maplibre/maplibre-react-native@11.3.6`, confirmed against its published source) actually exports the map container as **`Map`** (aliased `MapLibreMap` in our code — `Map` is a JS global), plus `Camera`, `UserLocation`, `GeoJSONSource`, `Layer` (`type="circle"`, kebab-case `paint` keys like `circle-radius`), `Marker` (prop `lngLat`, not `coordinate`), and `OfflineManager`. All code below uses the real, confirmed API — don't "correct" it back to the doc's looser prose.

---

## File structure

**New:**
- `src/lib/format.ts` — `formatFee`, `formatFeeRange`, `formatDistance`, `humanizeTag`
- `src/lib/hours.ts` — `formatHours`, `isOpenNow`
- `src/lib/links.ts` — `callNumber`, `openWebsite`, `openDirections`
- `src/lib/maplibre.ts` — guarded re-exports + `MAP_AVAILABLE`
- `src/lib/map-offline.ts` — `downloadAreaPack`
- `src/hooks/use-debounced-value.ts`
- `src/hooks/use-connectivity.ts`
- `src/hooks/use-location.ts`
- `src/components/ui/badge.tsx`
- `src/components/ui/chip.tsx`
- `src/components/ui/star-rating.tsx`
- `src/components/ui/list-state.tsx`
- `src/components/directory/DirectorySegments.tsx`
- `src/components/directory/SearchBar.tsx`
- `src/components/directory/DoctorCard.tsx`
- `src/components/directory/DoctorsView.tsx`
- `src/components/directory/ClinicCard.tsx`
- `src/components/directory/ClinicPreviewCard.tsx`
- `src/components/directory/ClinicMap.tsx`
- `src/components/directory/ClinicsView.tsx`
- `src/app/directory/_layout.tsx`
- `src/app/directory/doctor.tsx`
- `src/app/directory/clinic.tsx`

**Modify:**
- `package.json` (via `npx expo install`)
- `app.json` (plugins)
- `src/config.ts` (map constants)
- `.env.example` (MapTiler key placeholder)
- `src/components/ui/icon.tsx` (`VECTOR_MAP` additions)
- `src/app/(tabs)/directory.tsx` (replace placeholder)
- `src/app/_layout.tsx` (register `directory` detail stack)

**Untouched (read-only for this feature):** `src/data/db.ts`, `src/data/sync.ts`, `src/data/repositories.ts`, `src/api/types.ts`.

---

### Task 1: Native dependencies + config

**Files:**
- Modify: `package.json` (via CLI, not hand-edited)
- Modify: `app.json`
- Modify: `src/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Install native deps**

Run:
```bash
npx expo install @maplibre/maplibre-react-native @types/geojson expo-location @react-native-community/netinfo @gorhom/bottom-sheet
```
Expected: installs cleanly (all four packages' peer deps — `expo>=54`, `react>=19.1`, `react-native>=0.80`, `react-native-reanimated>=3.16||>=4.0`, `react-native-gesture-handler>=2.16.1` — are already satisfied by this project's versions). No `--legacy-peer-deps` needed.

- [ ] **Step 2: Register config plugins in `app.json`**

Add to the `"plugins"` array (after the existing `"expo-image-picker"` entry, before `"react-native-vision-camera"` — order doesn't matter functionally, keep it readable):

```json
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "Allow SpotOn to use your location to find clinics near you."
        }
      ],
      "@maplibre/maplibre-react-native"
```

- [ ] **Step 3: Add map constants to `src/config.ts`**

Append to the end of the file:

```ts
/**
 * MapTiler key for the MapLibre style URL. Client-safe (restrict by bundle id in
 * MapTiler's dashboard) — set in `.env`, gitignored. Empty string when unset, which
 * `MAP_AVAILABLE` (src/lib/maplibre.ts) treats as "map not ready".
 */
export const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY ?? "";

export const MAP_STYLE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : "";

/** Fallback map center/zoom when location is denied or unavailable — Metro Manila. */
export const MAP_DEFAULT = {
  latitude: 14.5995,
  longitude: 120.9842,
  zoom: 11,
} as const;
```

- [ ] **Step 4: Add the env placeholder**

Append to `.env.example`:
```
EXPO_PUBLIC_MAPTILER_KEY=
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (new packages ship their own types; `config.ts` additions are self-contained).

- [ ] **Step 6: Commit**

```bash
git add package.json app.json src/config.ts .env.example
git commit -m "chore(directory): add map/location/connectivity/bottom-sheet deps and config"
```

(If `package-lock.json`/`yarn.lock` changed, add that too.)

---

### Task 2: Shared formatting/hours/links libs

**Files:**
- Create: `src/lib/format.ts`
- Create: `src/lib/hours.ts`
- Create: `src/lib/links.ts`

- [ ] **Step 1: Write `src/lib/format.ts`**

```ts
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
```

- [ ] **Step 2: Write `src/lib/hours.ts`**

```ts
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
```

- [ ] **Step 3: Write `src/lib/links.ts`**

```ts
import * as Linking from 'expo-linking';
import { openBrowserAsync } from 'expo-web-browser';

export function callNumber(phone: string): void {
  Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`).catch(() => {});
}

export function openWebsite(url: string): void {
  openBrowserAsync(url).catch(() => {});
}

export function openDirections(opts: {
  googleMapsUrl?: string | null;
  latitude: number;
  longitude: number;
}): void {
  const url =
    opts.googleMapsUrl || `https://www.google.com/maps/dir/?api=1&destination=${opts.latitude},${opts.longitude}`;
  Linking.openURL(url).catch(() => {});
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/hours.ts src/lib/links.ts
git commit -m "feat(directory): add format, hours, and links helpers"
```

---

### Task 3: Hooks — debounce, connectivity, location

**Files:**
- Create: `src/hooks/use-debounced-value.ts`
- Create: `src/hooks/use-connectivity.ts`
- Create: `src/hooks/use-location.ts`

- [ ] **Step 1: Write `src/hooks/use-debounced-value.ts`**

```ts
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
```

- [ ] **Step 2: Write `src/hooks/use-connectivity.ts`**

```ts
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export function useConnectivity(): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected !== false && state.isInternetReachable !== false);
    });
  }, []);

  return { isOnline };
}

/** One-shot connectivity check outside React render (e.g. before an offline-pack download). */
export async function isOnlineNow(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected !== false && state.isInternetReachable !== false;
}
```

- [ ] **Step 3: Write `src/hooks/use-location.ts`**

```ts
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export type Coords = { latitude: number; longitude: number };
export type LocationStatus = 'idle' | 'granted' | 'denied';

/** Foreground GPS fix. Works fully offline — only map tiles need connectivity. */
export function useLocation(): { coords: Coords | null; status: LocationStatus } {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { status: permission } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (permission !== 'granted') {
        setStatus('denied');
        return;
      }
      setStatus('granted');
      try {
        const position = await Location.getCurrentPositionAsync({});
        if (!cancelled) {
          setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        }
      } catch {
        // GPS fix unavailable — leave coords null, callers fall back to a name-sorted list.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { coords, status };
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-debounced-value.ts src/hooks/use-connectivity.ts src/hooks/use-location.ts
git commit -m "feat(directory): add debounce, connectivity, and location hooks"
```

---

### Task 4: Icon additions

**Files:**
- Modify: `src/components/ui/icon.tsx`

- [ ] **Step 1: Add new SF Symbol → vector-icon mappings**

In `src/components/ui/icon.tsx`, insert these entries into `VECTOR_MAP` (anywhere in the object — grouped here for readability, e.g. right after the `pencil` entry at the end):

```ts
  'magnifyingglass': { set: 'ionicons', name: 'search' },
  'xmark.circle.fill': { set: 'ionicons', name: 'close-circle' },
  minus: { set: 'ionicons', name: 'remove' },
  'star.fill': { set: 'ionicons', name: 'star' },
  'clock.fill': { set: 'ionicons', name: 'time' },
  'phone.fill': { set: 'ionicons', name: 'call' },
  globe: { set: 'ionicons', name: 'globe-outline' },
  'arrow.up.arrow.down': { set: 'ionicons', name: 'swap-vertical' },
  'mappin.circle.fill': { set: 'ionicons', name: 'location' },
  'wifi.slash': { set: 'ionicons', name: 'cloud-offline-outline' },
  'checkmark.seal.fill': { set: 'ionicons', name: 'checkmark-circle' },
  'arrow.triangle.turn.up.right.diamond.fill': { set: 'ionicons', name: 'navigate' },
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (this is a plain object literal addition to an existing `Record<string, VectorSpec>`).

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/icon.tsx
git commit -m "feat(directory): add SF Symbol mappings needed by the directory screen"
```

---

### Task 5: UI primitives — badge, chip, star-rating, list-state

**Files:**
- Create: `src/components/ui/badge.tsx`
- Create: `src/components/ui/chip.tsx`
- Create: `src/components/ui/star-rating.tsx`
- Create: `src/components/ui/list-state.tsx`

- [ ] **Step 1: Write `src/components/ui/badge.tsx`**

```tsx
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';

export type BadgeProps = {
  label: string;
  /** `brand` for a called-out tag (e.g. the facility's practice type); `neutral` (default) for everything else. */
  tone?: 'neutral' | 'brand';
  style?: ViewStyle | ViewStyle[];
};

export function Badge({ label, tone = 'neutral', style }: BadgeProps) {
  const theme = useTheme();
  const bg = tone === 'brand' ? theme.brandTint : theme.elementBg;

  return (
    <View style={[styles.pill, { backgroundColor: bg }, style]}>
      <ThemedText type="caption" themeColor={tone === 'brand' ? 'brand' : 'textSecondary'} style={styles.label}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  label: { fontWeight: '600' },
});
```

- [ ] **Step 2: Write `src/components/ui/chip.tsx`**

```tsx
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon, type IconName } from './icon';

export type ChipProps = {
  label: string;
  active?: boolean;
  icon?: IconName;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
};

/** Toggleable filter chip. Active = brandTint fill + brand text; inactive = elementBg + textSecondary. */
export function Chip({ label, active = false, icon, onPress, style }: ChipProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? theme.brandTint : theme.elementBg }, style]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}>
      {icon ? (
        <Icon name={icon} size={14} tintColor={active ? theme.brand : theme.textSecondary} style={styles.icon} />
      ) : null}
      <ThemedText type="subhead" themeColor={active ? 'brand' : 'textSecondary'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
  },
  icon: { marginRight: Space.xs },
});
```

- [ ] **Step 3: Write `src/components/ui/star-rating.tsx`**

```tsx
import { StyleSheet, View } from 'react-native';

import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon } from './icon';

export type StarRatingProps = {
  rating: number;
  reviewCount?: number | null;
  size?: number;
};

export function StarRating({ rating, reviewCount, size = 14 }: StarRatingProps) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <Icon name="star.fill" size={size} tintColor={theme.riskModerate} />
      <ThemedText type="footnote" themeColor="text" style={styles.value}>
        {rating.toFixed(1)}
      </ThemedText>
      {reviewCount ? (
        <ThemedText type="footnote" themeColor="muted">
          ({reviewCount})
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  value: { fontWeight: '600' },
});
```

- [ ] **Step 4: Write `src/components/ui/list-state.tsx`**

```tsx
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from '../themed-text';
import { Icon, type IconName } from './icon';

export type ListStateProps = {
  kind: 'loading' | 'empty' | 'error' | 'offline';
  title: string;
  subtitle?: string;
  icon?: IconName;
};

const DEFAULT_ICON: Record<ListStateProps['kind'], IconName> = {
  loading: 'magnifyingglass',
  empty: 'magnifyingglass',
  error: 'exclamationmark.triangle.fill',
  offline: 'wifi.slash',
};

export function ListState({ kind, title, subtitle, icon }: ListStateProps) {
  const theme = useTheme();

  return (
    <View style={styles.center}>
      {kind === 'loading' ? (
        <ActivityIndicator color={theme.brand} />
      ) : (
        <Icon name={icon ?? DEFAULT_ICON[kind]} size={32} tintColor={theme.muted} />
      )}
      <ThemedText type="headline" style={styles.title}>
        {title}
      </ThemedText>
      {subtitle ? (
        <ThemedText type="footnote" themeColor="muted" style={styles.subtitle}>
          {subtitle}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.xxxl,
    gap: Space.sm,
    paddingHorizontal: Space.xl,
  },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center' },
});
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/badge.tsx src/components/ui/chip.tsx src/components/ui/star-rating.tsx src/components/ui/list-state.tsx
git commit -m "feat(directory): add badge, chip, star-rating, and list-state primitives"
```

---

### Task 6: DirectorySegments + SearchBar

**Files:**
- Create: `src/components/directory/DirectorySegments.tsx`
- Create: `src/components/directory/SearchBar.tsx`

- [ ] **Step 1: Write `src/components/directory/DirectorySegments.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type DirectorySegment = 'clinics' | 'doctors';

const SEGMENTS: { value: DirectorySegment; label: string; icon: IconName }[] = [
  { value: 'clinics', label: 'Clinics', icon: 'building.2.fill' },
  { value: 'doctors', label: 'Online Booking', icon: 'stethoscope' },
];

export type DirectorySegmentsProps = {
  value: DirectorySegment;
  onChange: (value: DirectorySegment) => void;
};

/** Two gray tab pills. Active = brand-filled pill with white icon+label; inactive = muted gray. */
export function DirectorySegments({ value, onChange }: DirectorySegmentsProps) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {SEGMENTS.map((segment) => {
        const active = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            onPress={() => onChange(segment.value)}
            style={[styles.pill, { backgroundColor: active ? theme.brand : theme.elementBg }]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}>
            <Icon name={segment.icon} size={16} tintColor={active ? theme.onBrand : theme.muted} />
            <ThemedText type="subhead" themeColor={active ? 'onBrand' : 'muted'} style={styles.label}>
              {segment.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Space.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    height: 40,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
  },
  label: { fontWeight: '600' },
});
```

- [ ] **Step 2: Write `src/components/directory/SearchBar.tsx`**

```tsx
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Elevation, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SearchBarProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Adds a soft warm shadow — used when the bar floats over the map/list instead of sitting on a card. */
  floating?: boolean;
};

export function SearchBar({ value, onChangeText, placeholder = 'Search', floating = false }: SearchBarProps) {
  const theme = useTheme();

  return (
    <View style={[styles.row, { backgroundColor: theme.surface }, floating && Elevation.md]}>
      <Icon name="magnifyingglass" size={18} tintColor={theme.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        style={[styles.input, { color: theme.text }]}
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
          <Icon name="xmark.circle.fill" size={18} tintColor={theme.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    height: 48,
    paddingHorizontal: Space.base,
    borderRadius: Radius.md,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
});
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/directory/DirectorySegments.tsx src/components/directory/SearchBar.tsx
git commit -m "feat(directory): add DirectorySegments and SearchBar components"
```

---

### Task 7: DoctorCard + DoctorsView

**Files:**
- Create: `src/components/directory/DoctorCard.tsx`
- Create: `src/components/directory/DoctorsView.tsx`

- [ ] **Step 1: Write `src/components/directory/DoctorCard.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';

import type { DoctorSync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Space } from '@/constants/theme';
import { humanizeTag } from '@/lib/format';

export type DoctorCardProps = { doctor: DoctorSync; onPress: () => void };

export function DoctorCard({ doctor, onPress }: DoctorCardProps) {
  const specialty = doctor.specialties_display || doctor.specialties.map(humanizeTag).join(', ');

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={styles.card} elevation="sm">
        <View style={styles.top}>
          <View style={styles.text}>
            <ThemedText type="headline">{doctor.name}</ThemedText>
            {specialty ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                {specialty}
              </ThemedText>
            ) : null}
            {doctor.city ? (
              <ThemedText type="footnote" themeColor="muted">
                {doctor.city}
              </ThemedText>
            ) : null}
          </View>
          {doctor.pds_certified ? <Badge label="PDS Certified" tone="brand" /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Space.md },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Space.sm },
  text: { flex: 1, gap: 2 },
});
```

- [ ] **Step 2: Write `src/components/directory/DoctorsView.tsx`**

```tsx
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import type { DoctorSync } from '@/api/types';
import { Chip } from '@/components/ui/chip';
import { ListState } from '@/components/ui/list-state';
import { Space } from '@/constants/theme';
import { listDoctors, type DoctorQuery } from '@/data/repositories';

import { DoctorCard } from './DoctorCard';

export type DoctorsViewProps = { query: string; topInset: number };

const PDS_CHIP = 'PDS certified';

export function DoctorsView({ query, topInset }: DoctorsViewProps) {
  const [pdsOnly, setPdsOnly] = useState(false);
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [doctors, setDoctors] = useState<DoctorSync[] | null>(null);
  const [error, setError] = useState(false);

  // One-time broad fetch to derive the specialty facet chips.
  useEffect(() => {
    let cancelled = false;
    listDoctors({ limit: 500 })
      .then((all) => {
        if (cancelled) return;
        setSpecialties(Array.from(new Set(all.flatMap((d) => d.specialties))).sort());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const q: DoctorQuery = {
      q: query || undefined,
      pdsCertified: pdsOnly || undefined,
      specialty: specialty ?? undefined,
      limit: 100,
    };
    listDoctors(q)
      .then((rows) => !cancelled && setDoctors(rows))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [query, pdsOnly, specialty]);

  const onSelect = (id: string) => router.push({ pathname: '/directory/doctor', params: { id } });

  return (
    <View style={[styles.fill, { paddingTop: topInset }]}>
      <FlatList
        data={doctors ?? []}
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => <DoctorCard doctor={item} onPress={() => onSelect(item.id)} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={[PDS_CHIP, ...specialties]}
            keyExtractor={(s) => s}
            contentContainerStyle={styles.chips}
            renderItem={({ item }) =>
              item === PDS_CHIP ? (
                <Chip label={item} active={pdsOnly} onPress={() => setPdsOnly((v) => !v)} />
              ) : (
                <Chip
                  label={item}
                  active={specialty === item}
                  onPress={() => setSpecialty((v) => (v === item ? null : item))}
                />
              )
            }
            style={styles.chipRow}
          />
        }
        ListEmptyComponent={
          doctors === null ? (
            error ? (
              <ListState kind="error" title="Couldn't load doctors" subtitle="Check your connection and try again." />
            ) : (
              <ListState kind="loading" title="Loading doctors…" />
            )
          ) : (
            <ListState kind="empty" title="No doctors found" subtitle="Try a different search or filter." />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl },
  chipRow: { marginBottom: Space.base },
  chips: { gap: Space.sm },
});
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/directory/DoctorCard.tsx src/components/directory/DoctorsView.tsx
git commit -m "feat(directory): add DoctorCard and DoctorsView"
```

---

### Task 8: Doctor detail screen + routing skeleton

Ships a complete, working (non-map) slice: route registration, doctor detail screen. This is the point where the app should run end-to-end for the Online Booking segment.

**Files:**
- Create: `src/app/directory/_layout.tsx`
- Create: `src/app/directory/doctor.tsx`
- Modify: `src/app/_layout.tsx`

- [ ] **Step 1: Write `src/app/directory/_layout.tsx`**

```tsx
import { Stack } from 'expo-router';

export default function DirectoryDetailLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="clinic" />
      <Stack.Screen name="doctor" />
    </Stack>
  );
}
```

- [ ] **Step 2: Write `src/app/directory/doctor.tsx`**

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { DoctorSync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { StarRating } from '@/components/ui/star-rating';
import { Space } from '@/constants/theme';
import { getDoctor, getDoctorBookingLinks, type BookingLinkWithPlatform } from '@/data/repositories';
import { useTheme } from '@/hooks/use-theme';
import { formatFee, humanizeTag } from '@/lib/format';
import { openWebsite } from '@/lib/links';

export default function DoctorDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [doctor, setDoctor] = useState<DoctorSync | null>(null);
  const [links, setLinks] = useState<BookingLinkWithPlatform[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([getDoctor(id), getDoctorBookingLinks(id)])
      .then(([d, l]) => {
        setDoctor(d);
        setLinks(l);
      })
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Doctor
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <ListState kind="loading" title="Loading doctor…" />
      ) : !doctor ? (
        <ListState kind="error" title="Doctor not found" />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.identity}>
            <ThemedText type="title1">{doctor.name}</ThemedText>
            {doctor.title ? (
              <ThemedText type="body" themeColor="textSecondary">
                {doctor.title}
              </ThemedText>
            ) : null}
            <View style={styles.badges}>
              {doctor.pds_certified ? <Badge label="PDS Certified" tone="brand" /> : null}
              {doctor.specialties.map((s) => (
                <Badge key={s} label={humanizeTag(s)} />
              ))}
            </View>
          </View>

          <ThemedText type="title2" style={styles.sectionTitle}>
            Book online
          </ThemedText>
          {links.length === 0 ? (
            <ListState kind="empty" title="No booking links yet" subtitle="Check back later." />
          ) : (
            links.map((link) => (
              <Pressable key={link.id} onPress={() => openWebsite(link.url)}>
                <Card style={styles.linkCard} elevation="sm">
                  <View style={styles.linkTop}>
                    <ThemedText type="headline">{link.platform?.name ?? 'Booking platform'}</ThemedText>
                    <Icon name="globe" size={16} tintColor={theme.brand} />
                  </View>
                  <View style={styles.linkMeta}>
                    {link.consultation_fee != null ? (
                      <ThemedText type="footnote" themeColor="textSecondary">
                        {formatFee(link.consultation_fee)}
                        {link.is_introductory_fee ? ' (intro)' : ''}
                      </ThemedText>
                    ) : null}
                    {link.rating != null ? <StarRating rating={link.rating} reviewCount={link.review_count} /> : null}
                  </View>
                  {link.available_text ? (
                    <ThemedText type="footnote" themeColor="muted">
                      {link.available_text}
                    </ThemedText>
                  ) : null}
                </Card>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  body: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl, gap: Space.md },
  identity: { gap: Space.sm, marginBottom: Space.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs, marginTop: Space.xs },
  sectionTitle: { marginTop: Space.md },
  linkCard: { gap: Space.xs },
  linkTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linkMeta: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
});
```

Note: `src/app/directory/clinic.tsx` doesn't exist yet (Task 15) — `_layout.tsx`'s `<Stack.Screen name="clinic" />` referencing a not-yet-created route is fine for expo-router (it just means nothing renders there until Task 15 adds the file); it will not break typecheck/lint since it's a string name, not an import.

- [ ] **Step 3: Register the `directory` detail stack in the root layout**

In `src/app/_layout.tsx`, add `<Stack.Screen name="directory" />` after `<Stack.Screen name="profile" />` (around line 59):

```tsx
                <Stack.Screen name="profile" />
                <Stack.Screen name="directory" />
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Run: `npx expo lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/directory/_layout.tsx src/app/directory/doctor.tsx src/app/_layout.tsx
git commit -m "feat(directory): add doctor detail screen and register the directory detail stack"
```

---

### Task 9: ClinicCard

**Files:**
- Create: `src/components/directory/ClinicCard.tsx`

- [ ] **Step 1: Write `src/components/directory/ClinicCard.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';

import type { FacilitySync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import type { FacilityWithDistance } from '@/data/repositories';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, humanizeTag } from '@/lib/format';
import { formatHours, isOpenNow } from '@/lib/hours';
import { callNumber, openDirections } from '@/lib/links';

export type ClinicCardProps = {
  facility: FacilitySync | FacilityWithDistance;
  onPress: () => void;
};

export function ClinicCard({ facility, onPress }: ClinicCardProps) {
  const theme = useTheme();
  const distance = 'distance_m' in facility ? facility.distance_m : null;
  const open = isOpenNow(facility.weekday_hours, facility.weekend_hours);
  const topService = facility.services[0];

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={styles.card} elevation="sm">
        <View style={styles.row}>
          <View style={styles.rail}>
            <View style={[styles.dot, { backgroundColor: theme.brand }]} />
            {distance != null ? (
              <ThemedText type="caption" themeColor="brand" style={styles.distance}>
                {formatDistance(distance)}
              </ThemedText>
            ) : null}
            {open != null ? (
              <View style={[styles.statusDot, { backgroundColor: open ? theme.riskLow : theme.muted }]} />
            ) : null}
          </View>

          <View style={styles.body}>
            <ThemedText type="headline">{facility.name}</ThemedText>

            <View style={styles.badges}>
              {facility.has_philhealth ? <Badge label="PhilHealth" /> : null}
              {open != null ? <Badge label={open ? 'Open Now' : 'Closed'} tone={open ? 'brand' : 'neutral'} /> : null}
              <Badge label={humanizeTag(facility.type)} />
              {topService ? <Badge label={humanizeTag(topService)} /> : null}
            </View>

            <View style={styles.info}>
              <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                {facility.address}
              </ThemedText>
              <ThemedText type="footnote" themeColor="muted">
                Mon–Fri {formatHours(facility.weekday_hours)}
              </ThemedText>
              {facility.phone ? (
                <ThemedText type="footnote" themeColor="muted">
                  {facility.phone}
                </ThemedText>
              ) : null}
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={() =>
                  openDirections({
                    googleMapsUrl: facility.google_maps_url,
                    latitude: facility.latitude,
                    longitude: facility.longitude,
                  })
                }
                style={[styles.actionFilled, { backgroundColor: theme.brand }]}
                accessibilityRole="button">
                <Icon name="arrow.triangle.turn.up.right.diamond.fill" size={14} tintColor={theme.onBrand} />
                <ThemedText type="footnote" themeColor="onBrand" style={styles.actionLabel}>
                  Directions
                </ThemedText>
              </Pressable>
              {facility.phone ? (
                <Pressable
                  onPress={() => callNumber(facility.phone as string)}
                  style={[styles.actionIcon, { backgroundColor: theme.elementBg }]}
                  accessibilityRole="button"
                  accessibilityLabel="Call">
                  <Icon name="phone.fill" size={16} tintColor={theme.brand} />
                </Pressable>
              ) : null}
              <Pressable onPress={onPress} style={[styles.actionOutline, { borderColor: theme.hairline }]} accessibilityRole="button">
                <ThemedText type="footnote" themeColor="text" style={styles.actionLabel}>
                  Details
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Space.md },
  row: { flexDirection: 'row', gap: Space.md },
  rail: { width: 44, alignItems: 'center', gap: Space.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  distance: { fontWeight: '700' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  body: { flex: 1, gap: Space.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  info: { gap: 2, marginTop: Space.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: Space.sm },
  actionFilled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    height: 36,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
  },
  actionIcon: { width: 36, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  actionOutline: {
    height: 36,
    paddingHorizontal: Space.base,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionLabel: { fontWeight: '600' },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. (`'distance_m' in facility` correctly narrows `FacilitySync | FacilityWithDistance` — confirm no narrowing error.)

- [ ] **Step 3: Commit**

```bash
git add src/components/directory/ClinicCard.tsx
git commit -m "feat(directory): add ClinicCard"
```

---

### Task 10: Guarded MapLibre module

**Files:**
- Create: `src/lib/maplibre.ts`

- [ ] **Step 1: Write `src/lib/maplibre.ts`**

```ts
/**
 * Guarded MapLibre re-exports. The native module isn't linked until a dev build
 * runs `expo prebuild`; importing it before then throws (it calls
 * `requireNativeComponent` at module-eval time). Every map render checks
 * `MAP_AVAILABLE` and falls back to a list instead of crashing the JS bundle —
 * add the MapTiler key and run one dev build and the map lights up with no code
 * change (see docs/DIRECTORY_SCREEN.md §7).
 */
import { MAP_STYLE_URL } from '@/config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require('@maplibre/maplibre-react-native');
} catch {
  mod = null;
}

export const MAP_AVAILABLE = Boolean(mod) && MAP_STYLE_URL.length > 0;

/** Aliased — `Map` is a JS global. */
export const MapLibreMap = mod?.Map;
export const Camera = mod?.Camera;
export const UserLocation = mod?.UserLocation;
export const GeoJSONSource = mod?.GeoJSONSource;
export const Layer = mod?.Layer;
export const Marker = mod?.Marker;
export const OfflineManager = mod?.OfflineManager;

export type { CameraRef, LngLat, LngLatBounds } from '@maplibre/maplibre-react-native';
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. The `import type` line only needs the package's `.d.ts` to resolve (present from Task 1's `npx expo install`, regardless of native linking) — it does not execute at runtime, so it can't throw even without a dev build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/maplibre.ts
git commit -m "feat(directory): add guarded MapLibre re-exports"
```

---

### Task 11: ClinicPreviewCard

**Files:**
- Create: `src/components/directory/ClinicPreviewCard.tsx`

- [ ] **Step 1: Write `src/components/directory/ClinicPreviewCard.tsx`**

```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { FacilitySync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Elevation, Radius, Space } from '@/constants/theme';
import type { FacilityWithDistance } from '@/data/repositories';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, humanizeTag } from '@/lib/format';
import { formatHours, isOpenNow } from '@/lib/hours';

export type ClinicPreviewCardProps = {
  facility: FacilitySync | FacilityWithDistance;
  onClose: () => void;
};

const MAX_SERVICES_SHOWN = 2;

/** The callout attached to a tapped map pin (rendered inside a MapLibre `Marker`). */
export function ClinicPreviewCard({ facility, onClose }: ClinicPreviewCardProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const distance = 'distance_m' in facility ? facility.distance_m : null;
  const open = isOpenNow(facility.weekday_hours, facility.weekend_hours);

  const shown = facility.services.slice(0, MAX_SERVICES_SHOWN);
  const extra = facility.services.length - shown.length;
  // Never show the raw taxonomy tag — humanize the service list, or the practice type if there are no services.
  const specialization = shown.length ? shown.map(humanizeTag).join('; ') : humanizeTag(facility.type);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <View style={styles.header}>
        <ThemedText type="headline" style={styles.name} numberOfLines={1}>
          {facility.name}
        </ThemedText>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <Icon name="xmark" size={16} tintColor={theme.muted} />
        </Pressable>
      </View>

      <View style={styles.specRow}>
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.spec} numberOfLines={1}>
          {specialization}
        </ThemedText>
        {extra > 0 ? (
          <ThemedText type="footnote" themeColor="brand" style={styles.more}>
            {' '}
            +{extra} more
          </ThemedText>
        ) : null}
      </View>

      {open != null ? (
        <Pressable onPress={() => setExpanded((v) => !v)} style={styles.hoursRow} accessibilityRole="button">
          <Icon name="clock.fill" size={14} tintColor={open ? theme.riskLow : theme.riskHigh} />
          <ThemedText type="footnote" themeColor={open ? 'riskLow' : 'riskHigh'} style={styles.hoursLabel}>
            {open ? 'Open Now' : 'Closed Now'}
          </ThemedText>
          <Icon name={expanded ? 'chevron.up' : 'chevron.down'} size={12} tintColor={theme.muted} />
        </Pressable>
      ) : null}
      {expanded ? (
        <View style={styles.hoursDetail}>
          <ThemedText type="caption" themeColor="muted">
            Mon–Fri {formatHours(facility.weekday_hours)}
          </ThemedText>
          <ThemedText type="caption" themeColor="muted">
            Sat–Sun {formatHours(facility.weekend_hours)}
          </ThemedText>
        </View>
      ) : null}

      <ThemedText type="footnote" themeColor="muted" numberOfLines={1} style={styles.address}>
        {distance != null ? `${formatDistance(distance)} (Near You) · ` : ''}
        {facility.address}
      </ThemedText>

      <View style={styles.buttonWrap}>
        <Button
          label="Details"
          variant="brand"
          onPress={() => router.push({ pathname: '/directory/clinic', params: { id: facility.id } })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', borderRadius: Radius.lg, padding: Space.base, gap: Space.xs, ...Elevation.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  name: { flex: 1 },
  specRow: { flexDirection: 'row', flexWrap: 'wrap' },
  spec: { flexShrink: 1 },
  more: { textDecorationLine: 'underline', fontWeight: '600' },
  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  hoursLabel: { fontWeight: '600' },
  hoursDetail: { gap: 2, paddingLeft: Space.lg },
  address: {},
  buttonWrap: { marginTop: Space.xs },
});
```

**Note on `Button`:** `src/components/ui/button.tsx`'s `ButtonProps` types `style?: any` but never destructures it — it's spread via `...rest` onto the underlying `AnimatedPressable` *after* the component's own computed `style` array, so a caller-supplied `style` silently replaces (not merges with) the button's own sizing/color styles. Don't pass `style` to `<Button>` anywhere in this feature — wrap it in a `View` for spacing instead (as above with `buttonWrap`). This is a pre-existing quirk in shared code; fixing it is out of scope for this feature.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/directory/ClinicPreviewCard.tsx
git commit -m "feat(directory): add ClinicPreviewCard"
```

---

### Task 12: ClinicMap

**Files:**
- Create: `src/components/directory/ClinicMap.tsx`

- [ ] **Step 1: Write `src/components/directory/ClinicMap.tsx`**

```tsx
import { useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';

import type { FacilitySync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Elevation, Radius, Space } from '@/constants/theme';
import type { FacilityWithDistance } from '@/data/repositories';
import { useTheme } from '@/hooks/use-theme';
import { MAP_DEFAULT, MAP_STYLE_URL } from '@/config';
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  MAP_AVAILABLE,
  MapLibreMap,
  Marker,
  UserLocation,
} from '@/lib/maplibre';

import { ClinicPreviewCard } from './ClinicPreviewCard';

export type ClinicMapProps = {
  facilities: (FacilitySync | FacilityWithDistance)[];
  coords: { latitude: number; longitude: number } | null;
  selectedId: string | null;
  onSelectFacility: (id: string | null) => void;
  /** Screen-space distance from the bottom to keep floating controls clear of the collapsed sheet. */
  bottomInset: number;
};

const SCREEN_W = Dimensions.get('window').width;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;
// A same-tap on a pin bubbles from GeoJSONSource.onPress up to Map.onPress despite
// stopPropagation() (native bubbling quirk) — this window suppresses the bubbled
// "clear selection" call. See docs/DIRECTORY_SCREEN.md §5 "Pin -> preview card".
const SOURCE_PRESS_GUARD_MS = 250;

export function ClinicMap({ facilities, coords, selectedId, onSelectFacility, bottomInset }: ClinicMapProps) {
  const theme = useTheme();
  const cameraRef = useRef<CameraRef>(null);
  const lastSourcePressAt = useRef(0);
  const [zoom, setZoom] = useState(coords ? 13 : MAP_DEFAULT.zoom);

  const selectedFacility = useMemo(
    () => facilities.find((f) => f.id === selectedId) ?? null,
    [facilities, selectedId],
  );

  const featureCollection = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: facilities.map((f) => ({
        type: 'Feature' as const,
        properties: { id: f.id },
        geometry: { type: 'Point' as const, coordinates: [f.longitude, f.latitude] },
      })),
    }),
    [facilities],
  );

  const nearestArea = useMemo(() => {
    const first = facilities[0];
    return first ? `${first.city}, ${first.province}` : null;
  }, [facilities]);

  const applyZoom = (delta: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta));
    cameraRef.current?.zoomTo(next, { duration: 200 });
    setZoom(next);
  };

  if (!MAP_AVAILABLE) {
    return (
      <View style={[styles.fallback, { backgroundColor: theme.elementBg }]}>
        <Icon name="building.2.fill" size={32} tintColor={theme.muted} />
        <ThemedText type="footnote" themeColor="muted" style={styles.fallbackText}>
          The map needs a dev build to render — clinics still list below.
        </ThemedText>
      </View>
    );
  }

  const initialCenter: [number, number] = coords
    ? [coords.longitude, coords.latitude]
    : [MAP_DEFAULT.longitude, MAP_DEFAULT.latitude];

  return (
    <View style={styles.fill}>
      <MapLibreMap
        style={styles.fill}
        mapStyle={MAP_STYLE_URL}
        logo={false}
        compass={false}
        scaleBar={false}
        onPress={() => {
          if (Date.now() - lastSourcePressAt.current < SOURCE_PRESS_GUARD_MS) return;
          onSelectFacility(null);
        }}>
        <Camera ref={cameraRef} initialViewState={{ center: initialCenter, zoom }} />
        <UserLocation />

        <GeoJSONSource
          id="clinics"
          data={featureCollection}
          onPress={(e: { stopPropagation?: () => void; nativeEvent?: { features?: GeoJSON.Feature[] } }) => {
            lastSourcePressAt.current = Date.now();
            e.stopPropagation?.();
            const feature = e.nativeEvent?.features?.[0];
            const id = feature?.properties?.id as string | undefined;
            if (id) onSelectFacility(id);
          }}>
          <Layer
            type="circle"
            id="clinics-pins"
            filter={['!=', ['get', 'id'], selectedId ?? '']}
            paint={{
              'circle-radius': 9,
              'circle-color': theme.brand,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#FFFFFF',
            }}
          />
          <Layer
            type="circle"
            id="clinics-pin-selected"
            filter={['==', ['get', 'id'], selectedId ?? '']}
            paint={{
              'circle-radius': 13,
              'circle-color': theme.brandPressed,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#FFFFFF',
            }}
          />
        </GeoJSONSource>

        {selectedFacility ? (
          <Marker lngLat={[selectedFacility.longitude, selectedFacility.latitude]} anchor="bottom" offset={[0, -18]}>
            <View style={{ width: Math.min(SCREEN_W - 32, 320) }}>
              <ClinicPreviewCard facility={selectedFacility} onClose={() => onSelectFacility(null)} />
            </View>
          </Marker>
        ) : null}
      </MapLibreMap>

      <View style={[styles.zoomStack, { bottom: bottomInset, backgroundColor: theme.surface }]}>
        <Pressable onPress={() => applyZoom(1)} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel="Zoom in">
          <Icon name="plus" size={18} tintColor={theme.text} />
        </Pressable>
        <View style={[styles.zoomDivider, { backgroundColor: theme.hairline }]} />
        <Pressable onPress={() => applyZoom(-1)} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel="Zoom out">
          <Icon name="minus" size={18} tintColor={theme.text} />
        </Pressable>
      </View>

      {nearestArea ? (
        <View style={[styles.areaChip, { bottom: bottomInset, backgroundColor: theme.surface }]}>
          <Icon name="mappin.circle.fill" size={14} tintColor={theme.brand} />
          <ThemedText type="caption" themeColor="text" style={styles.areaText} numberOfLines={1}>
            {nearestArea}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.sm, paddingHorizontal: Space.xxxl },
  fallbackText: { textAlign: 'center' },
  zoomStack: {
    position: 'absolute',
    right: Space.base,
    borderRadius: Radius.md,
    overflow: 'hidden',
    ...Elevation.md,
  },
  zoomBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  zoomDivider: { height: StyleSheet.hairlineWidth },
  areaChip: {
    position: 'absolute',
    left: Space.base,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    height: 32,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    maxWidth: SCREEN_W * 0.5,
    ...Elevation.sm,
  },
  areaText: { fontWeight: '600' },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. (The guarded components from `@/lib/maplibre` are typed `any`, so JSX prop-checking on `MapLibreMap`/`Camera`/etc. is intentionally loose here — that's the guarded-module tradeoff documented in Task 10.)

- [ ] **Step 3: Commit**

```bash
git add src/components/directory/ClinicMap.tsx
git commit -m "feat(directory): add ClinicMap with pins, preview marker, zoom, and area chip"
```

---

### Task 13: Offline map tile packs

**Files:**
- Create: `src/lib/map-offline.ts`

- [ ] **Step 1: Write `src/lib/map-offline.ts`**

```ts
import { MAP_STYLE_URL } from '@/config';
import { getMeta, setMeta } from '@/data/db';

import { MAP_AVAILABLE, OfflineManager } from './maplibre';

const DOWNLOADED_KEY = 'map_offline_pack_downloaded';
const RADIUS_M = 25_000;
const RADIUS_DEG = RADIUS_M / 111_320;

/**
 * Downloads a bounded MapTiler tile pack (~25km, zoom 10-15) around `coords` so
 * the map renders offline afterwards. No-op if the native map isn't linked yet,
 * or if a pack has already been cached once (best-effort, not re-validated here).
 */
export async function downloadAreaPack(coords: { latitude: number; longitude: number }): Promise<void> {
  if (!MAP_AVAILABLE) return;
  if ((await getMeta(DOWNLOADED_KEY)) === '1') return;

  const bounds: [number, number, number, number] = [
    coords.longitude - RADIUS_DEG,
    coords.latitude - RADIUS_DEG,
    coords.longitude + RADIUS_DEG,
    coords.latitude + RADIUS_DEG,
  ];

  try {
    await OfflineManager.createPack(
      { mapStyle: MAP_STYLE_URL, bounds, minZoom: 10, maxZoom: 15 },
      () => {},
      () => {},
    );
    await setMeta(DOWNLOADED_KEY, '1');
  } catch {
    // Best-effort — offline caching is a nice-to-have, never block the UI on it.
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/map-offline.ts
git commit -m "feat(directory): add offline map tile pack downloads"
```

---

### Task 14: ClinicsView

**Files:**
- Create: `src/components/directory/ClinicsView.tsx`

- [ ] **Step 1: Write `src/components/directory/ClinicsView.tsx`**

```tsx
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, View } from 'react-native';

import type { FacilitySync } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { ListState } from '@/components/ui/list-state';
import { Space } from '@/constants/theme';
import { listFacilities, nearbyFacilities, type FacilityWithDistance } from '@/data/repositories';
import { useConnectivity } from '@/hooks/use-connectivity';
import { useLocation } from '@/hooks/use-location';
import { humanizeTag } from '@/lib/format';
import { isOpenNow } from '@/lib/hours';
import { downloadAreaPack } from '@/lib/map-offline';
import { useTheme } from '@/hooks/use-theme';

import { ClinicCard } from './ClinicCard';
import { ClinicMap } from './ClinicMap';

export type ClinicsViewProps = { query: string; topInset: number };

type SortMode = 'distance' | 'rating' | 'name';
type Facility = FacilitySync | FacilityWithDistance;

const SNAP_POINTS = ['32%', '64%', '92%'];
const SCREEN_H = Dimensions.get('window').height;
const COLLAPSED_BOTTOM_INSET = SCREEN_H * 0.32 + 12;
const ALL_CHIP = 'All Clinics';
const OPEN_CHIP = 'Open Now';
const PHILHEALTH_CHIP = 'PhilHealth';

export function ClinicsView({ query, topInset }: ClinicsViewProps) {
  const theme = useTheme();
  const { coords } = useLocation();
  const { isOnline } = useConnectivity();

  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [error, setError] = useState(false);
  const [service, setService] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [philhealthOnly, setPhilhealthOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>('name');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [serviceFacets, setServiceFacets] = useState<string[]>([]);

  // Facet chips — one-time broad fetch.
  useEffect(() => {
    listFacilities({ limit: 1000 })
      .then((all) => setServiceFacets(Array.from(new Set(all.flatMap((f) => f.services))).sort()))
      .catch(() => {});
  }, []);

  // Main data fetch — stale-while-loading (no spinner flash on refilter).
  useEffect(() => {
    let cancelled = false;
    const params = { q: query || undefined, service: service ?? undefined, limit: 200 };
    const fetcher = coords ? nearbyFacilities(coords.latitude, coords.longitude, params) : listFacilities(params);
    fetcher
      .then((rows) => !cancelled && setFacilities(rows))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [query, service, coords]);

  // Default sort to distance once location is known.
  useEffect(() => {
    if (coords) setSort((s) => (s === 'name' ? 'distance' : s));
  }, [coords]);

  // Cache map tiles for the area once we have a fix and a connection.
  useEffect(() => {
    if (coords && isOnline) downloadAreaPack(coords).catch(() => {});
  }, [coords, isOnline]);

  const filtered = useMemo(() => {
    if (!facilities) return [];
    let rows = facilities;
    if (openOnly) rows = rows.filter((f) => isOpenNow(f.weekday_hours, f.weekend_hours) === true);
    if (philhealthOnly) rows = rows.filter((f) => f.has_philhealth);

    const sorted = [...rows];
    if (sort === 'distance' && coords) {
      sorted.sort((a, b) => ('distance_m' in a ? a.distance_m : Infinity) - ('distance_m' in b ? b.distance_m : Infinity));
    } else if (sort === 'rating') {
      sorted.sort((a, b) => (b.google_rating ?? 0) - (a.google_rating ?? 0));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [facilities, openOnly, philhealthOnly, sort, coords]);

  const cycleSort = useCallback(() => {
    setSort((s) => {
      if (s === 'distance') return 'rating';
      if (s === 'rating') return 'name';
      return coords ? 'distance' : 'rating';
    });
  }, [coords]);

  const sortLabel = sort === 'distance' ? 'distance' : sort === 'rating' ? 'rating' : 'name';
  const chips = [ALL_CHIP, OPEN_CHIP, PHILHEALTH_CHIP, ...serviceFacets];

  return (
    <View style={styles.fill}>
      <ClinicMap
        facilities={filtered}
        coords={coords}
        selectedId={selectedId}
        onSelectFacility={setSelectedId}
        bottomInset={COLLAPSED_BOTTOM_INSET}
      />

      <BottomSheet
        index={0}
        snapPoints={SNAP_POINTS}
        topInset={topInset}
        enableDynamicSizing={false}
        backgroundStyle={{ backgroundColor: theme.surface }}
        handleIndicatorStyle={{ backgroundColor: theme.hairline }}>
        <View style={styles.header}>
          <View style={styles.resultsRow}>
            <ThemedText type="subhead" themeColor="textSecondary">
              {filtered.length} {filtered.length === 1 ? 'clinic' : 'clinics'} · by {sortLabel}
            </ThemedText>
            <Pressable onPress={cycleSort} accessibilityRole="button" accessibilityLabel="Change sort order" hitSlop={8}>
              <Icon name="arrow.up.arrow.down" size={16} tintColor={theme.brand} />
            </Pressable>
          </View>

          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={chips}
            keyExtractor={(s) => s}
            contentContainerStyle={styles.chips}
            renderItem={({ item }) => {
              if (item === ALL_CHIP) {
                return (
                  <Chip
                    label={item}
                    active={!service && !openOnly && !philhealthOnly}
                    onPress={() => {
                      setService(null);
                      setOpenOnly(false);
                      setPhilhealthOnly(false);
                    }}
                  />
                );
              }
              if (item === OPEN_CHIP) {
                return <Chip label={item} active={openOnly} onPress={() => setOpenOnly((v) => !v)} />;
              }
              if (item === PHILHEALTH_CHIP) {
                return <Chip label={item} active={philhealthOnly} onPress={() => setPhilhealthOnly((v) => !v)} />;
              }
              return (
                <Chip
                  label={humanizeTag(item)}
                  active={service === item}
                  onPress={() => setService((v) => (v === item ? null : item))}
                />
              );
            }}
          />
        </View>

        <BottomSheetFlatList
          data={filtered}
          keyExtractor={(f) => f.id}
          renderItem={({ item }) => (
            <ClinicCard
              facility={item}
              onPress={() => router.push({ pathname: '/directory/clinic', params: { id: item.id } })}
            />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            !isOnline && facilities === null ? (
              <ListState kind="offline" title="You're offline" subtitle="Showing cached clinics only." />
            ) : facilities === null ? (
              error ? (
                <ListState kind="error" title="Couldn't load clinics" subtitle="Check your connection and try again." />
              ) : (
                <ListState kind="loading" title="Finding clinics…" />
              )
            ) : (
              <ListState kind="empty" title="No clinics found" subtitle="Try a different search or filter." />
            )
          }
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: Space.xl, paddingBottom: Space.sm, gap: Space.sm },
  resultsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { gap: Space.sm },
  list: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/directory/ClinicsView.tsx
git commit -m "feat(directory): add ClinicsView assembling map, bottom sheet, filters, and sort"
```

---

### Task 15: Clinic detail screen

**Files:**
- Create: `src/app/directory/clinic.tsx`

- [ ] **Step 1: Write `src/app/directory/clinic.tsx`**

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ListState } from '@/components/ui/list-state';
import { Screen } from '@/components/ui/screen';
import { StarRating } from '@/components/ui/star-rating';
import { Space } from '@/constants/theme';
import type { FacilitySync } from '@/api/types';
import { getFacility } from '@/data/repositories';
import { useTheme } from '@/hooks/use-theme';
import { formatFeeRange, humanizeTag } from '@/lib/format';
import { formatHours, isOpenNow } from '@/lib/hours';
import { callNumber, openDirections, openWebsite } from '@/lib/links';

export default function ClinicDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [facility, setFacility] = useState<FacilitySync | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getFacility(id)
      .then(setFacility)
      .finally(() => setLoading(false));
  }, [id]);

  const open = facility ? isOpenNow(facility.weekday_hours, facility.weekend_hours) : null;
  const feeRange = facility ? formatFeeRange(facility.fee_min, facility.fee_max) : null;

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" tintColor={theme.brand} size={20} />
        </Pressable>
        <ThemedText type="headline" themeColor="textSecondary">
          Clinic
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <ListState kind="loading" title="Loading clinic…" />
      ) : !facility ? (
        <ListState kind="error" title="Clinic not found" />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.identity}>
            <ThemedText type="title1">{facility.name}</ThemedText>
            <View style={styles.badges}>
              <Badge label={humanizeTag(facility.type)} tone="brand" />
              {open != null ? <Badge label={open ? 'Open Now' : 'Closed'} /> : null}
              {facility.has_philhealth ? <Badge label="PhilHealth" /> : null}
            </View>
            {facility.google_rating != null ? <StarRating rating={facility.google_rating} /> : null}
          </View>

          <Pressable
            onPress={() =>
              openDirections({
                googleMapsUrl: facility.google_maps_url,
                latitude: facility.latitude,
                longitude: facility.longitude,
              })
            }>
            <Card style={styles.row} elevation="sm">
              <Icon name="mappin.circle.fill" size={18} tintColor={theme.brand} />
              <ThemedText type="body" style={styles.rowText}>
                {facility.address}
              </ThemedText>
            </Card>
          </Pressable>

          <Card style={styles.hoursCard} elevation="sm">
            <ThemedText type="headline">Hours</ThemedText>
            <View style={styles.hoursRow}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Mon–Fri
              </ThemedText>
              <ThemedText type="footnote">{formatHours(facility.weekday_hours)}</ThemedText>
            </View>
            <View style={styles.hoursRow}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Sat–Sun
              </ThemedText>
              <ThemedText type="footnote">{formatHours(facility.weekend_hours)}</ThemedText>
            </View>
          </Card>

          {facility.services.length ? (
            <View>
              <ThemedText type="headline" style={styles.sectionTitle}>
                Services
              </ThemedText>
              <View style={styles.badges}>
                {facility.services.map((s) => (
                  <Badge key={s} label={humanizeTag(s)} />
                ))}
              </View>
            </View>
          ) : null}

          {feeRange ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              Consultation fee: {feeRange}
            </ThemedText>
          ) : null}

          <View style={styles.actions}>
            {facility.phone ? (
              <Button label="Call" variant="outline" icon="phone.fill" onPress={() => callNumber(facility.phone as string)} />
            ) : null}
            {facility.website ? (
              <Button label="Website" variant="outline" icon="globe" onPress={() => openWebsite(facility.website as string)} />
            ) : null}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 20 },
  body: { paddingHorizontal: Space.xl, paddingBottom: Space.xxxl, gap: Space.md },
  identity: { gap: Space.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  rowText: { flex: 1 },
  hoursCard: { gap: Space.xs },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { marginBottom: Space.xs },
  actions: { flexDirection: 'row', gap: Space.md, marginTop: Space.md },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Run: `npx expo lint`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/directory/clinic.tsx
git commit -m "feat(directory): add clinic detail screen"
```

---

### Task 16: Directory tab screen (final assembly)

**Files:**
- Modify: `src/app/(tabs)/directory.tsx`

- [ ] **Step 1: Replace the placeholder with the real screen**

```tsx
import { useEffect, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { DirectorySegments, type DirectorySegment } from '@/components/directory/DirectorySegments';
import { SearchBar } from '@/components/directory/SearchBar';
import { ClinicsView } from '@/components/directory/ClinicsView';
import { DoctorsView } from '@/components/directory/DoctorsView';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/constants/theme';
import { needsInitialSync, runSync } from '@/data/sync';
import { useConnectivity } from '@/hooks/use-connectivity';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';

export default function DirectoryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isOnline } = useConnectivity();

  const [segment, setSegment] = useState<DirectorySegment>('clinics');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const [overlayH, setOverlayH] = useState(0);

  useEffect(() => {
    (async () => {
      if (await needsInitialSync()) {
        await runSync({ full: true }).catch(() => {});
      } else {
        runSync().catch(() => {});
      }
    })();
  }, []);

  const onOverlayLayout = (e: LayoutChangeEvent) => setOverlayH(e.nativeEvent.layout.height);

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      {segment === 'clinics' ? (
        <ClinicsView query={debouncedQuery} topInset={overlayH} />
      ) : (
        <DoctorsView query={debouncedQuery} topInset={overlayH} />
      )}

      <View pointerEvents="box-none" style={[styles.overlay, { paddingTop: insets.top }]} onLayout={onOverlayLayout}>
        <DirectorySegments
          value={segment}
          onChange={(next) => {
            setSegment(next);
            setQuery('');
          }}
        />
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={segment === 'clinics' ? 'Search clinics or area…' : 'Search doctors…'}
          floating
        />
        {!isOnline ? (
          <View style={[styles.offlineChip, { backgroundColor: theme.brandTint }]}>
            <Icon name="wifi.slash" size={12} tintColor={theme.brand} />
            <ThemedText type="caption" themeColor="brand" style={styles.offlineLabel}>
              Offline — showing cached results
            </ThemedText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Space.xl,
    gap: Space.md,
    paddingBottom: Space.md,
  },
  offlineChip: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  offlineLabel: { fontWeight: '600' },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Run: `npx expo lint`
Expected: both clean. `src/components/ui/screen-placeholder.tsx` is now unused by this screen but is still a generic primitive used elsewhere (`learn.tsx`, etc. — check before assuming it's dead) — leave it in place.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(tabs)/directory.tsx"
git commit -m "feat(directory): assemble the Directory tab (segments, search, sync, offline chip)"
```

---

### Task 17: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Lint**

Run: `npx expo lint`
Expected: clean (fix any new warnings introduced by this feature; don't touch unrelated pre-existing lint debt).

- [ ] **Step 3: Bundle export (JS-level proof the guarded map, routes, and imports resolve without a native build)**

Run: `npx expo export --platform ios`
Expected: succeeds. This is the strongest automated signal available in this environment — it proves `src/lib/maplibre.ts`'s guarded `require`, every new route, and every new import resolve correctly even though the native module isn't linked.

- [ ] **Step 4: Manual on-device checklist (you run this after a dev build — do not mark done without actually doing it)**

```bash
npx expo prebuild --clean
npx expo run:ios   # or run:android / an EAS dev build
```

Then, per `docs/DIRECTORY_SCREEN.md` §9:
1. Map renders; tap a pin → attached preview card that pans with the map → **Details** opens the clinic screen; tapping empty map dismisses it.
2. Drag the bottom sheet between its snap points; filters (Open Now / PhilHealth / service) and the sort cycle button update the list; distance labels show once location is granted.
3. Deny location → Clinics falls back to a name-sorted list (no crash); GPS-off still lists cached clinics.
4. Airplane mode after caching a pack: tiles still render, distance sort still works, clinic/doctor details open, doctor booking links and clinic Call/Website actions open externally.
5. Online Booking: PDS/specialty chips filter the list; tapping a doctor opens the detail screen; tapping a booking link opens it in the in-app browser.
6. Pressure-test both segments and both detail screens against the 10 anti-AI-slop rules (`spoton-ui-design` skill).

- [ ] **Step 5: Final commit (only if Steps 1-3 required fixes)**

```bash
git add -A
git commit -m "fix(directory): address final verification findings"
```

If nothing needed fixing, skip this step — there's nothing to commit.
