/**
 * Patient-facing skin concerns - what a user searches the directory by.
 *
 * IDs mirror the server vocabulary (SpotOn-backend api/app/core/vocab.py CONCERNS,
 * migration 016) and are stored in facilities.concerns / doctors.concerns, so they
 * must never be renamed or translated. Labels are English source strings,
 * translated at the display site with t().
 */
export const CONCERNS = [
  { id: "skin_cancer_mole_check", label: "Mole / skin cancer check" },
  { id: "acne", label: "Acne" },
  { id: "eczema_rashes", label: "Eczema & rashes" },
  { id: "psoriasis", label: "Psoriasis" },
  { id: "pigmentation", label: "Dark spots & melasma" },
  { id: "infections", label: "Fungal & skin infections" },
  { id: "hair_scalp", label: "Hair & scalp" },
  { id: "nails", label: "Nails" },
  { id: "pediatric_derm", label: "Children's skin" },
  { id: "cosmetic", label: "Cosmetic" },
] as const;

export type ConcernId = (typeof CONCERNS)[number]["id"];

export const isConcern = (v: unknown): v is ConcernId =>
  typeof v === "string" && CONCERNS.some((c) => c.id === v);

/** Saturday + Sunday in the doctor_facility.schedule_days bitmask (Mon=1 .. Sun=64). */
export const WEEKEND_MASK = 32 | 64;

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "Tue, Thu, Sat" from a schedule_days bitmask; null when unknown. */
export function formatScheduleDays(mask: number | null | undefined): string | null {
  if (!mask) return null;
  const days = DAY_NAMES.filter((_, i) => mask & (1 << i));
  return days.length === 7 ? "Daily" : days.join(", ");
}
