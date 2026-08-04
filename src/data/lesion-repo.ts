/**
 * SQLite repository for tracked lesions — the spot itself, as distinct from any one screening of it.
 *
 * The rollup columns (screening_count, first/last_screened_at, last_screening_id, last_tier) are
 * denormalized from `screenings` so the lesion list and the 3D body model render without a
 * per-row query. `screenings` is always authoritative; refreshLesionRollup() recomputes from it and
 * is safe to call at any time.
 *
 * Same conventions as screening-repo.ts: booleans as INTEGER 0/1, ISO timestamps as TEXT.
 */
import type { BodyMark, Lesion, TriageTier } from "../lib/triage/types";
import { getDb } from "./db";

type Row = {
  id: string;
  created_at: string;
  updated_at: string;
  label: string | null;
  mark_x: number | null;
  mark_y: number | null;
  mark_z: number | null;
  mark_region: string | null;
  mark_view: string | null;
  screening_count: number;
  first_screened_at: string | null;
  last_screened_at: string | null;
  last_screening_id: string | null;
  last_tier: string | null;
  archived: number;
  user_id: string | null;
};

/** The mark is only meaningful when every component survived; a partial row reads as "unmarked". */
function toMark(row: Pick<Row, "mark_x" | "mark_y" | "mark_z" | "mark_region" | "mark_view">): BodyMark | null {
  if (row.mark_x == null || row.mark_y == null || row.mark_z == null) return null;
  if (!row.mark_region || !row.mark_view) return null;
  return {
    point: [row.mark_x, row.mark_y, row.mark_z],
    region: row.mark_region,
    view: row.mark_view as "front" | "back",
  };
}

function toLesion(row: Row): Lesion {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    label: row.label,
    mark: toMark(row),
    screeningCount: row.screening_count,
    firstScreenedAt: row.first_screened_at,
    lastScreenedAt: row.last_screened_at,
    lastScreeningId: row.last_screening_id,
    lastTier: (row.last_tier as TriageTier | null) ?? null,
    archived: row.archived === 1,
    userId: row.user_id,
  };
}

export async function insertLesion(lesion: Lesion): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO lesions (
       id, created_at, updated_at, label, mark_x, mark_y, mark_z, mark_region, mark_view,
       screening_count, first_screened_at, last_screened_at, last_screening_id, last_tier,
       archived, user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    lesion.id,
    lesion.createdAt,
    lesion.updatedAt,
    lesion.label,
    lesion.mark?.point[0] ?? null,
    lesion.mark?.point[1] ?? null,
    lesion.mark?.point[2] ?? null,
    lesion.mark?.region ?? null,
    lesion.mark?.view ?? null,
    lesion.screeningCount,
    lesion.firstScreenedAt,
    lesion.lastScreenedAt,
    lesion.lastScreeningId,
    lesion.lastTier,
    lesion.archived ? 1 : 0,
    lesion.userId ?? null,
  );
}

export async function getLesion(id: string): Promise<Lesion | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>("SELECT * FROM lesions WHERE id = ?", id);
  return row ? toLesion(row) : null;
}

/** Active lesions first, most recently updated first. */
export async function listLesions(opts?: { includeArchived?: boolean }): Promise<Lesion[]> {
  const db = await getDb();
  const where = opts?.includeArchived ? "" : "WHERE archived = 0";
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM lesions ${where} ORDER BY archived ASC, updated_at DESC`,
  );
  return rows.map(toLesion);
}

export async function updateLesionLabel(id: string, label: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE lesions SET label = ?, updated_at = ? WHERE id = ?",
    label,
    new Date().toISOString(),
    id,
  );
}

export async function updateLesionMark(id: string, mark: BodyMark | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE lesions SET mark_x = ?, mark_y = ?, mark_z = ?, mark_region = ?, mark_view = ?,
                        updated_at = ? WHERE id = ?`,
    mark?.point[0] ?? null,
    mark?.point[1] ?? null,
    mark?.point[2] ?? null,
    mark?.region ?? null,
    mark?.view ?? null,
    new Date().toISOString(),
    id,
  );
}

export async function setLesionArchived(id: string, archived: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE lesions SET archived = ?, updated_at = ? WHERE id = ?",
    archived ? 1 : 0,
    new Date().toISOString(),
    id,
  );
}

/**
 * Recompute the rollups from `screenings`. Idempotent — safe to call after any insert, delete or
 * relink. A lesion with no screenings left keeps its row (the user may still be tracking the spot)
 * with a zeroed count.
 */
export async function refreshLesionRollup(id: string): Promise<Lesion | null> {
  const db = await getDb();
  const agg = await db.getFirstAsync<{
    n: number;
    first_at: string | null;
    last_at: string | null;
  }>(
    `SELECT COUNT(*) AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at
       FROM screenings WHERE lesion_id = ?`,
    id,
  );
  const latest = await db.getFirstAsync<{ id: string; tier: string }>(
    "SELECT id, tier FROM screenings WHERE lesion_id = ? ORDER BY created_at DESC LIMIT 1",
    id,
  );
  await db.runAsync(
    `UPDATE lesions SET screening_count = ?, first_screened_at = ?, last_screened_at = ?,
                        last_screening_id = ?, last_tier = ?, updated_at = ? WHERE id = ?`,
    agg?.n ?? 0,
    agg?.first_at ?? null,
    agg?.last_at ?? null,
    latest?.id ?? null,
    latest?.tier ?? null,
    // The lesion's own recency should track its screenings, not the moment of this recompute.
    agg?.last_at ?? new Date().toISOString(),
    id,
  );
  return getLesion(id);
}

/**
 * Delete the lesion and unlink its screenings — they survive as standalone history rather than
 * disappearing. Callers that also want the photos gone must delete the screenings explicitly.
 */
export async function deleteLesion(id: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE screenings SET lesion_id = NULL WHERE lesion_id = ?", id);
    await db.runAsync("DELETE FROM lesions WHERE id = ?", id);
  });
}
