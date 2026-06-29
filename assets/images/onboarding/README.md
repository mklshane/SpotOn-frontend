# Onboarding illustrations

Hero illustration slots for the 4-step onboarding flow. **Real vector art now ships** as
transparent **SVGs** (`welcome.svg`, `classify.svg`, `dermatologists.svg`, `privacy.svg`),
wired into each slide in `src/app/(onboarding)/index.tsx`. If an `image` is ever removed,
`OnboardingHero` falls back to an on-brand placeholder (sunset gradient frame + glyph), so
the UI stays shippable.

## Why SVG works with no extra deps
`expo-image` (already a dependency) renders SVG natively, and Metro treats `.svg` as an
**asset** by default — so `require('@/assets/images/onboarding/welcome.svg')` resolves to an
image source exactly like a PNG. No `react-native-svg-transformer` / Metro config needed.

## How to swap or add art
1. Author a transparent, ~square SVG (`viewBox="0 0 400 400"`), flat/semi-flat "sunset"
   vector style (warm orange / coral / peach), matching `inspiration2.png`. PNGs (~1024×1024)
   also work in the same slot.
2. Save here with the exact name (`welcome` / `classify` / `dermatologists` / `privacy`).
3. Wire in `src/app/(onboarding)/index.tsx` — add an `image` to the slide:
   ```ts
   { key: 'welcome', title: '…', description: '…', icon: 'sparkles',
     image: require('@/assets/images/onboarding/welcome.svg') },
   ```

## Suggested generation prompts (soft 3D, sunset palette, transparent background)
- **welcome** — "Soft 3D illustration of a friendly smartphone with a glowing sun/spot motif,
  warm sunset orange and peach gradients, rounded shapes, gentle studio light, transparent
  background, premium medical-app onboarding style."
- **classify** — "Soft 3D illustration of a phone camera viewfinder framing a small skin spot
  on an arm, warm coral and amber tones, clean and reassuring, transparent background."
- **dermatologists** — "Soft 3D illustration of a location pin with a small medical cross and a
  friendly doctor avatar, warm sunset gradient, rounded forms, transparent background."
- **privacy** — "Soft 3D illustration of a rounded shield with a lock over a phone, warm peach
  and orange gradient, calm and trustworthy, transparent background."
