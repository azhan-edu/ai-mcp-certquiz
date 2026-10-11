import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseNotes, parseRawData } from "../../../.claude/skills/raw-data-to-json/parser.ts";

// TEST DATA ONLY: synthetic fixtures, not real exam content.
const NOTES = `# Notes

## Contents

- [1. Alpha (2)](#1-alpha-2)

## 1. Alpha (2)

#### Group one (2)

### Note one
- Test note one body.
  - nested bullet
- Вопросы: [Q1](_shortNotesSource.md#q1), [Q3](_shortNotesSource.md#q3)

### Note two
- Test note two body.
- Вопросы: [Q2](_shortNotesSource.md#q2)

### Orphan note
- No back reference.
`;

const SOURCE = `# Sources

## 1. Alpha

### Q1
Заметки: [Note one](_shortNotes.md#L11)

TEST question one?

- A) first option
  wrapped continuation
- B) second option

**Ответ: B**

> Official: Correct. Because test.

## 2. Beta

### Q2
Заметки: [Note](_shortNotes.md#L99), [Note two](_shortNotes.md#L1)

TEST question two?

- A) only
- B) other

**Ответ: A**

> Official (B): Incorrect. Not this one.

### Q3
Заметки: —

TEST open-ended question?

**Ответ:** free text

## 1. Alpha

### Q4
Заметки: [Missing](_shortNotes.md#L2000)

TEST question four?

- A) one
- B) two

**Ответ: A**

> Official: Correct. Fourth explanation.
`;

describe("parseRawData", () => {
  const parsed = parseRawData(NOTES, SOURCE);

  it("parses notes without the Вопросы line and keeps nested markdown", () => {
    expect(parsed.notes.map((n) => n.title)).toEqual(["Note one", "Note two", "Orphan note"]);
    const one = parsed.notes[0];
    expect(one?.text).toBe("- Test note one body.\n  - nested bullet");
    expect(one?.questionNumbers).toEqual([1, 3]);
    expect(
      parsed.warnings.some((w) => w.includes("orphan note") && w.includes("Orphan note")),
    ).toBe(true);
  });

  it("assigns topics from the nearest domain heading, even when headings repeat", () => {
    expect(parsed.questions.map((q) => [q.number, q.topic])).toEqual([
      [1, "Alpha"],
      [2, "Beta"],
      [4, "Alpha"],
    ]);
    expect(parsed.topics.sort()).toEqual(["Alpha", "Beta"]);
  });

  it("builds options with positions, joins wrapped lines and finds the correct one", () => {
    const q1 = parsed.questions[0];
    expect(q1?.text).toBe("TEST question one?");
    expect(q1?.options).toEqual([
      { position: 1, label: "first option wrapped continuation" },
      { position: 2, label: "second option" },
    ]);
    expect(q1?.correctPosition).toBe(2);
  });

  it("strips the Official/Correct labels and keeps labelled option explanations", () => {
    expect(parsed.questions[0]?.explanation).toBe("Because test.");
    expect(parsed.questions[1]?.explanation).toBe("(B) Incorrect. Not this one.");
  });

  it("resolves note links by exact title; an unresolvable link warns and is dropped", () => {
    expect(parsed.questions[0]?.noteTitles).toEqual(["Note one"]);
    // "Note" matches no title exactly and L99 is no heading line: it warns and is dropped.
    // Q2 still gets "Note two" from its own exact link.
    expect(parsed.questions[1]?.noteTitles).toEqual(["Note two"]);
    expect(parsed.warnings).toContain(`Q2: unresolved note link "Note" (L99)`);
    expect(parsed.questions[2]?.noteTitles).toEqual([]);
    expect(parsed.warnings.some((w) => w.includes("Q4") && w.includes("unresolved"))).toBe(true);
  });

  it("skips questions it cannot build and says why", () => {
    expect(parsed.skipped).toEqual([
      { number: 3, reason: "no options in the source (open-ended question)" },
    ]);
    expect(parsed.questionBlocks).toBe(4);
  });

  it("skips a question with a missing explanation, a bad answer letter or a repeated text", () => {
    const source = `## 1. Alpha

### Q1
Заметки: —

TEST same text?

- A) a
- B) b

**Ответ: A**

> Official: Correct. ok

### Q2
Заметки: —

TEST same text?

- A) a
- B) b

**Ответ: A**

> Official: Correct. ok

### Q3
Заметки: —

TEST no explanation?

- A) a
- B) b

**Ответ: A**

### Q4
Заметки: —

TEST bad letter?

- A) a
- B) b

**Ответ: D**

> Official: Correct. ok
`;
    const result = parseRawData("", source);
    expect(result.questions.map((q) => q.number)).toEqual([1]);
    expect(result.skipped).toEqual([
      { number: 2, reason: "same text as Q1 in the same topic" },
      { number: 3, reason: "no explanation (no official text and no note)" },
      { number: 4, reason: "answer letter has no matching option" },
    ]);
  });

  it("skips a question whose option has an empty label", () => {
    const source = `## 1. Alpha

### Q1
Заметки: —

TEST empty label?

- A) a
- B)  \u0020
- C) c

**Ответ: A**

> Official: Correct. ok
`;
    const result = parseRawData("", source);
    expect(result.questions).toEqual([]);
    expect(result.skipped.map((s) => s.number)).toEqual([1]);
  });

  it("accepts both answer line styles and rejects several letters with its own reason", () => {
    const q = (n: number, answer: string) => `### Q${n}
Заметки: —

TEST question ${n}?

- A) a
- B) b

${answer}

> Official: Correct. ok
`;
    const source = `## 1. Alpha\n\n${q(1, "**Ответ: B**")}\n${q(2, "**Ответ:** B")}\n${q(3, "**Ответ: A, B**")}`;
    const result = parseRawData("", source);
    expect(result.questions.map((x) => [x.number, x.correctPosition])).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(result.skipped).toEqual([{ number: 3, reason: "more than one answer letter" }]);
  });

  it("does not treat # lines inside code fences as headings", () => {
    const notes =
      "### Note\n- Before\n```\n# not a heading\n### nor this\n```\n- After\n- Вопросы: [Q1](x)\n";
    const result = parseNotes(notes);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.text).toContain("- After");
    expect(result.notes[0]?.text).toContain("# not a heading");
  });

  it("warns when an unexpected heading cuts a question block short", () => {
    const source = "## 1. Alpha\n\n### Q1\nЗаметки: —\n\nTEXT?\n\n### Q1 (new)\n\n- A) a\n- B) b\n";
    const result = parseRawData("", source);
    expect(result.warnings.some((w) => w.includes("unexpected heading") && w.includes("Q1"))).toBe(
      true,
    );
  });

  it("keeps a valid question when an invalid block with the same number comes first", () => {
    const valid = `### Q1
Заметки: —

TEST valid?

- A) a
- B) b

**Ответ: A**

> Official: Correct. ok
`;
    const invalid = "### Q1\nЗаметки: —\n\nTEST open-ended?\n";
    const result = parseRawData("", `## 1. Alpha\n\n${invalid}\n${valid}`);
    expect(result.questions.map((x) => x.number)).toEqual([1]);
  });

  it("skips a question with two answer lines or with gaps in the option letters", () => {
    const block = (n: number, options: string, answers: string) => `### Q${n}
Заметки: —

TEST question ${n}?

${options}

${answers}

> Official: Correct. ok
`;
    const ab = "- A) a\n- B) b";
    const source = `## 1. Alpha\n\n${block(1, ab, "**Ответ: A**\n**Ответ: B**")}\n${block(2, "- A) a\n- C) c", "**Ответ: A**")}\n${block(3, ab, "**Ответ: B**")}`;
    const result = parseRawData("", source);
    expect(result.questions.map((q) => q.number)).toEqual([3]);
    expect(result.skipped).toEqual([
      { number: 1, reason: "more than one answer line" },
      { number: 2, reason: "option letters are not A, B, C... in order" },
    ]);
  });

  it("skips instead of guessing when an answer line or an option line has an unknown form", () => {
    const q = (n: number, options: string, answer: string) => `### Q${n}
Заметки: —

TEST question ${n}?

${options}

${answer}

> Official: Correct. ok
`;
    const ab = "- A) a\n- B) b";
    const source = `## 1. Alpha

${q(1, ab, "**Ответ: B**.")}
${q(2, ab, "**Ответ: \u0412**")}
${q(3, ab, "Ответ: B")}
${q(4, "- A) a\n- B)", "**Ответ: A**")}
${q(5, "- A) a\n* B) b", "**Ответ: A**")}
${q(6, ab, "**Ответ: B**")}`;
    const result = parseRawData("", source);
    expect(result.questions.map((x) => x.number)).toEqual([6]);
    expect(result.skipped).toEqual([
      { number: 1, reason: "unrecognized answer line" },
      { number: 2, reason: "unrecognized answer line" },
      { number: 3, reason: "unrecognized answer line" },
      { number: 4, reason: "empty option label" },
      { number: 5, reason: "malformed option line" },
    ]);
    // the stray answer text must never end up inside an option label
    expect(JSON.stringify(result.questions)).not.toMatch(/Ответ/);
  });

  it("treats code fences in the source as content: right fence markers only, warning when unclosed", () => {
    const fenced = `## 1. Alpha

### Q1
Заметки: —

TEST with code?

\`\`\`bash
> not an explanation
- A) not an option
### Q99
~~~
\`\`\`

- A) a
- B) b

**Ответ: A**

> Official: Correct. ok
`;
    const ok = parseRawData("", fenced);
    expect(ok.questionBlocks).toBe(1);
    expect(ok.questions[0]?.options.map((o) => o.label)).toEqual(["a", "b"]);
    expect(ok.questions[0]?.explanation).toBe("ok");
    expect(ok.warnings).toEqual([]);

    const unclosed = parseRawData("### N\n- body\n```\n- more\n", "## 1. A\n\n### Q1\n```\nx\n");
    expect(unclosed.warnings.some((w) => w.includes("unclosed code fence in the notes"))).toBe(
      true,
    );
    expect(unclosed.warnings.some((w) => w.includes("unclosed code fence in the source"))).toBe(
      true,
    );
  });

  it.skipIf(!existsSync("raw-data/_shortNotesSource.md"))(
    "parses the real raw-data/ files into consistent questions",
    () => {
      const real = parseRawData(
        readFileSync("raw-data/_shortNotes.md", "utf8"),
        readFileSync("raw-data/_shortNotesSource.md", "utf8"),
      );
      expect(real.questions.length).toBeGreaterThan(0);
      expect(real.questions.length + real.skipped.length).toBe(real.questionBlocks);
      const titles = new Set(real.notes.map((n) => n.title));
      for (const q of real.questions) {
        expect(q.options.some((o) => o.position === q.correctPosition)).toBe(true);
        expect(new Set(q.options.map((o) => o.position)).size).toBe(q.options.length);
        expect(q.text.trim()).not.toBe("");
        expect(q.explanation.trim()).not.toBe("");
        for (const title of q.noteTitles) expect(titles.has(title)).toBe(true);
      }
    },
  );
});

describe("parser skip reasons and warnings", () => {
  it("contain no option text", () => {
    const parsed = parseRawData(
      "### Note one\n- Test note one.\n- Вопросы: [Q1](_shortNotesSource.md#q1)\n",
      "## 1. Alpha\n\n### Q1\nЗаметки: [Missing note](_shortNotes.md#L900)\n\nTEST skipped question?\n\n- A) MARKER-WRONG-DELTA\n- B) MARKER-RIGHT-ECHO\n\n**Ответ: D**\n\n> Official: Correct. Test explanation.\n\n### Q3\nЗаметки: —\n\nTEST open-ended question?\n\n**Ответ:** MARKER-RIGHT-FREE-TEXT\n",
    );
    expect(parsed.skipped.length).toBeGreaterThan(0);
    expect(JSON.stringify([parsed.skipped, parsed.warnings])).not.toMatch(/MARKER/);
  });
});

describe("parser: duplicate option labels", () => {
  const block = (n: number, optionA: string, optionB: string, answer: string) => `### Q${n}
Заметки: —

TEST question ${n}?

- A) ${optionA}
- B) ${optionB}

**Ответ: ${answer}**

> Official: Correct. Test explanation ${n}.
`;
  const source = `## 1. Alpha

${block(1, "MARKER-SAME", "MARKER-SAME", "B")}
${block(2, "MARKER-WRONG-2", "MARKER-RIGHT-2", "B")}`;

  it("skips the question with the reason, keeps the others and does not abort", () => {
    const parsed = parseRawData("", source);
    expect(parsed.skipped).toEqual([{ number: 1, reason: "duplicate option labels" }]);
    expect(parsed.questions.map((q) => q.number)).toEqual([2]);
    expect(parsed.questionBlocks).toBe(2);
  });

  it("leaks no label text or answer letter in the reason or warnings", () => {
    const parsed = parseRawData("", source);
    const text = JSON.stringify([parsed.skipped, parsed.warnings]);
    expect(text).not.toMatch(/MARKER/);
    expect(parsed.skipped[0]?.reason).toBe("duplicate option labels");
    expect(parsed.skipped[0]?.reason).not.toMatch(/\b[A-Z]\b/);
  });
});
