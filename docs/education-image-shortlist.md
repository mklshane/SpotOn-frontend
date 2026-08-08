# ISIC candidate shortlist for review

Queried from the ISIC Archive API on 2026-08-08.

**STATUS: executed.** Ten of these candidates were approved, downloaded to
`assets/images/learn/clinical/`, and wired into `src/data/learn-images.ts`. This
document is now the audit trail for which image went into which slot and why.
Anything below still describing a slot as unfilled refers to the two evolving
slots, which remain open.

Project status assumed: **academic thesis, non-commercial**. Every candidate below
is CC-0 or CC-BY, both of which permit this use and would also survive the project
later going commercial. No CC-BY-NC image is proposed, so that decision stays open.

## Read this before reviewing

**I cannot see these images.** Every candidate was selected from *metadata* only:
diagnosis, image type, anatomical site, licence. The archive records that
`ISIC_8092280` is a benign nevus; it does not record whether that nevus looks
symmetrical, which is the actual reason the ABCDE "A" slot would use it.

So each candidate needs a human to open it and confirm it visibly shows the feature
it is being asked to teach. A benign nevus that happens to look lopsided would
actively teach the wrong lesson in the "More regular" frame.

## Pool sizes found

| Query | Total |
| --- | --- |
| `image_type:clinical` | 9,316 |
| `image_type:clinical AND copyright_license:"CC-0"` | 52 |
| `image_type:clinical AND diagnosis_1:Benign` | 3,196 (all CC-BY, MSKCC) |
| `image_type:clinical AND diagnosis_3:Nevus` | 1,005 (all CC-BY, MSKCC) |
| `image_type:clinical AND diagnosis_3:Nevus AND fitzpatrick_skin_type:"V"` | **1** |

All 52 CC-0 clinical images are malignant. There are no benign CC-0 clinical
images, which is why the benign halves below are CC-BY.

## Candidates

Source page for any id: `https://api.isic-archive.com/api/v2/images/<ISIC_ID>/`

### ABCDE, benign halves

Licence **CC-BY**. Attribution required: *Memorial Sloan Kettering Cancer Center*.

| Slot | ISIC ID | Diagnosis / site | Why |
| --- | --- | --- | --- |
| `abcde-asymmetry-regular` | ISIC_8092280 | Nevus, posterior trunk, 5.30 mm, Fitzpatrick IV, histopathology confirmed | Biopsy-confirmed benign nevus with recorded size. Fitzpatrick IV is closer to most Filipino users than the archive's usual II/III |
| `abcde-border-even` | ISIC_0788010 | Nevus, lower extremity, 6.60 mm, Fitzpatrick II, histopathology confirmed | Biopsy-confirmed benign nevus. Metadata verified directly. Also the best `abcde-diameter` candidate, see below |
| `abcde-color-uniform` | ISIC_2486464 | Nevus, anterior trunk | Benign nevus, needs visual check that it is a single even shade |

Alternates from the same collection, all CC-BY MSKCC nevi: ISIC_9377549,
ISIC_5574004, ISIC_9498324, ISIC_7727119, ISIC_5009385, ISIC_4676795, ISIC_9708499.

### ABCDE, concerning halves

Licence **CC-0**. No attribution required, though the app will still credit ISIC.

| Slot | ISIC ID | Diagnosis | Why |
| --- | --- | --- | --- |
| `abcde-asymmetry-irregular` | ISIC_0024226 | Melanoma, invasive | Invasive melanoma, most likely of the set to show clear asymmetry |
| `abcde-border-irregular` | ISIC_0024214 | Melanoma in situ | In-situ melanomas typically show the spreading, poorly defined edge this frame teaches |
| `abcde-color-varied` | ISIC_0024228 | Melanoma in situ | Needs visual check for several shades in one lesion |

Alternates, all CC-0 clinical melanoma: ISIC_0024229, ISIC_0024241, ISIC_0024258,
ISIC_0024268, ISIC_0024273, ISIC_0024284, ISIC_0024290, ISIC_0024292, ISIC_0024298.

### Skin cancer type examples

Licence **CC-0**.

| Slot | ISIC ID | Diagnosis |
| --- | --- | --- |
| `bcc-example` | ISIC_0024262 | Basal cell carcinoma, nodular, posterior trunk |
| `scc-example` | ISIC_0024211 | Squamous cell carcinoma, NOS |
| `melanoma-example` | ISIC_0024292 | Melanoma, invasive |

Alternates: BCC — ISIC_0024221, ISIC_0024224, ISIC_0024230, ISIC_0024250.
SCC — ISIC_0024212, ISIC_0024223, ISIC_0024225, ISIC_0024237.

## Two slots I could not fill

### `abcde-diameter`

Fillable, but only from the CC-BY side. Verified on 2026-08-08 by fetching two
candidates directly:

- **ISIC_0788010** (CC-BY, MSKCC) records `clinical_size_long_diam_mm: 6.60`,
  Fitzpatrick II, histopathology confirmed, lower extremity.
- **ISIC_0024226** (CC-0) records melanoma *thickness* 0.60 mm, which is Breslow
  depth, not surface diameter. It carries no `clinical_size_long_diam_mm`, no
  Fitzpatrick type, and no anatomical site.

So the CC-0 collection has no diameter metadata at all, and the D slot has to come
from the MSKCC CC-BY collection, which does record it. ISIC photographs never
include a ruler in frame, so the app's 6 mm overlay plus the recorded figure quoted
in the caption is the workable route.

One judgement call: ISIC_0788010 is a *benign* nevus measuring 6.60 mm. That is
above the threshold while being harmless, which is either a confusing example or a
genuinely useful one, since size alone is not diagnostic. A malignant lesion with a
recorded diameter above 6 mm would be the cleaner choice. Finding one needs another
query, because the API rejects range syntax (`[6 TO 20]` and `>6` both return HTTP
400), so it has to be done by checking candidates individually.

### `abcde-evolving-earlier` / `abcde-evolving-later` — RESOLVED

**Filled from outside ISIC**, as expected. ISIC holds single images per lesion, so
no dated same-lesion pair was findable there.

Source: Sato T, Tanaka M. *A case of a superficial spreading melanoma in situ
diagnosed via digital dermoscopic monitoring with high dynamic range conversion.*
Dermatology Practical & Conceptual. 2014;4(4):57-60. doi:10.5826/dpc.0404a10
<https://pmc.ncbi.nlm.nih.gov/articles/PMC4230260/>

Licence verbatim from the article: *"©2014 Sato et al. This is an open-access
article distributed under the terms of the Creative Commons Attribution License,
which permits unrestricted use, distribution, and reproduction in any medium,
provided the original author and source are credited."*

| Slot | Figure | Documented |
| --- | --- | --- |
| `abcde-evolving-earlier` | Fig 1A | 3 mm, first consultation |
| `abcde-evolving-later` | Fig 2A | 5 mm, 7 months later |

Same lesion, same patient, intervals and sizes quoted from the publication rather
than estimated.

**Figures 1A and 2A were used, not 1B and 2B.** The B variants are the authors'
high-dynamic-range conversions, i.e. digitally processed. The unprocessed originals
are the honest choice for teaching what a lesion looks like.

**These are dermoscopic, not clinical.** Only Figure 3A of that paper is a clinical
photograph, and it has no earlier counterpart, so a clinical pair was not available
at any licence. The UI handles this explicitly:

- the frame badge reads `DERMOSCOPIC` rather than `PHOTO`
- a footnote explains that dermoscopy is a magnified examination used by
  professionals and is not how a spot looks to the naked eye
- `fit: 'contain'` letterboxes the published figures instead of cropping them
  square, which would have cut clinically relevant edges away

Rejected alternative: PMC3157767 has a genuine one-year clinical pair, but it is
© Specjalisci Dermatolodzy rather than CC BY, and its own caption states "no
increase in size is noted", so there is no visible change to teach.

## The skin tone problem is worse than expected

Searching the entire archive for a clinical nevus at Fitzpatrick type V returned
**one** image: ISIC_9498860, CC-BY, Federal University of Espírito Santo (UFES).

ISIC is overwhelmingly Fitzpatrick I to III. For an app aimed at Filipino users,
mostly Fitzpatrick III to V, that is a real limitation and not one more querying
will fix. Worth raising in the thesis writeup regardless of what ships.

Partial mitigations:

- Prefer higher Fitzpatrick types where the metadata records them, as with
  ISIC_8092280 (type IV) above.
- Look at the UFES collection specifically. It is Brazilian and appears to carry
  more varied skin tones than the US contributions.
- State the limitation in the app. The Education module already tells users that
  appearance alone cannot confirm a diagnosis; a line noting that these examples
  skew toward lighter skin would be honest and clinically useful.

## What was actually taken

Downloaded 2026-08-08 from `https://isic-archive.s3.amazonaws.com/images/<id>.jpg`,
resized to 640x640 (5.2 MB total became 575 KB, since these render at roughly 150 px)
and committed to `assets/images/learn/clinical/`.

| Slot | ISIC ID | Licence |
| --- | --- | --- |
| `abcde-asymmetry-regular` | ISIC_8092280 | CC BY 4.0, MSKCC |
| `abcde-asymmetry-irregular` | ISIC_0024226 | CC0 1.0 |
| `abcde-border-even` | ISIC_0788010 | CC BY 4.0, MSKCC |
| `abcde-border-irregular` | ISIC_0024214 | CC0 1.0 |
| `abcde-color-uniform` | ISIC_2486464 | CC BY 4.0, MSKCC |
| `abcde-color-varied` | ISIC_0024228 | CC0 1.0 |
| `abcde-diameter-small` | ISIC_8092280 | CC BY 4.0, MSKCC |
| `abcde-diameter-large` | ISIC_2222766 | CC BY 4.0, MSKCC |
| `abcde-evolving-earlier` | Sato & Tanaka 2014, Fig 1A | CC BY |
| `abcde-evolving-later` | Sato & Tanaka 2014, Fig 2A | CC BY |
| `bcc-example` | ISIC_0024262 | CC0 1.0 |
| `scc-example` | ISIC_0024211 | CC0 1.0 |
| `melanoma-example` | ISIC_0024292 | CC0 1.0 |

All thirteen slots are now filled.

### The D slot, resolved

`ISIC_2222766` is a melanoma with a recorded longest diameter of **10.4 mm**, found
by filtering `image_type:clinical AND diagnosis_1:Malignant AND
copyright_license:"CC-BY"` and reading the recorded sizes. That is comfortably above
the 6 mm threshold, so it teaches the sign without needing the benign 6.6 mm nevus
and its confusing caveat.

**The 6 mm overlay was removed.** It drew a bar at a fixed 46 percent of the frame
width, which bore no relation to the lesion's real scale. On a diagram that was
merely decorative; on a real photograph it would have been a false measurement
printed over clinical evidence. The recorded figure is quoted in the caption
instead, where it is traceable to the archive's own metadata.

### Still to check by eye

Every one of these was chosen from metadata. Open the app and confirm each visibly
shows the feature its slot teaches, particularly:

- the three benign nevi, which need to look symmetrical, evenly bordered, and evenly
  coloured respectively
- `abcde-color-varied`, which needs several visible shades in one lesion

Swapping any of them is a one-line change in `learn-images.ts`; alternates are
listed above.

## 2026-08-08: nine slots replaced with project-supplied clinical photographs

Nine slots no longer use the sources listed above. They were replaced with
clinical, naked-eye photographs supplied directly by the project:

| Slot | Was | Now |
| --- | --- | --- |
| `melanoma-example` | ISIC_0024292 | `melanoma-example.jpg` |
| `melanoma-superficial-spreading` | ISIC_0009992 (dermoscopic) | `melanoma-superficial-spreading.jpg` |
| `melanoma-nodular` | ISIC_0000076 (dermoscopic) | `melanoma-nodular.jpg` |
| `melanoma-lentigo-maligna` | ISIC_0009924 (dermoscopic) | `melanoma-lentigo-maligna.jpg` |
| `melanoma-acral` | ISIC_0000290 (dermoscopic) | `melanoma-acral.jpg` |
| `scc-keratoacanthoma` | Stansbury et al. 2025, Fig 1 | `scc-keratoacanthoma.jpg` |
| `bcc-pigmented` | Ruml et al. 2024, Fig 1 | `bcc-pigmented.jpg` |
| `bcc-nodular` | ISIC_0024262 | `bcc-nodular.jpg` |
| `bcc-morpheaform` | Nakayama et al. 2011 | `bcc-morpheaform.jpg` |

Two consequences worth recording:

**The four melanoma subtypes are no longer dermoscopic.** ISIC only labels
melanoma subtype on dermoscopic images, so those four slots previously showed a
magnified instrument view — accurate, but not what a reader sees in a mirror.
The replacements are clinical, so `modality: 'dermoscopic'` was dropped from all
four and the frame no longer carries the dermoscopy caveat. Alt text was
rewritten to describe the lesion rather than the instrument.

**`fit: 'contain'` was dropped** from `bcc-pigmented`, `bcc-morpheaform`, and
`scc-keratoacanthoma`. Letterboxing existed to protect the edges of published
journal figures; these are square close-ups already centred on the lesion, so
they take the default `cover` like the ISIC photographs do.

The nine superseded files are still in `assets/images/learn/clinical/` but are no
longer referenced by any slot, so Metro does not bundle them. Delete them once
the replacements have been reviewed on device.

### Provenance: DDI and SCIN

The nine come from two datasets — [DDI](https://ddi-dataset.github.io/) (Stanford
Medicine) and [SCIN](https://github.com/google-research-datasets/scin) (Google
Health with Stanford Medicine) — and which image came from which was not recorded.
All nine therefore share one `DATASET_CREDIT` naming both, rather than either being
guessed at per image. That credit carries no `url`, since no single page would be
honest to link to; `ImageCredit.url` was made optional and such rows render as plain
text instead of a link.

### Blocking before release: the DDI licence

This is the one thing on this page that is not just bookkeeping.

- **SCIN** is released under the SCIN Data Use License, which permits reproducing
  and sharing the material with attribution, and forbids any attempt to re-identify
  contributors. Fine for this use.
- **DDI** is released under a Stanford University School of Medicine Research Use
  Agreement, which grants use "for personal, non-commercial research purposes only"
  and states: "YOU MAY NOT DISTRIBUTE, PUBLISH, OR REPRODUCE A COPY of any portion
  or all of the Diverse Dermatology Images Dataset to others without specific prior
  written permission." It also prohibits commercial use outright.

Bundling an image into a shipped app is distribution. Because the nine are not
separated by dataset, the DDI restriction has to be assumed to cover all of them.
This is a reversal of the sourcing rule the rest of this document was written
under, which deliberately took only CC0 and CC BY images so the project would not
be locked out of going commercial.

Three ways out, in order of effort:

1. Trace each of the nine back to its dataset. Any that turn out to be SCIN are
   clear immediately, and only the DDI ones need handling.
2. Request written permission from Stanford (roxanad@stanford.edu is the contact on
   the DDI page) for the DDI images used.
3. Replace the DDI ones. SCIN alone, or ISIC, can cover most of these slots — the
   melanoma subtypes are the hard case, which is what pushed them to dermoscopic
   ISIC images in the first place.

Until one of those happens, this is fine for a thesis demo and not fine for a
public release or anything commercial.
