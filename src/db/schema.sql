CREATE TABLE IF NOT EXISTS topics (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS short_notes (
  id    INTEGER PRIMARY KEY,
  title TEXT NOT NULL UNIQUE CHECK (length(trim(title)) > 0),  -- key for import and JSON references
  text  TEXT NOT NULL CHECK (length(trim(text)) > 0)
);

CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY,
  topic_id    INTEGER NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
  text        TEXT NOT NULL CHECK (length(trim(text)) > 0),
  explanation TEXT NOT NULL CHECK (length(trim(explanation)) > 0),
  UNIQUE (topic_id, text)                                               -- dedup key for import
);

CREATE TABLE IF NOT EXISTS options (
  id          INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL CHECK (position >= 1),                  -- display order (A, B, C...)
  label       TEXT NOT NULL CHECK (length(trim(label)) > 0),
  is_correct  INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  UNIQUE (question_id, position)
);

-- many-to-many: a note can serve several questions, a question can have several notes
CREATE TABLE IF NOT EXISTS question_short_notes (
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  short_note_id INTEGER NOT NULL REFERENCES short_notes(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, short_note_id)
) WITHOUT ROWID;

-- Correct option guarantee. Every question that has options has EXACTLY ONE correct option:
--   at most one: the partial unique index below plus options_no_replace;
--   at least one: the triggers below. Options are inserted one row at a time, so a plain
--   "at least one" check is impossible; instead the correct option must be inserted FIRST
--   (the first option of a question can only be the correct one), and it can never be
--   unmarked, promoted, moved to another question or deleted while its question exists.
-- REPLACE paths are closed too. Conflict resolution (INSERT OR REPLACE, UPDATE OR REPLACE) deletes
--   rows without firing delete triggers, but BEFORE triggers run before conflict resolution, so
--   they refuse every insert or update that would collide with an existing row (same id, same
--   (question_id, position), a second correct option, a question with the same id or text).
--   The id, position and is_correct of an existing option cannot be updated (ids follow positions).
-- Single gap: a question with ZERO options cannot be forbidden by the DB (a plain INSERT into
--   questions without options is allowed). That is checked by the seed-json validation and by the
--   import. The correct option can only be changed by deleting the question (ON DELETE CASCADE
--   removes its options) and importing again.
-- Triggers are DROPped and re-created so that running this file on an existing DB refreshes them.
-- Messages deliberately mention no option text.
CREATE UNIQUE INDEX IF NOT EXISTS one_correct_per_question ON options(question_id) WHERE is_correct = 1;

-- the first option of a question must be the correct one
DROP TRIGGER IF EXISTS options_correct_first;
CREATE TRIGGER options_correct_first
BEFORE INSERT ON options
-- IS NOT 1 (not = 0): INSERT OR REPLACE turns an explicit NULL into the column default 0 after the triggers ran
WHEN NEW.is_correct IS NOT 1
  AND NOT EXISTS (SELECT 1 FROM options WHERE question_id = NEW.question_id AND is_correct = 1)
BEGIN
  SELECT RAISE(ABORT, 'the correct option of a question must be inserted first');
END;

-- an insert never collides with an existing option (this closes INSERT OR REPLACE)
DROP TRIGGER IF EXISTS options_no_replace;
CREATE TRIGGER options_no_replace
BEFORE INSERT ON options
WHEN (NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM options WHERE id = NEW.id))
  OR EXISTS (SELECT 1 FROM options WHERE question_id = NEW.question_id AND position = NEW.position)
  OR (NEW.is_correct = 1 AND EXISTS (SELECT 1 FROM options WHERE question_id = NEW.question_id AND is_correct = 1))
BEGIN
  SELECT RAISE(ABORT, 'an option cannot replace or duplicate an existing option');
END;

-- the correctness flag of an option never changes (no unmarking, no promoting another option)
DROP TRIGGER IF EXISTS options_correct_update;
CREATE TRIGGER options_correct_update
BEFORE UPDATE OF is_correct ON options
WHEN NEW.is_correct IS NOT OLD.is_correct
BEGIN
  SELECT RAISE(ABORT, 'the correctness flag of an option cannot be changed');
END;

-- id and position never change (ids follow positions)
DROP TRIGGER IF EXISTS options_key_update;
CREATE TRIGGER options_key_update
BEFORE UPDATE OF id, position ON options
WHEN NEW.id IS NOT OLD.id OR NEW.position IS NOT OLD.position
BEGIN
  SELECT RAISE(ABORT, 'the id and position of an option cannot be changed');
END;

-- an option cannot move to another question
DROP TRIGGER IF EXISTS options_no_move;
CREATE TRIGGER options_no_move
BEFORE UPDATE OF question_id ON options
WHEN NEW.question_id <> OLD.question_id
BEGIN
  SELECT RAISE(ABORT, 'an option cannot be moved to another question');
END;

-- the correct option cannot be deleted while its question exists (a cascade from a deleted question is allowed)
DROP TRIGGER IF EXISTS options_correct_delete;
CREATE TRIGGER options_correct_delete
BEFORE DELETE ON options
WHEN OLD.is_correct = 1 AND EXISTS (SELECT 1 FROM questions WHERE id = OLD.question_id)
BEGIN
  SELECT RAISE(ABORT, 'the correct option of a question cannot be deleted');
END;

-- a question insert never replaces an existing question (REPLACE would cascade-delete its options)
DROP TRIGGER IF EXISTS questions_no_replace;
CREATE TRIGGER questions_no_replace
BEFORE INSERT ON questions
WHEN (NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM questions WHERE id = NEW.id))
  OR EXISTS (SELECT 1 FROM questions WHERE topic_id = NEW.topic_id AND text = NEW.text)
BEGIN
  SELECT RAISE(ABORT, 'a question cannot replace or duplicate an existing question');
END;

-- same for UPDATE OR REPLACE: an update never collides with another question (plain updates stay allowed)
DROP TRIGGER IF EXISTS questions_no_replace_update;
CREATE TRIGGER questions_no_replace_update
BEFORE UPDATE ON questions
WHEN EXISTS (SELECT 1 FROM questions WHERE id <> OLD.id AND (id = NEW.id OR (topic_id = NEW.topic_id AND text = NEW.text)))
BEGIN
  SELECT RAISE(ABORT, 'a question cannot replace or duplicate an existing question');
END;

CREATE INDEX IF NOT EXISTS idx_question_short_notes_note ON question_short_notes(short_note_id);
