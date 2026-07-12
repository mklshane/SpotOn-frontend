# Running SpotOn on a device / emulator

The native `ios/` and `android/` folders are **gitignored** — they're regenerated from
`app.json` (Expo Continuous Native Generation). All native setup, including the MapLibre map used
by the Directory screen, is wired by config plugins in `app.json`, so a **clean checkout builds
with no manual native edits**. The one gotcha is a *stale* local `ios/`/`android/` from before a
native dependency was added — that's what `prebuild --clean` fixes.

## First-time setup (any platform)

```bash
npm install
cp .env.example .env         # optional: add EXPO_PUBLIC_MAPTILER_KEY to light up the map
npm run prebuild:clean       # regenerate ios/ + android/ from app.json (applies MapLibre etc.)
```

Without a MapTiler key or a native build, the map safely **degrades to a clinic list** — the app
never crashes (see `src/lib/maplibre.ts`).

## Android

Requires JDK 17 and the Android SDK (platform 36, build-tools 35/36, NDK 27.x).

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"   # or your SDK path; on Homebrew cmdline-tools:
# export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"

npx expo run:android         # with a device plugged in (USB debugging) or an emulator running
```

If Gradle can't find the SDK, create `android/local.properties` (gitignored) with:

```
sdk.dir=/absolute/path/to/your/Android/sdk
```

## iOS (macOS only)

```bash
npx expo run:ios             # or: --device "<your device>"
```

If a first build fails on `MapLibre/MapLibre.h file not found`, your Pods are stale — run
`npm run prebuild:clean` (regenerates the Podfile with the MapLibre SPM wiring). If SwiftPM errors
with `cannot use bare repository … safe.bareRepository is 'explicit'`, run once:
`git config --global safe.bareRepository all`.

## Troubleshooting: any native "module not found" / MapLibre build error

Almost always a stale native folder. Fix:

```bash
npm run prebuild:clean
```

This wipes and regenerates `ios/`/`android/` from `app.json`, re-applying every config plugin.
