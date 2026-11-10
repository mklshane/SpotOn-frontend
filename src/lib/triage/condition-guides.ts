import type { LesionClass } from "./types";

type ConditionGuide = {
  priorityAction: string;
  description: string;
  signs: string;
  factors: string;
  nextSteps: string;
  consult: string;
  reminder: string;
};

const CONDITION_GUIDES: Record<LesionClass, ConditionGuide> = {
  // https://www.aad.org/public/diseases/skin-cancer/types/common/melanoma/symptoms and /causes
  MEL: {
    priorityAction:
      "Bring earlier photos of the spot so the dermatologist can compare its size, shape, and color. If a mole is changing or a new spot looks unlike your others, contact a dermatologist promptly.",
    description:
      "Melanoma starts in the cells that give skin its color and can spread to other parts of the body.",
    signs:
      "A new spot or a mole with uneven halves, irregular edges, several colors, or a change over time.",
    factors:
      "UV exposure and a personal or family history of melanoma can raise risk.",
    nextSteps:
      "Book an in-person skin exam promptly. Bring earlier photos if you have them and note when the spot began changing.",
    consult:
      "Seek prompt evaluation for a changing mole, a spot unlike your other moles, or a new unexplained dark streak under a nail.",
    reminder:
      "Melanoma can be smaller than 6 mm and can appear on the palms, soles, or under a nail.",
  },
  // https://www.aad.org/public/diseases/skin-cancer/squamous-cell-carcinoma/
  SCC: {
    priorityAction:
      "Point out any rough or scaly patch that persists or a sore that keeps crusting without healing. Ask for an earlier appointment if it grows quickly or starts bleeding repeatedly.",
    description:
      "Squamous cell carcinoma starts in cells in the outer layer of the skin.",
    signs:
      "A rough, scaly patch, a firm raised bump, or a sore that crusts, bleeds, or feels tender.",
    factors:
      "Long-term UV exposure and a weakened immune system can raise risk.",
    nextSteps:
      "Arrange a skin exam promptly. Tell the clinician if the growth has enlarged quickly or you take medicines that suppress your immune system.",
    consult:
      "Get a rapidly growing, tender, or repeatedly bleeding growth checked promptly. Mention if it is on your lip or ear.",
    reminder:
      "A crust may come off and form again. A spot that keeps crusting or bleeding still needs an exam.",
  },
  // https://www.aad.org/public/diseases/skin-cancer/basal-cell-carcinoma/
  BCC: {
    priorityAction:
      "Tell the dermatologist if a shiny bump is slowly growing or a sore closes and then opens again. A sore that keeps coming back needs assessment even if it is painless. Ask to be seen sooner if it starts bleeding repeatedly.",
    description:
      "Basal cell carcinoma starts in basal cells in the outer layer of the skin and can damage nearby tissue as it grows.",
    signs:
      "A shiny or waxy bump, a flat scar-like patch, or a sore that closes and opens again. The spot can be brown or black.",
    factors:
      "UV damage can build up over years. Basal cell carcinoma often appears on areas that get a lot of sun, such as the face and neck.",
    nextSteps:
      "Arrange a skin exam. If the spot scabs, bleeds, or reopens, tell the clinician how often it happens.",
    consult:
      "Have a sore that keeps reopening or a slowly growing shiny bump checked, even if it feels painless.",
    reminder:
      "A spot may look healed between episodes of bleeding. Mention that cycle at your visit.",
  },
  // https://dermnetnz.org/topics/benign-skin-lesions and https://www.aad.org/public/diseases/a-z/moles-treatment
  BENIGN: {
    priorityAction:
      "Keep a dated photo to help you notice changes in a familiar spot. A benign-looking spot can still need assessment. Contact a dermatologist promptly if it changes shape or color, starts itching, or bleeds.",
    description:
      "This broad category includes noncancerous growths such as ordinary moles and seborrheic keratoses.",
    signs:
      "An ordinary mole may be round and evenly colored. A seborrheic keratosis can look waxy or like it is stuck onto the skin.",
    factors:
      "Moles form when pigment cells grow in clusters. Some other benign growths become more common with age.",
    nextSteps:
      "If the spot is longstanding and stable, keep a dated photo for comparison. Follow the screening priority above for your result.",
    consult:
      "Have it checked if a familiar spot changes, starts bleeding or itching, or looks different from your other moles.",
    reminder:
      "Skin cancers can resemble harmless growths. Avoid home mole-removal products, which can scar the skin and delay evaluation.",
  },
  // https://www.aad.org/public/diseases/skin-cancer/actinic-keratosis-causes
  OTHER: {
    priorityAction:
      "The scan cannot tell what kind of spot this is. Have a persistent rough patch or a sore that does not heal examined in person. Contact a dermatologist promptly if the spot grows or begins to bleed.",
    description:
      "Other is a broad model category. The scan cannot identify a specific condition within it.",
    signs:
      "There is no single set of signs for this result. For example, a rough patch that feels like sandpaper can occur with actinic keratosis, a precancerous growth.",
    factors:
      "Factors depend on the actual condition. Long-term UV exposure contributes to actinic keratosis, one possible explanation for a persistent rough patch.",
    nextSteps:
      "Arrange an in-person exam to identify the spot. Tell the clinician whether it feels rough, comes and goes, or has changed.",
    consult:
      "Have a persistent rough patch or a sore that fails to heal checked. Seek prompt assessment if the spot grows or bleeds.",
    reminder:
      "Other can include different kinds of growths. The label alone cannot tell whether the spot is harmless or needs treatment.",
  },
};

export function getConditionGuide(label: string): ConditionGuide | undefined {
  if (Object.hasOwn(CONDITION_GUIDES, label)) {
    return CONDITION_GUIDES[label as LesionClass];
  }
}
