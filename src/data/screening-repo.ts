/**
 * SQLite repository for completed screenings. Every TPS component is stored in its
 * own column (audit requirement: individual scoring decisions must be reviewable);
 * structured blobs (answers, softmax distribution) are JSON TEXT, parsed on read —
 * same conventions as repositories.ts.
 */
import type {
  BodyMark,
  ClassificationOutput,
  Lesion,
  PerImageResult,
  QuestionnaireResponse,
  ScreeningImage,
  ScreeningRecord,
  TriageResult,
} from "../lib/triage/types";
import { getDb } from "./db";
import { toDisplayUri, toStoredUri } from "./image-paths";
import { getLesion, refreshLesionRollup } from "./lesion-repo";

type Row = {
  id: string;
  created_at: string;
  mark_x: number | null;
  mark_y: number | null;
  mark_z: number | null;
  mark_region: string | null;
  mark_view: string | null;
  image_uri: string;
  source: string;
  answers_json: string;
  probs_json: string;
  top_class: string;
  top_confidence: number;
  attempt: number;
  model_version: string;
  input_size: number;
  normalization: string;
  temperature: number;
  inference_ms: number;
  first_attempt_json: string | null;
  class_weight: number;
  cs: number;
  symptom_score_raw: number;
  symptom_score: number;
  tps: number;
  tier: string;
  safety_floor_applied: number;
  confidence_qualifier: number;
  malignant_score: number;
  malignant_gate_applied: number;
  scale_unstable: number;
  classifier_refined: number;
  detector_used: number;
  lesion_id: string | null;
  user_id: string | null;
  followup_of: string | null;
  answers_carried: number | null;
  answers_source_id: string | null;
  images_json: string | null;
  image_count: number | null;
  per_image_json: string | null;
  image_disagreement: number | null;
  aggregate_method: string | null;
};

/**
 * listScreenings() skips rows whose parse throws — which for a NEW column would silently delete
 * history from the user's view. Every optional blob therefore parses through this, never bare.
 */
function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn("[screenings] unreadable JSON column, using fallback", e);
    return fallback;
  }
}

/** Pre-v11 rows have one photo and no images_json; present them as a one-image set. */
function legacyImage(row: Row): ScreeningImage {
  return {
    uri: toDisplayUri(row.image_uri),
    index: 0,
    source: row.source as "camera" | "gallery",
    qualityPassed: true,
  };
}

function toRecord(row: Row): ScreeningRecord {
  const questionnaire = JSON.parse(row.answers_json) as QuestionnaireResponse;
  const probs = JSON.parse(row.probs_json) as ClassificationOutput["probs"];
  const perImage = safeParse<PerImageResult[] | undefined>(row.per_image_json, undefined);
  const classification: ClassificationOutput = {
    imageCount: row.image_count ?? 1,
    aggregate: (row.aggregate_method as ClassificationOutput["aggregate"]) ?? "single",
    perImage,
    imageDisagreement: row.image_disagreement === 1,
    probs,
    topClass: row.top_class as ClassificationOutput["topClass"],
    topConfidence: row.top_confidence,
    attempt: row.attempt as 1 | 2,
    modelVersion: row.model_version,
    inputSize: row.input_size,
    normalization: row.normalization,
    temperature: row.temperature,
    inferenceMs: row.inference_ms,
    scaleUnstable: row.scale_unstable === 1,
    refined: row.classifier_refined === 1,
    detectorUsed: row.detector_used === 1,
  };
  const triage: TriageResult = {
    classWeight: row.class_weight,
    topConfidence: row.top_confidence,
    cs: row.cs,
    symptomScoreRaw: row.symptom_score_raw,
    symptomScore: row.symptom_score,
    tps: row.tps,
    tier: row.tier as TriageResult["tier"],
    safetyFloorApplied: row.safety_floor_applied === 1,
    confidenceQualifier: row.confidence_qualifier === 1,
    malignantScore: row.malignant_score ?? 0,
    malignantGateApplied: row.malignant_gate_applied === 1,
  };
  return {
    id: row.id,
    createdAt: row.created_at,
    mark:
      row.mark_x != null && row.mark_y != null && row.mark_z != null && row.mark_region && row.mark_view
        ? {
            point: [row.mark_x, row.mark_y, row.mark_z],
            region: row.mark_region,
            view: row.mark_view as "front" | "back",
          }
        : null,
    // Both photo paths resolve against the CURRENT container here — see image-paths.ts. v14
    // rewrote image_uri to the relative form, but images_json is left as written and normalized
    // on every read instead, so rows from any prior install render without a blob rewrite.
    imageUri: toDisplayUri(row.image_uri),
    images: safeParse<ScreeningImage[]>(row.images_json, [legacyImage(row)]).map((img) => ({
      ...img,
      uri: toDisplayUri(img.uri),
    })),
    source: row.source as "camera" | "gallery",
    questionnaire,
    classification,
    firstAttempt: row.first_attempt_json
      ? (JSON.parse(row.first_attempt_json) as ClassificationOutput)
      : undefined,
    triage,
    lesionId: row.lesion_id ?? null,
    followUpOf: row.followup_of ?? undefined,
    answersCarried: row.answers_carried === 1,
    answersSourceId: row.answers_source_id ?? undefined,
    userId: row.user_id ?? null,
  };
}

export async function insertScreening(record: ScreeningRecord): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO screenings (
       id, created_at, mark_x, mark_y, mark_z, mark_region, mark_view, image_uri, source,
       answers_json, probs_json, top_class, top_confidence, attempt, model_version,
       input_size, normalization, temperature, inference_ms, first_attempt_json,
       class_weight, cs, symptom_score_raw, symptom_score, tps, tier,
       safety_floor_applied, confidence_qualifier, malignant_score, malignant_gate_applied,
       scale_unstable, classifier_refined, detector_used,
       lesion_id, user_id, followup_of, answers_carried, answers_source_id,
       images_json, image_count, per_image_json, image_disagreement, aggregate_method
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.id,
    record.createdAt,
    record.mark?.point[0] ?? null,
    record.mark?.point[1] ?? null,
    record.mark?.point[2] ?? null,
    record.mark?.region ?? null,
    record.mark?.view ?? null,
    toStoredUri(record.imageUri),
    record.source,
    JSON.stringify(record.questionnaire),
    JSON.stringify(record.classification.probs),
    record.classification.topClass,
    record.classification.topConfidence,
    record.classification.attempt,
    record.classification.modelVersion,
    record.classification.inputSize,
    record.classification.normalization,
    record.classification.temperature,
    record.classification.inferenceMs,
    record.firstAttempt ? JSON.stringify(record.firstAttempt) : null,
    record.triage.classWeight,
    record.triage.cs,
    record.triage.symptomScoreRaw,
    record.triage.symptomScore,
    record.triage.tps,
    record.triage.tier,
    record.triage.safetyFloorApplied ? 1 : 0,
    record.triage.confidenceQualifier ? 1 : 0,
    record.triage.malignantScore,
    record.triage.malignantGateApplied ? 1 : 0,
    record.classification.scaleUnstable ? 1 : 0,
    record.classification.refined ? 1 : 0,
    record.classification.detectorUsed ? 1 : 0,
    record.lesionId ?? null,
    record.userId ?? null,
    record.followUpOf ?? null,
    record.answersCarried ? 1 : 0,
    record.answersSourceId ?? null,
    JSON.stringify(record.images.map((img) => ({ ...img, uri: toStoredUri(img.uri) }))),
    record.classification.imageCount ?? 1,
    record.classification.perImage ? JSON.stringify(record.classification.perImage) : null,
    record.classification.imageDisagreement ? 1 : 0,
    record.classification.aggregate ?? "single",
  );
}

/** A lesion's screenings oldest-first — the order the timeline and trend summary read them in. */
export async function listScreeningsForLesion(lesionId: string): Promise<ScreeningRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    "SELECT * FROM screenings WHERE lesion_id = ? ORDER BY created_at ASC",
    lesionId,
  );
  const out: ScreeningRecord[] = [];
  for (const row of rows) {
    try {
      out.push(toRecord(row));
    } catch (e) {
      console.warn("[screenings] skipping unreadable row", row.id, e);
    }
  }
  return out;
}

export async function getLatestScreeningForLesion(
  lesionId: string,
): Promise<ScreeningRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>(
    "SELECT * FROM screenings WHERE lesion_id = ? ORDER BY created_at DESC LIMIT 1",
    lesionId,
  );
  return row ? toRecord(row) : null;
}

/** Attach a screening to a lesion (or detach with null), refreshing both sides' rollups. */
export async function setScreeningLesion(
  screeningId: string,
  lesionId: string | null,
): Promise<void> {
  const db = await getDb();
  const prev = await db.getFirstAsync<{ lesion_id: string | null }>(
    "SELECT lesion_id FROM screenings WHERE id = ?",
    screeningId,
  );
  await db.runAsync("UPDATE screenings SET lesion_id = ? WHERE id = ?", lesionId, screeningId);
  if (prev?.lesion_id && prev.lesion_id !== lesionId) await refreshLesionRollup(prev.lesion_id);
  if (lesionId) await refreshLesionRollup(lesionId);
}

export type LesionSeed = {
  id: string;
  mark: BodyMark | null;
  label?: string | null;
  userId?: string | null;
};

/**
 * Insert a screening and upsert its lesion together, then return the refreshed lesion.
 *
 * The two writes must not be separable: a screening whose lesion row is missing is unreachable from
 * every browse surface, and a lesion whose rollup lags shows a wrong "last checked" date. An
 * existing lesion keeps its label and mark — a follow-up records a new observation, it does not
 * redefine the spot.
 */
export async function insertScreeningLinked(
  record: ScreeningRecord,
  seed: LesionSeed,
): Promise<Lesion> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR IGNORE INTO lesions
         (id, created_at, updated_at, label, mark_x, mark_y, mark_z, mark_region, mark_view,
          screening_count, first_screened_at, last_screened_at, last_screening_id, last_tier,
          archived, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, 0, ?)`,
      seed.id,
      record.createdAt,
      now,
      seed.label ?? null,
      seed.mark?.point[0] ?? null,
      seed.mark?.point[1] ?? null,
      seed.mark?.point[2] ?? null,
      seed.mark?.region ?? null,
      seed.mark?.view ?? null,
      seed.userId ?? null,
    );
    await insertScreening({ ...record, lesionId: seed.id });
  });
  // Outside the transaction: the rollup is derived state, and a failure here must not lose the scan.
  const lesion = await refreshLesionRollup(seed.id);
  return lesion ?? (await getLesion(seed.id))!;
}

export async function getScreening(id: string): Promise<ScreeningRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>("SELECT * FROM screenings WHERE id = ?", id);
  return row ? toRecord(row) : null;
}

export async function listScreenings(): Promise<ScreeningRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>("SELECT * FROM screenings ORDER BY created_at DESC");
  const out: ScreeningRecord[] = [];
  for (const row of rows) {
    try {
      out.push(toRecord(row));
    } catch (e) {
      console.warn("[screenings] skipping unreadable row", row.id, e);
    }
  }
  return out;
}

/**
 * Delete a screening and the photo files it owns.
 *
 * The file cleanup matters more than it used to: a screening can now hold up to three ~200-400 KB
 * images, and without this they stay in documentDirectory forever with no row pointing at them.
 * Only files under the app's own screenings/ directory are removed — a record whose image copy
 * failed still points at the original cache URI, which is not ours to delete.
 */
export async function deleteScreening(id: string): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ lesion_id: string | null; image_uri: string; images_json: string | null }>(
    "SELECT lesion_id, image_uri, images_json FROM screenings WHERE id = ?",
    id,
  );
  await db.runAsync("DELETE FROM screenings WHERE id = ?", id);
  if (!row) return;
  const images = safeParse<{ uri: string }[]>(row.images_json, [{ uri: row.image_uri }]);
  // Raw columns, so these are whatever the writing install stored — relative (v14+), or absolute
  // under a container that may no longer exist. Resolve before the ownership test below.
  await deleteImageFiles(images.map((i) => toDisplayUri(i.uri)));
  if (row.lesion_id) await refreshLesionRollup(row.lesion_id);
}

/** Best-effort unlink of owned photo files. A failure here must never fail the delete. */
async function deleteImageFiles(uris: readonly string[]): Promise<void> {
  const FileSystem = await import("expo-file-system/legacy");
  const owned = `${FileSystem.documentDirectory ?? ""}screenings/`;
  for (const uri of uris) {
    if (!uri.startsWith(owned)) continue;
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (e) {
      console.warn("[screenings] could not remove image", uri, e);
    }
  }
}
