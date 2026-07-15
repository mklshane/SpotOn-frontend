# Questionnaire reference images — attribution

Clinical reference photos shown on each questionnaire page to help users recognize the
feature the question asks about. All are openly licensed (public domain / Creative Commons)
and were downloaded from Wikimedia Commons, then center-cropped to 700×420 and re-encoded
as JPEG. Public-domain images need no credit; the CC-BY / CC-BY-SA images below must retain
attribution (surfaced in-app on the About/Licenses screen).

> ⚠️ **`evolution`, `bleeding_nonhealing`, `irregular_border`, `spontaneous_bleeding`, and
> `rough_scaly` were replaced 2026-07-15 with images supplied by the product owner. Their
> provenance is UNVERIFIED and some carry third-party watermarks (sciencephoto.com, VisualDx
> © 2018). These are NOT confirmed public-domain/CC — obtain proper rights/licenses before
> production release.** The three NCI/Commons images below remain openly licensed.

| File | Question | Source | License | Author |
|------|----------|--------|---------|--------|
| `evolution.jpg` | Changed over time | Product owner | ⚠️ Unverified | — |
| `bleeding_nonhealing.jpg` | Not healing | Product owner | ⚠️ Unverified | — |
| `irregular_border.jpg` | Irregular edge | Product owner | ⚠️ Unverified | — |
| `spontaneous_bleeding.jpg` | Bleeds on its own | Product owner | ⚠️ Unverified | — |
| `rough_scaly.jpg` | Rough or scaly | Product owner | ⚠️ Unverified | — |
| `larger_7mm.jpg` | Wider than 7mm | Melanoma Diameter (Wikimedia Commons) | Public domain | NCI |
| `ugly_duckling.jpg` | Looks different | DysplasticNevusSyndrome (Wikimedia Commons) | CC BY-SA 3.0 | 0x6adb015 |
| `persistent_2mo.jpg` | Present over 2 months | Squamous cell carcinoma (2) (Wikimedia Commons) | Public domain | Kelly Nelson (NCI) |

Attribution text and license URLs are duplicated in machine-readable form in
`src/lib/triage/reference-images.ts` (the `REFERENCE_IMAGE_CREDITS` array) so the app can
render a licenses list. CC BY 4.0 = https://creativecommons.org/licenses/by/4.0/ ·
CC BY-SA 4.0 = https://creativecommons.org/licenses/by-sa/4.0/ ·
CC BY-SA 3.0 = https://creativecommons.org/licenses/by-sa/3.0/
