import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AppError } from "../lib/errors.js";

export class DatabaseError extends AppError {}

export interface OpenOptions {
  readOnly?: boolean;
  /** Switch a writable file to WAL (default true). Dry runs pass false to leave the file as it is. */
  wal?: boolean;
}

/** schema.sql sits next to this file in src/ and, for the built package, in src/db/ two levels up. */
function readSchema(): string {
  for (const relative of ["./schema.sql", "../../src/db/schema.sql"]) {
    const url = new URL(relative, import.meta.url);
    if (existsSync(url)) return readFileSync(url, "utf8");
  }
  throw new DatabaseError("schema.sql not found");
}

/**
 * Opens the SQLite file. Writers (seed) create the directory and the file; the server passes
 * `readOnly: true` and gets a clear error when the database has not been seeded yet.
 */
export function openDatabase(path: string, options: OpenOptions = {}): DatabaseSync {
  if (path === ":memory:") {
    const db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys = ON");
    return db;
  }
  if (options.readOnly) {
    if (!existsSync(path)) {
      throw new DatabaseError(`Database not found at ${path}. Run "npm run db:seed" first.`);
    }
    const db = new DatabaseSync(path, { readOnly: true });
    let tables: unknown;
    try {
      tables = db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('topics', 'short_notes', 'questions', 'options', 'question_short_notes')",
        )
        .get()?.n;
    } catch {
      db.close();
      throw new DatabaseError(`${path} is not a SQLite database. Run "npm run db:seed" first.`);
    }
    if (tables !== 5) {
      db.close();
      throw new DatabaseError(`Database at ${path} has no schema. Run "npm run db:seed" first.`);
    }
    db.exec("PRAGMA foreign_keys = ON");
    return db;
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    // Two seeds at once wait for each other instead of failing at once.
    db.exec("PRAGMA busy_timeout = 5000");
    if (options.wal ?? true) db.exec("PRAGMA journal_mode = WAL");
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

/** Idempotent: schema.sql uses CREATE ... IF NOT EXISTS. */
export function applySchema(db: DatabaseSync): void {
  db.exec(readSchema());
}
