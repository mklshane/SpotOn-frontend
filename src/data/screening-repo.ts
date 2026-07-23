/**
 * SQLite repository for completed screenings. Every TPS component is stored in its
 * own column (audit requirement: individual scoring decisions must be reviewable);
 * structured blobs (answers, softmax distribution) are JSON TEXT, parsed on read —
 * same conventions as repositories.ts.
 */
import type {
  ClassificationOutput,
  QuestionnaireResponse,
  ScreeningRecord,
  TriageResult,
} from "../lib/triage/types";
import { getDb } from "./db";

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
};

function toRecord(row: Row): ScreeningRecord {
  const questionnaire = JSON.parse(row.answers_json) as QuestionnaireResponse;
  const probs = JSON.parse(row.probs_json) as ClassificationOutput["probs"];
  const classification: ClassificationOutput = {
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
    imageUri: row.image_uri,
    source: row.source as "camera" | "gallery",
    questionnaire,
    classification,
    firstAttempt: row.first_attempt_json
      ? (JSON.parse(row.first_attempt_json) as ClassificationOutput)
      : undefined,
    triage,
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
       scale_unstable, classifier_refined
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.id,
    record.createdAt,
    record.mark?.point[0] ?? null,
    record.mark?.point[1] ?? null,
    record.mark?.point[2] ?? null,
    record.mark?.region ?? null,
    record.mark?.view ?? null,
    record.imageUri,
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
  );
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

export async function deleteScreening(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM screenings WHERE id = ?", id);
}
