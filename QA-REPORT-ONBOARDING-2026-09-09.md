# SpotOn production QA — onboarding pass

Target: https://spoton-dlsl.vercel.app  
Date: 2026-09-09 (Asia/Manila)  
Pass type: manual browser interaction + DOM/accessibility inspection  
State: partial onboarding pass; account creation was not submitted.

## Findings

### QA-ONB-001 — Onboarding route is not directly addressable

- Severity: Medium
- Area: Functional / navigation
- Repro: Open `https://spoton-dlsl.vercel.app/onboarding`.
- Expected: The onboarding screen opens, or the app redirects to its onboarding entry screen.
- Actual: Vercel returns `404: NOT_FOUND`.
- Notes: The app source uses an Expo Router route group `(onboarding)`, which is normally reached through the splash redirect rather than a literal `/onboarding` URL. The production session had already marked onboarding as seen, so the first-run onboarding screen could not be reached from the deployed build without clearing app storage or using a development-only reset control. This is still a discoverability/testability issue; confirm whether direct linking is intended.

### QA-ONB-002 — Registration content extends below the viewport with no document scroll

- Severity: High
- Area: UI / responsive layout / usability
- Repro: Open `/register` at the available desktop browser viewport (1280×720 CSS px), with the phone registration mode selected.
- Expected: The complete form, consent checkboxes, primary CTA, and sign-in link are reachable by normal scrolling.
- Actual: The rendered registration form extends to approximately y=1000px while the document reports a 720px scroll height. The full-page capture shows only the upper form area; the consent controls and CTA are below the visible area and are not reachable through ordinary document scrolling. The page is rendered as a narrow mobile-width surface within a large dark desktop background.
- Evidence: DOM measurement during test: primary button rect `top≈904`, `bottom≈962`; viewport height `720`; `documentElement.scrollHeight=720`.

### QA-ONB-003 — Tagalog validation errors are hard-coded in English

- Severity: Medium
- Area: Localization / UX
- Repro: On `/register` in Tagalog mode, submit the empty form.
- Expected: Validation feedback follows the selected Tagalog language, or at minimum uses the app's established bilingual copy consistently.
- Actual: The form labels and explanatory copy are Tagalog, but validation feedback is English: `Please confirm you are 18 or older.`, `Please accept the Terms and Privacy Policy to continue.`, and field messages such as `Ilagay ang buong pangalan mo.` are mixed with English. This is inconsistent within the same validation state.

### QA-ONB-004 — English login screen retains multiple Tagalog strings

- Severity: Medium
- Area: Localization / UX
- Repro: Open the language picker on `/login`, select English, and inspect the page.
- Expected: All user-facing login copy is English.
- Actual: `Welcome back` and the supporting sentence are English, but `Password mo`, `Bago ka rito?`, and `Gumawa ng account` remain Tagalog. The registration screen itself translated correctly after switching to English, so the inconsistency appears screen-specific.

### QA-ONB-005 — Language picker is inconsistent across auth onboarding screens

- Severity: Low
- Area: UI consistency / navigation
- Repro: Compare `/login` and `/register` in the same session.
- Expected: The language control is available consistently on both entry screens.
- Actual: `/login` exposes a `Language / Wika` button. `/register` has no visible language button in the accessibility tree or visual header, although it follows the locale selected on the preceding screen.

## Positive checks

- Registration supports both phone and email modes; toggling between them updates the field and toggle label.
- Empty-form validation runs client-side and does not proceed without required fields and consent.
- Both consent checkboxes are present and exposed with meaningful accessible labels.
- Password visibility control is exposed as `Show password`/`Ipakita ang password`.
- The app emitted one non-blocking web warning about `expo-notifications` listener support; no uncaught console errors were observed during this pass.

## Not yet executed

- First-run four-slide onboarding carousel (the deployed browser profile had already persisted `has_seen_onboarding`; direct `/onboarding` is a 404).
- Final registration submission and post-registration `complete-profile` flow. This requires creating an external account; it was intentionally not submitted during this pass.
- Camera/file upload, screening, clinic directory, learning, and profile flows.

