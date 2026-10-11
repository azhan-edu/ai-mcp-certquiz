import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// TEST DATA ONLY. convert.mts runs on import, so tests execute it as a subprocess inside a
// temporary project layout that holds only what the script needs.

export const project = resolve(import.meta.dirname, "../../..");
const tsxLoader = pathToFileURL(join(project, "node_modules/tsx/dist/esm/index.mjs")).href;

/** Creates a temporary project root with the script, its imports and the given markdown. */
export function makeConvertRoot(notes: string, source: string): string {
  const root = mkdtempSync(join(tmpdir(), "certquiz-convert-"));
  const script = join(root, ".claude/skills/raw-data-to-json");
  mkdirSync(script, { recursive: true });
  mkdirSync(join(root, "src/db"), { recursive: true });
  mkdirSync(join(root, "src/lib"), { recursive: true });
  mkdirSync(join(root, "raw-data"));
  copyFileSync(
    join(project, ".claude/skills/raw-data-to-json/convert.mts"),
    join(script, "convert.mts"),
  );
  // The parser sits next to convert.mts, as in the real skill folder.
  copyFileSync(
    join(project, ".claude/skills/raw-data-to-json/parser.ts"),
    join(script, "parser.ts"),
  );
  for (const file of ["src/db/seed-json.ts", "src/db/schema.sql"]) {
    copyFileSync(join(project, file), join(root, file));
  }
  copyFileSync(join(project, "src/lib/errors.ts"), join(root, "src/lib/errors.ts"));
  // Without "type": "module" tsx loads the .ts files as CommonJS and cannot map `.js` imports.
  writeFileSync(join(root, "package.json"), '{ "type": "module" }\n');
  // seed-json.ts imports zod: make it resolvable from the temporary root.
  symlinkSync(join(project, "node_modules"), join(root, "node_modules"));
  writeFileSync(join(root, "raw-data/_shortNotes.md"), notes);
  writeFileSync(join(root, "raw-data/_shortNotesSource.md"), source);
  return root;
}

export function runConvert(root: string, ...args: string[]) {
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoader, ".claude/skills/raw-data-to-json/convert.mts", ...args],
    { cwd: root, encoding: "utf8", timeout: 60_000 },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
