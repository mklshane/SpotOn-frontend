import type { IconName } from "@/components/ui/icon";
import type { ClinicalImageId } from "@/data/learn-images";
import type { PendingSourceId, SourceId } from "@/data/learn-sources";
import { localizedCopy } from "../lib/i18n/core";
import { QUESTION_SOURCE } from "../lib/triage/questions";
import { TIER_SOURCE } from "../lib/triage/recommendations";
import { TIER_ORDER, type TriageTier } from "../lib/triage/tps-core";
import type { QuestionId } from "../lib/triage/types";

/** Which of the five ABCDE signs a comparison diagram illustrates. */
export type AbcdeSign =
  | "asymmetry"
  | "border"
  | "color"
  | "diameter"
  | "evolving";

/**
 * Article bodies are a list of blocks rather than a single prose shape, so each
 * topic can be presented the way its information actually reads: a visual
 * checklist as side-by-side diagrams, a clinic visit as numbered steps, risk
 * factors and sun-safety advice as scannable icon rows, and everything else as
 * plain headed prose. Every block still renders from the same type ramp,
 * spacing scale and card treatment, so the articles stay recognisably one set.
 */
export type ArticleBlock =
  | { kind: "prose"; heading?: string; paragraphs: string[] }
  | { kind: "compare"; heading?: string; intro?: string; items: CompareItem[] }
  | { kind: "steps"; heading?: string; intro?: string; steps: Step[] }
  | {
      kind: "list";
      heading?: string;
      intro?: string;
      variant: "grouped" | "tips";
      items: ListItem[];
    }
  | {
      kind: "visual";
      heading?: string;
      intro?: string;
      /**
       * Required, and `photoRequired` in the image registry. This block exists
       * to show what a lesion actually looks like, so it takes a photograph or
       * a labelled gap. There is deliberately no illustration path.
       */
      photo: ClinicalImageId;
      traits: Trait[];
    }
  | { kind: "bodyAreas"; heading?: string; intro?: string; areas: BodyArea[] }
  | { kind: "notice"; tone: "info" | "caution"; title?: string; text: string }
  | { kind: "subtypes"; heading?: string; intro?: string; items: Subtype[] }
  | {
      kind: "gallery";
      heading?: string;
      intro?: string;
      items: GalleryItem[];
      /** Quiet line under the grid, e.g. what the photos do and do not show. */
      footnote?: string;
    }
  | { kind: "sources"; sources: SourceId[]; pending?: PendingSourceId[] };

/**
 * One sign of the ABCDE rule. Most are a typical-versus-concerning pair;
 * diameter is a question of scale rather than contrast, so it stands alone with
 * a measured drawing.
 */
export type CompareItem = {
  /** The letter this sign stands for, e.g. "A". */
  letter: string;
  sign: AbcdeSign;
  title: string;
  detail: string;
  /** Labels under each frame. Non-clinical wording on purpose. */
  captions: { typical: string; concern: string };
  /**
   * Documented sizes under each frame, quoted from the source archive's own
   * measurement. Never derived from the rendered image: a photograph carries no
   * reliable millimetres per pixel, so anything measured off it would be a
   * guess wearing a number's clothes.
   */
  measurements?: { typical: string; concern: string };
  /**
   * Photo slots. These are `photoRequired`, so an empty slot renders a labelled
   * gap rather than a drawing: recognising a lesion is the whole point of these
   * frames and an illustration cannot carry it.
   */
  photos: { typical: ClinicalImageId; concern: ClinicalImageId };
  /** Quiet line under the pair, e.g. where the measurements came from. */
  footnote?: string;
};

/**
 * A recognised variant of a skin cancer type. Names come from the reference
 * cited on the article, never from memory, and each carries its own photo slot
 * so a card can never show a generic example of the parent type.
 */
export type Subtype = {
  id: string;
  name: string;
  /** One line, shown on the collapsed card. */
  summary: string;
  photo: ClinicalImageId;
  /**
   * Set when the photograph is a broader example than the subtype named on the
   * card, so the image is never read as a confirmed instance of it.
   * `photoCaption` sits under the thumbnail; `photoNote` explains it in full
   * once the card is open.
   */
  photoCaption?: string;
  photoNote?: string;
  /** What it may look like. */
  appearance: string;
  /** Where it commonly appears, only when the reference states it. */
  location?: string;
  /** Two or three concise points. */
  points: string[];
};

/**
 * One photograph in a `gallery` block. Galleries exist to show range, the same
 * condition on different skin or in different places, so every item is a real
 * photo slot and its caption says what is actually in the frame.
 */
export type GalleryItem = { photo: ClinicalImageId; caption: string };

export type Step = { title: string; detail: string };

export type ListItem = { icon: IconName; title: string; detail: string };

/** One labelled feature of the illustration in a `visual` block. */
export type Trait = { title: string; detail: string };

/**
 * A place on the body a lesion commonly appears. `region` is a body-mark region
 * name from the scan flow, reused here so the Education illustrations come from
 * the same drawing set as the rest of the app.
 */
export type BodyArea = { region: string; label: string };

export type Article = {
  id: string;
  title: string;
  icon: IconName;
  /** One line used by list cards and search results. */
  summary: string;
  blocks: ArticleBlock[];
  /** Topic ids offered under "Keep reading", so an article never dead-ends. */
  related?: string[];
};

/**
 * Broad buckets the Learn hub's filter chips are built from. Deliberately
 * coarser than the topic list: a chip per topic would just duplicate the list
 * below it instead of narrowing it.
 */
export const LEARN_CATEGORIES = localizedCopy([
  { id: "basics", label: "Basics" },
  { id: "warning-signs", label: "Warning Signs" },
  { id: "self-check", label: "Self-Check" },
  { id: "risk", label: "Risk Factors" },
  { id: "sun-safety", label: "Sun Safety" },
  { id: "care", label: "Getting Care" },
] as const);

export type LearnCategoryId = (typeof LEARN_CATEGORIES)[number]["id"];

type TopicBase = {
  id: string;
  title: string;
  subtitle: string;
  icon: IconName;
  category: LearnCategoryId;
};

export type Topic =
  | (TopicBase & { kind: "article"; article: Article })
  | (TopicBase & { kind: "subtopics"; subtopics: Article[] });

export type LearnRecommendation = {
  title: string;
  summary: string;
  topicId: string;
};

/**
 * Short, actionable tips that rotate by local calendar date. Each tip links
 * into the article it is drawn from, so it stays useful offline and every
 * claim already sits beside its source. Sun-safety and skin-check tips
 * alternate, so a week of tips covers more than one topic.
 */
export const LEARN_RECOMMENDATIONS = localizedCopy([
  {
    title: "Protect easy-to-miss areas",
    summary:
      "Apply sunscreen to your ears, neck, hands, and feet before going outdoors.",
    topicId: "prevention",
  },
  {
    title: "Check your skin in the same order",
    summary:
      "Go from scalp to soles the same way every time, so a new or changing spot is easier to notice.",
    topicId: "self-check",
  },
  {
    title: "Reapply sunscreen outdoors",
    summary:
      "Reapply broad-spectrum SPF 30+ every two hours, or sooner after sweating or swimming.",
    topicId: "prevention",
  },
  {
    title: "Look for the one that stands out",
    summary:
      "A spot that looks unlike your other moles is worth a closer look, even if it seems small.",
    topicId: "warning-signs",
  },
  {
    title: "Cloudy days still need protection",
    summary:
      "UV rays can still reach your skin on cloudy or cool days, so keep protecting exposed skin.",
    topicId: "prevention",
  },
  {
    title: "Change matters most",
    summary:
      "A spot that grows, darkens, or changes shape over weeks to months is worth showing a dermatologist.",
    topicId: "warning-signs",
  },
  {
    title: "Plan around peak UV hours",
    summary:
      "When possible, seek shade between 10 AM and 4 PM, when UV rays are strongest.",
    topicId: "prevention",
  },
  {
    title: "Do not skip palms, soles, and nails",
    summary:
      "Skin cancer can appear where the sun rarely reaches, so include your hands, feet, and nails in every check.",
    topicId: "self-check",
  },
  {
    title: "Make daily commutes sun-safe",
    summary:
      "Use sunscreen, a hat, or protective clothing for walks and rides, not only beach days.",
    topicId: "prevention",
  },
  {
    title: "Keep a dated photo",
    summary:
      "Scan a spot you want to watch, so you can compare pictures months apart instead of relying on memory.",
    topicId: "self-check",
  },
  {
    title: "Choose broad-spectrum protection",
    summary:
      "Look for water-resistant, broad-spectrum sunscreen with SPF 30+ and follow its label directions.",
    topicId: "prevention",
  },
  {
    title: "A sore that keeps reopening",
    summary:
      "A sore that heals, then reopens in the same place over several weeks, is worth having checked.",
    topicId: "when-to-see-a-doctor",
  },
  {
    title: "Pair sunscreen with shade and clothing",
    summary:
      "Sunscreen works best alongside shade, protective clothing, a hat, and sunglasses.",
    topicId: "prevention",
  },
  {
    title: "Ask someone to check your back",
    summary:
      "Your back and scalp are hard to see alone. A trusted person or a phone camera covers the blind spots.",
    topicId: "self-check",
  },
] as const satisfies readonly LearnRecommendation[]);

export function getDailyLearnRecommendation(
  date = new Date(),
): LearnRecommendation {
  const yearStart = Date.UTC(date.getFullYear(), 0, 0);
  const localDay = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayOfYear = Math.floor((localDay - yearStart) / 86_400_000);
  const index = (dayOfYear - 1) % LEARN_RECOMMENDATIONS.length;

  return LEARN_RECOMMENDATIONS[index] ?? LEARN_RECOMMENDATIONS[0];
}

/** One icon per result level, for the result explainer's list of levels. */
const TIER_ICON: Record<TriageTier, IconName> = {
  low: "checkmark.seal.fill",
  moderate: "clock.fill",
  high: "exclamationmark.circle.fill",
  critical: "exclamationmark.triangle.fill",
};

/**
 * The longer explanation under each questionnaire item in the Learn article.
 * Keyed by question id rather than position so reordering the scan's
 * questions cannot attach a detail to the wrong question.
 */
const QUESTION_DETAILS: Record<QuestionId, string> = {
  evolution:
    "Look at whether the spot has become larger or smaller, changed from its original shape, or developed a different color. Changes may include becoming darker, lighter, redder, or developing more than one color.",
  bleeding_nonhealing:
    "Think about whether the spot repeatedly bleeds, forms a crust or scab, or remains open, irritated, or wounded without properly healing for more than three weeks.",
  irregular_border:
    "Look closely at the outer edge of the spot. Check whether the border is smooth and clearly defined, or whether it appears uneven, jagged, irregular, or difficult to distinguish from the surrounding skin.",
  spontaneous_bleeding:
    "Consider whether you have noticed the spot bleeding without an obvious cause. This means the area was not recently scratched, rubbed, cut, or injured before the bleeding occurred.",
  rough_scaly:
    "If it is safe to touch, notice the texture of the spot. Check whether it feels unusually rough, dry, scaly, or hard, or whether a crust repeatedly forms on the surface after coming off.",
  larger_7mm:
    "Use a pencil eraser or a small pea as a general size reference. If the spot appears wider than approximately 7 millimeters, answer Yes. The measurement does not need to be exact. The ABCDE rule mentions about 6 mm instead; this question follows the Glasgow 7-Point Checklist, which uses 7 mm.",
  ugly_duckling:
    "Compare this spot with your other moles or skin spots. Look for noticeable differences in size, shape, color, or overall appearance. Consider whether this particular spot stands out from the others.",
  persistent_2mo:
    "Think about when you first noticed the spot. Check whether it has remained present for more than two months without becoming smaller, fading, or disappearing.",
};

export const LEARN_TOPICS: Topic[] = localizedCopy([
  {
    id: "what-is-skin-cancer",
    title: "What is Skin Cancer",
    subtitle:
      "A quick introduction to what skin cancer is and why early detection matters.",
    icon: "cross.case.fill",
    category: "basics",
    kind: "article",
    article: {
      id: "what-is-skin-cancer",
      related: ["types-of-skin-cancer", "warning-signs", "risk-factors"],
      title: "What is Skin Cancer",
      icon: "cross.case.fill",
      summary:
        "What skin cancer is, and why finding it early makes such a difference.",
      // Straightforward background reading, so it stays plain headed prose.
      blocks: [
        {
          kind: "prose",
          paragraphs: [
            "Skin cancer happens when skin cells grow abnormally, usually because of damage from ultraviolet (UV) light. Most of that damage comes from the sun, though tanning beds cause it too. It is the most common type of cancer worldwide, and also one of the most treatable when caught early.",
          ],
        },
        {
          kind: "prose",
          heading: "Why early detection matters",
          paragraphs: [
            "Most skin cancers develop slowly and visibly, on skin you can see and check yourself. Spotting a change early, before it grows or spreads, usually means simpler treatment and better outcomes.",
          ],
        },
        {
          kind: "prose",
          heading: "SpotOn's role",
          paragraphs: [
            "SpotOn helps you track spots on your skin over time and get an early, informal read on whether a spot looks worth showing a doctor. It is a screening aid, not a diagnosis. Always follow up with a dermatologist for anything that concerns you.",
          ],
        },
        { kind: "sources", sources: ["nciSkin", "aadOverview"] },
      ],
    },
  },
  {
    id: "types-of-skin-cancer",
    title: "Types of Skin Cancer",
    subtitle: "The three most common types, and how they differ.",
    icon: "square.grid.2x2.fill",
    category: "basics",
    kind: "subtopics",
    subtopics: [
      {
        id: "bcc",
        related: ["warning-signs", "self-check", "when-to-see-a-doctor"],
        title: "Basal Cell Carcinoma",
        icon: "cross.case.fill",
        summary:
          "The most common and least dangerous type, usually a slow-growing pearly bump.",
        blocks: [
          {
            kind: "prose",
            paragraphs: [
              "Basal cell carcinoma is the most common skin cancer and the least dangerous. It grows slowly on skin that has had years of sun, and it is highly curable when treated early.",
            ],
          },
          {
            kind: "visual",
            heading: "What it may look like",
            photo: "bcc-example",
            traits: [
              {
                title: "Pearly, waxy surface",
                detail:
                  "The bump can look slightly translucent, as if lit from within.",
              },
              {
                title: "Raised, rolled border",
                detail: "The edge is smooth and defined rather than ragged.",
              },
              {
                title: "Fine surface vessels",
                detail:
                  "Thread-like blood vessels are often visible across the bump.",
              },
            ],
          },
          {
            kind: "subtypes",
            heading: "Types of basal cell carcinoma",
            intro:
              "More than twenty variants are described. These are the ones seen most often.",
            items: [
              {
                id: "nodular",
                name: "Nodular",
                summary: "The most common form, and the classic pearly bump.",
                photo: "bcc-nodular",
                appearance:
                  "A raised, round growth with a translucent or pearly surface, often with fine visible vessels across it.",
                location:
                  "Most often the head and neck, particularly the nose and forehead.",
                points: [
                  "The most common variant.",
                  "Considered lower risk than the infiltrative forms.",
                ],
              },
              {
                id: "superficial",
                name: "Superficial",
                summary:
                  "A flat, scaly patch rather than a bump, usually on the trunk.",
                photo: "bcc-superficial",
                appearance:
                  "A reddened, well defined flat patch with a light scale, which can be mistaken for eczema or psoriasis.",
                location: "Usually the trunk.",
                points: [
                  "Often appears in more than one place.",
                  "Grows outward rather than downward.",
                ],
              },
              {
                id: "morpheaform",
                name: "Morpheaform or sclerosing",
                summary: "Looks like a scar, and its edges are hard to see.",
                photo: "bcc-morpheaform",
                appearance:
                  "A pale, waxy, slightly firm patch with poorly defined edges, easily mistaken for a scar.",
                location:
                  "Mainly the nose, inner eye corners, forehead, and cheeks.",
                points: [
                  "Its true extent is hard to judge by eye.",
                  "Returns after treatment more often than the nodular form.",
                ],
              },
              {
                id: "pigmented",
                name: "Pigmented",
                summary: "A nodular growth carrying brown or black colour.",
                photo: "bcc-pigmented",
                appearance:
                  "A pearly bump with brown, black, or blue-grey pigment, so it can be mistaken for a mole.",
                points: [
                  "More often seen in people with darker skin tones.",
                  "Behaves like the nodular form despite the different colour.",
                ],
              },
            ],
          },
          {
            kind: "list",
            variant: "grouped",
            heading: "Common signs",
            items: [
              {
                icon: "drop.fill",
                title: "Bleeds, then scabs over",
                detail:
                  "It may bleed after a light knock, crust over, and reopen in the same place instead of healing.",
              },
              {
                icon: "clock.fill",
                title: "Slow to change",
                detail:
                  "It develops over months or years rather than weeks, so it is easy to dismiss as a stubborn pimple.",
              },
              {
                icon: "checkmark.seal.fill",
                title: "Rarely spreads",
                detail:
                  "It almost always stays local, though it can damage nearby tissue if it is left alone for a long time.",
              },
            ],
          },
          {
            kind: "gallery",
            heading: "On brown skin",
            intro:
              "Basal cell carcinoma on Fitzpatrick type V skin. On darker skin it more often carries brown, black, or grey colour, so it can be mistaken for a mole.",
            items: [
              { photo: "bcc-brown-pigmented", caption: "Pigmented, skin type V" },
              { photo: "bcc-brown-bump", caption: "Shiny bump, skin type V" },
            ],
          },
          {
            kind: "bodyAreas",
            heading: "Where it usually appears",
            intro: "Almost always on skin that gets regular sun.",
            areas: [
              { region: "head / face", label: "Face and nose" },
              { region: "neck", label: "Neck" },
              { region: "shoulder", label: "Shoulders" },
              { region: "forearm", label: "Forearms" },
            ],
          },
          {
            kind: "prose",
            heading: "Typical treatment",
            paragraphs: [
              "Usually removed with a minor outpatient procedure. Highly curable when caught early.",
            ],
          },
          {
            kind: "notice",
            tone: "info",
            title: "Worth remembering",
            text: "A sore on sun-exposed skin that keeps reopening over several weeks is worth showing a dermatologist, even when it does not hurt.",
          },
          { kind: "sources", sources: ["aadBcc", "statPearlsBcc", "nciSkin"] },
        ],
      },
      {
        id: "scc",
        related: ["warning-signs", "self-check", "when-to-see-a-doctor"],
        title: "Squamous Cell Carcinoma",
        icon: "cross.case.fill",
        summary:
          "A scaly patch or sore that keeps reopening, most often on sun-exposed skin.",
        blocks: [
          {
            kind: "prose",
            paragraphs: [
              "Squamous cell carcinoma is the second most common skin cancer. It is still highly treatable when found early, but it is more likely than basal cell carcinoma to grow deeper if it is ignored.",
            ],
          },
          {
            kind: "visual",
            heading: "What it may look like",
            photo: "scc-example",
            traits: [
              {
                title: "Rough, scaly surface",
                detail:
                  "The patch feels crusted or sandpapery rather than smooth.",
              },
              {
                title: "Firm red base",
                detail: "The skin underneath often looks inflamed or reddened.",
              },
              {
                title: "Crusting that returns",
                detail: "Flakes lift off and rebuild in the same spot.",
              },
            ],
          },
          {
            kind: "subtypes",
            heading: "Types of squamous cell carcinoma",
            intro: "Three forms account for most cases seen on the skin.",
            items: [
              {
                id: "bowens",
                name: "Bowen disease, or in situ",
                summary:
                  "The earliest form, still confined to the surface layer of the skin.",
                photo: "scc-bowens",
                appearance:
                  "A well defined red, scaly patch that can look like eczema or psoriasis but does not clear.",
                points: [
                  "Has not grown past the top layer of skin.",
                  "Highly treatable at this stage.",
                ],
              },
              {
                id: "keratoacanthoma",
                name: "Keratoacanthoma",
                summary: "Grows quickly, and can shrink on its own.",
                photo: "scc-keratoacanthoma",
                appearance:
                  "A dome-shaped lump with a central plug of keratin, giving it a crater-like middle.",
                points: [
                  "Appears and grows over weeks rather than months.",
                  "Still assessed and treated as a squamous cell carcinoma even though it may regress.",
                ],
              },
              {
                id: "invasive",
                name: "Invasive",
                summary: "Has grown past the surface layer into deeper skin.",
                photo: "scc-invasive",
                photoCaption: "General SCC example",
                photoNote:
                  "Clinical example of squamous cell carcinoma. The image source does not specify whether this lesion is invasive, and invasion is confirmed under a microscope rather than by eye.",
                appearance:
                  "A firm, often tender lump, or a scaly sore that bleeds, crusts, and does not heal.",
                points: [
                  "The form most likely to spread if it is left untreated.",
                  "Still very treatable when found early.",
                ],
              },
            ],
          },
          {
            kind: "list",
            variant: "grouped",
            heading: "Common signs",
            items: [
              {
                icon: "bandage.fill",
                title: "A sore that will not close",
                detail:
                  "It heals partway, then reopens in the same place over weeks or months.",
              },
              {
                icon: "allergens",
                title: "Rough to the touch",
                detail:
                  "The patch can feel scaly or tender, and it may catch on clothing.",
              },
              {
                icon: "exclamationmark.triangle.fill",
                title: "Can grow deeper",
                detail:
                  "Left untreated it is more likely than basal cell carcinoma to spread beyond the skin.",
              },
            ],
          },
          {
            kind: "gallery",
            heading: "On brown skin",
            intro:
              "Squamous cell carcinoma on Fitzpatrick type IV and V skin.",
            items: [
              { photo: "scc-brown-crusted", caption: "Crusted, skin type IV" },
              { photo: "scc-brown-plaque", caption: "Scaly patch, skin type V" },
            ],
          },
          {
            kind: "bodyAreas",
            heading: "Where it usually appears",
            intro: "On the areas that take the most daily sun.",
            areas: [
              { region: "head / face", label: "Face and ears" },
              { region: "neck", label: "Neck" },
              { region: "hand", label: "Backs of hands" },
              { region: "forearm", label: "Forearms" },
              { region: "lower leg", label: "Lower legs" },
            ],
          },
          {
            kind: "prose",
            heading: "Typical treatment",
            paragraphs: [
              "Usually surgical removal. Larger or higher-risk cases may need additional treatment.",
            ],
          },
          {
            kind: "notice",
            tone: "info",
            title: "Worth remembering",
            text: "A rough patch that keeps coming back after it seems to heal is a common early sign, and it is much simpler to treat at that stage.",
          },
          { kind: "sources", sources: ["aadScc", "statPearlsScc", "nciSkin"] },
        ],
      },
      {
        id: "melanoma",
        related: ["warning-signs", "self-check", "when-to-see-a-doctor"],
        title: "Melanoma",
        icon: "cross.case.fill",
        summary:
          "The least common but most serious type, usually a new or changing mole.",
        blocks: [
          {
            kind: "prose",
            paragraphs: [
              "Melanoma is the least common of the three types but the most serious, because it can spread to other parts of the body. Found early it is very treatable, which is why a changing mole is worth acting on rather than watching.",
            ],
          },
          {
            kind: "visual",
            heading: "What it may look like",
            photo: "melanoma-example",
            traits: [
              {
                title: "Asymmetric shape",
                detail: "One half does not mirror the other half.",
              },
              {
                title: "Irregular, notched border",
                detail: "The edge wanders instead of forming a clean circle.",
              },
              {
                title: "Uneven color",
                detail:
                  "Several shades of brown or black appear within one spot.",
              },
            ],
          },
          {
            kind: "subtypes",
            heading: "Types of melanoma",
            intro:
              "Four main types are recognised, by how they grow and where they appear. Tap one to see what it may look like.",
            items: [
              {
                id: "superficial-spreading",
                name: "Superficial spreading melanoma",
                // Kept to two lines in the narrow card column. This is the only
                // subtype whose name wraps, so a third line of summary made its
                // card taller than every sibling in the set.
                summary:
                  "The most common type. Spreads outward before it grows deeper.",
                photo: "melanoma-superficial-spreading",
                appearance:
                  "A flat or slightly raised patch with an uneven edge and more than one shade of brown, black, or pink.",
                location:
                  "Often the trunk in men and the legs in women, though it can appear anywhere.",
                points: [
                  "Usually grows sideways for a period before it grows deeper.",
                  "The ABCDE signs describe this type well.",
                ],
              },
              {
                id: "nodular",
                name: "Nodular melanoma",
                summary:
                  "Grows downward early, so it can become serious faster than the others.",
                photo: "melanoma-nodular",
                appearance:
                  "A firm, raised lump, often evenly coloured. It can be black, brown, red, pink, or carry no extra colour at all.",
                points: [
                  "Grows deeper from the start rather than spreading sideways first.",
                  "May not show the usual ABCDE signs, so a new firm lump that keeps growing is worth checking even when it looks even.",
                ],
              },
              {
                id: "lentigo-maligna",
                name: "Lentigo maligna melanoma",
                summary:
                  "Develops slowly on skin with many years of sun exposure.",
                photo: "melanoma-lentigo-maligna",
                appearance:
                  "A large, flat, freckle-like patch of uneven tan and brown that widens slowly over years.",
                location: "Usually the face, head, and neck.",
                points: [
                  "More common in older adults.",
                  "Slow growth makes it easy to mistake for an age spot.",
                ],
              },
              {
                id: "acral-lentiginous",
                name: "Acral lentiginous melanoma",
                summary:
                  "Appears on palms, soles, and under the nails, on skin that rarely sees sun.",
                photo: "melanoma-acral",
                appearance:
                  "A dark patch on a palm or sole, or a dark band running the length of a nail.",
                location: "Palms, soles, and nail beds.",
                points: [
                  "Not linked to sun exposure.",
                  "Worth knowing about because these areas are easy to skip during a self-check.",
                ],
              },
            ],
          },
          {
            kind: "list",
            variant: "grouped",
            heading: "Common signs",
            items: [
              {
                icon: "arrow.triangle.2.circlepath",
                title: "It changes over time",
                detail:
                  "It grows, darkens, or shifts shape over weeks to months. Change matters more than any single feature.",
              },
              {
                icon: "square.grid.2x2.fill",
                title: "It stands out from your other moles",
                detail:
                  "Often called the ugly duckling sign, because it simply does not match the rest of your skin.",
              },
              {
                icon: "exclamationmark.triangle.fill",
                title: "It can appear on new skin",
                detail:
                  "Most melanomas are new spots rather than changes to a mole you have had for years.",
              },
            ],
          },
          {
            kind: "gallery",
            heading: "On brown skin, and where the sun rarely reaches",
            intro:
              "Melanoma on Fitzpatrick type IV skin, and on the sole of the foot, where acral melanoma appears without being linked to sun exposure.",
            items: [
              { photo: "melanoma-brown-flat", caption: "Flat and uneven, skin type IV" },
              { photo: "melanoma-brown-dark", caption: "Dark and ragged, skin type IV" },
              { photo: "acral-sole-small", caption: "On the sole of the foot" },
              { photo: "acral-sole-large", caption: "Acral lentiginous, across the sole" },
            ],
          },
          {
            kind: "bodyAreas",
            heading: "Where it usually appears",
            intro:
              "Melanoma can appear anywhere, including skin that rarely sees sun.",
            areas: [
              { region: "upper back", label: "Back" },
              { region: "lower leg", label: "Legs" },
              { region: "forearm", label: "Arms" },
              { region: "foot", label: "Soles of feet" },
              { region: "head / face", label: "Face and scalp" },
            ],
          },
          {
            kind: "prose",
            heading: "Typical treatment",
            paragraphs: [
              "Surgical removal is standard. More advanced cases may need additional treatment from an oncology team.",
            ],
          },
          {
            kind: "notice",
            tone: "caution",
            title: "Do not wait this one out",
            text: "If a mole matches an ABCDE sign or has clearly changed, book a dermatologist rather than watching it for another few months. Early melanoma is usually treated with a simple removal.",
          },
          {
            kind: "sources",
            sources: [
              "aadMelanoma",
              "nciMelanomaSubtypes",
              "aadAbcde",
              "nciSkin",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "harmless-spots",
    title: "Spots That Are Usually Harmless",
    subtitle: "Common non-cancerous growths, and how to tell them apart.",
    icon: "checkmark.seal.fill",
    category: "basics",
    kind: "article",
    article: {
      id: "harmless-spots",
      related: ["understanding-your-result", "warning-signs", "self-check"],
      title: "Spots That Are Usually Harmless",
      icon: "checkmark.seal.fill",
      summary:
        "What common harmless spots look like, and when one is still worth checking.",
      // The look-alikes a Benign result usually means. Photographed ones are
      // cards; the two without a licensable photograph stay as text rather
      // than borrowing an image of something else.
      blocks: [
        {
          kind: "prose",
          paragraphs: [
            "Most spots on the skin are not cancer. Knowing what common harmless growths look like can make a result easier to understand, but only a dermatologist can say for certain what a spot is.",
          ],
        },
        {
          kind: "subtypes",
          heading: "Common harmless spots",
          intro: "Tap one to see what it may look like.",
          items: [
            {
              id: "common-mole",
              name: "Common mole",
              summary: "Most adults have several, and the common type is harmless.",
              photo: "benign-mole",
              appearance:
                "A small brown spot, usually one even colour with a smooth, regular edge.",
              points: [
                "Almost every adult has some moles.",
                "Having 50 or more moles raises the risk of melanoma, so it is worth checking them regularly.",
                "A new mole, or one that changes, is worth showing a dermatologist.",
              ],
            },
            {
              id: "seborrheic-keratosis",
              name: "Seborrheic keratosis",
              summary: "A waxy, stuck-on growth that becomes common with age.",
              photo: "benign-seborrheic-keratosis",
              appearance:
                "Can look like a dab of brown candle wax, or be warty and thick. Most are tan or brown, but they range from white to black.",
              location:
                "Almost anywhere except the palms and soles, most often the chest, back, head, or neck.",
              points: [
                "Harmless and not contagious.",
                "Most common in middle-aged and older adults, who often have several.",
                "It can look like skin cancer, so have a dermatologist check one you are unsure about.",
              ],
            },
            {
              id: "cherry-angioma",
              name: "Cherry angioma",
              summary: "A small, bright red dot made of tiny blood vessels.",
              photo: "benign-cherry-angioma",
              appearance:
                "Bright cherry red, from pinhead size to about 6 mm across, either smooth or slightly raised.",
              location:
                "Usually the trunk, though they can appear almost anywhere.",
              points: [
                "Most common after age 30.",
                "Usually harmless, though it can bleed if it is injured.",
                "Worth showing a doctor if its appearance changes.",
              ],
            },
          ],
        },
        {
          kind: "list",
          variant: "grouped",
          heading: "Other common harmless spots",
          items: [
            {
              icon: "circle.grid.2x2.fill",
              title: "Dermatofibroma",
              detail:
                "A firm bump, most often on the lower legs, that dimples inward when you pinch the skin around it. It is pink to light brown on lighter skin, and dark brown to black on darker skin.",
            },
            {
              icon: "sun.max.fill",
              title: "Age spots (solar lentigines)",
              detail:
                "Flat tan, brown, or dark spots on skin that gets a lot of sun, such as the backs of the hands, the forearms, and the face. In Asian skin they most often appear on the face. They can resemble early melanoma, so a dermatologist may want to check one that looks different from the rest.",
            },
          ],
        },
        {
          kind: "notice",
          tone: "caution",
          title: "Harmless spots can still change",
          text: "A benign result does not mean a spot will never change. If any spot grows, changes colour or shape, bleeds, or itches, have it checked, whatever it looked like before.",
        },
        {
          kind: "sources",
          sources: [
            "aadMoles",
            "aadAbcde",
            "aadSeborrheicKeratosis",
            "medlineCherryAngioma",
            "dermnetDermatofibroma",
            "dermnetSolarLentigo",
          ],
        },
      ],
    },
  },
  {
    id: "actinic-keratosis",
    title: "Actinic Keratosis (Precancer)",
    subtitle: "A rough, sun-damaged patch that can turn into skin cancer.",
    icon: "exclamationmark.circle.fill",
    category: "warning-signs",
    kind: "article",
    article: {
      id: "actinic-keratosis",
      related: ["types-of-skin-cancer", "prevention", "understanding-your-result"],
      title: "Actinic Keratosis (Precancer)",
      icon: "exclamationmark.circle.fill",
      summary:
        "What a precancerous patch looks and feels like, and why it is worth treating.",
      blocks: [
        {
          kind: "prose",
          paragraphs: [
            "An actinic keratosis, or AK, is a precancerous growth caused by the sun or indoor tanning. It is not cancer, but some AKs turn into squamous cell carcinoma if they are left untreated.",
          ],
        },
        {
          kind: "visual",
          heading: "What it may look like",
          photo: "ak-example",
          traits: [
            {
              title: "Rough, like sandpaper",
              detail: "You can often feel one before you can see it.",
            },
            {
              title: "Many possible colours",
              detail:
                "Usually red, pink, or skin coloured, but it can also be grey, yellow, brown, tan, or white.",
            },
            {
              title: "Easy to dismiss",
              detail:
                "It can look like a new age spot, a pimple, or a patch of irritated skin.",
            },
          ],
        },
        {
          kind: "gallery",
          heading: "Other forms it can take",
          intro:
            "Actinic keratosis on Fitzpatrick type IV and V skin.",
          items: [
            { photo: "ak-thick", caption: "Thick, crusted, skin type IV" },
            { photo: "ak-raised", caption: "Raised and scaly, skin type V" },
          ],
        },
        {
          kind: "bodyAreas",
          heading: "Where it usually appears",
          intro: "On the skin that has had the most sun over the years.",
          areas: [
            { region: "head / face", label: "Face, ears, and lips" },
            { region: "back of head", label: "Balding scalp" },
            { region: "neck", label: "Neck" },
            { region: "hand", label: "Hands" },
          ],
        },
        {
          kind: "list",
          variant: "grouped",
          heading: "Signs to have it checked soon",
          items: [
            {
              icon: "bandage.fill",
              title: "It itches, stings, or bleeds",
              detail:
                "An AK can burn, feel tender, catch on clothing, or bleed.",
            },
            {
              icon: "exclamationmark.triangle.fill",
              title: "It grows into a horn shape",
              detail:
                "A horn-shaped growth can signal a higher risk of squamous cell carcinoma, so a dermatologist should examine it promptly.",
            },
            {
              icon: "drop.fill",
              title: "A lip that stays dry and scaly",
              detail:
                "A dry, scaly lip that never heals, white scaly patches, or a lip that loses its colour can be a precancerous change.",
            },
          ],
        },
        {
          kind: "prose",
          heading: "How it relates to your SpotOn result",
          paragraphs: [
            "SpotOn's Other pattern covers spots like this one, which do not match the three common cancer types but may still need a dermatologist.",
          ],
        },
        {
          kind: "notice",
          tone: "info",
          title: "Worth remembering",
          text: "Because some AKs become squamous cell carcinoma, a rough patch on sun-damaged skin is worth showing a dermatologist rather than waiting to see whether it goes away.",
        },
        {
          kind: "sources",
          sources: ["aadActinicKeratosis", "aadActinicKeratosisSymptoms"],
        },
      ],
    },
  },
  {
    id: "warning-signs",
    title: "Warning Signs (ABCDE Rule)",
    subtitle: "A simple checklist for spotting a mole that needs attention.",
    icon: "exclamationmark.triangle.fill",
    category: "warning-signs",
    kind: "article",
    article: {
      id: "warning-signs",
      related: ["self-check", "types-of-skin-cancer", "when-to-see-a-doctor"],
      title: "Warning Signs (ABCDE Rule)",
      icon: "exclamationmark.triangle.fill",
      summary: "Five things to look for in a mole, shown side by side.",
      // The five signs are visual by nature, so each one is drawn as a
      // typical-versus-concerning pair rather than described in prose.
      blocks: [
        {
          kind: "prose",
          paragraphs: [
            "Melanoma is often noticed first by the person who has it, not by a doctor. The ABCDE rule is the same checklist dermatologists use, and it works just as well at home in front of a mirror.",
          ],
        },
        {
          kind: "compare",
          heading: "The ABCDE rule",
          intro:
            "Compare a spot against each sign below. One sign on its own is not a diagnosis, but it is a good reason to have the spot looked at.",
          items: [
            {
              letter: "A",
              sign: "asymmetry",
              title: "Asymmetry",
              detail: "One half of the mole does not match the other half.",
              captions: { typical: "More regular", concern: "Asymmetrical" },
              photos: {
                typical: "abcde-asymmetry-regular",
                concern: "abcde-asymmetry-irregular",
              },
            },
            {
              letter: "B",
              sign: "border",
              title: "Border",
              detail:
                "Look for edges that are irregular, ragged, blurred, or uneven.",
              captions: {
                typical: "More even border",
                concern: "Irregular border",
              },
              photos: {
                typical: "abcde-border-even",
                concern: "abcde-border-irregular",
              },
            },
            {
              letter: "C",
              sign: "color",
              title: "Color",
              detail:
                "Look for uneven color, or several shades within the same spot, such as tan, brown, black, red, white, or blue.",
              captions: { typical: "More uniform", concern: "Multiple colors" },
              photos: {
                typical: "abcde-color-uniform",
                concern: "abcde-color-varied",
              },
            },
            {
              letter: "D",
              sign: "diameter",
              title: "Diameter",
              detail:
                "Diameter is one feature to consider. Melanomas are often wider than about 6 mm when found, but they can also be smaller.",
              captions: {
                typical: "Smaller example",
                concern: "Larger example",
              },
              measurements: { typical: "5.3 mm", concern: "10.4 mm" },
              photos: {
                typical: "abcde-diameter-small",
                concern: "abcde-diameter-large",
              },
              footnote:
                "Both measurements are recorded by the source archive, not read off these photographs. You cannot judge a real diameter from a picture.",
            },
            {
              // The same lesion on the same patient, seven months apart, from a
              // CC BY case report. These are dermoscopic rather than clinical,
              // which the captions and note below state outright: a magnified
              // instrument view is not what anyone sees in a mirror, and
              // implying otherwise would teach the wrong expectation.
              letter: "E",
              sign: "evolving",
              title: "Evolving",
              detail:
                "Watch for changes in a spot over time, including its size, shape, color, or new symptoms such as itching or bleeding.",
              captions: { typical: "Initial image", concern: "7 months later" },
              measurements: { typical: "3 mm", concern: "5 mm" },
              photos: {
                typical: "abcde-evolving-earlier",
                concern: "abcde-evolving-later",
              },
              footnote:
                "Dermoscopic view. Dermoscopy is a magnified examination of the skin used by healthcare professionals, so this is not how the spot looks to the naked eye. The same lesion is shown here growing from 3 mm to 5 mm over seven months, with both measurements taken from the published case report.",
            },
          ],
        },
        {
          kind: "prose",
          heading: "If a spot matches a sign",
          paragraphs: [
            "Have it checked rather than waiting to see what happens. Scanning it with SpotOn also keeps a dated photo, which makes any later change much easier to see.",
          ],
        },
        {
          kind: "notice",
          tone: "info",
          title: "Important to know",
          text: "The ABCDE rule can help you notice changes in your skin. It cannot confirm whether a spot is cancerous, and plenty of harmless moles fail one of these tests. Use it to decide what to show a dermatologist, not to rule anything in or out yourself.",
        },
        {
          kind: "sources",
          sources: ["aadAbcde", "aadMelanoma", "nciSkin", "satoTanakaEvolving"],
        },
      ],
    },
  },
  {
    id: "self-check",
    title: "How to Check Your Skin",
    subtitle: "A five-step routine you can do at home in about ten minutes.",
    icon: "magnifyingglass",
    category: "self-check",
    kind: "article",
    article: {
      id: "self-check",
      related: ["warning-signs", "questionnaire", "when-to-see-a-doctor"],
      title: "How to Check Your Skin",
      icon: "magnifyingglass",
      summary:
        "A five-step routine for checking your own skin, and the spots people miss.",
      // A procedure, so it is numbered, and the easily missed areas are drawn
      // rather than listed as text.
      blocks: [
        {
          kind: "prose",
          paragraphs: [
            "A skin self-check takes about ten minutes and needs nothing more than good light and a mirror. Doing it in the same order every time is what makes a change easy to notice.",
          ],
        },
        {
          kind: "steps",
          heading: "The five-step routine",
          intro: "Once a month is enough for most people.",
          steps: [
            {
              title: "Find good light and a mirror",
              detail:
                "Stand in bright, even light in front of a full-length mirror. A handheld mirror helps for the areas you cannot see directly.",
            },
            {
              title: "Work from the top down",
              detail:
                "Start at your scalp and face, then your neck, shoulders, chest, and arms, and finish at your legs and feet. A fixed order means you are far less likely to skip a patch.",
            },
            {
              title: "Check the areas that are easy to miss",
              detail:
                "Between your fingers and toes, the soles of your feet, behind your ears, your nape, and your back. Skin cancer can appear where the sun rarely reaches.",
            },
            {
              title: "Compare each spot against the rest",
              detail:
                "You are looking for the one that stands out from your other moles. If something catches your eye, check it against the ABCDE rule.",
            },
            {
              title: "Photograph anything you want to watch",
              detail:
                "Scan the spot with SpotOn so you have a dated photo. Comparing two pictures months apart is far more reliable than trying to remember.",
            },
          ],
        },
        {
          kind: "bodyAreas",
          heading: "The spots people skip",
          intro:
            "Give these a deliberate look, since they are hard to see without help.",
          areas: [
            { region: "back of head", label: "Scalp and nape" },
            { region: "upper back", label: "Back" },
            { region: "hand", label: "Between fingers" },
            { region: "foot", label: "Soles and toes" },
          ],
        },
        {
          kind: "gallery",
          items: [
            {
              photo: "life-back-check",
              caption: "Someone else can see the skin on your back",
            },
          ],
        },
        {
          kind: "notice",
          tone: "info",
          title: "Ask for a second pair of eyes",
          text: "Your back and scalp are the hardest areas to check alone. Asking someone you trust to look, or using a phone camera, covers the blind spots a mirror cannot.",
        },
        {
          kind: "sources",
          sources: ["aadSelfExam", "aadAbcde"],
          pending: ["selfCheckFrequency"],
        },
      ],
    },
  },
  {
    id: "risk-factors",
    title: "Risk Factors",
    subtitle: "What raises your chances of developing skin cancer.",
    icon: "figure.stand",
    category: "risk",
    kind: "article",
    article: {
      id: "risk-factors",
      related: ["prevention", "self-check"],
      title: "Risk Factors",
      icon: "figure.stand",
      summary:
        "The four things that most affect your chances, grouped at a glance.",
      // Four parallel factors, so they read better as a compact grouped list
      // than as four headed paragraphs.
      blocks: [
        {
          kind: "prose",
          paragraphs: [
            "Anyone can develop skin cancer, but some factors make it more likely. Knowing yours can help you decide how often to check your skin and when to see a dermatologist.",
          ],
        },
        {
          kind: "list",
          variant: "grouped",
          heading: "What raises your risk",
          items: [
            {
              icon: "sun.max.fill",
              title: "Sun exposure",
              detail:
                "Frequent sunburns or long-term unprotected sun exposure, especially earlier in life.",
            },
            {
              icon: "figure.stand",
              title: "Skin type",
              detail:
                "Fair skin, light hair, and eyes that burn easily carry a higher risk, though anyone can develop skin cancer.",
            },
            {
              icon: "person.2.fill",
              title: "Family history",
              detail:
                "A close relative with skin cancer, especially melanoma, raises your own risk.",
            },
            {
              icon: "circle.grid.2x2.fill",
              title: "Age and moles",
              detail:
                "Risk increases with age, and having many moles or atypical-looking moles is also a factor.",
            },
          ],
        },
        {
          kind: "gallery",
          heading: "Sun at work",
          intro:
            "Long hours outdoors, such as farm work, fishing, or driving, add up to a lot of sun over the years.",
          items: [
            {
              photo: "life-rice-farmers",
              caption: "Rice farmers in Laguna",
            },
            {
              photo: "life-corn-farmers",
              caption: "A corn harvest in the Philippines",
            },
          ],
        },
        {
          kind: "prose",
          heading: "What to do with this",
          paragraphs: [
            "Having a risk factor does not mean you will develop skin cancer. It is a reason to check your skin a little more regularly, and to protect it from the sun.",
          ],
        },
        {
          kind: "notice",
          tone: "info",
          title: "Darker skin is not exempt",
          text: "Skin cancer is less common in darker skin tones, but it is often found later, when it is harder to treat. Everyone benefits from checking their own skin.",
        },
        { kind: "sources", sources: ["nciPrevention", "aadOverview"] },
      ],
    },
  },
  {
    id: "skin-of-color",
    title: "Skin Cancer on Brown Skin",
    subtitle: "Where to look, and why it is often found late.",
    icon: "person.2.fill",
    category: "risk",
    kind: "article",
    article: {
      id: "skin-of-color",
      related: ["self-check", "warning-signs", "types-of-skin-cancer"],
      title: "Skin Cancer on Brown Skin",
      icon: "person.2.fill",
      summary:
        "How skin cancer can look different on darker skin, and the places to check.",
      blocks: [
        {
          kind: "prose",
          paragraphs: [
            "Skin cancer is less common on darker skin, but when it does develop it is often advanced by the time it is diagnosed. Found early, melanoma is highly treatable, so knowing where and how to look matters.",
          ],
        },
        {
          kind: "prose",
          heading: "It can look different",
          paragraphs: [
            "On darker skin, skin cancer can look different from the examples most people have seen, and it often appears where the sun rarely reaches. Sun-exposed areas such as the face and neck can still be affected.",
          ],
        },
        {
          kind: "bodyAreas",
          heading: "Places to look closely",
          intro: "These areas get little sun, and they are easy to skip.",
          areas: [
            { region: "hand", label: "Palms, fingers, and nails" },
            { region: "foot", label: "Soles, toes, and toenails" },
            { region: "head / face", label: "Lips and inside the mouth" },
          ],
        },
        {
          kind: "list",
          variant: "grouped",
          heading: "Signs to watch for",
          items: [
            {
              icon: "ruler.fill",
              title: "A dark line in a nail",
              detail:
                "A brown or black streak along a nail can look like a bruise. Unlike a bruise, it does not grow out with the nail.",
            },
            {
              icon: "bandage.fill",
              title: "A spot near a nail that will not heal",
              detail:
                "A sore or spot under or around a nail that does not heal is worth having checked.",
            },
            {
              icon: "arrow.triangle.2.circlepath",
              title: "A patch that changes over time",
              detail:
                "A growth or patch that grows or changes, wherever it is on the body.",
            },
            {
              icon: "exclamationmark.triangle.fill",
              title: "Changes in scars or old injuries",
              detail:
                "Skin cancer is more likely to develop in scars and in skin that was injured or treated with radiation, so watch these areas too.",
            },
          ],
        },
        {
          kind: "gallery",
          heading: "What these signs can look like",
          intro:
            "Real photographs from the places this article asks you to check.",
          items: [
            { photo: "nail-streak", caption: "A dark line along a nail" },
            { photo: "nail-melanoma", caption: "Advanced melanoma of the thumbnail" },
            { photo: "acral-sole-small", caption: "Melanoma on the sole" },
            { photo: "acral-sole-large", caption: "Large acral melanoma on the sole" },
          ],
          footnote:
            "The source of the nail-line photo does not say whether it was cancer. Only a dermatologist can tell, so have any new or changing dark line checked.",
        },
        {
          kind: "steps",
          heading: "Checking darker skin",
          intro: "Add these to your usual self-check.",
          steps: [
            {
              title: "Use two mirrors",
              detail:
                "A full-length mirror and a handheld mirror, in a private space with good light.",
            },
            {
              title: "Check your hands and feet closely",
              detail:
                "Look at your palms, your soles, and between your fingers and toes.",
            },
            {
              title: "Look at every nail",
              detail:
                "Fingernails and toenails, for any dark line or spot that does not heal.",
            },
            {
              title: "Check your lips and mouth",
              detail: "Look at your lips and the inside of your mouth.",
            },
            {
              title: "Book a dermatologist if something looks off",
              detail:
                "Mention exactly what you found and where, so it is not missed during the visit.",
            },
          ],
        },
        {
          kind: "notice",
          tone: "caution",
          title: "Feet are easy to miss",
          text: "Many people never check their feet, so skin cancer there is often found only after it has spread. A quick look at your soles and toes during each self-check closes that gap.",
        },
        { kind: "sources", sources: ["aadSkinOfColor", "aadSelfExam"] },
      ],
    },
  },
  {
    id: "prevention",
    title: "UV Protection in the Philippines",
    subtitle: "Sun safety tips for our year-round tropical climate.",
    icon: "sun.max.fill",
    category: "sun-safety",
    kind: "article",
    article: {
      id: "prevention",
      related: ["risk-factors", "self-check"],
      title: "UV Protection in the Philippines",
      icon: "sun.max.fill",
      summary:
        "Practical sun-safety habits for a country with high UV all year.",
      // Advice you act on, so it is presented as scannable recommendation
      // cards instead of a wall of paragraphs.
      blocks: [
        {
          kind: "prose",
          paragraphs: [
            // The previous wording asserted that PAGASA publishes a daily UV
            // Index forecast. Its public site was checked on 2026-08-08 and no
            // such product was found, so the claim was replaced with WHO's
            // published thresholds, which are verifiable. See PENDING_SOURCES.
            "The Philippines sits close to the equator, so UV levels stay high all year rather than only in summer. Sun protection is a daily habit here, not a seasonal one.",
          ],
        },
        {
          kind: "list",
          variant: "tips",
          heading: "Everyday sun protection",
          intro: "Five habits that fit around an ordinary week here.",
          items: [
            {
              icon: "chart.bar.fill",
              title: "Check the UV Index",
              detail:
                "The World Health Organization advises sun protection once the UV Index reaches 3, and at 8 and above it advises staying out of the sun around midday and seeking shade. Most weather apps and forecasts publish the current figure, so you can plan errands and exercise around it.",
            },
            {
              icon: "drop.fill",
              title: "Use sunscreen that survives the humidity",
              detail:
                "Broad-spectrum SPF 30+ daily, reapplied every two hours outdoors, and sooner if you are sweating or swimming. A water-resistant, lightweight formula sits better here than a heavy cream.",
            },
            {
              icon: "umbrella.fill",
              title: "Cover up on ordinary errands",
              detail:
                "Jeepney and tricycle rides, market trips, waiting for a ride, and walks to school or work all add up. Long sleeves, a wide-brimmed hat or cap, and sunglasses help outside of beach days.",
            },
            {
              icon: "clock.fill",
              title: "Plan around peak hours",
              detail:
                "UV rays are strongest between 10am and 4pm, so seek shade during that window when possible. Overcast or rainy-season skies block heat but not most UV.",
            },
            {
              icon: "magnifyingglass",
              title: "Check your skin monthly",
              detail:
                "Look for new or changing spots using the ABCDE rule as a guide, and use SpotOn to track anything you want to keep an eye on.",
            },
          ],
        },
        {
          kind: "gallery",
          heading: "Sun protection, day to day",
          intro:
            "Ordinary habits that add up over a sunny week.",
          items: [
            {
              photo: "life-umbrella-street",
              caption: "A payong on an ordinary errand",
            },
            {
              photo: "life-sun-hat",
              caption: "A wide brim shades the face and neck",
            },
            {
              photo: "life-sunscreen-face",
              caption: "Sunscreen on the face before heading out",
            },
            {
              photo: "life-sunscreen-label",
              caption: "Look for Broad Spectrum on the label",
            },
          ],
          footnote:
            "The example label shows SPF 15. For daily outdoor use, the advice above is broad-spectrum SPF 30 or higher.",
        },
        {
          kind: "sources",
          sources: ["whoUvIndex", "nciPrevention", "aadOverview"],
        },
      ],
    },
  },
  {
    id: "when-to-see-a-doctor",
    title: "When to See a Doctor",
    subtitle: "Signs that mean it is time for a professional opinion.",
    icon: "stethoscope",
    category: "care",
    kind: "article",
    article: {
      id: "when-to-see-a-doctor",
      related: ["warning-signs", "questionnaire"],
      title: "When to See a Doctor",
      icon: "stethoscope",
      summary:
        "What is worth booking for, and what actually happens at the visit.",
      // Two different shapes in one article: a checklist of reasons to book,
      // then the visit itself as an ordered walkthrough.
      blocks: [
        {
          kind: "list",
          variant: "grouped",
          heading: "Signs worth booking for",
          intro: "See a dermatologist if a spot does any of the following.",
          items: [
            {
              icon: "exclamationmark.triangle.fill",
              title: "It matches an ABCDE sign",
              detail:
                "Asymmetry, an irregular border, uneven color, a diameter over about 6mm, or any change over time.",
            },
            {
              icon: "drop.fill",
              title: "It bleeds or will not heal",
              detail:
                "A sore that scabs over, heals, and then reopens in the same place is worth showing someone.",
            },
            {
              icon: "scribble",
              title: "It itches persistently",
              detail:
                "Ongoing itching or tenderness in one spot, rather than an occasional passing itch.",
            },
            {
              icon: "square.grid.2x2.fill",
              title: "It looks unlike your other moles",
              detail:
                "A spot that simply stands out from the rest of your skin is reason enough to have it checked.",
            },
          ],
        },
        {
          kind: "steps",
          heading: "What to expect at a visit",
          intro: "Most visits are quick and non-invasive.",
          steps: [
            {
              title: "Visual examination",
              detail:
                "The dermatologist looks closely at the spot, and often at the rest of your skin, which usually takes only a few minutes.",
            },
            {
              title: "A closer look with a dermatoscope",
              detail:
                "A handheld magnifying lens may be rested against the skin to see detail that is invisible to the naked eye. It does not hurt.",
            },
            {
              title: "A biopsy, only if needed",
              detail:
                "If anything looks concerning, a small sample is taken under local anesthetic and sent to a lab for a definite answer.",
            },
          ],
        },
        {
          kind: "gallery",
          heading: "At the clinic",
          items: [
            {
              photo: "life-derm-screening",
              caption: "A dermatologist looking at a spot up close",
            },
            {
              photo: "life-dermatoscope",
              caption: "A dermatoscope gives a magnified view of the skin",
            },
          ],
        },
        {
          kind: "prose",
          heading: "Finding a clinic",
          paragraphs: [
            "The Directory tab lists nearby dermatology clinics and doctors offering online booking, so you can find and reach a professional directly from SpotOn.",
          ],
        },
        {
          kind: "notice",
          tone: "info",
          title: "Important to know",
          text: "A dermatologist can tell you what a spot is. Nothing you read here, and no photo comparison, can do that on its own.",
        },
        { kind: "sources", sources: ["aadOverview", "aadAbcde", "nciSkin"] },
      ],
    },
  },

  {
    id: "understanding-your-result",
    title: "Understanding Your SpotOn Result",
    subtitle: "What your result means, and what it cannot tell you.",
    icon: "list.bullet.clipboard.fill",
    category: "care",
    kind: "article",
    article: {
      id: "understanding-your-result",
      related: ["harmless-spots", "actinic-keratosis", "when-to-see-a-doctor"],
      title: "Understanding Your SpotOn Result",
      icon: "list.bullet.clipboard.fill",
      summary:
        "How a result is made, what each level means, and its limits.",
      blocks: [
        {
          kind: "prose",
          paragraphs: [
            "SpotOn looks at a photo of your spot and your answers to eight short questions, then suggests how soon to have it checked. It is a screening aid, not a diagnosis: it can point you toward a doctor, but it cannot tell you what a spot is.",
          ],
        },
        {
          kind: "steps",
          heading: "How a result is made",
          steps: [
            {
              title: "Photo check",
              detail:
                "SpotOn first checks that the photo is clear and shows skin. If it cannot see the spot well, it asks for a clearer photo.",
            },
            {
              title: "Pattern match",
              detail:
                "The photo is compared with patterns learned from many images of skin spots, and matched to the closest of five patterns.",
            },
            {
              title: "Your answers",
              detail:
                "Your answers to the eight questions, based on the Glasgow 7-Point Checklist, can raise how soon a check is recommended. On their own they never lead to the most urgent level.",
            },
            {
              title: "One recommendation",
              detail:
                "Both are combined into one of four levels, each with a suggested time to see a doctor.",
            },
          ],
        },
        {
          kind: "list",
          variant: "grouped",
          heading: "The five patterns",
          intro:
            "A match means the spot shares features with a pattern, not that it is that condition.",
          items: [
            {
              icon: "exclamationmark.triangle.fill",
              title: "Melanoma",
              detail: "The most serious type of skin cancer.",
            },
            {
              icon: "cross.case.fill",
              title: "Squamous Cell Carcinoma",
              detail:
                "A common skin cancer that often looks rough, scaly, or crusted.",
            },
            {
              icon: "cross.case.fill",
              title: "Basal Cell Carcinoma",
              detail:
                "The most common skin cancer, often a pearly bump or a sore that heals and returns.",
            },
            {
              icon: "questionmark.circle.fill",
              title: "Other (unusual pattern)",
              detail:
                "A spot that does not clearly match the common cancer types. It may be a precancer such as an actinic keratosis, or another skin condition.",
            },
            {
              icon: "checkmark.seal.fill",
              title: "Benign",
              detail:
                "A pattern that looks non-cancerous, like an ordinary mole or a seborrheic keratosis.",
            },
          ],
        },
        {
          kind: "list",
          variant: "grouped",
          heading: "The four levels",
          intro: "This is the advice the result screen gives for each level.",
          // Word for word from the result screen's own copy, so the two can
          // never disagree about what a level asks you to do.
          items: TIER_ORDER.map((tier) => ({
            icon: TIER_ICON[tier],
            title: TIER_SOURCE[tier].name,
            detail: TIER_SOURCE[tier].recommendation,
          })),
        },
        {
          kind: "prose",
          heading: "What the percentage means",
          paragraphs: [
            "The percentage shows how closely your photo matched the pattern SpotOn names. It is not the chance that the spot is or is not cancer, and a high percentage is not a diagnosis.",
          ],
        },
        {
          kind: "list",
          variant: "grouped",
          heading: "When SpotOn plays it safe",
          items: [
            {
              icon: "camera.viewfinder",
              title: "Unclear photos",
              detail:
                "If the photos could not be read clearly enough for a confident assessment, SpotOn recommends a check-up as a precaution. This reflects photo uncertainty, not a detected risk.",
            },
            {
              icon: "chart.bar.fill",
              title: "Split results",
              detail:
                "If the closest match is not a cancer type but a meaningful share of the assessment still points toward one, SpotOn raises the recommendation rather than relying on the closest match alone.",
            },
          ],
        },
        {
          kind: "notice",
          tone: "caution",
          title: "A low result is not an all-clear",
          text: "SpotOn can miss skin cancer, especially in unclear photos. If a spot changes, bleeds, itches, or simply worries you, see a dermatologist whatever your last result said.",
        },
        {
          kind: "list",
          variant: "tips",
          heading: "Getting a clearer result",
          items: [
            {
              icon: "sun.max.fill",
              title: "Use good, even light",
              detail: "Daylight or a bright room, without harsh shadows across the spot.",
            },
            {
              icon: "plus.viewfinder",
              title: "Get close and hold steady",
              detail: "Let the spot fill most of the frame, and wait for the camera to focus.",
            },
            {
              icon: "eye.slash",
              title: "Keep the spot uncovered",
              detail: "Move hair, makeup, or bandages away from it first.",
            },
            {
              icon: "clock.arrow.circlepath",
              title: "Scan again over time",
              detail:
                "A dated series of photos shows change far better than any single result.",
            },
          ],
        },
        { kind: "sources", sources: ["glasgow7pcl"] },
      ],
    },
  },
  //Questionnaire
  {
    id: "questionnaire",
    title: "SpotOn Questionnaire",
    subtitle: "A guided self-check to help assess your risk.",
    icon: "doc.text.fill",
    category: "self-check",
    kind: "article",
    article: {
      id: "questionnaire",
      related: ["warning-signs", "self-check"],
      title: "SpotOn Questionnaire",
      icon: "doc.text.fill",
      summary:
        "Eight questions to guide what to look for when checking a spot on your skin.",
      blocks: [
        {
          kind: "prose",
          heading: "How to use this",
          paragraphs: [
            "These are the same questions the SpotOn self-check walks you through. Go over each one with the spot you're looking at in mind.",
          ],
        },
        {
          kind: "list",
          variant: "grouped",
          heading: "The 8 questions",
          intro:
            "Work through each one and see if it applies to the spot you're checking.",
          // Titles and icons come from the scan's own question set, so this
          // article always shows exactly what the app asks.
          items: QUESTION_SOURCE.map((q) => ({
            icon: q.icon,
            title: q.question,
            detail: QUESTION_DETAILS[q.id],
          })),
        },
        {
          kind: "notice",
          tone: "info",
          title: "Important to know",
          text: "This checklist does not diagnose anything on its own, and no single answer means a spot is dangerous. If several of these apply, or you're simply unsure, it's worth having it looked at professionally.",
        },
        { kind: "sources", sources: ["glasgow7pcl", "aadAbcde"] },
      ],
    },
  },
]);

export function getTopic(id: string): Topic | undefined {
  return LEARN_TOPICS.find((t) => t.id === id);
}

export function getArticle(
  topicId: string,
  articleId?: string,
): Article | undefined {
  const topic = getTopic(topicId);
  if (!topic) return undefined;
  if (topic.kind === "article") return topic.article;
  return topic.subtopics.find((a) => a.id === articleId);
}

export function getCategoryLabel(id: LearnCategoryId): string {
  return LEARN_CATEGORIES.find((c) => c.id === id)?.label ?? "";
}

// Average adult reading speed for non-technical prose. Read times are derived
// from the article text itself rather than hand-authored, so they can never
// drift out of sync with the content.
const WORDS_PER_MINUTE = 200;

function countWords(...parts: (string | undefined)[]): number {
  return parts.reduce(
    (total, part) =>
      total + (part ? part.trim().split(/\s+/).filter(Boolean).length : 0),
    0,
  );
}

function blockWords(block: ArticleBlock): number {
  switch (block.kind) {
    case "prose":
      return countWords(block.heading, ...block.paragraphs);
    case "compare":
      return (
        countWords(block.heading, block.intro) +
        block.items.reduce(
          (total, item) => total + countWords(item.title, item.detail),
          0,
        )
      );
    case "steps":
      return (
        countWords(block.heading, block.intro) +
        block.steps.reduce(
          (total, step) => total + countWords(step.title, step.detail),
          0,
        )
      );
    case "list":
      return (
        countWords(block.heading, block.intro) +
        block.items.reduce(
          (total, item) => total + countWords(item.title, item.detail),
          0,
        )
      );
    case "visual":
      return (
        countWords(block.heading, block.intro) +
        block.traits.reduce(
          (total, trait) => total + countWords(trait.title, trait.detail),
          0,
        )
      );
    case "bodyAreas":
      return (
        countWords(block.heading, block.intro) +
        block.areas.reduce((total, area) => total + countWords(area.label), 0)
      );
    case "notice":
      return countWords(block.title, block.text);
    case "subtypes":
      return (
        countWords(block.heading, block.intro) +
        block.items.reduce(
          (total, item) =>
            total +
            countWords(
              item.name,
              item.summary,
              item.appearance,
              item.location,
              ...item.points,
            ),
          0,
        )
      );
    case "gallery":
      return (
        countWords(block.heading, block.intro, block.footnote) +
        block.items.reduce((total, item) => total + countWords(item.caption), 0)
      );
    case "sources":
      // A reference list is scanned, not read. Counting it would inflate every
      // article's estimate by a minute for text nobody reads start to finish.
      return 0;
    default:
      // Exhaustiveness check: a compile error here means a new block kind was
      // added without teaching the read-time estimate how to measure it.
      return block satisfies never;
  }
}

/**
 * Estimated reading time in whole minutes. Rounds up rather than to nearest, so
 * the figure never promises a shorter read than the article actually is.
 */
export function getArticleReadMinutes(article: Article): number {
  const words = article.blocks.reduce(
    (total, block) => total + blockWords(block),
    0,
  );
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/** Combined reading time for a topic, across all of its articles. */
export function getTopicReadMinutes(topic: Topic): number {
  if (topic.kind === "article") return getArticleReadMinutes(topic.article);
  return topic.subtopics.reduce(
    (total, article) => total + getArticleReadMinutes(article),
    0,
  );
}
