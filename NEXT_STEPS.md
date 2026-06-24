# SpotOn Frontend — Next Steps (Handoff)

Pick-up doc for a fresh session. The architecture plan is in `README.md`; this is the
"where we are + what to do next" snapshot.

## Current state (done)
- **Scaffolded:** Expo **SDK 56**, RN 0.85, **expo-router**, TypeScript. Styling = plain
  `StyleSheet` + `useTheme()` token system (NO NativeWind). Default template screens still in
  `src/app/` — not yet replaced.
- **Runs as an iOS dev build** on the simulator (`com.mklshane.SpotOn-frontend`). Build was
  clean (0 errors).
- **Offline data layer complete + type-checked** — `src/data/` (SQLite mirror, `runSync()`,
  repositories) and `src/api/` (typed client, `setAuthTokenProvider` hook). See `src/data/index.ts`.
- Backend directory data is enriched and live (`/directory`, `/sync`, `/me`, Supabase auth).

## How to run
```bash
npx expo start --dev-client          # JS dev server; open the installed dev build
# rebuild ONLY when native deps change:
npx expo run:ios                     # iOS simulator (Xcode ready on this machine)
```
- **Expo Go does NOT work** for this app (custom native ML/camera modules come later) — dev
  build is the runtime. Don't chase Expo Go.
- **Android** isn't set up locally (no SDK/Java) — use EAS Build for a device APK when needed.
- Set `EXPO_PUBLIC_API_BASE_URL` in `.env` (see `.env.example`); a physical device needs your
  machine's LAN IP, not `localhost`.

## Design system — use it for every screen
Invoke **`/spoton-ui-design`** (skill at `.claude/skills/spoton-ui-design/`). It carries the
sunset palette, type ramp, tokens, component recipes, and the anti-AI-slop rules.
- Visual refs in this folder: `inspiration2.png` (primary onboarding aesthetic), `inspiration.png`
  (functional screens), `screeningsummary.png` (report).
- Decisions: **Hanken Grotesk** (display) + **SF Pro** (body); **light-first** (dark deferred).

## Next steps (in order)
1. **Apply the design system.** Extend `src/constants/theme.ts` with the tokens from the skill's
   `REFERENCE.md §1`; `npx expo install expo-linear-gradient @expo-google-fonts/hanken-grotesk`;
   load fonts in `src/app/_layout.tsx`; build primitives in `src/components/ui/` (Button, Card,
   Screen/GradientBackground, TextField, SelectCard, Chip/Badge, Dots, …).
2. **Splash** — sunset gradient + logomark; holds during font load / initial sync.
3. **Onboarding** — 3–4 sunset-gradient pages (mirror inspiration2), `Dots`, vivid CTA.
4. **Auth = Supabase** (connects to backend):
   - `npm i @supabase/supabase-js`; create a Supabase client from **Project URL + anon/public
     key** (in `.env` as `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`).
   - Sign-in / sign-up screens (email + optionally Apple/Google).
   - Wire the session: `setAuthTokenProvider(() => supabase.auth.getSession()…access_token)`
     (from `src/api/client.ts`) so authed requests carry the token to the backend **`/me`**.
   - ⚠️ **anon key only** in the client — never the service key.
5. **App shell + directory feature** — tabs, then the directory screens consuming the ready data
   layer (`listFacilities`, `nearbyFacilities`, `getFacility`, … from `src/data`). On first launch
   call `runSync()` to seed the offline mirror; pull-to-refresh = `runSync()` again.

## Key references
- Data layer: `src/data/index.ts` (barrel) · sync `src/data/sync.ts` · queries `src/data/repositories.ts`.
- API: `src/api/client.ts` (`api.get/post/patch`, `setAuthTokenProvider`, `ApiError`) · types `src/api/types.ts`.
- Backend (FastAPI): `/directory/facilities|doctors|platforms|meta`, `/sync`, `/me`. Excluded
  facilities are hidden by default; vocab from `/directory/meta`.
- **API-exposure gap:** `booking_url` and `facility_type` exist in the DB but are NOT yet in the
  `/sync` (`FacilitySync`) or `/directory` (`FacilityOut`) schemas — add them server-side
  (`api/app/schemas/sync.py`, `directory.py`) when the UI needs them.
- Offline boundaries (what works without signal) are in `README.md`.

## Gotchas
- **SDK 56 is bleeding-edge** (RN 0.85 / React 19.2). Verify library compatibility before adding
  big native deps — especially `react-native-vision-camera` + `react-native-fast-tflite` for the
  camera/ML phase. If they lag, consider pinning to SDK 54.
- A **dev build is required** for the camera/ML features (Expo Go can't load them).
- Keep using `src/components/ui` primitives — don't one-off styles per screen.
