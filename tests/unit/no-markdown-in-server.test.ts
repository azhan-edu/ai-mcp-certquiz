import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Guard: raw-data/_shortNotes*.md belong to the raw-data-to-json skill alone. The server, db:seed
// and the import know only the JSON set in raw-data/json/ (loadSeedData -> SeedData ->
// importSeedData). Nothing under src/ may name the markdown files, the parser or the skill folder.

const root = resolve(import.meta.dirname, "../..");
const srcDir = join(root, "src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(ts|sql)$/.test(entry.name) ? [path] : [];
  });
}

const files = walk(srcDir).map((path) => ({
  rel: relative(root, path),
  text: readFileSync(path, "utf8"),
}));

const FORBIDDEN: [string, RegExp][] = [
  ["_shortNotes", /_shortNotes/],
  ["shortNotes.md", /shortNotes\.md/],
  ["parseRawData", /parseRawData/],
  ["raw-data.ts", /raw-data\.ts/],
  [".claude/", /\.claude\//],
];

describe("the server tree knows nothing about the markdown sources", () => {
  it("finds the source files to scan", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.rel.endsWith(".sql"))).toBe(true);
  });

  it.each(FORBIDDEN)("no file under src/ mentions %s", (_name, pattern) => {
    const hits = files.filter((f) => pattern.test(f.text)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  it.each(["seed", "run-seed", "import", "report"])(
    "src/db/%s.ts imports nothing from .claude/",
    (name) => {
      const file = files.find((f) => f.rel === join("src", "db", `${name}.ts`));
      expect(file).toBeDefined();
      const specifiers = [
        ...(file?.text ?? "").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g),
      ].map((m) => m[1]);
      expect(specifiers.length).toBeGreaterThan(0);
      expect(specifiers.filter((s) => s?.includes(".claude"))).toEqual([]);
    },
  );
});
