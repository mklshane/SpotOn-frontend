# SpotOn UI Plan — Splash · Onboarding · Auth (UI pass)

Self-contained build plan for a fresh session. Pairs with `/spoton-ui-design` skill
(`.claude/skills/spoton-ui-design/REFERENCE.md` = paste-ready tokens & recipes) and the refs
`inspiration2.png` (onboarding aesthetic) / `inspiration.png` / `screeningsummary.png`.

## Scope & decisions
- **Splash → 4-step onboarding → Registration ↔ Login**, plus the design-system foundation.
- **Auth = UI only.** Build screens + navigation + local validation. Do NOT wire Supabase yet
  (follow-up per `NEXT_STEPS.md §4`). Valid submit just `router.replace("/(tabs)")` so the flow
  is demonstrable.
- **Illustrations = PLACEHOLDER element for now.** Build an `OnboardingHero` that renders a
  styled placeholder (soft gradient `IconCircle` + SF Symbol + subtle "illustration" frame).
  Later, drop real art into `assets/images/onboarding/<page>.png` and the hero swaps to it —
  no layout change. (User will replace placeholders themselves.)
- **Routing = real gating** via existing `sync_meta` store, **plus a `__DEV__`-only dev-tools
  overlay** (lower-right floating button) to jump between screens and reset the flag.

---

## 1. Foundation
**Deps:** `npx expo install expo-linear-gradient @expo-google-fonts/hanken-grotesk`
(expo-font, reanimated, safe-area-context, expo-symbols already installed).

**Tokens — `src/constants/theme.ts`:** paste SpotOn tokens from `REFERENCE.md §1`
(`Gradients`, `Radius`, `Space`, `Type`, `Elevation`); merge the sunset palette into
`Colors.light`/`.dark`. **Keep existing keys** (`text`, `background`, `backgroundElement`,
`backgroundSelected`, `textSecondary`) — `themed-text/view.tsx` & `app-tabs.tsx` use them.
Add: `brand #FF8A4C`, `brandPressed #F26A2E`, `brandBright #FFA468`, `brandTint #FFE9DA`,
`surface #FFFFFF`, `elementBg #FBF0E8`, `hairline #F1E5DB`, `onBrand #FFFFFF`, `muted #A99C92`,
risk tiers. Keep existing `Spacing`; add `Space` (4·8·12·16·20·24·32·40·48·64).

**Fonts — `src/app/_layout.tsx`:** `useFonts({ "Display-SemiBold": HankenGrotesk_600SemiBold,
"Display-Bold": HankenGrotesk_700Bold })`; gate render until loaded. Extend
`src/components/themed-text.tsx` with the `Type` ramp variants.

**Primitives — `src/components/ui/`** (StyleSheet + `useTheme()`, reanimated press scale 0.97,
tap ≥44px; recipes in `REFERENCE.md §3`):
`Button` (pill: `brand`/`vivid`-gradient/`outline`/`ghost`, icon+loading+disabled) ·
`Screen` (safe-area; `plain`|`gradient` sunsetSoft) · `GradientBackground` ·
`TextField` (label, h54, elementBg, Radius.md, brand focus ring, error=riskCritical,
password show/hide) · `IconCircle` (gradient/brandTint + expo-symbols glyph) ·
`OnboardingHero` (PNG slot w/ placeholder fallback) · `Dots` (active = wide brand pill) ·
`Logo` (wordmark/logomark lockup).

---

## 2. Navigation (expo-router route groups)
```
src/app/
  _layout.tsx          SafeAreaProvider + ThemeProvider + font gate + <Stack headerShown:false>
                       + RootGate redirect + <DevTools/> (__DEV__)
  index.tsx            Splash (initial route → runs gating redirect)
  (onboarding)/_layout.tsx   Stack headerless
  (onboarding)/index.tsx     4-step carousel
  (auth)/_layout.tsx         Stack headerless
  (auth)/register.tsx        Registration (default post-onboarding)
  (auth)/login.tsx           Sign in
  (tabs)/_layout.tsx         renders existing AppTabs NativeTabs
  (tabs)/index.tsx           MOVED from src/app/index.tsx (Home)
  (tabs)/explore.tsx         MOVED from src/app/explore.tsx
```
- Move current `index.tsx`/`explore.tsx` into `(tabs)/`; route names stay `index`/`explore`,
  so `app-tabs.tsx` `NativeTabs.Trigger name=...` works unchanged — just render it from
  `(tabs)/_layout.tsx`.
- Add `SafeAreaProvider` (react-native-safe-area-context) in root layout (Screen needs insets).

**Gating** (existing `getMeta`/`setMeta` from `src/data/db.ts`, key `"has_seen_onboarding"`="1"):
- Splash reads flag → not seen: `router.replace("/(onboarding)")` · seen (UI-only ⇒ unauthed):
  `router.replace("/(auth)/register")`. (Later: authed ⇒ `/(tabs)`.)
- Onboarding Skip/finish → `setMeta("has_seen_onboarding","1")` → `/(auth)/register`.

---

## 3. Screens
**3a. Splash `src/app/index.tsx`** — full-bleed `sunsetVivid` gradient, `Logo` in `IconCircle`,
gentle scale+fade-in (reanimated). Holds while fonts+gating resolve, then redirects.

**3b. Onboarding `src/app/(onboarding)/index.tsx`** — one screen, horizontally paged
(`FlatList pagingEnabled`), `Dots`, **grey "Skip" top-right** every page, bottom `Button vivid`.
Pages (warm, non-alarmist copy):
1. **Welcome to SpotOn** — "Your pocket guide to checking skin changes early — calm, private,
   and made for the Philippines."
2. **Classify Skin Lesions** — "Snap a photo and get an instant, on-device triage of how
   concerning a spot looks."
3. **Access Local Dermatologists** — "Find verified dermatology clinics and doctors near you,
   even offline."
4. **Your Data is Safe** — "Your photos and results stay on your phone. Nothing is shared
   without your say-so." → CTA becomes **"Get Started"** → registration.
Last page swaps "Continue"→"Get Started"; Skip jumps to finish.

**3c. Registration `src/app/(auth)/register.tsx`** — `Logo` + warm one-liner; `TextField`s
full name / email / password(show-hide); `Button brand` "Create account"; footnote
**"Already have an account? Sign in"** → `router.push("/(auth)/login")`. Local validation only;
valid → `router.replace("/(tabs)")`.

**3d. Sign in `src/app/(auth)/login.tsx`** — email + password; `Button brand` "Sign in";
footnote **"New here? Create an account"** → register. Valid → `router.replace("/(tabs)")`.

---

## 4. Dev-tools overlay — `src/components/ui/DevTools.tsx`
`__DEV__`-only floating button, lower-right (safe-area aware), mounted in root layout above the
Stack. Panel: jump to **Splash · Onboarding · Register · Login · App(Tabs)** (`router.replace`);
**Reset onboarding flag** (`setMeta("has_seen_onboarding","")` → Splash); placeholder
"Mark authed" no-op (for later Supabase pass). Token-styled `Card` + `Elevation.md`. Never in prod.

---

## Critical files
- **Edit:** `src/constants/theme.ts`, `src/components/themed-text.tsx`, `src/app/_layout.tsx`,
  `app.json` (optional: splash `backgroundColor` → sunset, currently `#208AEF`).
- **Move:** `src/app/index.tsx`→`(tabs)/index.tsx`; `explore.tsx`→`(tabs)/explore.tsx`; add `(tabs)/_layout.tsx`.
- **New:** splash `index.tsx`, `(onboarding)/{_layout,index}`, `(auth)/{_layout,register,login}`,
  `src/components/ui/*` above, `assets/images/onboarding/` (placeholder slots).
- **Reuse (no change):** `getMeta`/`setMeta` (`src/data/db.ts`), `useTheme` (`src/hooks/use-theme.ts`),
  `app-tabs.tsx`, `themed-view.tsx`.

## Verify
1. `npx expo start --dev-client` → iOS dev build (Expo Go unsupported).
2. Fresh launch: splash → swipe 4 pages (Dots advance, grey Skip works, page 4 = "Get Started")
   → Registration.
3. Auth: "Sign in" link ↔ Login; empty/invalid triggers validation; valid → tabs.
4. Persistence: relaunch skips onboarding; Dev-tools → Reset flag → relaunch shows it again.
5. Dev-tools: jump to each screen; absent when `__DEV__` false.
6. `npx tsc --noEmit` clean; pass `REFERENCE.md §5` anti-AI-slop checklist.

## Build order
1) deps + tokens + fonts → 2) primitives → 3) nav restructure + gating → 4) splash →
5) onboarding → 6) auth screens → 7) dev-tools → 8) verify.
