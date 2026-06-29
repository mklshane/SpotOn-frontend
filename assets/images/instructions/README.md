# Instructions illustrations

SVG illustrations for the in-camera **Instructions** carousel (`src/app/scan/instructions.tsx`),
opened from the "Instructions" pill on the capture screen. Flat/semi-flat "sunset" vector style,
matching `assets/images/onboarding/*.svg`; rendered through `expo-image`.

- `locate.svg` — Locate your lesion (body + sunset marker + rotate arrows)
- `photo.svg` — Take a clear, detailed photo (hand + phone framing a spot on the arm)
- `assess.svg` — Get a quick assessment (concentric risk gauge, green/amber/burnt-orange)
- `schedule.svg` — Plan your self-checks (calendar with checkmarks + pen)

To swap one, drop a replacement SVG (transparent, ~square `viewBox="0 0 400 400"`) under the same
name. Metro bundles `.svg` as an asset (see `metro.config.js` / the onboarding README).
