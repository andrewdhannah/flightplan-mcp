/**
 * src/db/meta.ts — flightplan_meta table helpers
 *
 * Provides typed access to the flightplan_meta key/value table.
 * Phase 2 migrations call getSchemaVersion() to determine which
 * migration steps to run.
 *
 * MIGRATION PATTERN (for Phase 2 authors):
 *   const version = getSchemaVersion(db);
 *   if (version < 2) {
 *     db.exec('ALTER TABLE usage_snapshots ADD COLUMN ...');
 *     setSchemaVersion(db, 2);
 *   }
 */

import type { Database } from 'better-sqlite3';

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Shape of a row from flightplan_meta */
interface MetaRow {
  key:   string;
  value: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the current schema version as a number.
 *
 * If the row doesn't exist (e.g. very old DB before meta table was added),
 * returns 0 so migrations know to start from the beginning.
 *
 * @param db - Open better-sqlite3 Database instance
 * @returns Schema version number (e.g. 1)
 */
export function getSchemaVersion(db: Database): number {
  const row = db.prepare(
    `SELECT key, value FROM flightplan_meta WHERE key = 'schema_version'`
  ).get() as MetaRow | undefined;

  if (!row) return 0;
  const parsed = parseInt(row.value, 10);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Sets the schema version in flightplan_meta.
 * Uses UPSERT — safe whether the row exists or not.
 *
 * @param db      - Open better-sqlite3 Database instance
 * @param version - New schema version number to write
 */
export function setSchemaVersion(db: Database, version: number): void {
  db.prepare(`
    INSERT INTO flightplan_meta (key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(version));
}

/**
 * Returns a raw meta value by key, or null if not found.
 * Use this for any future meta keys beyond schema_version.
 *
 * @param db  - Open better-sqlite3 Database instance
 * @param key - The meta key to retrieve
 */
export function getMetaValue(db: Database, key: string): string | null {
  const row = db.prepare(
    `SELECT key, value FROM flightplan_meta WHERE key = ?`
  ).get(key) as MetaRow | undefined;

  return row?.value ?? null;
}
