import type { ImportReport } from "./import.js";

/** Counts only, same shape as SeedSummary in seed-json.ts. */
export interface ReportSummary {
  notes: number;
  questions: number;
  questionBlocks: number;
  skipped: readonly { number: number; reason: string }[];
  warnings: readonly string[];
}

/** At most this many database question ids are listed in the text. */
const MAX_IDS = 50;

/** Counts and Qn numbers only: the output must never reveal which option is correct. */
export function formatReport(report: ImportReport, parsed: ReportSummary, dbPath: string): string {
  const { inserted, existing, changed } = report;
  const lines = [
    `${report.dryRun ? "DRY RUN (nothing written)" : "Imported"}: ${dbPath}`,
    `parsed: ${parsed.notes} notes, ${parsed.questions}/${parsed.questionBlocks} questions`,
    `inserted: ${inserted.topics} topics, ${inserted.notes} notes, ${inserted.questions} questions, ${inserted.options} options, ${inserted.links} links`,
    `already present: ${existing.topics} topics, ${existing.notes} notes, ${existing.questions} questions`,
  ];
  if (changed.questions.length > 0) {
    lines.push(
      `changed in source (not updated): questions ${changed.questions.map((n) => `Q${n}`).join(", ")}`,
    );
  }
  if (changed.notes.length > 0) {
    lines.push(`changed in source (not updated): ${changed.notes.length} notes`);
    for (const title of changed.notes) lines.push(`  ${title}`);
  }
  const { notInSource } = report;
  if (notInSource.questions.length > 0 || notInSource.topics > 0) {
    const ids = notInSource.questions.slice(0, MAX_IDS).join(", ");
    const more = notInSource.questions.length > MAX_IDS ? ", ..." : "";
    const questions = `${notInSource.questions.length} questions${ids ? ` (ids ${ids}${more})` : ""}`;
    lines.push(
      `in database but not in source: ${questions}, ${notInSource.topics} topics no source question uses (left untouched)`,
    );
  }
  if (parsed.skipped.length > 0) {
    lines.push(`skipped ${parsed.skipped.length} questions:`);
    for (const s of parsed.skipped) lines.push(`  Q${s.number}: ${s.reason}`);
  }
  if (parsed.warnings.length > 0) {
    lines.push(`warnings (${parsed.warnings.length}):`);
    for (const w of parsed.warnings) lines.push(`  ${w}`);
  }
  return `${lines.join("\n")}\n`;
}
