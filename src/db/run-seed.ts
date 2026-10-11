import { closeSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./connection.js";
import { type ImportReport, importSeedData } from "./import.js";
import { formatReport } from "./report.js";
import { loadSeedData } from "./seed-json.js";

export interface SeedOptions {
  dbPath: string;
  jsonDir: string;
  dryRun: boolean;
}

/** Reads the JSON files in jsonDir (before any DB file is touched), imports into dbPath and returns the text report (counts and Qn only). */
export function seedDatabase({ dbPath, jsonDir, dryRun }: SeedOptions): string {
  const { data, summary } = loadSeedData(jsonDir);

  // A dry run must not create the file: use a scratch database when none exists yet.
  const scratch = dryRun && !existsSync(dbPath);

  // Claim a missing file exclusively, so that only the process that created it may remove it.
  let created = false;
  if (!dryRun && !existsSync(dbPath)) {
    mkdirSync(dirname(dbPath), { recursive: true });
    try {
      closeSync(openSync(dbPath, "wx"));
      created = true;
    } catch (err) {
      const exists = err instanceof Error && "code" in err && err.code === "EEXIST";
      if (!exists) throw err;
    }
  }

  let db: DatabaseSync | undefined;
  let report: ImportReport;
  try {
    db = scratch ? openDatabase(":memory:") : openDatabase(dbPath, { wal: !dryRun });
    report = importSeedData(db, data, { dryRun });
  } catch (err) {
    try {
      db?.close();
    } finally {
      // A failed first import must not leave an empty file that the server would try to open.
      if (created) {
        for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
      }
    }
    throw err;
  }
  db.close();
  return formatReport(report, summary, dbPath);
}
