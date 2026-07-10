import type { IconName } from '@/components/ui/icon';

export type ArticleSection = {
  heading?: string;
  paragraphs: string[];
};

export type Article = {
  id: string;
  title: string;
  icon: IconName;
  sections: ArticleSection[];
};

export type Topic =
  | { id: string; title: string; subtitle: string; icon: IconName; kind: 'article'; article: Article }
  | { id: string; title: string; subtitle: string; icon: IconName; kind: 'subtopics'; subtopics: Article[] }
  | { id: string; title: string; subtitle: string; icon: IconName; kind: 'comingSoon' };

export const LEARN_TOPICS: Topic[] = [
  {
    id: 'what-is-skin-cancer',
    title: 'What is Skin Cancer',
    subtitle: 'A quick introduction to what skin cancer is and why early detection matters.',
    icon: 'cross.case.fill',
    kind: 'article',
    article: {
      id: 'what-is-skin-cancer',
      title: 'What is Skin Cancer',
      icon: 'cross.case.fill',
      sections: [
        {
          paragraphs: [
            'Skin cancer happens when skin cells grow abnormally, usually because of damage from ultraviolet (UV) light — most often from the sun, but tanning beds too. It is the most common type of cancer worldwide, and also one of the most treatable when caught early.',
          ],
        },
        {
          heading: 'Why early detection matters',
          paragraphs: [
            'Most skin cancers develop slowly and visibly, on skin you can see and check yourself. Spotting a change early — before it grows or spreads — usually means simpler treatment and better outcomes.',
          ],
        },
        {
          heading: "SpotOn's role",
          paragraphs: [
            'SpotOn helps you track spots on your skin over time and get an early, informal read on whether a spot looks worth showing a doctor. It is a screening aid, not a diagnosis — always follow up with a dermatologist for anything that concerns you.',
          ],
        },
      ],
    },
  },
  {
    id: 'types-of-skin-cancer',
    title: 'Types of Skin Cancer',
    subtitle: 'The three most common types, and how they differ.',
    icon: 'square.grid.2x2.fill',
    kind: 'subtopics',
    subtopics: [
      {
        id: 'bcc',
        title: 'Basal Cell Carcinoma',
        icon: 'cross.case.fill',
        sections: [
          {
            heading: 'What it looks like',
            paragraphs: [
              'Often a pearly or waxy bump, or a flat, flesh-colored/brown scar-like lesion. It may bleed or scab and not fully heal.',
            ],
          },
          {
            heading: 'Risk level',
            paragraphs: [
              'The most common and least dangerous type — it grows slowly and rarely spreads beyond the skin, but can damage surrounding tissue if left untreated.',
            ],
          },
          {
            heading: 'Typical treatment',
            paragraphs: ['Usually removed with a minor outpatient procedure. Highly curable when caught early.'],
          },
        ],
      },
      {
        id: 'scc',
        title: 'Squamous Cell Carcinoma',
        icon: 'cross.case.fill',
        sections: [
          {
            heading: 'What it looks like',
            paragraphs: [
              'A firm, red bump, a scaly patch, or a sore that heals and reopens, often on sun-exposed skin like the face, ears, or hands.',
            ],
          },
          {
            heading: 'Risk level',
            paragraphs: [
              'More likely than BCC to grow deeper or spread if untreated, though still highly treatable when found early.',
            ],
          },
          {
            heading: 'Typical treatment',
            paragraphs: ['Usually surgical removal; larger or higher-risk cases may need additional treatment.'],
          },
        ],
      },
      {
        id: 'melanoma',
        title: 'Melanoma',
        icon: 'cross.case.fill',
        sections: [
          {
            heading: 'What it looks like',
            paragraphs: [
              'A new or changing mole — often asymmetric, with an irregular border, uneven color, and larger than a pencil eraser. See the ABCDE rule for the full checklist.',
            ],
          },
          {
            heading: 'Risk level',
            paragraphs: [
              'The least common but most serious type — it can spread to other parts of the body if not caught early, so prompt evaluation matters most here.',
            ],
          },
          {
            heading: 'Typical treatment',
            paragraphs: [
              'Surgical removal is standard; more advanced cases may need additional treatment from an oncology team.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'warning-signs',
    title: 'Warning Signs (ABCDE Rule)',
    subtitle: 'A simple checklist for spotting a mole that needs attention.',
    icon: 'exclamationmark.triangle.fill',
    kind: 'article',
    article: {
      id: 'warning-signs',
      title: 'Warning Signs (ABCDE Rule)',
      icon: 'exclamationmark.triangle.fill',
      sections: [
        { heading: 'Asymmetry', paragraphs: ['One half of the mole does not match the other half.'] },
        { heading: 'Border', paragraphs: ['Edges are irregular, ragged, or blurred, instead of smooth.'] },
        {
          heading: 'Color',
          paragraphs: ['Uneven color, or shades of brown, black, red, white, or blue within the same spot.'],
        },
        {
          heading: 'Diameter',
          paragraphs: ['Larger than about 6mm (roughly the size of a pencil eraser), though melanomas can be smaller.'],
        },
        {
          heading: 'Evolving',
          paragraphs: ['Any change in size, shape, color, or symptoms (itching, bleeding) over time.'],
        },
      ],
    },
  },
  {
    id: 'risk-factors',
    title: 'Risk Factors',
    subtitle: 'What raises your chances of developing skin cancer.',
    icon: 'figure.stand',
    kind: 'article',
    article: {
      id: 'risk-factors',
      title: 'Risk Factors',
      icon: 'figure.stand',
      sections: [
        {
          paragraphs: [
            'Anyone can develop skin cancer, but some factors make it more likely. Knowing yours can help you decide how often to self-check and when to see a dermatologist.',
          ],
        },
        {
          heading: 'Sun exposure',
          paragraphs: ['Frequent sunburns or long-term unprotected sun exposure, especially earlier in life.'],
        },
        {
          heading: 'Skin type',
          paragraphs: [
            'Fair skin, light hair, and eyes that burn easily are at higher risk, though anyone can develop skin cancer.',
          ],
        },
        {
          heading: 'Family history',
          paragraphs: ['A close relative with skin cancer, especially melanoma, raises your own risk.'],
        },
        {
          heading: 'Age and moles',
          paragraphs: ['Risk increases with age, and having many moles or atypical-looking moles is also a factor.'],
        },
      ],
    },
  },
  {
    id: 'prevention',
    title: 'UV Protection in the Philippines',
    subtitle: 'Sun safety tips for our year-round tropical climate.',
    icon: 'sun.max.fill',
    kind: 'article',
    article: {
      id: 'prevention',
      title: 'UV Protection in the Philippines',
      icon: 'sun.max.fill',
      sections: [
        {
          paragraphs: [
            "The Philippines sits close to the equator, so UV levels stay high year-round — not just during summer (March to May, when PAGASA regularly reports \"Extreme\" UV Index readings). Sun protection is a daily habit here, not a seasonal one.",
          ],
        },
        {
          heading: 'Check the UV Index',
          paragraphs: [
            'PAGASA publishes a daily UV Index forecast. From "Very High" to "Extreme" (8 and above, common on clear days), unprotected skin can burn in under 15 minutes — plan outdoor errands, commutes, or exercise around it when you can.',
          ],
        },
        {
          heading: 'Sunscreen that survives the humidity',
          paragraphs: [
            'Use broad-spectrum SPF 30+ daily, reapplied every two hours outdoors — more often if you are sweating or swimming, both common here. A water-resistant, lightweight formula sits better under our humidity than heavy creams.',
          ],
        },
        {
          heading: 'Everyday exposure adds up',
          paragraphs: [
            'Jeepney and tricycle rides, market trips, waiting for a ride, walking to school or work — a lot of daily sun exposure here happens outside of "beach days." Long sleeves, a wide-brimmed hat or cap, and sunglasses help on ordinary errands, not just vacations.',
          ],
        },
        {
          heading: 'Peak hours and cloudy days',
          paragraphs: [
            'UV rays are strongest between 10am and 4pm — seek shade when possible during this window. Overcast or rainy-season skies block heat but not most UV, so cloudy days still call for protection.',
          ],
        },
        {
          heading: 'Regular self-checks',
          paragraphs: [
            'Check your skin monthly for new or changing spots, using the ABCDE rule as a guide, and use SpotOn to track anything you want to keep an eye on.',
          ],
        },
      ],
    },
  },
  {
    id: 'when-to-see-a-doctor',
    title: 'When to See a Doctor',
    subtitle: 'Signs that mean it is time for a professional opinion.',
    icon: 'stethoscope',
    kind: 'article',
    article: {
      id: 'when-to-see-a-doctor',
      title: 'When to See a Doctor',
      icon: 'stethoscope',
      sections: [
        {
          heading: 'Red-flag symptoms',
          paragraphs: [
            'See a dermatologist if a spot matches any of the ABCDE warning signs, changes noticeably, bleeds, itches persistently, or simply looks different from your other moles.',
          ],
        },
        {
          heading: 'What to expect at a visit',
          paragraphs: [
            'A dermatologist will visually examine the spot, possibly with a dermatoscope, and may recommend a biopsy if anything looks concerning. Most visits are quick and non-invasive.',
          ],
        },
        {
          heading: 'Finding a clinic',
          paragraphs: [
            'The Directory tab lists nearby dermatology clinics and doctors offering online booking, so you can find and reach a professional directly from SpotOn.',
          ],
        },
      ],
    },
  },
  {
    id: 'questionnaire',
    title: 'SpotOn Questionnaire',
    subtitle: 'A guided self-check to help assess your risk.',
    icon: 'doc.text.fill',
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
