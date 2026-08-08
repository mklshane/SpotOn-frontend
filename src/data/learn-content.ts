import type { IconName } from '@/components/ui/icon';
import type { ClinicalImageId } from '@/data/learn-images';
import type { PendingSourceId, SourceId } from '@/data/learn-sources';

/** Which of the five ABCDE signs a comparison diagram illustrates. */
export type AbcdeSign = 'asymmetry' | 'border' | 'color' | 'diameter' | 'evolving';

/**
 * Article bodies are a list of blocks rather than a single prose shape, so each
 * topic can be presented the way its information actually reads: a visual
 * checklist as side-by-side diagrams, a clinic visit as numbered steps, risk
 * factors and sun-safety advice as scannable icon rows, and everything else as
 * plain headed prose. Every block still renders from the same type ramp,
 * spacing scale and card treatment, so the articles stay recognisably one set.
 */
export type ArticleBlock =
  | { kind: 'prose'; heading?: string; paragraphs: string[] }
  | { kind: 'compare'; heading?: string; intro?: string; items: CompareItem[] }
  | { kind: 'steps'; heading?: string; intro?: string; steps: Step[] }
  | { kind: 'list'; heading?: string; intro?: string; variant: 'grouped' | 'tips'; items: ListItem[] }
  | {
      kind: 'visual';
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
  | { kind: 'bodyAreas'; heading?: string; intro?: string; areas: BodyArea[] }
  | { kind: 'notice'; tone: 'info' | 'caution'; title?: string; text: string }
  | { kind: 'subtypes'; heading?: string; intro?: string; items: Subtype[] }
  | { kind: 'sources'; sources: SourceId[]; pending?: PendingSourceId[] };

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
};

/**
 * Broad buckets the Learn hub's filter chips are built from. Deliberately
 * coarser than the topic list: a chip per topic would just duplicate the list
 * below it instead of narrowing it.
 */
export const LEARN_CATEGORIES = [
  { id: 'basics', label: 'Basics' },
  { id: 'warning-signs', label: 'Warning Signs' },
  { id: 'self-check', label: 'Self-Check' },
  { id: 'risk', label: 'Risk Factors' },
  { id: 'sun-safety', label: 'Sun Safety' },
  { id: 'care', label: 'Getting Care' },
] as const;

export type LearnCategoryId = (typeof LEARN_CATEGORIES)[number]['id'];

type TopicBase = {
  id: string;
  title: string;
  subtitle: string;
  icon: IconName;
  category: LearnCategoryId;
};

export type Topic =
  | (TopicBase & { kind: 'article'; article: Article })
  | (TopicBase & { kind: 'subtopics'; subtopics: Article[] })
  | (TopicBase & { kind: 'comingSoon' });

export type LearnRecommendation = {
  title: string;
  summary: string;
  topicId: string;
};

/**
 * Short, actionable tips that rotate by local calendar date. Each tip links
 * into the existing Philippines-specific UV protection article, keeping the
 * recommendation useful offline and avoiding a separate content flow.
 */
export const LEARN_RECOMMENDATIONS = [
  {
    title: 'Protect easy-to-miss areas',
    summary: 'Apply sunscreen to your ears, neck, hands, and feet before going outdoors.',
    topicId: 'prevention',
  },
  {
    title: 'Reapply sunscreen outdoors',
    summary: 'Reapply broad-spectrum SPF 30+ every two hours, or sooner after sweating or swimming.',
    topicId: 'prevention',
  },
  {
    title: 'Cloudy days still need protection',
    summary: 'UV rays can still reach your skin on cloudy or cool days, so keep protecting exposed skin.',
    topicId: 'prevention',
  },
  {
    title: 'Plan around peak UV hours',
    summary: 'When possible, seek shade between 10 AM and 4 PM, when UV rays are strongest.',
    topicId: 'prevention',
  },
  {
    title: 'Make daily commutes sun-safe',
    summary: 'Use sunscreen, a hat, or protective clothing for walks and rides, not only beach days.',
    topicId: 'prevention',
  },
  {
    title: 'Choose broad-spectrum protection',
    summary: 'Look for water-resistant, broad-spectrum sunscreen with SPF 30+ and follow its label directions.',
    topicId: 'prevention',
  },
  {
    title: 'Pair sunscreen with shade and clothing',
    summary: 'Sunscreen works best alongside shade, protective clothing, a hat, and sunglasses.',
    topicId: 'prevention',
  },
] as const satisfies readonly LearnRecommendation[];

export function getDailyLearnRecommendation(date = new Date()): LearnRecommendation {
  const yearStart = Date.UTC(date.getFullYear(), 0, 0);
  const localDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOfYear = Math.floor((localDay - yearStart) / 86_400_000);
  const index = (dayOfYear - 1) % LEARN_RECOMMENDATIONS.length;

  return LEARN_RECOMMENDATIONS[index] ?? LEARN_RECOMMENDATIONS[0];
}

export const LEARN_TOPICS: Topic[] = [
  {
    id: 'what-is-skin-cancer',
    title: 'What is Skin Cancer',
    subtitle: 'A quick introduction to what skin cancer is and why early detection matters.',
    icon: 'cross.case.fill',
    category: 'basics',
    kind: 'article',
    article: {
      id: 'what-is-skin-cancer',
      title: 'What is Skin Cancer',
      icon: 'cross.case.fill',
      summary: 'What skin cancer is, and why finding it early makes such a difference.',
      // Straightforward background reading, so it stays plain headed prose.
      blocks: [
        {
          kind: 'prose',
          paragraphs: [
            'Skin cancer happens when skin cells grow abnormally, usually because of damage from ultraviolet (UV) light. Most of that damage comes from the sun, though tanning beds cause it too. It is the most common type of cancer worldwide, and also one of the most treatable when caught early.',
          ],
        },
        {
          kind: 'prose',
          heading: 'Why early detection matters',
          paragraphs: [
            'Most skin cancers develop slowly and visibly, on skin you can see and check yourself. Spotting a change early, before it grows or spreads, usually means simpler treatment and better outcomes.',
          ],
        },
        {
          kind: 'prose',
          heading: "SpotOn's role",
          paragraphs: [
            'SpotOn helps you track spots on your skin over time and get an early, informal read on whether a spot looks worth showing a doctor. It is a screening aid, not a diagnosis. Always follow up with a dermatologist for anything that concerns you.',
          ],
        },
        { kind: 'sources', sources: ['nciSkin', 'aadOverview'] },
      ],
    },
  },
  {
    id: 'types-of-skin-cancer',
    title: 'Types of Skin Cancer',
    subtitle: 'The three most common types, and how they differ.',
    icon: 'square.grid.2x2.fill',
    category: 'basics',
    kind: 'subtopics',
    subtopics: [
      {
        id: 'bcc',
        title: 'Basal Cell Carcinoma',
        icon: 'cross.case.fill',
        summary: 'The most common and least dangerous type, usually a slow-growing pearly bump.',
        blocks: [
          {
            kind: 'prose',
            paragraphs: [
              'Basal cell carcinoma is the most common skin cancer and the least dangerous. It grows slowly on skin that has had years of sun, and it is highly curable when treated early.',
            ],
          },
          {
            kind: 'visual',
            heading: 'What it may look like',
            photo: 'bcc-example',
            traits: [
              { title: 'Pearly, waxy surface', detail: 'The bump can look slightly translucent, as if lit from within.' },
              { title: 'Raised, rolled border', detail: 'The edge is smooth and defined rather than ragged.' },
              { title: 'Fine surface vessels', detail: 'Thread-like blood vessels are often visible across the bump.' },
            ],
          },
          {
            kind: 'subtypes',
            heading: 'Types of basal cell carcinoma',
            intro: 'More than twenty variants are described. These are the ones seen most often.',
            items: [
              {
                id: 'nodular',
                name: 'Nodular',
                summary: 'The most common form, and the classic pearly bump.',
                photo: 'bcc-nodular',
                appearance:
                  'A raised, round growth with a translucent or pearly surface, often with fine visible vessels across it.',
                location: 'Most often the head and neck, particularly the nose and forehead.',
                points: ['The most common variant.', 'Considered lower risk than the infiltrative forms.'],
              },
              {
                id: 'superficial',
                name: 'Superficial',
                summary: 'A flat, scaly patch rather than a bump, usually on the trunk.',
                photo: 'bcc-superficial',
                appearance:
                  'A reddened, well defined flat patch with a light scale, which can be mistaken for eczema or psoriasis.',
                location: 'Usually the trunk.',
                points: ['Often appears in more than one place.', 'Grows outward rather than downward.'],
              },
              {
                id: 'morpheaform',
                name: 'Morpheaform or sclerosing',
                summary: 'Looks like a scar, and its edges are hard to see.',
                photo: 'bcc-morpheaform',
                appearance: 'A pale, waxy, slightly firm patch with poorly defined edges, easily mistaken for a scar.',
                location: 'Mainly the nose, inner eye corners, forehead, and cheeks.',
                points: [
                  'Its true extent is hard to judge by eye.',
                  'Returns after treatment more often than the nodular form.',
                ],
              },
              {
                id: 'pigmented',
                name: 'Pigmented',
                summary: 'A nodular growth carrying brown or black colour.',
                photo: 'bcc-pigmented',
                appearance: 'A pearly bump with brown, black, or blue-grey pigment, so it can be mistaken for a mole.',
                points: [
                  'More often seen in people with darker skin tones.',
                  'Behaves like the nodular form despite the different colour.',
                ],
              },
            ],
          },
          {
            kind: 'list',
            variant: 'grouped',
            heading: 'Common signs',
            items: [
              {
                icon: 'drop.fill',
                title: 'Bleeds, then scabs over',
                detail: 'It may bleed after a light knock, crust over, and reopen in the same place instead of healing.',
              },
              {
                icon: 'clock.fill',
                title: 'Slow to change',
                detail: 'It develops over months or years rather than weeks, so it is easy to dismiss as a stubborn pimple.',
              },
              {
                icon: 'checkmark.seal.fill',
                title: 'Rarely spreads',
                detail: 'It almost always stays local, though it can damage nearby tissue if it is left alone for a long time.',
              },
            ],
          },
          {
            kind: 'bodyAreas',
            heading: 'Where it usually appears',
            intro: 'Almost always on skin that gets regular sun.',
            areas: [
              { region: 'head / face', label: 'Face and nose' },
              { region: 'neck', label: 'Neck' },
              { region: 'shoulder', label: 'Shoulders' },
              { region: 'forearm', label: 'Forearms' },
            ],
          },
          {
            kind: 'prose',
            heading: 'Typical treatment',
            paragraphs: ['Usually removed with a minor outpatient procedure. Highly curable when caught early.'],
          },
          {
            kind: 'notice',
            tone: 'info',
            title: 'Worth remembering',
            text: 'A sore on sun-exposed skin that keeps reopening over several weeks is worth showing a dermatologist, even when it does not hurt.',
          },
          { kind: 'sources', sources: ['aadBcc', 'statPearlsBcc', 'nciSkin'] },
        ],
      },
      {
        id: 'scc',
        title: 'Squamous Cell Carcinoma',
        icon: 'cross.case.fill',
        summary: 'A scaly patch or sore that keeps reopening, most often on sun-exposed skin.',
        blocks: [
          {
            kind: 'prose',
            paragraphs: [
              'Squamous cell carcinoma is the second most common skin cancer. It is still highly treatable when found early, but it is more likely than basal cell carcinoma to grow deeper if it is ignored.',
            ],
          },
          {
            kind: 'visual',
            heading: 'What it may look like',
            photo: 'scc-example',
            traits: [
              { title: 'Rough, scaly surface', detail: 'The patch feels crusted or sandpapery rather than smooth.' },
              { title: 'Firm red base', detail: 'The skin underneath often looks inflamed or reddened.' },
              { title: 'Crusting that returns', detail: 'Flakes lift off and rebuild in the same spot.' },
            ],
          },
          {
            kind: 'subtypes',
            heading: 'Types of squamous cell carcinoma',
            intro: 'Three forms account for most cases seen on the skin.',
            items: [
              {
                id: 'bowens',
                name: 'Bowen disease, or in situ',
                summary: 'The earliest form, still confined to the surface layer of the skin.',
                photo: 'scc-bowens',
                appearance: 'A well defined red, scaly patch that can look like eczema or psoriasis but does not clear.',
                points: [
                  'Has not grown past the top layer of skin.',
                  'Highly treatable at this stage.',
                ],
              },
              {
                id: 'keratoacanthoma',
                name: 'Keratoacanthoma',
                summary: 'Grows quickly, and can shrink on its own.',
                photo: 'scc-keratoacanthoma',
                appearance: 'A dome-shaped lump with a central plug of keratin, giving it a crater-like middle.',
                points: [
                  'Appears and grows over weeks rather than months.',
                  'Still assessed and treated as a squamous cell carcinoma even though it may regress.',
                ],
              },
              {
                id: 'invasive',
                name: 'Invasive',
                summary: 'Has grown past the surface layer into deeper skin.',
                photo: 'scc-invasive',
                photoCaption: 'General SCC example',
                photoNote:
                  'Clinical example of squamous cell carcinoma. The image source does not specify whether this lesion is invasive, and invasion is confirmed under a microscope rather than by eye.',
                appearance: 'A firm, often tender lump, or a scaly sore that bleeds, crusts, and does not heal.',
                points: [
                  'The form most likely to spread if it is left untreated.',
                  'Still very treatable when found early.',
                ],
              },
            ],
          },
          {
            kind: 'list',
            variant: 'grouped',
            heading: 'Common signs',
            items: [
              {
                icon: 'bandage.fill',
                title: 'A sore that will not close',
                detail: 'It heals partway, then reopens in the same place over weeks or months.',
              },
              {
                icon: 'allergens',
                title: 'Rough to the touch',
                detail: 'The patch can feel scaly or tender, and it may catch on clothing.',
              },
              {
                icon: 'exclamationmark.triangle.fill',
                title: 'Can grow deeper',
                detail: 'Left untreated it is more likely than basal cell carcinoma to spread beyond the skin.',
              },
            ],
          },
          {
            kind: 'bodyAreas',
            heading: 'Where it usually appears',
            intro: 'On the areas that take the most daily sun.',
            areas: [
              { region: 'head / face', label: 'Face and ears' },
              { region: 'neck', label: 'Neck' },
              { region: 'hand', label: 'Backs of hands' },
              { region: 'forearm', label: 'Forearms' },
              { region: 'lower leg', label: 'Lower legs' },
            ],
          },
          {
            kind: 'prose',
            heading: 'Typical treatment',
            paragraphs: ['Usually surgical removal. Larger or higher-risk cases may need additional treatment.'],
          },
          {
            kind: 'notice',
            tone: 'info',
            title: 'Worth remembering',
            text: 'A rough patch that keeps coming back after it seems to heal is a common early sign, and it is much simpler to treat at that stage.',
          },
          { kind: 'sources', sources: ['aadScc', 'statPearlsScc', 'nciSkin'] },
        ],
      },
      {
        id: 'melanoma',
        title: 'Melanoma',
        icon: 'cross.case.fill',
        summary: 'The least common but most serious type, usually a new or changing mole.',
        blocks: [
          {
            kind: 'prose',
            paragraphs: [
              'Melanoma is the least common of the three types but the most serious, because it can spread to other parts of the body. Found early it is very treatable, which is why a changing mole is worth acting on rather than watching.',
            ],
          },
          {
            kind: 'visual',
            heading: 'What it may look like',
            photo: 'melanoma-example',
            traits: [
              { title: 'Asymmetric shape', detail: 'One half does not mirror the other half.' },
              { title: 'Irregular, notched border', detail: 'The edge wanders instead of forming a clean circle.' },
              { title: 'Uneven color', detail: 'Several shades of brown or black appear within one spot.' },
            ],
          },
          {
            kind: 'subtypes',
            heading: 'Types of melanoma',
            intro:
              'Four main types are recognised, by how they grow and where they appear. Tap one to see what it may look like.',
            items: [
              {
                id: 'superficial-spreading',
                name: 'Superficial spreading melanoma',
                // Kept to two lines in the narrow card column. This is the only
                // subtype whose name wraps, so a third line of summary made its
                // card taller than every sibling in the set.
                summary: 'The most common type. Spreads outward before it grows deeper.',
                photo: 'melanoma-superficial-spreading',
                appearance:
                  'A flat or slightly raised patch with an uneven edge and more than one shade of brown, black, or pink.',
                location: 'Often the trunk in men and the legs in women, though it can appear anywhere.',
                points: [
                  'Usually grows sideways for a period before it grows deeper.',
                  'The ABCDE signs describe this type well.',
                ],
              },
              {
                id: 'nodular',
                name: 'Nodular melanoma',
                summary: 'Grows downward early, so it can become serious faster than the others.',
                photo: 'melanoma-nodular',
                appearance:
                  'A firm, raised lump, often evenly coloured. It can be black, brown, red, pink, or carry no extra colour at all.',
                points: [
                  'Grows deeper from the start rather than spreading sideways first.',
                  'May not show the usual ABCDE signs, so a new firm lump that keeps growing is worth checking even when it looks even.',
                ],
              },
              {
                id: 'lentigo-maligna',
                name: 'Lentigo maligna melanoma',
                summary: 'Develops slowly on skin with many years of sun exposure.',
                photo: 'melanoma-lentigo-maligna',
                appearance:
                  'A large, flat, freckle-like patch of uneven tan and brown that widens slowly over years.',
                location: 'Usually the face, head, and neck.',
                points: [
                  'More common in older adults.',
                  'Slow growth makes it easy to mistake for an age spot.',
                ],
              },
              {
                id: 'acral-lentiginous',
                name: 'Acral lentiginous melanoma',
                summary: 'Appears on palms, soles, and under the nails, on skin that rarely sees sun.',
                photo: 'melanoma-acral',
                appearance:
                  'A dark patch on a palm or sole, or a dark band running the length of a nail.',
                location: 'Palms, soles, and nail beds.',
                points: [
                  'Not linked to sun exposure.',
                  'Worth knowing about because these areas are easy to skip during a self-check.',
                ],
              },
            ],
          },
          {
            kind: 'list',
            variant: 'grouped',
            heading: 'Common signs',
            items: [
              {
                icon: 'arrow.triangle.2.circlepath',
                title: 'It changes over time',
                detail: 'It grows, darkens, or shifts shape over weeks to months. Change matters more than any single feature.',
              },
              {
                icon: 'square.grid.2x2.fill',
                title: 'It stands out from your other moles',
                detail: 'Often called the ugly duckling sign, because it simply does not match the rest of your skin.',
              },
              {
                icon: 'exclamationmark.triangle.fill',
                title: 'It can appear on new skin',
                detail: 'Most melanomas are new spots rather than changes to a mole you have had for years.',
              },
            ],
          },
          {
            kind: 'bodyAreas',
            heading: 'Where it usually appears',
            intro: 'Melanoma can appear anywhere, including skin that rarely sees sun.',
            areas: [
              { region: 'upper back', label: 'Back' },
              { region: 'lower leg', label: 'Legs' },
              { region: 'forearm', label: 'Arms' },
              { region: 'foot', label: 'Soles of feet' },
              { region: 'head / face', label: 'Face and scalp' },
            ],
          },
          {
            kind: 'prose',
            heading: 'Typical treatment',
            paragraphs: [
              'Surgical removal is standard. More advanced cases may need additional treatment from an oncology team.',
            ],
          },
          {
            kind: 'notice',
            tone: 'caution',
            title: 'Do not wait this one out',
            text: 'If a mole matches an ABCDE sign or has clearly changed, book a dermatologist rather than watching it for another few months. Early melanoma is usually treated with a simple removal.',
          },
          { kind: 'sources', sources: ['aadMelanoma', 'nciMelanomaSubtypes', 'aadAbcde', 'nciSkin'] },
        ],
      },
    ],
  },
  {
    id: 'warning-signs',
    title: 'Warning Signs (ABCDE Rule)',
    subtitle: 'A simple checklist for spotting a mole that needs attention.',
    icon: 'exclamationmark.triangle.fill',
    category: 'warning-signs',
    kind: 'article',
    article: {
      id: 'warning-signs',
      title: 'Warning Signs (ABCDE Rule)',
      icon: 'exclamationmark.triangle.fill',
      summary: 'Five things to look for in a mole, shown side by side.',
      // The five signs are visual by nature, so each one is drawn as a
      // typical-versus-concerning pair rather than described in prose.
      blocks: [
        {
          kind: 'prose',
          paragraphs: [
            'Melanoma is often noticed first by the person who has it, not by a doctor. The ABCDE rule is the same checklist dermatologists use, and it works just as well at home in front of a mirror.',
          ],
        },
        {
          kind: 'compare',
          heading: 'The ABCDE rule',
          intro:
            'Compare a spot against each sign below. One sign on its own is not a diagnosis, but it is a good reason to have the spot looked at.',
          items: [
            {
              letter: 'A',
              sign: 'asymmetry',
              title: 'Asymmetry',
              detail: 'One half of the mole does not match the other half.',
              captions: { typical: 'More regular', concern: 'Asymmetrical' },
              photos: { typical: 'abcde-asymmetry-regular', concern: 'abcde-asymmetry-irregular' },
            },
            {
              letter: 'B',
              sign: 'border',
              title: 'Border',
              detail: 'Look for edges that are irregular, ragged, blurred, or uneven.',
              captions: { typical: 'More even border', concern: 'Irregular border' },
              photos: { typical: 'abcde-border-even', concern: 'abcde-border-irregular' },
            },
            {
              letter: 'C',
              sign: 'color',
              title: 'Color',
              detail:
                'Look for uneven color, or several shades within the same spot, such as tan, brown, black, red, white, or blue.',
              captions: { typical: 'More uniform', concern: 'Multiple colors' },
              photos: { typical: 'abcde-color-uniform', concern: 'abcde-color-varied' },
            },
            {
              letter: 'D',
              sign: 'diameter',
              title: 'Diameter',
              detail:
                'Diameter is one feature to consider. Melanomas are often wider than about 6 mm when found, but they can also be smaller.',
              captions: { typical: 'Smaller example', concern: 'Larger example' },
              measurements: { typical: '5.3 mm', concern: '10.4 mm' },
              photos: { typical: 'abcde-diameter-small', concern: 'abcde-diameter-large' },
              footnote:
                'Both measurements are recorded by the source archive, not read off these photographs. You cannot judge a real diameter from a picture.',
            },
            {
              // The same lesion on the same patient, seven months apart, from a
              // CC BY case report. These are dermoscopic rather than clinical,
              // which the captions and note below state outright: a magnified
              // instrument view is not what anyone sees in a mirror, and
              // implying otherwise would teach the wrong expectation.
              letter: 'E',
              sign: 'evolving',
              title: 'Evolving',
              detail:
                'Watch for changes in a spot over time, including its size, shape, color, or new symptoms such as itching or bleeding.',
              captions: { typical: 'Initial image', concern: '7 months later' },
              measurements: { typical: '3 mm', concern: '5 mm' },
              photos: { typical: 'abcde-evolving-earlier', concern: 'abcde-evolving-later' },
              footnote:
                'Dermoscopic view. Dermoscopy is a magnified examination of the skin used by healthcare professionals, so this is not how the spot looks to the naked eye. The same lesion is shown here growing from 3 mm to 5 mm over seven months, with both measurements taken from the published case report.',
            },
          ],
        },
        {
          kind: 'prose',
          heading: 'If a spot matches a sign',
          paragraphs: [
            'Have it checked rather than waiting to see what happens. Scanning it with SpotOn also keeps a dated photo, which makes any later change much easier to see.',
          ],
        },
        {
          kind: 'notice',
          tone: 'info',
          title: 'Important to know',
          text: 'The ABCDE rule can help you notice changes in your skin. It cannot confirm whether a spot is cancerous, and plenty of harmless moles fail one of these tests. Use it to decide what to show a dermatologist, not to rule anything in or out yourself.',
        },
        { kind: 'sources', sources: ['aadAbcde', 'aadMelanoma', 'nciSkin', 'satoTanakaEvolving'] },
      ],
    },
  },
  {
    id: 'self-check',
    title: 'How to Check Your Skin',
    subtitle: 'A five-step routine you can do at home in about ten minutes.',
    icon: 'magnifyingglass',
    category: 'self-check',
    kind: 'article',
    article: {
      id: 'self-check',
      title: 'How to Check Your Skin',
      icon: 'magnifyingglass',
      summary: 'A five-step routine for checking your own skin, and the spots people miss.',
      // A procedure, so it is numbered, and the easily missed areas are drawn
      // rather than listed as text.
      blocks: [
        {
          kind: 'prose',
          paragraphs: [
            'A skin self-check takes about ten minutes and needs nothing more than good light and a mirror. Doing it in the same order every time is what makes a change easy to notice.',
          ],
        },
        {
          kind: 'steps',
          heading: 'The five-step routine',
          intro: 'Once a month is enough for most people.',
          steps: [
            {
              title: 'Find good light and a mirror',
              detail:
                'Stand in bright, even light in front of a full-length mirror. A handheld mirror helps for the areas you cannot see directly.',
            },
            {
              title: 'Work from the top down',
              detail:
                'Start at your scalp and face, then your neck, shoulders, chest, and arms, and finish at your legs and feet. A fixed order means you are far less likely to skip a patch.',
            },
            {
              title: 'Check the areas that are easy to miss',
              detail:
                'Between your fingers and toes, the soles of your feet, behind your ears, your nape, and your back. Skin cancer can appear where the sun rarely reaches.',
            },
            {
              title: 'Compare each spot against the rest',
              detail:
                'You are looking for the one that stands out from your other moles. If something catches your eye, check it against the ABCDE rule.',
            },
            {
              title: 'Photograph anything you want to watch',
              detail:
                'Scan the spot with SpotOn so you have a dated photo. Comparing two pictures months apart is far more reliable than trying to remember.',
            },
          ],
        },
        {
          kind: 'bodyAreas',
          heading: 'The spots people skip',
          intro: 'Give these a deliberate look, since they are hard to see without help.',
          areas: [
            { region: 'back of head', label: 'Scalp and nape' },
            { region: 'upper back', label: 'Back' },
            { region: 'hand', label: 'Between fingers' },
            { region: 'foot', label: 'Soles and toes' },
          ],
        },
        {
          kind: 'notice',
          tone: 'info',
          title: 'Ask for a second pair of eyes',
          text: 'Your back and scalp are the hardest areas to check alone. Asking someone you trust to look, or using a phone camera, covers the blind spots a mirror cannot.',
        },
        { kind: 'sources', sources: ['aadSelfExam', 'aadAbcde'], pending: ['selfCheckFrequency'] },
      ],
    },
  },
  {
    id: 'risk-factors',
    title: 'Risk Factors',
    subtitle: 'What raises your chances of developing skin cancer.',
    icon: 'figure.stand',
    category: 'risk',
    kind: 'article',
    article: {
      id: 'risk-factors',
      title: 'Risk Factors',
      icon: 'figure.stand',
      summary: 'The four things that most affect your chances, grouped at a glance.',
      // Four parallel factors, so they read better as a compact grouped list
      // than as four headed paragraphs.
      blocks: [
        {
          kind: 'prose',
          paragraphs: [
            'Anyone can develop skin cancer, but some factors make it more likely. Knowing yours can help you decide how often to check your skin and when to see a dermatologist.',
          ],
        },
        {
          kind: 'list',
          variant: 'grouped',
          heading: 'What raises your risk',
          items: [
            {
              icon: 'sun.max.fill',
              title: 'Sun exposure',
              detail: 'Frequent sunburns or long-term unprotected sun exposure, especially earlier in life.',
            },
            {
              icon: 'figure.stand',
              title: 'Skin type',
              detail:
                'Fair skin, light hair, and eyes that burn easily carry a higher risk, though anyone can develop skin cancer.',
            },
            {
              icon: 'person.2.fill',
              title: 'Family history',
              detail: 'A close relative with skin cancer, especially melanoma, raises your own risk.',
            },
            {
              icon: 'circle.grid.2x2.fill',
              title: 'Age and moles',
              detail: 'Risk increases with age, and having many moles or atypical-looking moles is also a factor.',
            },
          ],
        },
        {
          kind: 'prose',
          heading: 'What to do with this',
          paragraphs: [
            'Having a risk factor does not mean you will develop skin cancer. It is a reason to check your skin a little more regularly, and to protect it from the sun.',
          ],
        },
        {
          kind: 'notice',
          tone: 'info',
          title: 'Darker skin is not exempt',
          text: 'Skin cancer is less common in darker skin tones, but it is often found later, when it is harder to treat. Everyone benefits from checking their own skin.',
        },
        { kind: 'sources', sources: ['nciPrevention', 'aadOverview'] },
      ],
    },
  },
  {
    id: 'prevention',
    title: 'UV Protection in the Philippines',
    subtitle: 'Sun safety tips for our year-round tropical climate.',
    icon: 'sun.max.fill',
    category: 'sun-safety',
    kind: 'article',
    article: {
      id: 'prevention',
      title: 'UV Protection in the Philippines',
      icon: 'sun.max.fill',
      summary: 'Practical sun-safety habits for a country with high UV all year.',
      // Advice you act on, so it is presented as scannable recommendation
      // cards instead of a wall of paragraphs.
      blocks: [
        {
          kind: 'prose',
          paragraphs: [
            // The previous wording asserted that PAGASA publishes a daily UV
            // Index forecast. Its public site was checked on 2026-08-08 and no
            // such product was found, so the claim was replaced with WHO's
            // published thresholds, which are verifiable. See PENDING_SOURCES.
            'The Philippines sits close to the equator, so UV levels stay high all year rather than only in summer. Sun protection is a daily habit here, not a seasonal one.',
          ],
        },
        {
          kind: 'list',
          variant: 'tips',
          heading: 'Everyday sun protection',
          intro: 'Five habits that fit around an ordinary week here.',
          items: [
            {
              icon: 'chart.bar.fill',
              title: 'Check the UV Index',
              detail:
                'The World Health Organization advises sun protection once the UV Index reaches 3, and at 8 and above it advises staying out of the sun around midday and seeking shade. Most weather apps and forecasts publish the current figure, so you can plan errands and exercise around it.',
            },
            {
              icon: 'drop.fill',
              title: 'Use sunscreen that survives the humidity',
              detail:
                'Broad-spectrum SPF 30+ daily, reapplied every two hours outdoors, and sooner if you are sweating or swimming. A water-resistant, lightweight formula sits better here than a heavy cream.',
            },
            {
              icon: 'umbrella.fill',
              title: 'Cover up on ordinary errands',
              detail:
                'Jeepney and tricycle rides, market trips, waiting for a ride, and walks to school or work all add up. Long sleeves, a wide-brimmed hat or cap, and sunglasses help outside of beach days.',
            },
            {
              icon: 'clock.fill',
              title: 'Plan around peak hours',
              detail:
                'UV rays are strongest between 10am and 4pm, so seek shade during that window when possible. Overcast or rainy-season skies block heat but not most UV.',
            },
            {
              icon: 'magnifyingglass',
              title: 'Check your skin monthly',
              detail:
                'Look for new or changing spots using the ABCDE rule as a guide, and use SpotOn to track anything you want to keep an eye on.',
            },
          ],
        },
        { kind: 'sources', sources: ['whoUvIndex', 'nciPrevention', 'aadOverview'] },
      ],
    },
  },
  {
    id: 'when-to-see-a-doctor',
    title: 'When to See a Doctor',
    subtitle: 'Signs that mean it is time for a professional opinion.',
    icon: 'stethoscope',
    category: 'care',
    kind: 'article',
    article: {
      id: 'when-to-see-a-doctor',
      title: 'When to See a Doctor',
      icon: 'stethoscope',
      summary: 'What is worth booking for, and what actually happens at the visit.',
      // Two different shapes in one article: a checklist of reasons to book,
      // then the visit itself as an ordered walkthrough.
      blocks: [
        {
          kind: 'list',
          variant: 'grouped',
          heading: 'Signs worth booking for',
          intro: 'See a dermatologist if a spot does any of the following.',
          items: [
            {
              icon: 'exclamationmark.triangle.fill',
              title: 'It matches an ABCDE sign',
              detail:
                'Asymmetry, an irregular border, uneven color, a diameter over about 6mm, or any change over time.',
            },
            {
              icon: 'drop.fill',
              title: 'It bleeds or will not heal',
              detail: 'A sore that scabs over, heals, and then reopens in the same place is worth showing someone.',
            },
            {
              icon: 'scribble',
              title: 'It itches persistently',
              detail: 'Ongoing itching or tenderness in one spot, rather than an occasional passing itch.',
            },
            {
              icon: 'square.grid.2x2.fill',
              title: 'It looks unlike your other moles',
              detail: 'A spot that simply stands out from the rest of your skin is reason enough to have it checked.',
            },
          ],
        },
        {
          kind: 'steps',
          heading: 'What to expect at a visit',
          intro: 'Most visits are quick and non-invasive.',
          steps: [
            {
              title: 'Visual examination',
              detail:
                'The dermatologist looks closely at the spot, and often at the rest of your skin, which usually takes only a few minutes.',
            },
            {
              title: 'A closer look with a dermatoscope',
              detail:
                'A handheld magnifying lens may be rested against the skin to see detail that is invisible to the naked eye. It does not hurt.',
            },
            {
              title: 'A biopsy, only if needed',
              detail:
                'If anything looks concerning, a small sample is taken under local anesthetic and sent to a lab for a definite answer.',
            },
          ],
        },
        {
          kind: 'prose',
          heading: 'Finding a clinic',
          paragraphs: [
            'The Directory tab lists nearby dermatology clinics and doctors offering online booking, so you can find and reach a professional directly from SpotOn.',
          ],
        },
        {
          kind: 'notice',
          tone: 'info',
          title: 'Important to know',
          text: 'A dermatologist can tell you what a spot is. Nothing you read here, and no photo comparison, can do that on its own.',
        },
        { kind: 'sources', sources: ['aadOverview', 'aadAbcde', 'nciSkin'] },
      ],
    },
  },
  {
    id: 'questionnaire',
    title: 'SpotOn Questionnaire',
    subtitle: 'A guided self-check to help assess your risk.',
    icon: 'doc.text.fill',
    category: 'self-check',
    kind: 'comingSoon',
  },
];

export function getTopic(id: string): Topic | undefined {
  return LEARN_TOPICS.find((t) => t.id === id);
}

export function getArticle(topicId: string, articleId?: string): Article | undefined {
  const topic = getTopic(topicId);
  if (!topic) return undefined;
  if (topic.kind === 'article') return topic.article;
  if (topic.kind === 'subtopics') return topic.subtopics.find((a) => a.id === articleId);
  return undefined;
}

export function getCategoryLabel(id: LearnCategoryId): string {
  return LEARN_CATEGORIES.find((c) => c.id === id)?.label ?? '';
}

// Average adult reading speed for non-technical prose. Read times are derived
// from the article text itself rather than hand-authored, so they can never
// drift out of sync with the content.
const WORDS_PER_MINUTE = 200;

function countWords(...parts: (string | undefined)[]): number {
  return parts.reduce(
    (total, part) => total + (part ? part.trim().split(/\s+/).filter(Boolean).length : 0),
    0
  );
}

function blockWords(block: ArticleBlock): number {
  switch (block.kind) {
    case 'prose':
      return countWords(block.heading, ...block.paragraphs);
    case 'compare':
      return (
        countWords(block.heading, block.intro) +
        block.items.reduce((total, item) => total + countWords(item.title, item.detail), 0)
      );
    case 'steps':
      return (
        countWords(block.heading, block.intro) +
        block.steps.reduce((total, step) => total + countWords(step.title, step.detail), 0)
      );
    case 'list':
      return (
        countWords(block.heading, block.intro) +
        block.items.reduce((total, item) => total + countWords(item.title, item.detail), 0)
      );
    case 'visual':
      return (
        countWords(block.heading, block.intro) +
        block.traits.reduce((total, trait) => total + countWords(trait.title, trait.detail), 0)
      );
    case 'bodyAreas':
      return (
        countWords(block.heading, block.intro) +
        block.areas.reduce((total, area) => total + countWords(area.label), 0)
      );
    case 'notice':
      return countWords(block.title, block.text);
    case 'subtypes':
      return (
        countWords(block.heading, block.intro) +
        block.items.reduce(
          (total, item) =>
            total + countWords(item.name, item.summary, item.appearance, item.location, ...item.points),
          0
        )
      );
    case 'sources':
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
  const words = article.blocks.reduce((total, block) => total + blockWords(block), 0);
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/** Combined reading time for a topic, or `undefined` when it has no article yet. */
export function getTopicReadMinutes(topic: Topic): number | undefined {
  if (topic.kind === 'article') return getArticleReadMinutes(topic.article);
  if (topic.kind === 'subtopics') {
    return topic.subtopics.reduce((total, article) => total + getArticleReadMinutes(article), 0);
  }
  return undefined;
}
