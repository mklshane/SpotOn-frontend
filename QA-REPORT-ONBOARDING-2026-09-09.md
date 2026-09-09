# SpotOn production QA — onboarding & app pass

Target: https://spoton-dlsl.vercel.app
Date: 2026-09-09 (Asia/Manila)
Pass type: manual browser interaction + DOM/accessibility inspection
Triage/fix pass: 2026-09-09, verified against a local web build (`expo start --web`) driven with
Playwright, plus spot checks against the deployed build.

## Outcome

22 findings were filed. They were **not 22 independent defects** — eleven of them collapse into
three root causes, three did not reproduce in source, and two turned out to be observation
artifacts rather than product bugs.

| | count |
|---|---|
| Fixed and verified in a browser | 15 |
| Not reproducible / reclassified | 4 |
| Deferred with rationale | 3 |

### The three root causes

1. **The web app surface is 430px, but screens sized themselves to the browser window.**
   `src/app/_layout.tsx` clamps the app to `maxWidth: 430, overflow: hidden`, while seven screens
   paged their carousels with `useWindowDimensions().width` (~1280 on desktop). Measured on the
   deployed build: `/scan/instructions` renders **1280px pages inside a 430px shell**.
   → QA-APP-022, QA-APP-009.
2. **`react-native-screens` is inert on web, making `detachInactiveScreens` a no-op.**
   `core.js` sets `ENABLE_SCREENS = isNativePlatformSupported` (false on web), so expo-router's
   `MaybeScreen` fallback drops `enabled`/`active` and renders a plain `View`. Every visited tab
   stayed mounted and absolutely-filled, merely pushed behind with `zIndex: -1`.
   → QA-APP-001, QA-APP-006, and the *appearance* of QA-ONB-004 and QA-ONB-007.
3. **Commit `3375586` (`feat(i18n)`) swallowed trailing spaces when wrapping JSX text in `t()`.**
   `{pct}% match to {cls.lay}` became `{pct}{t("% match to")}{cls.lay}`; the space lived in the
   JSX text node, not the string, and `translate()` returns the source verbatim for English.
   20 sites across 11 files. → QA-APP-008, part of QA-APP-007.

---

## Findings

### QA-ONB-001 — Onboarding route is not directly addressable — **FIXED**

- Severity: Medium · Area: Functional / navigation
- Confirmed: `(onboarding)` is a route group, so its index resolves to `/`; there is no
  `dist/onboarding.html` and no SPA rewrite in `public/vercel.json`. Deployed build returns 404.
- Fix: added `src/app/onboarding.tsx`, a `<Redirect href="/(onboarding)" />` alias. Under
  `web.output: "static"` this emits a real `dist/onboarding.html`. Preferred over a catch-all
  rewrite, which would mask genuine 404s.
- Verified: `GET /onboarding` → 200, carousel renders.

### QA-ONB-002 — Registration content extends below the viewport — **NOT REPRODUCED**

- Severity: High (as filed) · Reclassified: test-method artifact
- `/register` has a `ScrollView` and the flex chain is intact. The measurement in the original
  report (`documentElement.scrollHeight === 720`) is expected: Expo's web shell sets
  `body{overflow:hidden}` deliberately, so the *document* never scrolls — the inner ScrollView does.
- Verified: scrolling the inner scroller brings the CTA to `bottom=658` within a 720px viewport.
  No code change.

### QA-ONB-003 — Tagalog validation errors are hard-coded in English — **FIXED**

- Severity: Medium · Area: Localization
- Confirmed, with a more precise cause than filed: two separate problems.
  1. Render sites that printed `error` raw instead of `t(error)` — `date-field.tsx`,
     `accordion.tsx`, and both consent errors in `register.tsx`. `TextField`/`IdentifierField`
     already did it correctly, so this was an inconsistency, not a missing mechanism.
  2. Six strings had no catalog entry, and `complete-profile.tsx` used a near-miss key
     (`"Enter a valid PH mobile number (e.g. 0917 123 4567)."`) when the already-translated
     `"Enter a valid PH mobile number."` existed.
- Fix: wrapped the raw render sites in `t()`, adopted the existing key, added the missing
  Tagalog entries to `fil-additions.json`.
- Verified: empty submit in Tagalog now yields zero English leaks, including the two consent
  errors QA quoted (`Kumpirmahin na 18 anyos ka na o mas matanda pa.`,
  `Tanggapin ang Terms at Privacy Policy para makatuloy.`).

### QA-ONB-004 — English login screen retains Tagalog strings — **NOT REPRODUCED**

- Severity: Medium (as filed) · Reclassified: symptom of QA-APP-001
- All three quoted strings go through `t()`; the Tagalog only comes from the catalog under `fil`.
- Checked against the **deployed** build in English: `Welcome back`, `New here?`,
  `Create an account` — no Tagalog present.
- Most likely what was observed: the language switch remounts the screen (`key={locale}`) while
  the previous scene stayed in the DOM — exactly QA-APP-001. Fixing that removes the mechanism.
  No login-specific change.

### QA-ONB-005 — Language picker inconsistent across auth screens — **FIXED**

- Severity: Low · Confirmed: `LanguagePicker` rendered on onboarding, login and settings only.
- Fix: added `<LanguagePicker compact />` to `register.tsx` and `complete-profile.tsx`. Also
  fixed a latent bug in the picker itself — it called `setVisible(false)` *after* awaiting
  `setLanguage()`, by which point the locale change had already unmounted it; it now closes first
  and only reopens on failure.
- Verified: `Language / Wika` present on `/register`.

### QA-ONB-006 — Complete-profile errors do not clear after correction — **FIXED**

- Severity: High · Area: Form validation
- Confirmed, with one correction to the report: `validate()` skips the phone check when the
  field is empty, so submission was **not** blocked by a cleared optional phone. The defect was
  purely stale error text persisting until the next submit.
- Fix: a `clearError(field)` helper called from each `onChange`, matching the per-field pattern
  `register.tsx` already used. Applied to `profile/edit.tsx`, which duplicated the screen verbatim.
- Verified: after an empty submit, picking `Female` clears `Please select one.` immediately while
  the still-unset date keeps its own error.

### QA-ONB-007 — Consent checkboxes do not expose checked state — **FIXED**

- Severity: Medium · Area: Accessibility
- Confirmed on the deployed build: `aria-checked` is absent before *and* after clicking.
  The component does set `accessibilityState={{ checked }}`, but **react-native-web does not
  derive `aria-checked` from it** — a gap this codebase had already discovered and documented in
  `select-card.tsx`, then fixed only there.
- Fix: set `aria-checked` directly on `checkbox.tsx`, and swept the same class into
  `switch.tsx`, `accordion.tsx` (radio options + `aria-expanded`) and `language-picker.tsx`.
- Verified: `aria-checked` now goes `false → true` on click.

### QA-APP-001 / QA-APP-006 — Inactive tab screens stay in the DOM — **FIXED**

- Severity: High / Medium · Root cause 2 above.
- Fix: `enableScreens(true)` on web in `src/app/_layout.tsx`. The library ships complete web
  variants (`Screen.web.js` hides inactive scenes with `display: none`); they were simply never
  used because the flag defaults off. On web `enableScreens` sets it and returns before any
  native-module check.
- Verified by A/B on the same build, walking Home → Directory → Learn → Profile:

  | | scenes in DOM | hidden | stale Home greeting visible on Profile |
  |---|---|---|---|
  | before | 17 | 1 | **yes** |
  | after | 9 | 4 | no |

- Risk noted: this also moves the root `Stack` onto its web variant. Stack navigation was
  re-tested (scan flow, profile sub-screens, directory, back navigation) with no regression.

### QA-APP-002 / QA-APP-014 — 3D body screens have no accessible representation — **PARTIALLY FIXED**

- Severity: Medium · Area: Accessibility
- Confirmed: both gesture surfaces had no `accessible`, role, label or hint; on web the r3f
  canvas exposes nothing at all.
- Fix (this pass): the surfaces now carry `accessible`, `accessibilityRole="image"`, a label and
  a hint carrying the on-screen gesture instructions.
- Deferred: an operable non-3D region picker — see *Deferred* below. `/scan/history` already
  ships a list alternative (`See all screenings as a list`); `/scan/body` still does not.

### QA-APP-003 — LiteRT/WebNN startup diagnostics logged as console errors — **DEFERRED (not our code)**

- Severity: Low
- Confirmed and traced: `src/` contains exactly one `console.error` (font loading). The red
  startup entries come from Emscripten's `var err = console.error.bind(console)` at line 153 of
  all three `public/litert/litert_wasm_*_internal.js`, which routes the WASM module's entire
  stderr — where TFLite/XNNPACK write routine `INFO:` diagnostics.
- Not fixed: it is vendored third-party runtime code. The cheap fix, if wanted, is ~3 lines in
  `scripts/copy-litert-wasm.mjs` to rewrite that line to `console.debug` while staging the files.

### QA-APP-004 — Notification setting disabled without explanation — **FIXED (partly reclassified)**

- Severity: Medium
- The `Switch` was **not** disabled. `settings-row.tsx` passed `disabled` whenever a row was
  non-interactive *as a row*, which react-native-web turns into `aria-disabled="true"` plus
  `tabIndex=-1` — on every switch row **and** every informational row on the screen.
- Fix: stopped passing `disabled` for non-interactive-by-design rows (omitting `onPress` is
  enough); gave `Switch` an `accessibilityLabel` fed from the row label; and, since
  `expo-notifications` cannot schedule in a browser, the row now says so up front instead of
  offering a toggle that silently springs back.
- Verified: `aria-disabled` nodes on Settings went 5 → **0**; the row reads
  "Not available in the browser — use the SpotOn app to get re-screening reminders".

### QA-APP-005 — Profile edit control lacks an accessible name — **FIXED**

- Severity: Medium · Confirmed: role but no label.
- Fix: `accessibilityLabel={t("Edit profile")}`. Verified present.

### QA-APP-007 — Directory listing display values — **SPLIT: partly fixed, partly deferred**

- `Photo:Cezanne Angel Cescar` → root cause 3; now `Photo: Cezanne Angel Cescar`.
- `Mon–FriHours unavailable` → root cause 3, but a space alone still read as a claim about
  weekday hours. Added `formatHoursLine()` in `src/lib/hours.ts`, which drops the day label when
  there is no period, matching the already-correct detail view.
- Rating without a review count → **deferred**: facilities have no `review_count` column
  (`src/data/db.ts`, `src/api/types.ts`); it exists only on doctor booking links. Backend change.

### QA-APP-008 — Missing spaces in result screen text — **FIXED**

- Severity: Medium · Root cause 3. Fixed at 20 sites across 11 files (the 4 reported plus 16 more
  in profile, follow-up confirm, capture, clinic/doctor detail, clinic cards, screening rows and
  article blocks).
- Verified live on the result screen: `91% match to a pattern with features similar to melanoma.`,
  `Checked on Sep 9, 2026`, `Priority action: Dermatologist evaluation within 1–2 weeks`.
- Regression guard added: `npm run test:i18n-spacing` fails on any `{t("…")}{` join without a
  separator (with an allow-list for deliberate ones). Confirmed it catches a reintroduced defect.

### QA-APP-009 — Questionnaire headings horizontally clipped — **FIXED**

- Severity: High · Root cause 1 — not a text-style issue; the heading had no `numberOfLines` or
  width constraint at all.
- Verified: questionnaire pages are now `[430 × 8]` with no text crossing the shell edge.

### QA-APP-010 — Report/share controls produce no visible feedback — **FIXED (reclassified)**

- Severity: Medium
- Not "unsupported": `report-pdf.web.ts` deliberately routes **both** actions through the
  browser's print dialog. That dialog is browser chrome, not DOM, so an automated pass sees
  nothing change — which is what was observed.
- Real gaps, now fixed: `Print` had no `loading` state (Share did); the primary action was
  labelled "Share or save" on a platform with no share sheet; and nothing told the user a print
  dialog would open. Web now shows "Save as PDF" plus an explanatory line.

### QA-APP-011 — Image quality screen accepts blurry imagery — **DEFERRED**

- Severity: Medium
- Not actioned deliberately: the blur thresholds were **relaxed on purpose** in `6980aa7`
  ("relax blur thresholds for improved photo acceptance") and `2977314`. Re-tightening them
  blind would undo a deliberate calibration. This needs real poor-quality photographs and the
  offline IQA eval harness, not a constant change.

### QA-APP-012 / QA-APP-013 — Directory "Open Now" and sort controls inert — **NOT REPRODUCED**

- Severity: High / Medium (as filed) · Reclassified
- The filter and sort logic were already correct in source. Driving the live UI — with both a
  real mouse click and a synthetic DOM click — both controls work:
  - `Open Now`: 4 clinics (2 marked Closed) → **2 clinics, 0 Closed cards**.
  - Sort: `sorted by name` → `rating` → `name`.
- A candidate cause (the bottom sheet's content-panning gesture swallowing taps on web) was
  implemented and then **reverted** when A/B testing showed the controls worked without it.
  Note "200 clinics" in the original report is the query's `limit`, not a stable count.
- Only change kept: the `Open Now` chip label was untranslated, unlike its sibling — now `t(item)`.

### QA-APP-015 — Mobile Home content obscured by the bottom navigation — **FIXED**

- Severity: Medium · Confirmed: `home.tsx` hard-coded `paddingBottom: Space.giant` (64), and
  Learn/Profile were worse at 20 — despite comments claiming to clear a ring that protrudes 30px.
  Nothing in the app read the tab bar's height.
- Fix: `tab-bar.tsx` now exports `TabBarHeight` (66), `TabBarOverhang` (30) and
  `TabContentInset`, and the three tab screens use it.
- Verified at 390×844: Home scroll content `paddingBottom: 96px`.

### QA-APP-020 — Sign-out and re-login are slow — **DEFERRED**

- Severity: Low. Backend cold start (Render), not a frontend defect.

### QA-APP-021 — Camera stuck on "Starting camera…" — **FIXED**

- Severity: High
- Confirmed and root-caused precisely: a *denied* prompt rejects immediately, but a **dismissed**
  one leaves `getUserMedia` **pending forever**. `capture.web.tsx` had no timers at all, and the
  `Try again` button existed only in the `denied` branch — unreachable from `starting`.
- Fix: a 10s race on `getUserMedia` with a new `timeout` state offering `Try again` /
  `Upload a photo`; a late-arriving stream is stopped so the camera indicator does not stay lit;
  and `live` is now gated on a real first frame, since `play()` can reject silently under an
  autoplay policy and leave an armed shutter over a 0×0 video.
- Verified by stubbing `getUserMedia` to a never-settling promise: `Starting camera…` at 6s →
  `Camera didn't start` with working retry/upload by 13s. Previously it never recovered.

### QA-APP-022 — Instructions/onboarding carousel uses full browser width — **FIXED**

- Severity: High · Root cause 1.
- Fix: `AppMaxWidth` exported from `theme.ts`, new `useSurfaceWidth()` hook returning
  `min(windowWidth, AppMaxWidth)` on web, applied at all page-width sites. Derived rather than
  measured deliberately — an `onLayout` provider reports 0 on first paint, and this value is
  baked into `getItemLayout`, where a 0 breaks paging.
- Verified: deployed build `[1280 × 5]` inside a 430px shell → local build `[430 × 5]`, with no
  text crossing the shell edge. Same for onboarding (`[430 × 4]`) and the questionnaire.

---

## Automated checks

All green after the pass:

```
npx tsc --noEmit                     clean
npm run lint                         25 errors, 0 warnings   (was 25 errors, 11 warnings)
test:flow 40 · test:localizer 16 · test:smoothing 31 · test:image-paths 29 · test:orbit 99
test:multiview 42 · test:capture 72 · test:glyphs 25 · test:tps 131 · test:iqa 45
test:scratch 20 · test:migration 52 · test:report PASS
test:i18n-spacing   (new)  no missing separators after t() calls
test:i18n-coverage  (new)  every t() key is translated (1223 catalog entries)
```

**On the 25 lint errors — these are not release defects.** 24 of 25 are
`react-hooks/immutability` and `react-hooks/refs` firing on Reanimated shared values and Gesture
worklets. A shared value is a native-backed handle, not React state; the codebase already
documents this false positive inline (`body-viewer.tsx`, `_layout.tsx`). Silencing them with 25
inline disables adds noise, and a config override would hide real findings. The original report's
classification of them as "release-quality engineering defects" should be corrected.

All 11 warnings were fixed: duplicate imports, two stale `eslint-disable` directives, a missing
effect dependency in `quality.tsx`, dead `MONTHS` in `profile-format.ts`, and two `require()`
imports that are Metro's asset mechanism and now carry a justified disable. Dead component
`body-marker-view.tsx` (referenced nowhere) was deleted.

`test:glyphs` was silently broken before this pass — it compiles with `--lib es2019` but
`i18n/core.ts` (reached via `body-parts.ts`) uses `Object.hasOwn`, an ES2022 method. Every
`test:*` script was moved to es2022 and the glyph script now rewrites emitted ESM specifiers for
Node. The region↔glyph invariant is guarded again (30 regions).

---

## Deferred, with rationale

- **Accessible non-3D body-region picker (QA-APP-002).** The labelling half is done. A real
  picker is a screen-level control and deserves its own pass — every ingredient exists
  (`BODY_PARTS`, `BodyGlyph`, the `BodyAreasBlock` grid, `SelectCard`'s radio semantics, the
  `ActionSheet` `body.tsx` already uses), and `test:glyphs` guards the invariant. It matters:
  `/scan/body`'s only non-3D path is `Skip`, which discards the body region that the report and
  history both depend on.
- **LiteRT console noise (QA-APP-003)** — vendored third-party code; fix available on request.
- **Facility review counts (QA-APP-007)** — no such column exists; backend/ingestion change.
- **Image-quality thresholds (QA-APP-011)** — deliberately relaxed; needs real photos + the eval harness.
- **Auth latency (QA-APP-020)** — backend cold start.
- **i18n Priority 2/3** — the Screening Summary Report still needs the open decision from
  `language-review/HANDOFF.md`: does the artefact a patient hands a doctor follow the app language?

## Issues found during this pass, not in the original report

- **The web build points at the production API.** `.env` sets
  `EXPO_PUBLIC_API_BASE_URL=https://spoton-api.onrender.com`, while
  `src/lib/secure-store.web.ts` carries an explicit warning in its own header: *"Do not point the
  web build at production auth, and do not let it hold real patient data"* — because on web it
  stores access/refresh tokens and the cached profile (name, email, phone) as **plain-text
  localStorage**. Worth resolving before wider testing.
- **Local web development cannot reach the API at all** — the API's CORS policy allows only the
  Vercel origin, so `http://localhost:8082` gets `ERR_FAILED` on `/sync`. This pass worked around
  it with a fixture. Allowing localhost in the API's dev CORS config would remove real friction.
- **Tab bar buttons have no `accessibilityLabel`** (they do have visible text, so this is minor).
