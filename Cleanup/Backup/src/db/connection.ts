/**
 * src/db/connection.ts — Database singleton
 *
 * Opens flightplan.db exactly once per process, applies the schema,
 * and returns the same connection on every subsequent call.
 *
 * Why a singleton:
 *   better-sqlite3 is synchronous and holds a file lock. Opening multiple
 *   connections to the same file from the same process causes lock conflicts.
 *   The singleton pattern prevents that entirely.
 *
 * Usage (from any other file):
 *   import { openDb } from './db/connection.js';
 *   const db = openDb();   // fast after first call — just returns cached instance
 *   const row = db.prepare('SELECT ...').get();
 *
 * Note on .js extension:
 *   TypeScript ESM requires .js extensions in import paths even when the
 *   source file is .ts. This is a TypeScript quirk, not a bug. The compiled
 *   output will be .js and the import resolves correctly.
 */

import Database from 'better-sqlite3';
import { getDbPath, ensureFlightplanDir } from './paths.js';
import { SCHEMA_STATEMENTS } from './schema.js';

// ─── Singleton instance ────────────────────────────────────────────────────────

/**
 * The cached database connection.
 * null until first call to openDb().
 * Never closed during normal operation — lives for the process lifetime.
 */
let _db: Database.Database | null = null;

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the open database connection, creating it on first call.
 *
 * First call:
 *   1. Ensures ~/.flightplan/ directory exists.
 *   2. Opens (or creates) flightplan.db via better-sqlite3.
 *   3. Enables WAL mode for better concurrent read performance.
 *   4. Applies the schema (all IF NOT EXISTS — safe to re-run).
 *   5. Caches the connection in _db.
 *
 * Subsequent calls:
 *   Returns the cached _db immediately. No file I/O.
 *
 * @returns An open better-sqlite3 Database instance
 * @throws If the DB file can't be created or the schema fails to apply
 */
export function openDb(): Database.Database {
  // Return cached connection if already open.
  if (_db) return _db;

  // Ensure the directory exists before better-sqlite3 tries to open the file.
  // better-sqlite3 creates the file but not the parent directory.
  ensureFlightplanDir();

  const dbPath = getDbPath();

  // Open (or create) the database file.
  // { verbose: undefined } in production — set to console.log for SQL debugging.
  _db = new Database(dbPath);

  // WAL (Write-Ahead Logging) mode:
  //   - Allows concurrent reads while a write is happening.
  //   - Better performance for our access pattern (frequent reads, infrequent writes).
  //   - Persists across connections — only needs to be set once per DB file.
  _db.pragma('journal_mode = WAL');

  // Apply all schema statements in a single transaction.
  // If any statement fails, none of them land — DB stays in a consistent state.
  applySchema(_db);

  return _db;
}

// ─── Schema application ────────────────────────────────────────────────────────

/**
 * Runs all schema DDL statements inside a transaction.
 * Called once on first DB open.
 *
 * Why a transaction: if the DB file is new and schema application fails
 * halfway through (disk full, permissions, etc.), we don't want a partially
 * initialized DB. The transaction ensures it's all-or-nothing.
 *
 * All statements use CREATE TABLE IF NOT EXISTS, so this is safe to call
 * on an existing DB without dropping data.
 *
 * @param db - An open better-sqlite3 Database instance
 */
function applySchema(db: Database.Database): void {
  const initTransaction = db.transaction(() => {
    for (const sql of SCHEMA_STATEMENTS) {
      db.exec(sql);
    }
  });

  try {
    initTransaction();
  } catch (err) {
    throw new Error(
      `Flightplan could not initialize the database schema.\n` +
      `DB path: ${getDbPath()}\n` +
      `Original error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
