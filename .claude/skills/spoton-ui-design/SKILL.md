---
name: spoton-ui-design
description: >
  The SpotOn mobile app design system — warm "sunset" orange theme, modern,
  Apple-application quality, intuitive, and deliberately NOT AI-slop. Use whenever
  building or restyling any SpotOn screen or UI component: splash, onboarding, auth,
  scan/camera, triage result, clinic directory, the Screening Summary Report, or any
  shared primitive (buttons, cards, inputs, gradients, badges). Triggers: "SpotOn UI",
  "SpotOn design", "design system", "theme", "style a screen", "build a screen",
  "onboarding UI", "make it look good", "sunset theme".
user-invokable: true
argument-hint: "[screen or component to design]"
license: MIT
metadata:
  author: SpotOn
  version: "1.0.0"
  category: design
---

# SpotOn Design System

SpotOn is an offline-first skin-cancer **triage → referral** app for Filipinos. It is a
**medical** product that must feel **calm, trustworthy, warm, and premium** — Apple-quality,
not a generic template. The visual language is **"sunset"**: warm orange / coral / peach
gradients, soft light, generous space.

**Before designing, look at the references** in `SpotOn-frontend/`:
- `inspiration2.png` — the **primary** aesthetic: warm sunset-gradient onboarding, soft
  rounded cards, soft 3D icons, refined type, lots of breathing room.
- `inspiration.png` — the functional skin-classification screens: clean near-white, orange
  accents/CTAs, progress gauges, result cards.
- `screeningsummary.png` — the offline Screening Summary Report layout.

This file is the quick reference. **`REFERENCE.md`** (same folder) has the paste-ready
`theme.ts` tokens, component recipes, and screen archetypes — read it before implementing.

---

## The 10 rules (anti-AI-slop)

Generic AI UIs fail in predictable ways. Hold these hard:

1. **One brand color, used with intent.** Sunset orange is the hero. Don't rainbow the UI.
   Color earns its place (brand action, risk tier) — everything else is warm neutral.
2. **Whitespace is the design.** Generous padding, few elements per screen, clear focal point.
   When unsure, remove and add space.
3. **Only values from the scale.** Spacing 4·8·12·16·20·24·32·40·48·64; the named radii and
   elevation. **Never** arbitrary `13`, `#e7e7e7`, `0 2px 4px`.
4. **Real type hierarchy.** Differentiate by size + weight + color, not 5 shades of gray at
   one size. Display font (Hanken Grotesk) for titles; SF Pro for body/UI.
5. **Soft, single-direction, warm shadows.** Warm-brown shadow color, low opacity, large
   blur, small downward offset. Never harsh black drop shadows or hard borders everywhere.
6. **Gradients subtle and warm.** Sunset peach→coral. Never neon, never oversaturated, never
   a gradient on everything — reserve `sunsetVivid` for true hero/CTA moments.
7. **Restrained iconography.** One icon set (SF Symbols via `expo-symbols`, or Lucide). Soft
   3D illustrated icons ONLY for onboarding hero moments (as in inspiration2). No clip-art.
8. **Built for thumbs.** Tap targets ≥44px. Primary actions sit in the lower third, reachable.
   Pills for primary CTAs.
9. **Warm, plain, reassuring copy.** This is a cancer-anxiety context. Short sentences, human
   tone, no jargon, no alarmism. Every result screen carries the triage-not-diagnosis disclaimer.
10. **Consistency over cleverness.** Every screen is assembled from the same `src/components/ui`
    primitives. If a screen needs something new, add it as a primitive — don't one-off it.

A screen passes when it could plausibly ship in an Apple Design Award gallery: confident
hierarchy, warmth, restraint, polish.

---

## Color (light-first)

**Brand — sunset:** primary `#FF8A4C` · pressed `#F26A2E` · bright `#FFA468` · tint `#FFE9DA`.

**Warm neutrals:** `ink` `#211A15` (warm near-black — never pure `#000`) · `textSecondary`
`#7C6E64` · `muted` `#A99C92` · `background` `#FFF9F4` (warm off-white) · `surface` `#FFFFFF`
· `elementBg` `#FBF0E8` · `hairline` `#F1E5DB`.

**Gradients:** `sunsetSoft` `#FFE9D6→#FFD7C0→#FFC3AC` (screen backgrounds) · `sunsetWarm`
(more saturated, hero blocks) · `sunsetVivid` (brand/CTA moments).

**Risk tiers** (triage — must read clearly and stay distinct from the brand orange):
Low = green `#34A878` · Moderate = amber `#F2A93B` · High = burnt-orange `#E5571B` · Critical
= red `#E04347`. Each pairs with a soft tint background. The triage gauge maps to these.

> Dark mode: tokens are stubbed warm-dark (charcoal + ember) but **not** built out yet — design
> light-first.

## Type
Display (titles/headlines): **Hanken Grotesk** 600/700. Body/UI: **SF Pro** (system).
Ramp — largeTitle 34/40·700 · title1 28/34·700 · title2 22/28·600 · headline 17/22·600 ·
body 17/24·400 · callout 15/20·400 · subhead 14/20·500 · footnote 13/18·400 · caption 12/16·400.

## Space / shape / motion
Spacing 4·8·12·16·20·24·32·40·48·64. Radii sm 10 · md 16 · lg 22 · xl 28 · pill 999 (cards
22–28, buttons pill, inputs 14–16). Elevation: 3 soft warm shadows. Motion: gentle springs,
200–300ms; press = scale 0.97 + slight opacity (reanimated, already installed).

---

## Implementation

Reuse the scaffold's pattern — **don't** introduce NativeWind/Tamagui.

- **Tokens:** extend `src/constants/theme.ts` (keep its `Colors`/`Fonts`/`Spacing` shape +
  `useTheme()` in `src/hooks/use-theme.ts`). Paste-ready block in `REFERENCE.md`.
- **Styling:** `StyleSheet.create` + `useTheme()`, following `src/components/themed-text.tsx`
  / `themed-view.tsx` (variant-`type` prop pattern).
- **Primitives:** build in `src/components/ui/` — `Button`, `Card`, `Screen`/`GradientBackground`,
  `TextField`, `SelectCard`, `Chip`/`Badge`, `RiskBadge`, `Gauge`, `IconCircle`, `SectionHeader`,
  `ListRow`, page `Dots`. Recipes in `REFERENCE.md`.
- **Deps to add:** `npx expo install expo-linear-gradient @expo-google-fonts/hanken-grotesk`
  (gradients + display font). Load fonts in `src/app/_layout.tsx` and gate render until loaded.
- **Icons:** `expo-symbols` (SF Symbols) is already installed — prefer it on iOS; soft 3D icons
  for onboarding heroes only.

When building a screen: pick the matching **archetype** in `REFERENCE.md`, assemble it from
existing primitives, apply the tokens, and pressure-test against the 10 rules above.
