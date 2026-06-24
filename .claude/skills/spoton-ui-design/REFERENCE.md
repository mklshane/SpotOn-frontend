# SpotOn Design System — Reference

Paste-ready tokens, component recipes, and screen archetypes. Read `SKILL.md` first for the
principles. All code follows the scaffold pattern: `StyleSheet` + `useTheme()`, no NativeWind.

---

## 1. Tokens — extend `src/constants/theme.ts`

Keep the existing `Colors` / `Fonts` / `Spacing` shape and `useTheme()`; add the SpotOn tokens.

```ts
// --- SpotOn brand tokens (append to src/constants/theme.ts) -------------------

export const Colors = {
  light: {
    // brand — sunset
    brand: "#FF8A4C",
    brandPressed: "#F26A2E",
    brandBright: "#FFA468",
    brandTint: "#FFE9DA",
    // text
    text: "#211A15",          // warm near-black (never #000)
    textSecondary: "#7C6E64",
    muted: "#A99C92",
    onBrand: "#FFFFFF",
    // surfaces
    background: "#FFF9F4",    // warm off-white
    surface: "#FFFFFF",
    elementBg: "#FBF0E8",
    backgroundSelected: "#FFE1CE",
    hairline: "#F1E5DB",
    // risk tiers (triage)
    riskLow: "#34A878",       riskLowBg: "#E7F6EF",
    riskModerate: "#F2A93B",  riskModerateBg: "#FFF4DE",
    riskHigh: "#E5571B",      riskHighBg: "#FFE6D7",
    riskCritical: "#E04347",  riskCriticalBg: "#FCE7E7",
  },
  dark: {
    // STUB — warm-dark, not built out yet. Mirror keys; refine later.
    brand: "#FF8A4C", brandPressed: "#F26A2E", brandBright: "#FFA468", brandTint: "#3A2A20",
    text: "#FBF1EA", textSecondary: "#C9BBB0", muted: "#8C7E73", onBrand: "#1A130E",
    background: "#171210", surface: "#211A15", elementBg: "#2A211B",
    backgroundSelected: "#3A2A20", hairline: "#2E2620",
    riskLow: "#3FBA88", riskLowBg: "#16271F", riskModerate: "#F2B454", riskModerateBg: "#2A2113",
    riskHigh: "#F26A33", riskHighBg: "#2C1810", riskCritical: "#F05B5F", riskCriticalBg: "#2A1414",
  },
} as const;

// Gradients (use with expo-linear-gradient). Tuples of color stops.
export const Gradients = {
  sunsetSoft:  ["#FFE9D6", "#FFD7C0", "#FFC3AC"] as const, // screen backgrounds
  sunsetWarm:  ["#FFD9B8", "#FFB98E", "#FF9E78"] as const, // hero blocks
  sunsetVivid: ["#FFA468", "#FF8A4C", "#F26A2E"] as const, // CTA / brand moments
};

export const Radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const;

// Spacing — clean 4px scale (supersedes the scaffold's half/one/two names).
export const Space = {
  xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40, huge: 48, giant: 64,
} as const;

// Type ramp. fontFamily values are wired up in §2.
export const Type = {
  largeTitle: { fontSize: 34, lineHeight: 40, fontFamily: "Display-Bold" },
  title1:     { fontSize: 28, lineHeight: 34, fontFamily: "Display-Bold" },
  title2:     { fontSize: 22, lineHeight: 28, fontFamily: "Display-SemiBold" },
  headline:   { fontSize: 17, lineHeight: 22, fontFamily: "Display-SemiBold" },
  body:       { fontSize: 17, lineHeight: 24 }, // SF Pro (system) — omit fontFamily
  callout:    { fontSize: 15, lineHeight: 20 },
  subhead:    { fontSize: 14, lineHeight: 20, fontWeight: "500" as const },
  footnote:   { fontSize: 13, lineHeight: 18 },
  caption:    { fontSize: 12, lineHeight: 16 },
} as const;

// Soft warm shadows. Spread into a style; add Android elevation.
export const Elevation = {
  sm: { shadowColor: "#7A4A2B", shadowOpacity: 0.08, shadowRadius: 8,  shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  md: { shadowColor: "#7A4A2B", shadowOpacity: 0.10, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  lg: { shadowColor: "#7A4A2B", shadowOpacity: 0.12, shadowRadius: 28, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
} as const;
```

---

## 2. Fonts — Hanken Grotesk (display) + SF Pro (body)

```bash
npx expo install expo-linear-gradient @expo-google-fonts/hanken-grotesk expo-font
```

In `src/app/_layout.tsx`, load and gate render:

```tsx
import { useFonts, HankenGrotesk_600SemiBold, HankenGrotesk_700Bold } from "@expo-google-fonts/hanken-grotesk";
// map to the Type ramp's family names:
const [loaded] = useFonts({ "Display-SemiBold": HankenGrotesk_600SemiBold, "Display-Bold": HankenGrotesk_700Bold });
if (!loaded) return null; // or keep the splash visible
```

Body/UI text uses the system font (SF Pro on iOS) — omit `fontFamily`. Extend
`src/components/themed-text.tsx` with the `Type` variants so all text flows through it.

---

## 3. Component recipes (`src/components/ui/`)

All accept `style` overrides, use `useTheme()`, and animate press with reanimated
(`useAnimatedStyle` + `withSpring`, scale 0.97 + opacity 0.9). Tap targets ≥44px.

- **`Button`** — pill (`Radius.pill`), height 54, `Type.headline`, centered. Variants:
  `brand` (filled `brand`, text `onBrand`) · `vivid` (LinearGradient `sunsetVivid`) · `ink`
  (filled `text`, text `surface`) · `outline` (1px `hairline`, text `text`) · `ghost`
  (transparent, text `brand`). Optional leading icon, loading spinner, `disabled` (0.5).
- **`Screen`** — safe-area page wrapper. `variant="plain"` (bg `background`) or
  `variant="gradient"` (full-bleed `LinearGradient` `sunsetSoft`, top→bottom). Standard
  horizontal padding `Space.xl`.
- **`Card`** — `surface`, `Radius.xl`, padding `Space.xl`, `Elevation.sm`. `Card.Gradient`
  variant uses `sunsetWarm` for hero cards.
- **`TextField`** — label (`Type.subhead`, `textSecondary`), input height 54, `elementBg`,
  `Radius.md`, `Space.base` padding, `brand` focus ring (1.5px). Error = `riskCritical`.
- **`SelectCard`** — tappable row/card (from inspiration2): title + optional subtitle, trailing
  check circle (filled `brand` when selected, else `hairline` ring). Selected bg `brandTint`.
- **`Chip` / `Badge`** — pill, `Space.md`×`Space.sm`, `Type.caption`. Filter chips toggle
  `elementBg`↔`brandTint`+`brand` text. Service tags = static `elementBg`.
- **`RiskBadge`** — maps tier → `risk*` color + `risk*Bg`, label in caps (LOW/MODERATE/HIGH/CRITICAL).
- **`Gauge`** — semicircular triage meter; needle/arc color from the tier; big tier label +
  TPS underneath. (`react-native-svg` if needed.)
- **`IconCircle`** — soft circular container (`brandTint` or gradient) holding an icon/3D glyph;
  onboarding hero element.
- **`SectionHeader`** — `Type.title2` + optional trailing action (`ghost` button).
- **`ListRow`** — left icon/avatar, title + subtitle, trailing chevron/meta; `Space.base` vertical,
  `hairline` separator. Used by the directory.
- **`Dots`** — onboarding page indicator; active = wide `brand` pill, inactive = `hairline` dot.

---

## 4. Screen archetypes

- **Splash** — full `sunsetWarm`/`sunsetVivid` gradient, centered SpotOn logomark in an
  `IconCircle`, subtle scale/fade-in. Holds while fonts/initial sync load.
- **Onboarding** (3–4 pages) — `Screen variant="gradient"` (`sunsetSoft`); soft 3D `IconCircle`
  hero, `Type.largeTitle` title, `Type.body` `textSecondary` subhead, `Dots`, bottom `Button vivid`
  "Continue" + `ghost` "Skip". One idea per page. Mirror inspiration2's calm spacing.
- **Auth** — branded header (logomark + warm one-liner), `Button outline` social ("Continue with
  Apple/Google"), divider, `TextField` email/password, `Button brand` submit, footnote toggle
  sign-in/up. Gentle gradient or plain `background`.
- **Scan/Capture** — clean near-white, large rounded camera viewport, orange framing guide,
  coaching text, capture control in the lower third (inspiration.png).
- **Result/Triage** — `Gauge` with tier color, big tier label + plain-language recommendation,
  `Card` disclaimer ("triage, not a diagnosis"), `Button brand` "Find a clinic" + `outline`
  "Save report".
- **Directory** — search `TextField`, horizontal filter `Chip`s (services from `/directory/meta`),
  facility `Card`/`ListRow` (name, type, distance, service `Badge`s, PhilHealth), map with
  online→list fallback (see `NEXT_STEPS.md` offline boundaries).
- **Screening Summary Report** — match `screeningsummary.png`: header, profile, lesion image +
  classification, symptom table, urgency + recommendation, disclaimer. Rendered offline to PDF
  via `expo-print` (HTML template mirroring these tokens).

---

## 5. Quick checklist before shipping a screen
- [ ] Only scale spacing / named radii / token colors — no arbitrary values.
- [ ] Clear single focal point; generous whitespace.
- [ ] Brand orange used purposefully (action or risk), not decoratively everywhere.
- [ ] Type hierarchy via Hanken display titles + SF Pro body; not mono-gray.
- [ ] Soft warm shadows; no hard borders-everywhere.
- [ ] Primary action is a thumb-reachable pill.
- [ ] Warm, plain copy; disclaimer present on any result/medical screen.
- [ ] Built only from `src/components/ui` primitives.
