/**
 * Saved clinics and doctors ("My dermatologists") - per account, this device only.
 *
 * Rows carry a name/subtitle snapshot so a saved place stays readable even if the directory later
 * drops it (the directory sync's sweep never touches this table). Every read and write is scoped
 * to the signed-in account; with no account there is nothing to read and writes throw, the same
 * rule as screening history.
 */
import { getActiveAccountId } from "../lib/account-scope";
import { getDb, withDbTransaction } from "./db";

export type SavedKind = "facility" | "doctor";

export interface SavedItem {
  kind: SavedKind;
  itemId: string;
  name: string;
  subtitle: string | null;
  savedAt: string;
  /** False when the directory no longer lists it (removed or hidden since it was saved). */
  listed: boolean;
}

type Row = {
  kind: SavedKind;
  item_id: string;
  name: string;
  subtitle: string | null;
  saved_at: string;
  listed: number;
};

function requireAccount(userId?: string | null): string {
  const id = userId ?? getActiveAccountId();
  if (!id) throw new Error("Cannot save to My dermatologists while signed out");
  return id;
}

/** Saved items for the signed-in account, newest first. Empty when signed out. */
export async function listSaved(userId?: string | null): Promise<SavedItem[]> {
  const id = userId ?? getActiveAccountId();
  if (!id) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    `SELECT s.kind, s.item_id, s.name, s.subtitle, s.saved_at,
            CASE s.kind
              WHEN 'facility' THEN EXISTS (SELECT 1 FROM facilities f WHERE f.id = s.item_id
                                             AND (f.status IS NULL OR f.status != 'excluded'))
              ELSE EXISTS (SELECT 1 FROM doctors d WHERE d.id = s.item_id
                             AND (d.status IS NULL OR d.status != 'excluded'))
            END AS listed
       FROM saved_items s
      WHERE s.user_id = ?
      ORDER BY s.saved_at DESC`,
    id,
  );
  return rows.map((r) => ({
    kind: r.kind,
    itemId: r.item_id,
    name: r.name,
    subtitle: r.subtitle,
    savedAt: r.saved_at,
    listed: r.listed === 1,
  }));
}

export async function isSaved(kind: SavedKind, itemId: string, userId?: string | null): Promise<boolean> {
  const id = userId ?? getActiveAccountId();
  if (!id) return false;
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM saved_items WHERE user_id = ? AND kind = ? AND item_id = ?",
    [id, kind, itemId],
  );
  return (row?.n ?? 0) > 0;
}

/** Save, or remove when already saved. Returns the new state. */
export async function toggleSaved(
  item: { kind: SavedKind; itemId: string; name: string; subtitle?: string | null },
  userId?: string | null,
): Promise<boolean> {
  const id = requireAccount(userId);
  const db = await getDb();
  let saved = false;
  await withDbTransaction(async () => {
    const existing = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM saved_items WHERE user_id = ? AND kind = ? AND item_id = ?",
      [id, item.kind, item.itemId],
    );
    if ((existing?.n ?? 0) > 0) {
      await db.runAsync("DELETE FROM saved_items WHERE user_id = ? AND kind = ? AND item_id = ?", [
        id,
        item.kind,
        item.itemId,
      ]);
      saved = false;
    } else {
      await db.runAsync(
        `INSERT INTO saved_items (user_id, kind, item_id, name, subtitle, saved_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, item.kind, item.itemId, item.name, item.subtitle ?? null, new Date().toISOString()],
      );
      saved = true;
    }
  });
  return saved;
}

export async function removeSaved(kind: SavedKind, itemId: string, userId?: string | null): Promise<void> {
  const id = requireAccount(userId);
  const db = await getDb();
  await withDbTransaction(async () => {
    await db.runAsync("DELETE FROM saved_items WHERE user_id = ? AND kind = ? AND item_id = ?", [id, kind, itemId]);
  });
}
