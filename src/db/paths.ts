/**
 * src/db/paths.ts — Cross-platform database path resolution
 *
 * Resolves the path to ~/.flightplan/flightplan.db on any OS.
 * Creates the directory if it doesn't exist.
 *
 * Why a dedicated file:
 *   Several modules need the DB path (connection.ts, cli.ts, status.ts).
 *   Centralizing it here means we change it in one place if it ever moves.
 *
 * Platform notes:
 *   Mac/Linux: uses HOME env var → /Users/andrew/.flightplan/flightplan.db
 *   Windows:   uses USERPROFILE env var → C:\Users\andrew\.flightplan\flightplan.db
 *   Fallback:  uses process.cwd() if neither env var exists (rare, but safe)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Directory and file names ──────────────────────────────────────────────────

/** The hidden folder in the user's home directory where Flightplan stores data. */
const FLIGHTPLAN_DIR_NAME = '.flightplan';

/** The SQLite database filename. */
const DB_FILENAME = 'flightplan.db';

// ─── Path resolution ──────────────────────────────────────────────────────────

/**
 * Returns the path to the ~/.flightplan directory.
 *
 * os.homedir() handles cross-platform home directory lookup:
 *   - Mac/Linux: reads $HOME
 *   - Windows:   reads USERPROFILE or HOMEDRIVE+HOMEPATH
 *   - Falls back to a reasonable path if none of those are set
 *
 * @returns Absolute path to the .flightplan directory
 */
export function getFlightplanDir(): string {
  return path.join(os.homedir(), FLIGHTPLAN_DIR_NAME);
}

/**
 * Returns the full path to flightplan.db.
 *
 * Example: /Users/andrew/.flightplan/flightplan.db
 *
 * @returns Absolute path to the SQLite database file
 */
export function getDbPath(): string {
  return path.join(getFlightplanDir(), DB_FILENAME);
}

// ─── Directory setup ──────────────────────────────────────────────────────────

/**
 * Creates the ~/.flightplan directory if it doesn't already exist.
 *
 * Safe to call multiple times — { recursive: true } makes it a no-op
 * if the directory already exists. This is called by:
 *   - cli.ts before opening the DB for init
 *   - connection.ts before opening the DB for any tool call
 *
 * Why not rely on better-sqlite3 to create it?
 * better-sqlite3 will throw if the *directory* doesn't exist, even though
 * it will create the *file*. We handle the directory ourselves to give
 * a cleaner error message if something goes wrong.
 */
export function ensureFlightplanDir(): void {
  const dir = getFlightplanDir();

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    // If we can't create the directory, nothing else will work.
    // Throw a human-readable error instead of a raw fs error.
    throw new Error(
      `Flightplan could not create its data directory at ${dir}.\n` +
      `Check that you have write access to your home directory.\n` +
      `Original error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
