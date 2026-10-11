/**
 * Parser for the raw exam files in raw-data/ (see raw-data/_shortNotesRelation.md).
 * Part of the raw-data-to-json skill (used by convert.mts); the only code that reads the markdown.
 * Pure functions: text in, plain objects out. No DB, no fs, no MCP.
 * Never invents content: a question that cannot be built from the source is skipped and reported.
 */

export interface ParsedNote {
  title: string;
  text: string;
  /** 1-based line of the `### Title` heading in _shortNotes.md. */
  line: number;
  questionNumbers: number[];
}

export interface ParsedOption {
  /** 1 for A, 2 for B, ... */
  position: number;
  label: string;
}

export interface ParsedQuestion {
  /** The `N` of `### QN` in the source file. */
  number: number;
  topic: string;
  text: string;
  options: ParsedOption[];
  /** Position of the correct option. Never print it in reports. */
  correctPosition: number;
  explanation: string;
  /**
   * Titles of all related notes, deduplicated: the question's own `Заметки:` links in source
   * order first, then notes that only list this question in their `Вопросы:` line. May be empty.
   */
  noteTitles: string[];
}

export interface SkippedQuestion {
  number: number;
  reason: string;
}

export interface ParsedRawData {
  topics: string[];
  notes: ParsedNote[];
  questions: ParsedQuestion[];
  /** Number of `### QN` blocks found in the source, valid or not. */
  questionBlocks: number;
  skipped: SkippedQuestion[];
  warnings: string[];
}

interface NoteLink {
  title: string;
  line: number;
}

const MULTIPLE_LETTERS = "multiple";
const CONFLICTING_ANSWERS = "conflict";
const UNRECOGNIZED_ANSWER = "unrecognized";

interface QuestionBlock {
  number: number;
  topic: string;
  links: NoteLink[];
  text: string;
  options: { letter: string; label: string }[];
  /** A line that looks like an option but is not in the `- A) text` form. */
  malformedOption: boolean;
  /** undefined: no answer line; null: free-text answer (open-ended question). */
  answerLetter: string | null | undefined;
  official: string | null;
}

const NOTE_HEADING = /^###\s+(?!#)(.+?)\s*$/;
const DOMAIN_HEADING = /^##\s+(?!#)(?:\d+\.\s*)?(.+?)\s*$/;
const QUESTION_HEADING = /^###\s+Q(\d+)\s*$/;
/** `- A) text`; a missing label still matches so that it is caught as an empty label. */
const OPTION_LINE = /^- ([A-Z])\)\s*(.*)$/;
/** Looks like an option but is not in the exact `- A) ...` form (e.g. `* B) x`). */
const LOOKS_LIKE_OPTION = /^\s*[-*+]\s*[A-Z]\)/;
/** An answer line in any style the known patterns do not accept (e.g. `**Ответ: B**.`). */
const ANSWER_ANY = /^\s*(?:\*\*\s*)?Ответ\s*:/i;
/** `**Ответ: B**` or `**Ответ:** B`. */
const ANSWER_LETTER = /^\*\*Ответ:(?:\s*([A-Z])\*\*|\*\*\s*([A-Z]))\s*$/;
/** `**Ответ: B, D**`: more than one letter. */
const ANSWER_MULTI = /^\*\*Ответ:\s*[A-Z](?:\s*(?:,|и|and|&)\s*[A-Z])+\s*\**/;
const ANSWER_FREE_TEXT = /^\*\*Ответ:\*\*/;
const NOTE_LINK = /\[([^\]]*)\]\(_shortNotes\.md#L(\d+)\)/g;

interface Fence {
  char: string;
  length: number;
}

/**
 * Code fences, CommonMark style: a fence closes only on the same character, at least as long,
 * with nothing else on the line. Lines inside a fence (and the fence lines) are never headings.
 */
function nextFence(
  fence: Fence | null,
  line: string,
): { fence: Fence | null; isFenceLine: boolean } {
  if (fence) {
    const t = line.trim();
    const closes = t.length >= fence.length && [...t].every((c) => c === fence.char);
    return closes ? { fence: null, isFenceLine: true } : { fence, isFenceLine: false };
  }
  const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
  const marker = open?.[1];
  return marker
    ? { fence: { char: marker.charAt(0), length: marker.length }, isFenceLine: true }
    : { fence: null, isFenceLine: false };
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function trimBlankLines(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end).join("\n").trim();
}

/** `_shortNotes.md`: one note per `### Title`; `####` lines are groups and end the previous note. */
export function parseNotes(markdown: string): { notes: ParsedNote[]; warnings: string[] } {
  const notes: ParsedNote[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let current: { title: string; line: number; body: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const questionNumbers: number[] = [];
    const body: string[] = [];
    for (const line of current.body) {
      const refs = /^- Вопросы:\s*(.*)$/.exec(line);
      if (refs) {
        for (const m of (refs[1] ?? "").matchAll(/\bQ(\d+)\b/g)) questionNumbers.push(Number(m[1]));
      } else {
        body.push(line);
      }
    }
    const text = trimBlankLines(body);
    if (seen.has(current.title)) {
      warnings.push(`duplicate note title "${current.title}" (line ${current.line}): skipped`);
    } else if (text === "") {
      warnings.push(`note "${current.title}" (line ${current.line}) has no text: skipped`);
    } else {
      seen.add(current.title);
      notes.push({ title: current.title, text, line: current.line, questionNumbers });
    }
    current = null;
  };

  let fence: Fence | null = null;
  let fenceLine = 0;
  splitLines(markdown).forEach((line, index) => {
    const next = nextFence(fence, line);
    const insideFence = fence !== null || next.isFenceLine;
    if (fence === null && next.fence !== null) fenceLine = index + 1;
    fence = next.fence;
    if (insideFence) {
      current?.body.push(line);
      return;
    }
    const heading = NOTE_HEADING.exec(line);
    if (heading) {
      flush();
      current = { title: (heading[1] ?? "").trim(), line: index + 1, body: [] };
    } else if (/^#{1,4}\s/.test(line)) {
      flush();
    } else if (current) {
      current.body.push(line);
    }
  });
  flush();
  if (fence !== null) warnings.push(`line ${fenceLine}: unclosed code fence in the notes file`);
  return { notes, warnings };
}

function parseOfficial(lines: string[]): string | null {
  const parts: string[] = [];
  for (const line of lines) {
    const body = line.replace(/^>\s?/, "").trim();
    const labelled = /^Official\s*\(([A-Z])\):\s*(.*)$/.exec(body);
    if (labelled) {
      parts.push(`(${labelled[1]}) ${labelled[2]}`);
      continue;
    }
    const main = /^Official:\s*(.*)$/.exec(body);
    if (main) parts.push((main[1] ?? "").replace(/^Correct(?:\.|\s+-)\s*/, ""));
    else if (body !== "" && parts.length > 0) parts[parts.length - 1] += ` ${body}`;
  }
  const text = parts
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .join("\n\n");
  return text === "" ? null : text;
}

function parseQuestionBlock(number: number, topic: string, lines: string[]): QuestionBlock {
  const links: NoteLink[] = [];
  const text: string[] = [];
  const options: { letter: string; label: string }[] = [];
  const official: string[] = [];
  let answerLetter: string | null | undefined;
  // A second answer line must not silently overwrite the first one.
  const setAnswer = (value: string | null | undefined) => {
    answerLetter = answerLetter === undefined ? value : CONFLICTING_ANSWERS;
  };
  let malformedOption = false;
  let section: "text" | "options" | "after" = "text";
  let fence: Fence | null = null;

  for (const line of lines) {
    // Code samples are content, not structure: keep them verbatim in the current section.
    const next = nextFence(fence, line);
    const insideFence = fence !== null || next.isFenceLine;
    fence = next.fence;
    if (insideFence) {
      if (section === "text") text.push(line);
      else if (section === "options") {
        const last = options[options.length - 1];
        if (last && line.trim() !== "") last.label = `${last.label} ${line.trim()}`;
      }
      continue;
    }
    if (links.length === 0 && /^Заметки:/.test(line)) {
      for (const m of line.matchAll(NOTE_LINK)) {
        links.push({ title: (m[1] ?? "").trim(), line: Number(m[2]) });
      }
      continue;
    }
    const option = OPTION_LINE.exec(line);
    const letter = ANSWER_LETTER.exec(line);
    if (option) {
      section = "options";
      options.push({ letter: option[1] ?? "", label: (option[2] ?? "").trim() });
    } else if (letter) {
      section = "after";
      setAnswer(letter[1] ?? letter[2]);
    } else if (ANSWER_MULTI.test(line)) {
      section = "after";
      setAnswer(MULTIPLE_LETTERS);
    } else if (ANSWER_FREE_TEXT.test(line)) {
      section = "after";
      setAnswer(null);
    } else if (ANSWER_ANY.test(line)) {
      section = "after";
      setAnswer(UNRECOGNIZED_ANSWER);
    } else if (section !== "after" && LOOKS_LIKE_OPTION.test(line)) {
      section = "options";
      malformedOption = true;
    } else if (line.startsWith(">")) {
      section = "after";
      official.push(line);
    } else if (section === "text") {
      text.push(line);
    } else if (section === "options" && line.trim() !== "") {
      const last = options[options.length - 1];
      if (last) last.label = `${last.label} ${line.trim()}`;
    }
  }

  return {
    number,
    topic,
    links,
    text: trimBlankLines(text),
    options,
    malformedOption,
    answerLetter,
    official: parseOfficial(official),
  };
}

/** `_shortNotesSource.md`: the same domain heading repeats, a question belongs to the nearest one. */
function parseQuestionBlocks(markdown: string): { blocks: QuestionBlock[]; warnings: string[] } {
  const blocks: QuestionBlock[] = [];
  const warnings: string[] = [];
  let topic = "";
  let current: { number: number; topic: string; lines: string[] } | null = null;

  const flush = () => {
    if (current) blocks.push(parseQuestionBlock(current.number, current.topic, current.lines));
    current = null;
  };

  let fence: Fence | null = null;
  let fenceLine = 0;
  splitLines(markdown).forEach((line, index) => {
    const next = nextFence(fence, line);
    const insideFence = fence !== null || next.isFenceLine;
    if (fence === null && next.fence !== null) fenceLine = index + 1;
    fence = next.fence;
    if (insideFence) {
      current?.lines.push(line);
      return;
    }
    const question = QUESTION_HEADING.exec(line);
    if (question) {
      flush();
      current = { number: Number(question[1]), topic, lines: [] };
    } else if (/^#{1,3}\s/.test(line)) {
      const domain = DOMAIN_HEADING.exec(line);
      if (domain && line.startsWith("## ")) {
        flush();
        topic = (domain[1] ?? "").trim();
      } else {
        // Anything else ends the block: say so instead of silently dropping the lines after it.
        if (current) warnings.push(`line ${index + 1}: unexpected heading ends Q${current.number}`);
        flush();
      }
    } else if (current) {
      current.lines.push(line);
    }
  });
  flush();
  if (fence !== null) warnings.push(`line ${fenceLine}: unclosed code fence in the source file`);
  return { blocks, warnings };
}

/** Exact title, then the only title starting with the link text, then the heading on that line. */
function findLinkedNote(link: NoteLink, notes: ParsedNote[]): ParsedNote | undefined {
  const exact = notes.find((n) => n.title === link.title);
  if (exact) return exact;
  const prefixed = link.title === "" ? [] : notes.filter((n) => n.title.startsWith(link.title));
  if (prefixed.length === 1) return prefixed[0];
  return notes.find((n) => n.line === link.line);
}

/**
 * Link resolution order: exact title, title starting with the link text, heading on the linked
 * line. A link that matches none of these is always reported as unresolved; the notes that list
 * the question in their `Вопросы:` line are added by the notes-side union in buildQuestion, not here.
 */
function resolveNotes(block: QuestionBlock, notes: ParsedNote[], warnings: string[]): ParsedNote[] {
  const resolved: ParsedNote[] = [];
  for (const link of block.links) {
    const linked = findLinkedNote(link, notes);
    if (linked) {
      if (!resolved.includes(linked)) resolved.push(linked);
      continue;
    }
    warnings.push(`Q${block.number}: unresolved note link "${link.title}" (L${link.line})`);
  }
  return resolved;
}

function buildQuestion(
  block: QuestionBlock,
  notes: ParsedNote[],
  warnings: string[],
): ParsedQuestion | string {
  if (block.malformedOption) return "malformed option line";
  if (block.options.length === 0) return "no options in the source (open-ended question)";
  if (block.answerLetter === undefined) return "no answer line";
  if (block.answerLetter === null) return "free-text answer instead of an option letter";
  if (block.answerLetter === MULTIPLE_LETTERS) return "more than one answer letter";
  if (block.answerLetter === UNRECOGNIZED_ANSWER) return "unrecognized answer line";
  if (block.answerLetter === CONFLICTING_ANSWERS) return "more than one answer line";
  if (block.options.length < 2) return "fewer than two options";
  const letters = block.options.map((o) => o.letter);
  if (new Set(letters).size !== letters.length) return "duplicate option letters";
  if (block.options.some((o) => o.label === "")) return "empty option label";
  const labels = block.options.map((o) => o.label);
  if (new Set(labels).size !== labels.length) return "duplicate option labels";
  if (letters.some((letter, i) => letter.charCodeAt(0) - 64 !== i + 1)) {
    return "option letters are not A, B, C... in order";
  }
  if (!letters.includes(block.answerLetter)) return "answer letter has no matching option";
  if (block.text === "") return "empty question text";

  const resolved = resolveNotes(block, notes, warnings);
  // The explanation fallback uses only the question's own links: `Заметки: —` means "no note".
  const fallbackNote = resolved[0];
  // Union with the notes side: a pair known from one direction only is still a relation.
  const fromQuestionSide = new Set(resolved);
  for (const note of notes) {
    if (note.questionNumbers.includes(block.number) && !fromQuestionSide.has(note)) {
      warnings.push(`Q${block.number}: related to note "${note.title}" only from the notes side`);
      resolved.push(note);
    }
  }
  for (const note of fromQuestionSide) {
    if (!note.questionNumbers.includes(block.number)) {
      warnings.push(
        `Q${block.number}: related to note "${note.title}" only from the question side`,
      );
    }
  }
  const explanation = block.official ?? fallbackNote?.text ?? null;
  if (explanation === null) return "no explanation (no official text and no note)";

  const position = (letter: string) => letter.charCodeAt(0) - 64;
  return {
    number: block.number,
    topic: block.topic,
    text: block.text,
    options: block.options.map((o) => ({ position: position(o.letter), label: o.label })),
    correctPosition: position(block.answerLetter),
    explanation,
    noteTitles: resolved.map((n) => n.title),
  };
}

export function parseRawData(notesMarkdown: string, sourceMarkdown: string): ParsedRawData {
  const { notes, warnings } = parseNotes(notesMarkdown);
  const { blocks, warnings: blockWarnings } = parseQuestionBlocks(sourceMarkdown);
  warnings.push(...blockWarnings);

  const questions: ParsedQuestion[] = [];
  const skipped: SkippedQuestion[] = [];
  const seenNumbers = new Set<number>();
  const byText = new Map<string, number>();
  for (const block of blocks) {
    if (seenNumbers.has(block.number)) {
      skipped.push({ number: block.number, reason: "duplicate question number (first one kept)" });
      continue;
    }
    if (block.topic === "") {
      skipped.push({ number: block.number, reason: "no domain heading above the question" });
      continue;
    }
    // Warnings of a question are kept back until it is accepted.
    const questionWarnings: string[] = [];
    const built = buildQuestion(block, notes, questionWarnings);
    if (typeof built === "string") {
      skipped.push({ number: block.number, reason: built });
      continue;
    }
    const key = `${built.topic}\u0000${built.text}`;
    const twin = byText.get(key);
    if (twin !== undefined) {
      skipped.push({ number: block.number, reason: `same text as Q${twin} in the same topic` });
      continue;
    }
    warnings.push(...questionWarnings);
    byText.set(key, built.number);
    seenNumbers.add(block.number);
    questions.push(built);
  }

  for (const note of notes) {
    if (note.questionNumbers.length === 0)
      warnings.push(`orphan note (no Вопросы): "${note.title}"`);
  }

  const blockNumbers = new Set(blocks.map((b) => b.number));
  for (const note of notes) {
    for (const n of new Set(note.questionNumbers)) {
      if (!blockNumbers.has(n)) {
        warnings.push(`note "${note.title}" lists Q${n}, which does not exist in the source`);
      }
    }
  }

  const topics = [...new Set(questions.map((q) => q.topic))];
  return { topics, notes, questions, questionBlocks: blocks.length, skipped, warnings };
}
