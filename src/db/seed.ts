import { parseArgs } from "node:util";
import { loadDbPath } from "../config.js";
import { seedDatabase } from "./run-seed.js";

/** CLI behind `npm run db:seed`: creates the database and adds what is missing from the JSON files in raw-data/json/. */
function main(): void {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      "json-dir": { type: "string", default: "raw-data/json" },
    },
  });
  const report = seedDatabase({
    dbPath: loadDbPath(),
    jsonDir: values["json-dir"] ?? "raw-data/json",
    dryRun: values["dry-run"] ?? false,
  });
  process.stdout.write(report);
}

try {
  main();
} catch (err) {
  process.stderr.write(`db:seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
