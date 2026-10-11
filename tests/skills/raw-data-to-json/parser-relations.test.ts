import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRawData } from "../../../.claude/skills/raw-data-to-json/parser.ts";

// TEST DATA ONLY: synthetic fixtures, not real exam content.
// Every option label is a unique marker so that a leak is detectable.

/** No heading sits on this line, so a link resolves by title only, never by the line fallback. */
const LINK_TARGET = "_shortNotes.md#L9999";

const ref = (n: number) => `[Q${n}](_shortNotesSource.md#q${n})`;

/** `rel` maps a note title to the question numbers listed in its `Вопросы:` line. */
function notesMd(rel: Record<string, number[]>): string {
  return Object.entries(rel)
    .map(([title, qs]) => {
      const refs = qs.length > 0 ? `\n- Вопросы: ${qs.map(ref).join(", ")}` : "";
      return `### ${title}\n- Test body of ${title}.${refs}\n`;
    })
    .join("\n");
}

interface Block {
  n: number;
  /** Titles on the `Заметки:` line; empty means `Заметки: —`. */
  links: string[];
  official?: boolean;
  answer?: string;
}

function sourceMd(blocks: Block[]): string {
  const body = blocks
    .map((b) => {
      const links =
        b.links.length > 0 ? b.links.map((t) => `[${t}](${LINK_TARGET})`).join(", ") : "—";
      const official = b.official === false ? "" : `\n> Official: Correct. Explanation Q${b.n}.\n`;
      return `### Q${b.n}\nЗаметки: ${links}\n\nTEST question ${b.n}?\n\n- A) MARKER-WRONG-${b.n}\n- B) MARKER-RIGHT-${b.n}\n\n**Ответ: ${b.answer ?? "B"}**\n${official}`;
    })
    .join("\n");
  return `## 1. Alpha\n\n${body}`;
}

describe("parser: question-note relations", () => {
  const parsed = parseRawData(
    notesMd({
      "Note A": [1],
      "Note B": [1, 2],
      "Note C": [3],
      "Note D": [9],
      "Note Z": [6],
      "Shared note": [111, 112],
    }),
    sourceMd([
      { n: 1, links: ["Note B", "Note A", "Note B"], official: false },
      { n: 2, links: [] },
      { n: 3, links: [] },
      { n: 4, links: ["Note D"] },
      { n: 5, links: [] },
      { n: 6, links: ["Note Z"], answer: "D" },
      { n: 111, links: ["Shared note"] },
      { n: 112, links: ["Shared note"] },
    ]),
  );
  const titles = (n: number) => parsed.questions.find((q) => q.number === n)?.noteTitles;

  it("keeps several notes of one question in source order, without duplicates", () => {
    expect(titles(1)).toEqual(["Note B", "Note A"]);
  });

  it("takes the notes-side relation when the block says `Заметки: —`", () => {
    expect(titles(2)).toEqual(["Note B"]);
    expect(titles(3)).toEqual(["Note C"]);
  });

  it("warns about a relation known from the notes side only", () => {
    expect(parsed.warnings).toContain(`Q2: related to note "Note B" only from the notes side`);
    expect(parsed.warnings).toContain(`Q3: related to note "Note C" only from the notes side`);
  });

  it("warns about a relation known from the question side only, and keeps it", () => {
    expect(parsed.warnings).toContain(`Q4: related to note "Note D" only from the question side`);
    expect(titles(4)).toEqual(["Note D"]);
  });

  it("does not warn about a relation listed on both sides", () => {
    expect(parsed.warnings.filter((w) => w.startsWith("Q1:"))).toEqual([]);
  });

  it("gives an empty list for `Заметки: —` with no back-link", () => {
    expect(titles(5)).toEqual([]);
  });

  it("a skipped question contributes no relations and no relation warnings", () => {
    expect(parsed.skipped.map((s) => s.number)).toEqual([6]);
    expect(titles(6)).toBeUndefined();
    expect(parsed.warnings.filter((w) => w.startsWith("Q6:"))).toEqual([]);
  });

  it("the explanation fallback uses the first linked note", () => {
    const q1 = parsed.questions.find((q) => q.number === 1);
    expect(q1?.explanation).toContain("Test body of Note B.");
    expect(q1?.explanation).not.toContain("Note A");
  });

  it("one note listed for two questions that both link back relates to both, silently", () => {
    expect(titles(111)).toEqual(["Shared note"]);
    expect(titles(112)).toEqual(["Shared note"]);
    expect(parsed.warnings.filter((w) => /Q11[12]:/.test(w))).toEqual([]);
  });
});

/** A block with an explicit question text, so that two questions can share a text. */
function blockMd(n: number, text: string, links: string[], opts: { answer?: string } = {}): string {
  const linkLine = links.length > 0 ? links.map((t) => `[${t}](${LINK_TARGET})`).join(", ") : "—";
  return `### Q${n}\nЗаметки: ${linkLine}\n\n${text}\n\n- A) MARKER-WRONG-${n}\n- B) MARKER-RIGHT-${n}\n\n**Ответ: ${opts.answer ?? "B"}**\n\n> Official: Correct. Explanation Q${n}.\n`;
}

describe("parser: relation edge cases", () => {
  it("an unresolved link warns even when a note lists the question, which stays related", () => {
    const parsed = parseRawData(
      notesMd({ "Note A": [1] }),
      sourceMd([{ n: 1, links: ["Missing title"] }]),
    );
    expect(parsed.warnings).toContain(`Q1: unresolved note link "Missing title" (L9999)`);
    expect(parsed.warnings).toContain(`Q1: related to note "Note A" only from the notes side`);
    expect(parsed.questions.find((q) => q.number === 1)?.noteTitles).toEqual(["Note A"]);
  });

  // Q3 above (answer "D") and Q6 in the first describe are skipped at the early return
  // "answer letter has no matching option", before notes are resolved: they cover only that path.
  // The cases below are skipped AFTER the notes are resolved, which is what proves that the
  // warnings of a rejected question are held back.
  describe("questions skipped after their notes were resolved", () => {
    const parsed = parseRawData(
      notesMd({ "Note X": [10], "Note Y": [12], "Note Z": [] }),
      `## 1. Alpha\n\n${[
        // No official text; unresolved question-side link; the notes side lists it.
        `### Q10\nЗаметки: [Missing title](${LINK_TARGET})\n\nTEST no explanation?\n\n- A) MARKER-WRONG-10\n- B) MARKER-RIGHT-10\n\n**Ответ: B**\n`,
        blockMd(11, "TEST twin text?", []),
        // Same text as Q11; unresolved link; the notes side lists it.
        blockMd(12, "TEST twin text?", ["Missing title"]),
      ].join("\n")}`,
    );

    it("skips them for the expected reasons", () => {
      expect(parsed.questions.map((q) => q.number)).toEqual([11]);
      expect(parsed.skipped).toEqual([
        { number: 10, reason: "no explanation (no official text and no note)" },
        { number: 12, reason: "same text as Q11 in the same topic" },
      ]);
    });

    it("holds back every warning of a question skipped after resolution", () => {
      expect(parsed.warnings.filter((w) => /^Q(10|12):/.test(w))).toEqual([]);
    });

    it("emits no pairs for them", () => {
      expect(parsed.questions.flatMap((q) => q.noteTitles)).toEqual([]);
      expect(parsed.questions).toHaveLength(1);
    });
  });

  describe("questions skipped for a duplicate text or another reason", () => {
    const parsed = parseRawData(
      notesMd({ "Note A": [1], "Note B": [2], "Note C": [3] }),
      `## 1. Alpha\n\n${[
        blockMd(1, "TEST same text?", []),
        blockMd(2, "TEST same text?", []),
        blockMd(3, "TEST other text?", ["Missing title"], { answer: "D" }),
      ].join("\n")}`,
    );

    it("skips both with their reasons", () => {
      expect(parsed.questions.map((q) => q.number)).toEqual([1]);
      expect(parsed.skipped.find((s) => s.number === 2)?.reason).toMatch(/same text as Q1/);
      expect(parsed.skipped.find((s) => s.number === 3)?.reason).toMatch(/answer letter/);
    });

    it("emits no relation warning for either skipped question", () => {
      expect(parsed.warnings.filter((w) => /^Q[23]:/.test(w))).toEqual([]);
    });

    it("the accepted twin keeps its own relation and warning", () => {
      expect(parsed.questions[0]?.noteTitles).toEqual(["Note A"]);
      expect(parsed.warnings).toContain(`Q1: related to note "Note A" only from the notes side`);
    });

    it("keeps only the twin's pair", () => {
      expect(parsed.questions).toHaveLength(1);
      expect(parsed.questions.flatMap((q) => q.noteTitles)).toEqual(["Note A"]);
    });
  });

  it("a notes-side link without official text is not an explanation: the question is skipped", () => {
    const parsed = parseRawData(
      notesMd({ "Note C": [7] }),
      sourceMd([{ n: 7, links: [], official: false }]),
    );
    expect(parsed.questions).toEqual([]);
    expect(parsed.skipped).toEqual([
      { number: 7, reason: "no explanation (no official text and no note)" },
    ]);
    expect(parsed.warnings.filter((w) => w.startsWith("Q7:"))).toEqual([]);
  });

  it("a question-side link without official text uses the first linked note", () => {
    const parsed = parseRawData(
      notesMd({ "Note A": [8], "Note B": [8] }),
      sourceMd([{ n: 8, links: ["Note B", "Note A"], official: false }]),
    );
    expect(parsed.skipped).toEqual([]);
    expect(parsed.questions[0]?.explanation).toContain("Test body of Note B.");
  });

  describe("notes that list a question missing from the source", () => {
    const parsed = parseRawData(
      notesMd({ "Note A": [1, 40, 40, 5] }),
      sourceMd([
        { n: 1, links: ["Note A"] },
        { n: 5, links: [], official: false },
      ]),
    );

    it("warns for a Qn without a block, once even when repeated in the note", () => {
      const warning = `note "Note A" lists Q40, which does not exist in the source`;
      expect(parsed.warnings.filter((w) => w === warning)).toHaveLength(1);
    });

    it("does not warn for a Qn whose block exists but was skipped", () => {
      expect(parsed.skipped.map((s) => s.number)).toEqual([5]);
      expect(parsed.warnings.filter((w) => /lists Q5\b/.test(w))).toEqual([]);
    });
  });
});

describe("parser on the real raw-data (skipped when the files are absent)", () => {
  const present =
    existsSync("raw-data/_shortNotesSource.md") && existsSync("raw-data/_shortNotes.md");

  it.skipIf(!present)("relates the shared-repositories note to exactly Q111 and Q112", () => {
    const real = parseRawData(
      readFileSync("raw-data/_shortNotes.md", "utf8"),
      readFileSync("raw-data/_shortNotesSource.md", "utf8"),
    );
    const title = "Общее правило для нескольких репозиториев";
    const related = real.questions
      .filter((q) => q.noteTitles.includes(title))
      .map((q) => q.number)
      .sort((a, b) => a - b);
    expect(related).toEqual([111, 112]);
  });

  it.skipIf(!present)("never relates a question to a note title that does not exist", () => {
    const real = parseRawData(
      readFileSync("raw-data/_shortNotes.md", "utf8"),
      readFileSync("raw-data/_shortNotesSource.md", "utf8"),
    );
    const known = new Set(real.notes.map((n) => n.title));
    const dangling = real.questions.flatMap((q) =>
      q.noteTitles.filter((t) => !known.has(t)).map((t) => `Q${q.number}: ${t}`),
    );
    expect(dangling).toEqual([]);
  });
});
