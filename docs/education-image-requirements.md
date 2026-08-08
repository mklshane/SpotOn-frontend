# Education module: clinical image sourcing brief

The Education module is built to show real clinical photography, but **no clinical
photograph currently ships with it**. Every clinical slot renders a dashed, labelled
"Clinical photo needed" gap.

This was a deliberate stop, not an oversight. Clinical images need a source whose
licence actually permits redistribution inside a commercial mobile app, and none
has been cleared for this project. Shipping a plausible-looking photo pulled from
a search result would have been the wrong kind of easy, in a module whose entire
job is to be trustworthy about skin disease.

## How a slot gets filled

Nothing in the UI has to change. For each id in `src/data/learn-images.ts`:

1. Obtain the image from a source that permits this use, in writing.
2. Save the file under `assets/images/learn/clinical/`.
3. Set `asset` to its `require()` and fill in `credit` (`org`, `url`, `licence`).

The gap becomes the photograph, the frame is labelled `PHOTO`, and the attribution
appears in that article's Image Credits section automatically.

## The visual rule

**Real photo = show what something actually looks like.**
**Illustration = explain a concept, process, location, or action.**

Illustrations are never a substitute for clinical appearance. Slots whose whole job
is recognition carry `photoRequired: true` in `src/data/learn-images.ts`, and
`ClinicalImage` refuses to draw an illustration in them even if a caller passes one.
An empty one shows a labelled gap instead.

That covers every ABCDE sign and each cancer type's "What it may look like" example.
A drawing of a mole is an artist's idea of a mole; standing it in for a photograph
would teach people to match their skin against something no skin has ever looked
like, which is worse than showing nothing and saying so.

The module's earlier ABCDE illustration set (`AbcdeArtwork.tsx`, hand-drawn SVG
lesion swatches) was **deleted** when this rule landed, rather than left in the tree
where a future edit might reinstate it as a fallback.

### Where each medium is used now

| Topic | Photograph | Illustration |
| --- | --- | --- |
| ABCDE rule | All five signs. No illustration path exists | Only the 6 mm measurement bar, drawn over the photo |
| Skin cancer types | "What it may look like" | Body-location tiles; card and hero identity artwork |
| Self-check | Hero: someone checking their own skin | Body tiles for areas to examine; numbered steps |
| Sun protection | Hero: lifestyle sunscreen photo | Icons per recommendation |
| Risk factors | Hero: lifestyle photo | Icons per factor |
| When to see a doctor | Hero: consultation photo | Numbered visit walkthrough |

### D, the measurement

D is a single real photograph with a 6 mm bar drawn **over** it, not a separate
diagram, so the scale is read against a real lesion. Source the photo with a ruler
in frame where possible; the overlay is a reading aid, not the measurement itself.

## What each slot needs

| Slot id | Needs |
| --- | --- |
| `abcde-asymmetry-regular` | A benign mole, close to round and symmetrical, photographed straight on |
| `abcde-asymmetry-irregular` | A lesion where one half clearly does not mirror the other |
| `abcde-border-even` | A benign mole with a smooth, clearly defined edge |
| `abcde-border-irregular` | A lesion with a ragged, notched, or blurred edge |
| `abcde-color-uniform` | A benign mole of a single even brown |
| `abcde-color-varied` | A lesion showing several shades within one spot |
| `abcde-diameter` | A lesion beside a millimetre scale, so 6mm is readable |
| `abcde-evolving-earlier` | First of a dated pair of the same lesion, same framing |
| `abcde-evolving-later` | The same lesion later, visibly changed |
| `bcc-example` | Basal cell carcinoma: a pearly or translucent raised bump |
| `scc-example` | Squamous cell carcinoma: a rough scaly patch or firm dome-shaped growth |
| `melanoma-example` | Melanoma showing several ABCDE features at once |

### Skin tone coverage

Each of the three cancer-type slots currently holds **one** example, which is not
enough. Presentation differs by skin tone in ways that matter clinically:

- Basal cell carcinoma reads as pink or red on lighter skin and more often brown,
  black, bluish, or grey on darker skin.
- Melanoma more often appears on palms, soles, and under the nails in people with
  darker skin.

A module that only ever shows one skin tone teaches Filipino users to look for the
wrong thing. Before this ships, each type slot should become a small set covering a
range of tones, and `VisualBlock` should render them as a short carousel.

### Pairing constraint for `abcde-evolving-*`

The two evolving slots must be the **same lesion on the same person**, dated, and
framed the same way. Two different lesions presented as a before and after would be
a fabricated example, which is worse here than having no photograph.

If a dated pair cannot be sourced, E drops to `layout: 'single'` with one real
photograph, and its `detail` text carries the teaching about what changes to watch
for. It does not fall back to a drawing, and it never pairs two unrelated lesions.
The decision point is commented on the E item in `learn-content.ts`.

## Candidate sources

### ISIC Archive (best first stop)

Checked against their [Terms & Conditions](https://www.isic-archive.com/terms-conditions)
on 2026-08-08. Licensing is **per image, not per archive**. Contributors pick one of:

| Licence | Commercial use | Attribution |
| --- | --- | --- |
| CC0 | Yes | Not required |
| CC-BY | Yes | Required |
| CC-BY-NC | **No** | Required |

So ISIC is usable, but you must filter to the licences that fit and check the
licence on each image's own metadata page before downloading. For a CC-BY-NC image
you would have to contact the uploader for a separate agreement.

**Decide this before sourcing anything:** is SpotOn commercial? If it stays an
academic, free project, CC-BY-NC is fair game and the pool is far larger, including
HAM10000 (~10,000 images, CC BY-NC 4.0). If it ever ships as a paid or monetised
app, CC-BY-NC is out and only CC0 and CC-BY qualify. Getting this wrong means
re-clearing every image later.

**Dermatoscopic vs clinical.** Much of ISIC, HAM10000 included, is dermatoscopic:
shot through a dermatoscope, magnified and flattened against the skin. That is what
the ML models train on, but it is not what a user sees in a mirror. The ABCDE page
needs **clinical** photographs, taken with a normal camera at normal distance.
Filter for those explicitly; they are a smaller subset.

### Others

- **Open-access journals** (PLOS, BMC, some JAAD Case Reports) — usually CC BY,
  which permits reuse with attribution. Slow, image by image, but reliable, and the
  best bet for the `abcde-evolving-*` pair: ISIC is overwhelmingly single images,
  whereas longitudinal case reports actually follow one lesion over time.
- **National Cancer Institute Visuals Online** — many US government works are public
  domain, but not all; check each item.
- **DermNet NZ** — large and well catalogued, but licensing is restrictive for
  commercial use and needs a written agreement.

Do not remove watermarks or attribution from any of these.

## Related content note

Verification for this work also turned up a factual problem, recorded in
`PENDING_SOURCES` in `src/data/learn-sources.ts`:

- The Prevention article previously stated that **PAGASA publishes a daily UV Index
  forecast**. Its public site was checked on 2026-08-08 and no UV Index product was
  found. The claim has been replaced with the World Health Organization's published
  thresholds, which are verifiable. If PAGASA does publish one, restore the local
  detail with a real source.
- The Self-Check article states that **monthly** is the right interval for most
  people. The AAD self-exam page advises checking regularly but does not give a
  frequency, so that number renders with a visible "Needs a verified source" entry
  until someone confirms it against a dermatology body.
