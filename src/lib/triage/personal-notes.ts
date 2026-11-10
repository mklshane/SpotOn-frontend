import { t } from '../i18n/core';
import {
  selectPersonalNotes,
  type NoteAnswer,
  type NoteTrend,
  type PersonalNote,
  type PersonalNoteId,
} from './personal-notes-core';
import type { ScreeningRecord } from './types';

/**
 * Copy for the result screen's "For you" card. Selection rules live in personal-notes-core.ts
 * (pure, tested); this file only turns ids into text.
 *
 * Every body is a literal t() call so it translates at render time and test:i18n-coverage sees it.
 * Claims are general, well-established public-health statements (AAD / WHO / Skin Cancer
 * Foundation patient pages, same sources as the Learn hub) - nothing here is a per-user risk
 * estimate, and none of it changes the triage tier.
 */
export type RenderedNote = { id: PersonalNoteId; reason: string; text: string };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function render(note: PersonalNote): RenderedNote {
  const since = note.params?.since ? formatDate(note.params.since) : '';
  const uv = note.params?.uv ?? 0;
  const copy = (reason: string, text: string): RenderedNote => ({ id: note.id, reason, text });
  switch (note.id) {
    case 'trend_worse':
      return copy(
        t('Changed since your last check'),
        t('This spot looks more concerning than at your check on {{date}}. Tell the dermatologist that it has changed and when you first noticed.', { date: since }),
      );
    case 'trend_stable':
      return copy(
        t('Same as your last check'),
        t('This spot’s result is the same as on {{date}}. Keep checking it the same way, and scan again if anything changes.', { date: since }),
      );
    case 'history_personal':
      return copy(
        t('You’ve had skin cancer before'),
        t('People who have had skin cancer are more likely to get it again. Mention your history at your visit, and keep up regular full-skin checks with a dermatologist.'),
      );
    case 'history_family':
      return copy(
        t('Family history'),
        t('A family history of skin cancer, especially melanoma, can raise your risk. Tell the dermatologist which relative had it and what type.'),
      );
    case 'site_acral':
      return copy(
        t('Spot on a hand or foot'),
        t('In people with brown skin, including Filipinos, melanoma is more often found on the palms, soles, or under the nails. Check these areas too, and watch for a new dark streak under a nail.'),
      );
    case 'age_minor':
      return copy(
        t('Under 18'),
        t('Show this result to a parent or guardian and ask them to help you arrange any follow-up.'),
      );
    case 'age_50':
      return copy(
        t('Age 50 and over'),
        t('Skin cancer becomes more common with age. Ask a dermatologist about a full-skin check, not just this spot.'),
      );
    case 'sun_exposure':
      return copy(
        t('Frequent sun exposure'),
        t('Years of strong sun raise the risk of skin cancer. Use SPF 30+ sunscreen, a wide-brimmed hat, and shade around midday, even on cloudy days.'),
      );
    case 'site_head':
      return copy(
        t('Spot on the head or neck'),
        t('The face, ears, scalp, and neck get the most sun, and many basal and squamous cell carcinomas appear there. A hat and sunscreen help protect the area.'),
      );
    case 'skin_dark':
      return copy(
        t('Your skin type'),
        t('Skin cancer is less common in brown and darker skin, but it is often found later, when it is harder to treat. Don’t skip checks because of your skin tone.'),
      );
    case 'skin_light':
      return copy(
        t('Your skin type'),
        t('Lighter skin burns more easily, and sunburn raises skin-cancer risk. Protect this spot and the skin around it from the sun.'),
      );
    case 'site_back':
      return copy(
        t('Hard-to-see spot'),
        t('You can’t easily see this area yourself. Ask someone to help you check it each month, or take a photo from the same distance each time.'),
      );
    case 'uv_high':
      return copy(
        t('UV today'),
        t('UV is {{uv}} today, which is high. If you’re going out, use sunscreen and cover up, especially from 10 AM to 4 PM.', { uv }),
      );
  }
}

/** The profile fields the notes read. Every field optional: cached profiles may predate them. */
export type NoteProfile = {
  date_of_birth?: string | null;
  fitzpatrick_skin_type?: number | null;
  personal_skin_cancer_history?: NoteAnswer | null;
  family_skin_cancer_history?: NoteAnswer | null;
  high_sun_exposure?: boolean | null;
};

const ANSWER_RANK: Record<NoteAnswer, number> = { no: 0, unsure: 1, yes: 2 };

/**
 * Trend facts for `record` from the screenings of the same spot taken *before* it, so a past
 * result keeps the comparison it had on the day - a later rescan never rewrites it.
 */
export function trendBefore(record: ScreeningRecord, sameSpot: readonly ScreeningRecord[]): NoteTrend | null {
  const earlier = sameSpot
    .filter((s) => s.id !== record.id && s.createdAt < record.createdAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const previous = earlier[earlier.length - 1];
  if (!previous) return null;
  const answers = record.questionnaire.answers as Record<string, NoteAnswer>;
  const before = previous.questionnaire.answers as Record<string, NoteAnswer>;
  // Answers carried forward from the previous screening are a copy, not a fresh report.
  const answerWorsened = !record.answersCarried && Object.keys(answers).some(
    (id) => before[id] !== undefined && answers[id] !== undefined && ANSWER_RANK[answers[id]] > ANSWER_RANK[before[id]],
  );
  return {
    count: earlier.length + 1,
    previousAt: previous.createdAt,
    previousTier: previous.triage.tier,
    answerWorsened,
    modelChanged: previous.classification.modelVersion !== record.classification.modelVersion,
  };
}

export function personalNotesFor(
  record: ScreeningRecord,
  profile: NoteProfile | null | undefined,
  sameSpot: readonly ScreeningRecord[],
  uvIndex?: number | null,
): RenderedNote[] {
  return selectPersonalNotes({
    tier: record.triage.tier,
    region: record.mark?.region ?? null,
    dateOfBirth: profile?.date_of_birth,
    fitzpatrick: profile?.fitzpatrick_skin_type,
    personalHistory: profile?.personal_skin_cancer_history,
    familyHistory: profile?.family_skin_cancer_history,
    highSunExposure: profile?.high_sun_exposure,
    trend: trendBefore(record, sameSpot),
    uvIndex,
    at: record.createdAt,
  }).map(render);
}
