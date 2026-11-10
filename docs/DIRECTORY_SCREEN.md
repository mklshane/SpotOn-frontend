# SpotOn - Directory Screen

This documents the **directory feature as it is currently implemented** (the `Directory`
tab: clinics + doctors). It is a handoff/reference spec - read it to understand how the
screen works, then extend it consistently. Everything lives under `SpotOn-frontend/`.

---

## 1. What it is

A two-segment directory:

1. **Clinics** - physical facilities on a **full-screen MapLibre map** with a **draggable
   bottom sheet** list over it. Map-first, works fully offline.
2. **Online Booking** - dermatology **doctors** with active telemedicine `booking_links`,
   as a plain searchable/filterable list → tap-to-book.

Design system: SpotOn **sunset orange** (`src/constants/theme.ts`). Build only from theme
tokens (`Colors.light`, `Space`, `Radius`, `Type`, `Elevation`, `Gradients`) - no arbitrary
values. See the `spoton-ui-design` skill for the rules.

---

## 2. Offline-first data model (already existed; this feature is its first consumer)

- Local mirror is **expo-sqlite** (`src/data/db.ts`), tables: `facilities`, `doctors`,
  `booking_links`, `telemedicine_platforms`, `sync_meta`.
- `src/data/sync.ts` `runSync({full?})` pulls the backend `GET /sync` feed into SQLite,
  paginated by per-collection cursors. `needsInitialSync()` / `getLastSyncedAt()` gate it.
- **All reads go through `src/data/repositories.ts`** (never touch SQLite from UI):
  - `listFacilities(q)`, `countFacilities(q)`, `getFacility(id)`
  - `nearbyFacilities(lat, lng, {radiusM, limit, ...})` - **on-device haversine distance
    sort**, works offline. Returns `FacilityWithDistance` (adds `distance_m`).
  - `listDoctors(q)`, `getDoctor(id)`, `getDoctorBookingLinks(id)`, `listPlatforms()`
  - `FacilityQuery` supports `q`, `service`, `city`, `type`, `facilityType`, `includeExcluded`.
- **`facility_type` + `booking_url`** are persisted in the mirror (types, schema with an
  idempotent `ALTER TABLE` migration in `db.ts`, upsert in `sync.ts`, mapper in
  `repositories.ts`). The backend `/sync` already sends them.

> **GPS works offline.** `expo-location` returns coordinates with no network - only map
> *tiles* and reverse-geocoding need connectivity. "Clinics near me" therefore works fully
> offline via `nearbyFacilities`.

---

## 3. Dependencies, config, native build

Added deps: `@maplibre/maplibre-react-native` (map), `expo-location` (GPS),
`@react-native-community/netinfo` (connectivity), `@gorhom/bottom-sheet` (draggable sheet).

Config (`src/config.ts`):
- `MAP_STYLE_URL` = OpenFreeMap `liberty` style (`https://tiles.openfreemap.org/styles/liberty`).
  Keyless, so there is no map env var. Includes a `building-3d` extrusion layer (zoom 14+, shows
  when pitched); no terrain/DEM source.
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
- `src/app/(tabs)/directory.tsx` - the tab. Owns segment state, debounced search, first-run
  seeding + background sync, and the **floating top overlay** (segment + search + offline chip).
- `src/app/directory/_layout.tsx` + `clinic.tsx` + `doctor.tsx` - detail stack (registered as
  `<Stack.Screen name="directory" />` in `src/app/_layout.tsx`).

**Directory components** (`src/components/directory/`)
- `DirectorySegments.tsx` - gray-tab segmented control (Clinics / Online Booking).
- `SearchBar.tsx` - reusable search field (magnifier + clear, `floating` shadow variant).
- `ClinicsView.tsx` - full-screen map + bottom-sheet list, filters, sort, offline-pack trigger.
- `ClinicMap.tsx` - the MapLibre map (guarded): pins, zoom, area chip, user dot, attached
  preview `Marker`, press handling.
- `ClinicPreviewCard.tsx` - the callout attached to a tapped pin.
- `ClinicCard.tsx` - a clinic row in the sheet list.
- `DoctorsView.tsx` - the Online Booking list (filters + list).
- `DoctorCard.tsx` - a doctor row.

**Shared primitives** (`src/components/ui/`) - added by this feature: `badge.tsx`, `chip.tsx`,
`star-rating.tsx`, `list-state.tsx` (loading/empty/error/offline). New SF Symbols registered in
`icon.tsx` `VECTOR_MAP` for the Android fallback.

**Hooks** (`src/hooks/`) - `use-location.ts` (offline GPS), `use-connectivity.ts`
(`isOnline` + `isOnlineNow()`), `use-debounced-value.ts`.

**Libs** (`src/lib/`) - `maplibre.ts` (guarded re-exports + `MAP_AVAILABLE`), `map-offline.ts`
(offline tile packs), `links.ts` (call / website / directions), `format.ts`
(`formatDistance`, `formatFeeRange`, `humanizeTag`), `hours.ts` (`formatHours`, `isOpenNow`).

---

## 5. Clinics view - UX & behavior

Layout (`ClinicsView.tsx`): a full-screen `ClinicMap` with a `@gorhom/bottom-sheet` over it.

**Floating top overlay** (`directory.tsx`, absolute, `pointerEvents="box-none"`, measured via
`onLayout` → `overlayH`, passed to both views as `topInset`):
- `DirectorySegments` - two **gray tab pills**: active = brand-filled pill with white
  icon+label, inactive = muted gray (`elementBg`) pill. Icons `building.2.fill` / `stethoscope`.
- `SearchBar` (floating) - debounced 250ms (`useDebouncedValue`), placeholder "Search clinic,
  city or doctor…" (Dermatologists: "Search dermatologists…"). Switching segments clears the query.
- Offline chip (brand tint) when `!isOnline`.

**Map** (`ClinicMap.tsx`):
- `MapView` (OpenFreeMap style), `Camera` initial center = user coords or `MAP_DEFAULT`,
  `UserLocation` dot.
- Pins: one `GeoJSONSource` + two circle layers - **plain orange dots** (`circleRadius 9`,
  brand, white stroke); the selected pin is a larger darker dot (`circleRadius 13`,
  `brandPressed`) via a `filter` on the id. **No numbers.**
- Floating controls lifted above the collapsed sheet via `bottomInset` (`height*0.32 + 12`):
  **zoom +/-** (right, drives `camera.zoomTo`) and an **area chip** (left) showing the nearest
  clinic's `city, province`.

**Bottom sheet** (draggable "container"):
- Snap points `['20%', '50%', '96%']`, starts collapsed (`index 0`). `enableDynamicSizing={false}`.
- Fixed header: **results row** - "`N clinics & hospitals`" and a labelled **sort
  pill** that rotates **Nearest → Top rated → A–Z** (Nearest only with a location). Without a
  location (permission denied) a **"Turn on location"** banner asks again, or opens Settings.
- Two horizontal **chip rows**: place filters `All` (clears) · `Derm in today` · `Hospitals` ·
  `Clinics` · `Weekend clinic` · `Books online`, then the patient **concern** chips
  (`lib/concerns.ts`; the active one moves to the front).
- Body: `BottomSheetFlatList` of `ClinicCard`. With a location and no search: the nearest 200 (`NEAREST_LIMIT`); a typed search covers the whole directory, nearest first; no location: every match by name. PDS credit as footer.
  `ListState` handles downloading / not downloaded / loading / empty (+ Clear filters) / error.

**Data flow**: `listFacilities({q, concern, kind, dayMask, hasBookingUrl, limit: null})`, then a
JS distance pass when `coords` is known. Search is accent-folded (`foldSearch`, "Las Pinas" ↔
"Las Piñas") and also matches **linked dermatologists' names**, so a doctor's name finds the
places they hold clinic. `facilityDermSummary()` (count + union of clinic days per facility)
drives `Derm in today` (a derm is scheduled today, or a non-hospital clinic is open now) and the
cards. Derm-first ranking (`dermTier`) applies on top of any sort.

**Scan result → directory**: `/(tabs)/directory?concern=skin_cancer_mole_check&at=<ms>`. The
`at` nonce makes each visit re-apply the concern and switch to Clinics, even after the user
cleared the chip or moved tabs.

**Pin → preview card**:
- Tapping a pin selects it. The preview is a **`Marker` anchored to the clinic's coordinate**
  (`anchor="bottom"`, `offset [0,-18]`) so it **pans/zooms with the map**. Tapping empty map
  clears it. Width bounded to `min(screenWidth-32, 320)`.
- `ClinicPreviewCard` shows: **name** + close ✕; **specialization** = services joined with
  `; ` and an underlined **"+N more"** (falls back to the practice type, e.g. "Dermatology
  Clinic") - never the raw `facility_type`; an **Open/Closed Now** row (clock, colored) whose
  chevron expands today's Mon–Fri / Sat–Sun hours inline; **distance "(Near You)" • address**;
  and a **"Details"** button → clinic detail.
- MapLibre gotcha (already handled in `ClinicMap.handlePress`): the source press is a **native
  bubbling event** - features are on `e.nativeEvent.features`, and it bubbles to `Map.onPress`.
  We read `e.nativeEvent.features`, call `e.stopPropagation()`, and guard `Map.onPress` with a
  timestamp so the same tap can't clear the selection.

**Clinic list card** (`ClinicCard.tsx`): left rail = distance + open/closed dot; body = name, a
**derm line** ("3 dermatologists · in today", or "No dermatologist listed - call the OPD" for a
hospital with none), badges, address / phone, and actions **Directions** · **Book** (disabled
offline) · **Call** · **Details**. Hospitals show no "Open now" or Mon–Fri hours - a hospital's
own (often 24h) hours say nothing about when a derm is in. No photo thumbnail (Google's photo
credit can't fit; the detail hero carries it). One screen-reader stop per card, with
Directions / Call / Book as accessibility actions. The list shares one number-picker sheet.
The "hospital without derm" rule is one function, `isHospitalWithoutDerm(facility, dermCount)`,
used by the card, the map preview and the detail page.

**Offline map packs** (`map-offline.ts`): on first location + connection, `downloadAreaPack`
caches a bounded OpenFreeMap pack (~25 km, zoom 10–15) so tiles render offline. Gated on
`isOnline` + `MAP_AVAILABLE`.

---

## 6. Dermatologists view

`DoctorsView.tsx` - no map. Was "Online Booking" and listed only doctors with a booking link
(~150 of ~1,500), so most dermatologists could not be found by name anywhere. Now it lists
**every non-excluded doctor** (`listDoctors({q, hasBookingLink?, dayMask?, limit: null})`),
nearest practice first when located. Chips: `All` · `Books online` · `In today` · `Weekend
clinic`. `DoctorCard` shows the primary practice, "In today" and "Books online" tags
(`doctorCardInfo()`). A failed refresh shows a banner over the old rows. PDS credit as footer.

**Doctor detail** (`app/directory/doctor.tsx`): identity → best booking link as the primary
action → **Practices at** (in today first, then nearest; translated schedule; Call + Directions
per practice) → direct line → more booking links → about/website → footer (updated date,
Report incorrect info, PDS credit).

**Clinic detail** (`app/directory/clinic.tsx`): identity/badges → actions **Book**, **Skin
clinic** (the derm OPD's own line from `department_info.phone`, when known), **Call/Hospital**,
**Directions**, **Website** → hours → address → skin services → doctors here (in today first,
"Schedule checked <date>" from `verified_at`) → fee/about → footer with Report incorrect info
and the PDS credit.

**PDS credit** (`components/directory/PdsAttribution.tsx`): the PDS Board approved using its
"Find a Dermatologist" directory on 2026-10-16 on condition that PDS is acknowledged; the line
(with a link to https://pds.org.ph/search-doctor/ and a not-an-endorsement note) appears on
both lists and both detail pages.

---

## 7. Guarded map (offline / no-native-build safety)

`src/lib/maplibre.ts` defensively `require`s the native module and exports the pieces plus
`MAP_AVAILABLE` (true only when the module is linked). Every map render and offline-pack call
checks it. When false - native module not linked yet - the app still runs; run one dev build and
the map lights up with no code change. `showZoom` and the attached `Marker` are likewise guarded.

---

## 8. Known limitations / possible follow-ups

- The attached preview `Marker` can extend past a screen edge when its pin is near the border
  (inherent to map callouts). Optional fix: `camera.flyTo` to center the pin on select.
- Numbered pins were intentionally removed (plain orange dots).
- "Details" and the preview's "+N more" both open the clinic detail; "+N more" could instead
  expand services inline.
- The sort control is a cycle button, not a dropdown menu.
- Doctors have no map (no coordinates in the doctor table) - the Dermatologists tab is list-only.
- Concern tags are near-uniform on doctors (every PDS derm carries the same 8), so the doctor
  list deliberately has no concern filter.

---

## 9. Verification

1. `npx tsc --noEmit` and `expo lint` clean; `npx expo export --platform ios` bundles (JS-level
   proof the guarded map, routes, and imports resolve).
2. After a dev build: map renders; **tap a pin → attached preview card that
   pans with the map → Details** opens the clinic screen; tapping empty map dismisses it.
3. Drag the bottom sheet between its snap points; filters (Open Now / PhilHealth / service) and
   the sort cycle update the list; distance labels show when location is granted.
4. Deny location → Clinics falls back to a name-sorted list (no crash); GPS-off still lists
   cached clinics.
5. Offline (airplane mode after caching a pack): tiles still render, distance sort still works,
   details open, doctor booking links / clinic actions open externally.
6. Pressure-test each screen against the 10 anti-AI-slop rules (`spoton-ui-design`).

---

## 10. Round 2 (2026-10-17): information features

- **Scan result → nearest dermatologists** (`components/directory/NearbyDerms.tsx`, on `scan/result.tsx`
  when `tier.showDirectory`): the 3 nearest tier-0 places doing mole checks, each with Call +
  Directions, and "See all clinics on the map". Uses the last known location (never prompts).
  If the nearest is > 50 km (`FAR_METERS`), an "Or consult online" block lists up to 3 doctors with
  an `offers_online` booking link (`onlineConsultOptions()`), cheapest fee first.
- **Fees / online / PhilHealth**: `doctor_facility.consultation_fee` and `booking_links.offers_online`
  (server migration 018, SQLite v18). Clinic doctor rows and doctor practice cards show
  "₱800 consult"; cards show "Consult from ₱…" (facility `fee_min`); doctors with an online link get
  an "Online consult" badge/chip. PhilHealth shows only a positive "PhilHealth-accredited (hospital)"
  badge - never "no PhilHealth".
- **My dermatologists** (`data/saved-repo.ts`, `app/profile/saved.tsx`): bookmark on both detail
  headers (`ListingActions`), per account, this device only, wiped with the account; rows keep a
  name snapshot so a place dropped from the directory still reads ("No longer listed").
- **Share** (`lib/share-listing.ts`): system share sheet (Messenger/SMS/…); web uses
  `navigator.share`, else copies to the clipboard. Message = name, address, phone, up to 3
  dermatologists' schedules, map link.
- **Report incorrect info** (`app/directory/report.tsx`, modal): category chips + optional note →
  `POST /directory/reports` (server 019). Offline/5xx → queued per account in sync_meta and sent
  after the next successful directory sync (`lib/directory-reports.ts`). Signed-out users get the
  old mailto. Reviewed in SpotOn-admin → Reports.
- **Concern chips**: tags are now evidence-based (37_ rewrite); a chip shows only when ≥ 15 places
  list it (`MIN_CONCERN_PLACES`), under the note "Every dermatologist treats common skin problems…".

### 2026-10-17 list/filter redesign
- Sheet header: one line - "Near <city of nearest place>" (or "Results for “q”" / "All clinics") +
  "N places", sort pill on the right. The big count card is gone.
- One chip rail (`Chip size="sm"`, 36pt + hit slop): **Filters** (opens `DirectoryFilterSheet`: place
  type, availability toggles, skin concern with its explanation, sort) · active concern as a removable
  chip · Derm in today · Clinics · Hospitals · Weekend.
- `ClinicCard`: name + distance; one meta line (type · ★ rating · From ₱fee · PhilHealth); open/closed
  with next change (clinics only); derm line; one address line; Call / Directions / Book pills. The
  whole card opens the details (no Details button, no badge row, no distance rail).
