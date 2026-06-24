# SpotOn — Mobile Frontend (Plan)

Offline-first mobile app for early skin-cancer **triage** and telemedicine referral,
for Filipino users in low-connectivity, underserved areas. Undergraduate CS thesis,
De La Salle Lipa, AY 2025–2026.

> **Positioning:** SpotOn is **not** a diagnostic tool. It is an AI-assisted *triage*
> system that produces probabilistic risk assessments and routes users to qualified
> clinicians. Every results screen carries an explicit disclaimer. Final diagnosis
> always rests with a medical professional.

This README is the **frontend architecture + roadmap plan**. Code is greenfield; the old
HTML mockup is **not** the basis for this build — the UI is being designed fresh.

---

## Core user flow

1. **Capture** a smartphone photo of a suspicious lesion — with **live, guided framing**.
2. Answer the **8-feature symptom questionnaire** (Yes / Unsure / No).
3. **On-device** AI classifies the lesion → `MEL` / `SCC` / `BCC` / `OTHER`.
4. Compute the **Triage Priority Score (TPS)** locally.
5. Generate a **Screening Summary Report** (offline, on-device PDF) and — if **Moderate+** —
   show the **localized clinic directory**.
6. Works **offline** end to end.

---

## Stack (locked)

**React Native + Expo (dev build / EAS) + TypeScript.**

- Two on-device models run cross-platform from **a single TFLite (INT8) artifact each**,
  hardware-accelerated per platform (GPU/NNAPI on Android, **Core ML delegate** on iOS) —
  avoiding the maintenance cost of separate TFLite + Core ML exports.
- Requires an **Expo dev build (EAS)**, not Expo Go — custom native ML modules aren't
  available in the Expo Go sandbox. The Expo/EAS workflow is otherwise unchanged.

### Why this stack
Live, guided framing means the detector must run **on the camera preview, per frame**.
`react-native-vision-camera` frame processors + `react-native-fast-tflite` are the proven
RN combo for running a model directly on camera frames. Flutter is a credible alternative
on-device-ML-wise, but switching to Dart for a time-boxed thesis with an existing RN plan
is cost without upside.

### Libraries

| Concern | Library |
|---|---|
| Camera + frame processors | `react-native-vision-camera` |
| Worklet runtime (frame processors) | `react-native-worklets-core` |
| On-device inference (TFLite) | `react-native-fast-tflite` |
| Frame → tensor resize/convert | `vision-camera-resize-plugin` |
| Overlay drawing (reticle / bbox) | `@shopify/react-native-skia` |
| Animation / shared values | `react-native-reanimated` |
| Navigation | `expo-router` (file-based) |
| Offline mirror + `/sync` | `expo-sqlite` + TanStack Query |
| Secure storage (auth token) | `expo-secure-store` |
| Screening Summary Report (offline PDF) | `expo-print` (HTML → PDF via `printToFileAsync`) + `expo-sharing` |
| Builds | EAS Build (Android `.apk`/`.aab`, iOS) |

---

## On-device ML architecture (two models)

The **detector runs live and cheap**; the **classifier runs once and heavy**. Never run
the classifier on the live preview.

```
Live preview (vision-camera)
  └─ frame processor (worklet thread, throttled ~10–15 fps via runAtTargetFps):
       resize frame → DETECTION model (TFLite) → bbox + confidence
       └─ Skia overlay: reticle + box + coaching ("move closer", "hold steady")
       └─ quality gate: box centered + large enough + in focus + stable N frames
            → auto-capture (or enable shutter)
  Captured full-res still
  └─ crop to detected ROI (+ margin)
  └─ CLASSIFICATION model (TFLite INT8) → softmax over {MEL, SCC, BCC, OTHER}
  └─ + questionnaire answers → TPS → risk tier
  └─ Screening Summary Report (offline PDF) + (Moderate+) clinic directory
```

### Screening Summary Report (offline, on-device)
Generated entirely on-device with `expo-print` (HTML template → PDF) — **never uploaded**,
since it embeds the lesion image and PII. Shared/saved via `expo-sharing`. Contents (per the
sample at `image.png`):
- **Header:** "Screening Summary Report" + date/time.
- **Profile:** name, date of birth, sex, contact, address (from the local user profile).
- **Lesion image + classification:** the captured photo, predicted class (e.g. Melanoma /
  MEL) and model confidence %.
- **Reported symptoms:** the 8-feature questionnaire with the user's Yes/Unsure/No answers.
- **Urgency level + recommendation:** the TPS risk tier (e.g. CRITICAL) + recommended action.
- **Disclaimer:** triage-only; not a clinical diagnosis, referral, or transfer of care; not
  a substitute for a professional dermatologic consultation.

### Model responsibilities
- **Detection (live):** localize the lesion to guide framing and crop the ROI. Must be
  **tiny** — target ~30–60 ms/inference on low-end Android (the primary device class).
  MobileNet-SSD-lite / YOLO-nano-class, not a heavy backbone.
- **Classification (still):** the 4-class CNN (EfficientNet-B2 / MobileNetV3-Large /
  ConvNeXt-Tiny per the selected model), INT8-quantized, run once on the cropped ROI.

### Triage Priority Score (computed on-device)
```
TPS = (W × C) + min(SS, 3)
W: MEL=5, SCC=4, BCC=3, OTHER=0      C = top softmax confidence (0–1)
SS: 8-feature questionnaire (raw 0–11, capped at 3 in the formula)
Safety floor: if top confidence < 40%, result is floored at Moderate.
Tiers: Low 0–1.99 | Moderate 2–3.99 | High 4–5.99 | Critical 6–8
```

### Performance notes
Continuous frame inference is the main battery/heat risk — the auto-capture quality gate
ends the live loop quickly. Use the GPU delegate, downscale frames before inference, and
throttle fps. Keep the detection model and classifier as separate `.tflite` assets bundled
with the app (offline).

---

## Offline-first data layer

The backend exposes a **`/sync`** endpoint built for this: pull the directory once, mirror
it to a local **SQLite** DB, then sync deltas (`/sync?since=<cursor>`). The UI reads from
SQLite so the directory, doctors, and platforms work with no connectivity.

- **First launch:** full `/sync` → seed SQLite.
- **Subsequent:** delta `/sync?since=` on app open / pull-to-refresh.
- **Models + questionnaire + TPS + Screening Summary Report:** fully on-device; no network
  needed for triage or the report.
- **Network-only:** sign-in/auth, and *completing* a booking or opening a clinic website.

Backend API already available (FastAPI): `/directory/facilities`, `/directory/doctors`,
`/directory/platforms`, `/directory/meta`, `/sync`, `/me`, health. Excluded facilities are
hidden by default; service/specialty vocabularies come from `/directory/meta`.

---

## Offline boundaries

What works with no connectivity vs. what needs signal. Design the UI to make the boundary
visible (e.g. a "needs internet" state on the Book button when offline).

| Capability | Offline? | Notes |
|---|---|---|
| Capture → detect → classify → TPS | ✅ Full | On-device models + local scoring. |
| Screening Summary Report (PDF) | ✅ Full | Generated locally with `expo-print`; embeds lesion image + PII, never uploaded. |
| Clinic / doctor list — browse, search, filter | ✅ Full | Read from the SQLite mirror seeded via `/sync`. |
| Enriched fields (services, phone, address, website, booking_url, has_philhealth, coords) | ✅ Full | All cached locally. |
| "Nearest clinic" / distance sort | ✅ Full | Computed on-device from cached lat/lng + phone GPS (haversine); no server radius query needed. |
| Tap-to-call, "open in Maps", copy website | ✅ Full | OS intents; the device's own Maps app may have its own offline maps. |
| **Map view (base tiles)** | ⚠️ Partial | Markers/coords are offline; the visual base map streams tiles. **Plan:** online interactive map with **offline fallback to the distance-sorted list**. A true offline map (pre-downloaded MapLibre/MBTiles tiles for target cities) is optional and costs app size — only if explicitly required. |
| **Booking a teleconsult** | ❌ Needs signal | The booking URL/platform/fee are cached and *viewable* offline, but the booking itself is a live external service. "See options offline, book when you have signal." |
| Opening a clinic website | ❌ Needs signal | External URL. |
| Sign-in / profile sync (`/me`, Supabase auth) | ❌ Needs signal | Auth + profile writes are online; cached profile can still feed the report offline. |
| Fresh directory data (`/sync` deltas) | ❌ Needs signal | Last synced snapshot is used offline; reconciles when back online. |

**Map recommendation:** ship **online map + offline list fallback** first. Revisit
pre-downloaded offline tiles only if a working map with zero connectivity is a hard
requirement.

---

## Proposed project structure

```
app/                      # expo-router routes
  (tabs)/
    index.tsx             # Home / start a check
    directory.tsx         # Clinic directory (browse/search/filter)
    history.tsx           # Past results (local)
  scan/
    capture.tsx           # Live camera + guided framing
    questionnaire.tsx     # 8-feature symptom form
    result.tsx            # TPS, risk tier, disclaimer, report + next actions
  facility/[id].tsx       # Facility detail
  doctor/[id].tsx         # Doctor detail
src/
  ml/                     # tflite loading, detection worklet, classifier, TPS
  camera/                 # vision-camera config, frame processor, overlay (Skia)
  data/                   # sqlite schema, sync client, repositories
  api/                    # typed API client (directory, sync)
  report/                 # Screening Summary Report HTML template + expo-print PDF gen
  features/directory/     # directory UI + hooks
  features/triage/        # questionnaire + result UI
  components/             # shared UI
  theme/                  # design tokens (fresh design)
assets/models/            # detection.tflite, classifier.tflite (bundled, offline)
```

---

## Setup & dev workflow

```bash
# from app/SpotOn-frontend
npx create-expo-app@latest .            # TypeScript template
# add native ML + camera deps (see table), then a config-plugin prebuild:
npx expo install react-native-vision-camera react-native-worklets-core \
  react-native-fast-tflite vision-camera-resize-plugin @shopify/react-native-skia \
  react-native-reanimated expo-sqlite expo-secure-store expo-router
# Custom dev client (Expo Go can't load the native ML modules):
eas build --profile development --platform android   # and ios
# then:
npx expo start --dev-client
```

`API_BASE_URL` is configured per environment (`.env` / `app.config.ts`); never commit
secrets. Camera + (later) notification permissions declared via Expo config plugins.

---

## Build roadmap (maps to thesis Sprints 8–10)

Build the **ML-independent** parts first so progress isn't blocked on model training.

1. **Scaffold** — Expo dev build, expo-router, TS, theme tokens, typed API client.
2. **Offline data layer** — SQLite schema + `/sync` client + repositories.
3. **Clinic directory feature** *(ready now — backend + data complete)* — browse, search,
   filter by service, facility/doctor detail, offline.
4. **Questionnaire + TPS** — pure logic + UI; no model dependency.
5. **Camera + guided framing** — vision-camera preview + Skia overlay + **stubbed**
   detection frame processor (drop in `detection.tflite` when trained).
6. **Classification + result** — wire `classifier.tflite`, compute TPS, result screen with
   disclaimer and routing.
7. **Screening Summary Report** — offline HTML→PDF (`expo-print`) with lesion image +
   profile + classification + questionnaire + urgency + disclaimer; share/save.
8. **Auth** (Supabase) + history, polish, EAS production builds, DPA 2012 review.

Steps 1–4 have **no ML dependency** and can proceed immediately; 5–6 drop the models in
once exported (PyTorch → TFLite INT8 via `ai-edge-torch`).

---

## Out of scope (per thesis)
EMR/HIS integration, provider-facing dashboards, rare dermatological conditions,
non-cutaneous cancers. SpotOn cannot replace biopsy and is not a diagnostic instrument.
