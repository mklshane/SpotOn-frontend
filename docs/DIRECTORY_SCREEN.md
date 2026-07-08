# SpotOn — Directory Screen

This documents the **directory feature as it is currently implemented** (the `Directory`
tab: clinics + doctors). It is a handoff/reference spec — read it to understand how the
screen works, then extend it consistently. Everything lives under `SpotOn-frontend/`.

---

## 1. What it is

A two-segment directory:

1. **Clinics** — physical facilities on a **full-screen MapLibre map** with a **draggable
   bottom sheet** list over it. Map-first, works fully offline.
2. **Online Booking** — dermatology **doctors** with active telemedicine `booking_links`,
   as a plain searchable/filterable list → tap-to-book.

Design system: SpotOn **sunset orange** (`src/constants/theme.ts`). Build only from theme
tokens (`Colors.light`, `Space`, `Radius`, `Type`, `Elevation`, `Gradients`) — no arbitrary
values. See the `spoton-ui-design` skill for the rules.

---

## 2. Offline-first data model (already existed; this feature is its first consumer)

- Local mirror is **expo-sqlite** (`src/data/db.ts`), tables: `facilities`, `doctors`,
  `booking_links`, `telemedicine_platforms`, `sync_meta`.
- `src/data/sync.ts` `runSync({full?})` pulls the backend `GET /sync` feed into SQLite,
  paginated by per-collection cursors. `needsInitialSync()` / `getLastSyncedAt()` gate it.
- **All reads go through `src/data/repositories.ts`** (never touch SQLite from UI):
  - `listFacilities(q)`, `countFacilities(q)`, `getFacility(id)`
  - `nearbyFacilities(lat, lng, {radiusM, limit, ...})` — **on-device haversine distance
    sort**, works offline. Returns `FacilityWithDistance` (adds `distance_m`).
  - `listDoctors(q)`, `getDoctor(id)`, `getDoctorBookingLinks(id)`, `listPlatforms()`
  - `FacilityQuery` supports `q`, `service`, `city`, `type`, `facilityType`, `includeExcluded`.
- **`facility_type` + `booking_url`** are persisted in the mirror (types, schema with an
  idempotent `ALTER TABLE` migration in `db.ts`, upsert in `sync.ts`, mapper in
  `repositories.ts`). The backend `/sync` already sends them.

> **GPS works offline.** `expo-location` returns coordinates with no network — only map
> *tiles* and reverse-geocoding need connectivity. "Clinics near me" therefore works fully
> offline via `nearbyFacilities`.

---

## 3. Dependencies, config, native build

Added deps: `@maplibre/maplibre-react-native` (map), `expo-location` (GPS),
`@react-native-community/netinfo` (connectivity), `@gorhom/bottom-sheet` (draggable sheet).

Config (`src/config.ts`):
- `MAPTILER_KEY` = `process.env.EXPO_PUBLIC_MAPTILER_KEY` (set in `.env`, gitignored;
  placeholder in `.env.example`). Client-safe; restrict by bundle id in MapTiler.
- `MAP_STYLE_URL` = MapTiler `streets-v2` style built from the key (empty string when no key).
- `MAP_DEFAULT` = Metro Manila fallback center/zoom.

`app.json` registers the `expo-location` (with permission copy) and
`@maplibre/maplibre-react-native` config plugins.

> **The map + location are native modules.** They only work after a dev build:
> `npx expo prebuild --clean && npx expo run:ios` (or Android / EAS). The map is **guarded**
> (see §7) so the JS app still runs and degrades to a list before that build; `@gorhom/
> bottom-sheet` is pure-JS (reanimated + gesture-handler) and needs no native rebuild.

---

## 4. File map

**Screen + routes**
- `src/app/(tabs)/directory.tsx` — the tab. Owns segment state, debounced search, first-run
  seeding + background sync, and the **floating top overlay** (segment + search + offline chip).
- `src/app/directory/_layout.tsx` + `clinic.tsx` + `doctor.tsx` — detail stack (registered as
  `<Stack.Screen name="directory" />` in `src/app/_layout.tsx`).

**Directory components** (`src/components/directory/`)
- `DirectorySegments.tsx` — gray-tab segmented control (Clinics / Online Booking).
- `SearchBar.tsx` — reusable search field (magnifier + clear, `floating` shadow variant).
- `ClinicsView.tsx` — full-screen map + bottom-sheet list, filters, sort, offline-pack trigger.
- `ClinicMap.tsx` — the MapLibre map (guarded): pins, zoom, area chip, user dot, attached
  preview `Marker`, press handling.
- `ClinicPreviewCard.tsx` — the callout attached to a tapped pin.
- `ClinicCard.tsx` — a clinic row in the sheet list.
- `DoctorsView.tsx` — the Online Booking list (filters + list).
- `DoctorCard.tsx` — a doctor row.

**Shared primitives** (`src/components/ui/`) — added by this feature: `badge.tsx`, `chip.tsx`,
`star-rating.tsx`, `list-state.tsx` (loading/empty/error/offline). New SF Symbols registered in
`icon.tsx` `VECTOR_MAP` for the Android fallback.

**Hooks** (`src/hooks/`) — `use-location.ts` (offline GPS), `use-connectivity.ts`
(`isOnline` + `isOnlineNow()`), `use-debounced-value.ts`.

**Libs** (`src/lib/`) — `maplibre.ts` (guarded re-exports + `MAP_AVAILABLE`), `map-offline.ts`
(offline tile packs), `links.ts` (call / website / directions), `format.ts`
(`formatDistance`, `formatFeeRange`, `humanizeTag`), `hours.ts` (`formatHours`, `isOpenNow`).

---

## 5. Clinics view — UX & behavior

Layout (`ClinicsView.tsx`): a full-screen `ClinicMap` with a `@gorhom/bottom-sheet` over it.

**Floating top overlay** (`directory.tsx`, absolute, `pointerEvents="box-none"`, measured via
`onLayout` → `overlayH`, passed to both views as `topInset`):
- `DirectorySegments` — two **gray tab pills**: active = brand-filled pill with white
  icon+label, inactive = muted gray (`elementBg`) pill. Icons `building.2.fill` / `stethoscope`.
- `SearchBar` (floating) — debounced 250ms (`useDebouncedValue`), placeholder "Search clinics
  or area…". Switching segments clears the query.
- Offline chip (brand tint) when `!isOnline`.

**Map** (`ClinicMap.tsx`):
- `MapView` (MapTiler style), `Camera` initial center = user coords or `MAP_DEFAULT`,
  `UserLocation` dot.
- Pins: one `GeoJSONSource` + two circle layers — **plain orange dots** (`circleRadius 9`,
  brand, white stroke); the selected pin is a larger darker dot (`circleRadius 13`,
  `brandPressed`) via a `filter` on the id. **No numbers.**
- Floating controls lifted above the collapsed sheet via `bottomInset` (`height*0.32 + 12`):
  **zoom +/-** (right, drives `camera.zoomTo`) and an **area chip** (left) showing the nearest
  clinic's `city, province`.

**Bottom sheet** (draggable "container"):
- Snap points `['32%', '64%', '92%']`, starts collapsed (`index 0`), `topInset` = overlay
  height so a fully-expanded sheet never covers the overlay. `enableDynamicSizing={false}`.
- Fixed header (grabber + these): **results row** — "`N clinics · by <distance|rating|name>`"
  and a **sort cycle button** (`arrow.up.arrow.down`) that rotates **Nearest → Top rated →
  Name** (Nearest only when location is known); then a horizontal **filter chip row**:
  `All Clinics` (clears), `Open Now`, `PhilHealth`, then service facets derived from the data.
- Body: `BottomSheetFlatList` of `ClinicCard`. `ListState` handles loading/empty/error.

**Data flow**: `coords ? nearbyFacilities(...) : listFacilities(...)` keyed on
`[query, service, coords]` (stale-while-loading — no spinner flash on refilter). `Open Now` /
`PhilHealth` are applied client-side; sort is client-side (`distance_m` / `google_rating` /
`name`). Facet chips come from a one-time broad `listFacilities({limit:1000})`.

**Pin → preview card**:
- Tapping a pin selects it. The preview is a **`Marker` anchored to the clinic's coordinate**
  (`anchor="bottom"`, `offset [0,-18]`) so it **pans/zooms with the map**. Tapping empty map
  clears it. Width bounded to `min(screenWidth-32, 320)`.
- `ClinicPreviewCard` shows: **name** + close ✕; **specialization** = services joined with
  `; ` and an underlined **"+N more"** (falls back to the practice type, e.g. "Dermatology
  Clinic") — never the raw `facility_type`; an **Open/Closed Now** row (clock, colored) whose
  chevron expands today's Mon–Fri / Sat–Sun hours inline; **distance "(Near You)" • address**;
  and a **"Details"** button → clinic detail.
- MapLibre gotcha (already handled in `ClinicMap.handlePress`): the source press is a **native
  bubbling event** — features are on `e.nativeEvent.features`, and it bubbles to `Map.onPress`.
  We read `e.nativeEvent.features`, call `e.stopPropagation()`, and guard `Map.onPress` with a
  timestamp so the same tap can't clear the selection.

**Clinic list card** (`ClinicCard.tsx`): left rail = small orange marker dot + bold distance +
open/closed status dot; body = name, tag badges (**PhilHealth**, **Open Now**, **practice
type**, top service), info rows (address / Mon–Fri hours / phone), and actions **Directions**
(filled) · **Call** (icon) · **Details** (outline). Card tap and Details both open the detail.

**Offline map packs** (`map-offline.ts`): on first location + connection, `downloadAreaPack`
caches a bounded MapTiler pack (~25 km, zoom 10–15) so tiles render offline. Gated on
`isOnline` + `MAP_AVAILABLE`.

---

## 6. Online Booking (doctors) view

`DoctorsView.tsx` — no map. A top spacer of `topInset` clears the overlay, then a **PDS
certified** toggle + specialty facet chips, then a `FlatList` of `DoctorCard` (name, specialty,
city, PDS badge) from `listDoctors({q, specialty, pdsCertified})`. `ListState` for
loading/empty/error. Search comes from the shared overlay.

**Doctor detail** (`app/directory/doctor.tsx`): `getDoctor` + `getDoctorBookingLinks` → name,
title, specialties + PDS badge, and a list of **booking links** (platform name, fee, rating,
availability) each opening its URL via `expo-web-browser`.

**Clinic detail** (`app/directory/clinic.tsx`): `getFacility` → name + practice-type/status
badges, address (→ directions), hours card, services badges, PhilHealth, fee range, rating;
actions **Book online** (`booking_url`), **Call**, **Directions**, **Website**. Manual back
header like `scan/history.tsx`.

---

## 7. Guarded map (offline / no-native-build safety)

`src/lib/maplibre.ts` defensively `require`s the native module and exports the pieces plus
`MAP_AVAILABLE` (true only when the module is linked **and** `MAP_STYLE_URL` is set). Every map
render and offline-pack call checks it. When false — native module not linked yet, or no
MapTiler key — the app still runs; add the key and run one dev build and the map lights up with
no code change. `showZoom` and the attached `Marker` are likewise guarded.

---

## 8. Known limitations / possible follow-ups

- The attached preview `Marker` can extend past a screen edge when its pin is near the border
  (inherent to map callouts). Optional fix: `camera.flyTo` to center the pin on select.
- Numbered pins were intentionally removed (plain orange dots).
- "Details" and the preview's "+N more" both open the clinic detail; "+N more" could instead
  expand services inline.
- The sort control is a cycle button, not a dropdown menu.
- Doctors have no map (no coordinates in the doctor table) — Online Booking is list-only.

---

## 9. Verification

1. `npx tsc --noEmit` and `expo lint` clean; `npx expo export --platform ios` bundles (JS-level
   proof the guarded map, routes, and imports resolve).
2. After a dev build with a MapTiler key: map renders; **tap a pin → attached preview card that
   pans with the map → Details** opens the clinic screen; tapping empty map dismisses it.
3. Drag the bottom sheet between its snap points; filters (Open Now / PhilHealth / service) and
   the sort cycle update the list; distance labels show when location is granted.
4. Deny location → Clinics falls back to a name-sorted list (no crash); GPS-off still lists
   cached clinics.
5. Offline (airplane mode after caching a pack): tiles still render, distance sort still works,
   details open, doctor booking links / clinic actions open externally.
6. Pressure-test each screen against the 10 anti-AI-slop rules (`spoton-ui-design`).
