# SpotOn — Clinic & Doctor Directory Screen

## Context

The `Directory` tab (`src/app/(tabs)/directory.tsx`) is currently a `ScreenPlaceholder`
stub ("COMING SOON"). Meanwhile a **complete offline-first data layer already exists and
is entirely unused**: `src/data/` mirrors the backend `/sync` feed (facilities, doctors,
booking_links, telemedicine_platforms) into **expo-sqlite** and exposes ready-to-use read
functions (`listFacilities`, `nearbyFacilities`, `listDoctors`, `getDoctorBookingLinks`,
`listPlatforms`). Nothing triggers the sync or reads this data yet.

This document is the implementation plan for building the real Directory screen on top of
that data layer. It is the app's **first data-driven list screen** and the first consumer
of the offline mirror.

**Goal:** a warm, Apple-quality directory with two segments —
1. **Clinics** — physical facilities, **map-first** (MapLibre) with a list toggle, "near me"
   distance sorting, filters.
2. **Online Booking** — doctors with active telemedicine `booking_links` → tap-to-book.

Everything must work **fully offline**, including the map.

### Key facts that shaped this plan
- **GPS works offline.** `expo-location.getCurrentPositionAsync()` returns lat/lng with no
  network. `nearbyFacilities(lat,lng)` (`src/data/repositories.ts:170`) already does an
  on-device haversine distance sort in SQLite. So "clinics near me" works offline end-to-end.
- Only **map tiles** and **reverse-geocoding** need network. We chose **MapLibre + offline
  tile packs** so the visual map ALSO renders offline (see Decisions).
- The backend `/sync` `FacilitySync` **already exposes** `facility_type` and `booking_url`
  (`SpotOn-backend/api/app/schemas/sync.py:48,62`). The frontend silently drops them. Adding
  them is a **frontend-only** change — no backend work.

## Decisions (confirmed with user)
- **Layout:** segmented tabs — `Clinics` and `Online Booking`.
- **Clinics default:** map-first (map + pins on open), toggle to list.
- **Map library:** `@maplibre/maplibre-react-native` with **offline tile packs** (map renders
  offline). Requires a tile source (MapTiler key or self-host) + pack download/management.
- **Field gap:** add BOTH `facility_type` and `booking_url` to the offline store.
- **Map pin interaction:** tap pin → preview card (basic details) → "View details" → full
  clinic detail screen.

---

## Architecture overview

```
Directory tab (segmented)
├── Clinics
│   ├── Map view (default)  → MapLibre, pins from cached facilities, user dot (GPS)
│   │     └── tap pin → preview card (basic details) → "View details" → clinic detail
│   ├── List view (toggle)  → cards sorted by distance (nearbyFacilities) or name
│   ├── Search + filters    → q, service, city, has_philhealth, facility_type
│   └── → Clinic detail     → hours, services, fees, phone/website/booking_url, directions
└── Online Booking
    ├── Doctor list         → listDoctors, search + specialty/PDS filter
    └── → Doctor detail     → booking_links (fee/rating/available) → open platform URL

Data: expo-sqlite mirror (already built) ← runSync() ← GET /sync (online only)
Location: expo-location (offline-capable GPS)
Map tiles: MapLibre offline packs (downloaded online, rendered offline)
```

No `@tanstack/react-query` — follow the existing hand-rolled `api/client.ts` + local async
state pattern (the repo has no query lib and doesn't need one here; reads are local SQLite).

---

## Work breakdown

### 1. Data layer — persist the two dropped fields (frontend-only)
The backend already sends them; wire them through the local mirror.
- `src/api/types.ts` — add `facility_type: string | null` and `booking_url: string | null`
  to `FacilitySync`; delete the stale note at lines 28–29.
- `src/data/db.ts` — add `facility_type TEXT` and `booking_url TEXT` columns to the
  `facilities` CREATE TABLE (`db.ts:12-34`). **Migration:** the table is created with
  `IF NOT EXISTS`, so existing installs won't gain the columns automatically. Add a tiny
  idempotent migration (e.g. `ALTER TABLE facilities ADD COLUMN ...` guarded by a
  `PRAGMA table_info` check, or bump `DB_NAME`/version and re-seed). Simplest robust option:
  run `ALTER TABLE` in a try/catch after `execAsync(SCHEMA)`.
- `src/data/sync.ts` — add both columns to the `upsertFacilities` INSERT list + values
  (`sync.ts:40-51`).
- `src/data/repositories.ts` — add the two fields to `FacilityRow` (`:17`) and `toFacility`
  (`:55`); optionally support a `facilityType` filter in `FacilityQuery` + `facilityWhere`.

### 2. Dependencies to install
- `npx expo install expo-location` — GPS (offline-capable).
- `@maplibre/maplibre-react-native` — map + offline tile packs (config-plugin, needs a dev
  build; the project already has native `ios/` + `android/` and uses dev-client-style deps).
- *(optional, recommended)* `npx expo install @react-native-community/netinfo` — to gate
  `runSync()` and offline-pack download on connectivity and show a subtle "offline" chip.
- Config: add a tile-source key (e.g. `EXPO_PUBLIC_MAPTILER_KEY`) to `src/config.ts` and
  `.env.example`. The key is only needed **online at pack-download time**; cached tiles render
  without it.
- `app.json`: add the MapLibre config plugin and the `expo-location` permission strings
  (iOS `NSLocationWhenInUseUsageDescription`, Android `ACCESS_FINE_LOCATION`). Rebuild the
  dev client (`npx expo prebuild` / EAS dev build) — these are native modules, not Expo Go.

### 3. Location layer
New `src/lib/location.ts` (or a `useLocation()` hook in `src/hooks/`):
- Request permission (`requestForegroundPermissionsAsync`), get `getCurrentPositionAsync`.
- Return `{ coords | null, status, request() }`. Fully offline for coords.
- **Fallbacks:** permission denied / unavailable → Clinics falls back to **list sorted by
  name** (or by a default city). No crash, no blocking.

### 4. Map layer (MapLibre + offline packs)
New `src/components/directory/ClinicMap.tsx`:
- `MapView` with a MapTiler (or self-hosted) style URL; `Camera` centered on user coords (or
  a PH default, e.g. Metro Manila, when no location).
- **Facility pins** from cached `facilities` via `PointAnnotation` (or `ShapeSource` +
  `SymbolLayer` for perf at scale). Sunset-tinted pin marker; selected pin highlighted.
- **Pin tap → preview card (bottom sheet / floating `Card`)** — new
  `src/components/directory/ClinicPreviewCard.tsx` showing **basic details only**: name,
  `facility_type` badge, one-line address/city, `google_rating` (stars), distance (`distance_m`
  when GPS available), and an open/closed hint from hours. The card has a primary **"View
  details"** `Button` → `router.push({ pathname: '/directory/clinic', params: { id } })`
  (the full clinic detail screen, §6). Tapping empty map or another pin dismisses/swaps the
  card. Card animates in with a gentle spring (reanimated, already installed).
- User-location dot via MapLibre's `UserLocation` (driven by the same GPS).

New `src/lib/mapOffline.ts` — offline tile-pack management (`OfflineManager`):
- **Strategy (to avoid huge packs):** on first location grant while online, download a
  bounded pack around the user's area (e.g. ~25 km radius, zoom ~10–15). Plus an optional
  low-zoom national pack for context. Expose a **"Download this area for offline"** action so
  users pre-cache before losing signal. Log/annotate pack size limits — do **not** silently
  cap coverage.
- Guard all downloads behind connectivity (netinfo) so offline never errors.

### 5. Directory tab UI
Replace `src/app/(tabs)/directory.tsx` body:
- Top **`Segmented`** (`src/components/ui/segmented.tsx`) — `Clinics` | `Online Booking`.
- Header search `TextField`; filter chips row (new `Chip` primitive — see §7).
- **Clinics segment** (`src/components/directory/ClinicsView.tsx`):
  - Map/List toggle (icon button), map-first per decision.
  - Map = `ClinicMap`; List = `FlatList` of `ClinicCard`.
  - Data: `nearbyFacilities(coords, {service, q, ...})` when coords present, else
    `listFacilities({...})`. Distance label from `distance_m`.
  - Loading / empty / error / offline states (define the reusable pattern here — none exists
    yet; `Button` has the only spinner today).
- **Online Booking segment** (`src/components/directory/DoctorsView.tsx`):
  - `FlatList` of `DoctorCard` from `listDoctors({q, specialty, pdsCertified})`.
  - Optional platform filter from `listPlatforms()`.

### 6. Detail screens (new route group, mirrors `scan/`)
- `src/app/directory/_layout.tsx` (Stack) + register `<Stack.Screen name="directory" />` in
  `src/app/_layout.tsx` (note: distinct from the `(tabs)/directory.tsx` tab file).
- `src/app/directory/clinic.tsx` — `getFacility(id)`: name, `facility_type` badge, address,
  hours (`weekday_hours`/`weekend_hours`), services, PhilHealth, fee range, rating; actions:
  Call (`tel:`), Website / **Book online** (`booking_url` via `expo-web-browser`), Directions
  (`google_maps_url` or MapLibre route). Manual back header like `scan/history.tsx:26-32`.
- `src/app/directory/doctor.tsx` — `getDoctor(id)` + `getDoctorBookingLinks(id)`: specialties,
  PDS badge, and a booking-links list (fee, rating, `available_text`, platform) → open URL.
- Navigate via `router.push({ pathname: '/directory/clinic', params: { id } })`.

### 7. New UI primitives (add to `src/components/ui/`, keep the variant-`type` pattern)
Reuse existing: `Screen`, `Card`, `ThemedText`, `Icon`/`IconCircle`, `TextField`,
`Segmented`, `Button`, `GradientBackground`. Add:
- `Chip` / `FilterChip` — pill filter toggles (services, specialties, PhilHealth).
- `Badge` — `facility_type` (medical/aesthetic), `status`, PDS-certified.
- `StarRating` (or inline) — `google_rating` / booking rating.
- `ListRow` / `ClinicCard` / `DoctorCard` — the list item cards.
- `EmptyState` + a small `ListState` wrapper (loading / empty / error / offline) — reusable
  across both segments.
All use `useTheme()` + tokens from `src/constants/theme.ts` (sunset brand `#FF8A4C`, `Space`,
`Radius`, `Elevation`). Follow the anti-AI-slop rules: one brand color, generous whitespace,
scale-only values, warm soft shadows.

### 8. Sync bootstrapping
- On Directory mount (or app start, online): if `needsInitialSync()` → `runSync()` to seed;
  else `runSync()` incrementally in the background. Gate on netinfo so offline is a no-op.
- Show a first-run "Downloading directory…" state when the mirror is empty and offline
  (nothing to show yet).

---

## Files — create / modify

**Modify**
- `src/app/(tabs)/directory.tsx` — replace stub with real screen.
- `src/app/_layout.tsx` — register the `directory` stack group.
- `src/api/types.ts` — add `facility_type`, `booking_url`.
- `src/data/db.ts` — 2 columns + migration.
- `src/data/sync.ts` — upsert the 2 columns.
- `src/data/repositories.ts` — row + mapper (+ optional `facilityType` filter).
- `src/config.ts`, `.env.example`, `app.json` — tile key, map plugin, location perms.

**Create**
- `src/app/directory/_layout.tsx`, `clinic.tsx`, `doctor.tsx`.
- `src/components/directory/ClinicsView.tsx`, `DoctorsView.tsx`, `ClinicMap.tsx`,
  `ClinicPreviewCard.tsx`, `ClinicCard.tsx`, `DoctorCard.tsx`.
- `src/lib/location.ts`, `src/lib/mapOffline.ts`.
- `src/components/ui/`: `chip.tsx`, `badge.tsx`, `star-rating.tsx`, `list-state.tsx` (+ index
  re-exports).

---

## Verification (end-to-end)

1. **Data wiring:** run `runSync()` against a backend with seeded facilities; assert
   `getFacility(id)` returns non-null `facility_type` and `booking_url` (proves §1). Verify via
   a temporary dev button calling `getCounts()`.
2. **Offline map:** with the dev client, grant location + download an offline pack while online,
   then enable Airplane Mode. Confirm: map still renders tiles, user dot shows (GPS works
   offline), "near me" list sorts by distance, clinic/doctor detail opens — all with no network.
3. **Map pin flow:** tap a pin → preview card shows basic details (name, type, rating,
   distance) → "View details" opens the full clinic screen. Verify offline too.
4. **Permission-denied path:** deny location → Clinics falls back to name-sorted list, no crash.
5. **Booking links:** open a doctor with active links → tapping a platform opens its URL in the
   in-app browser; open a clinic with `booking_url` → "Book online" works.
6. **Design pass:** pressure-test each screen against the 10 anti-AI-slop rules (see
   `spoton-ui-design` skill) — one brand color, whitespace, scale-only tokens, warm shadows.
7. **Run it:** launch via the project `run`/dev-client flow and screenshot both segments +
   both detail screens in light mode.

## Open considerations (not blockers)
- **Tile provider:** MapTiler free tier has monthly tile + offline-pack limits. If that's a
  concern, self-hosting a PH tile set or a bundled MBTiles is an alternative — decide before
  §4. Recommend starting with MapTiler + bounded per-area packs.
- **Pack size:** national high-zoom coverage is large; the per-area + on-demand strategy in §4
  keeps it small. Surface download size to the user.
- **netinfo** is optional but recommended to make sync/pack-download connectivity-aware.
