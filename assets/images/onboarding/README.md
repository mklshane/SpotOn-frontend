# Onboarding illustrations

These are the hero illustration slots for the 4-step onboarding flow. Until real art is
added, `OnboardingHero` renders an on-brand placeholder (sunset gradient frame + glyph), so
the UI is complete and shippable. Dropping the PNGs in here lights up the real art with **no
layout change**.

## How to add real illustrations
1. Export each as a transparent PNG, roughly square (~1024×1024), soft 3D "sunset" style
   (warm orange / coral / peach), matching `inspiration2.png`.
2. Save them here with these exact names:
   - `welcome.png` — Welcome to SpotOn
   - `classify.png` — Classify Skin Lesions
   - `dermatologists.png` — Access Local Dermatologists
   - `privacy.png` — Your Data is Safe
3. Wire them in `src/app/(onboarding)/index.tsx` — add an `image` to each slide, e.g.:
   ```ts
   { key: 'welcome', title: '…', description: '…', icon: 'sparkles',
     image: require('@/assets/images/onboarding/welcome.png') },
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
