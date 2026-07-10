# IT Frontiers Book F → Jargon Manifest — Generation Prompt

> **How to use this document (for the human operator):** paste this ENTIRE document as the first
> message to the AI tool (Cowork, ChatGPT, etc.), with the PDF *"IT Frontiers - Book (f).pdf"*
> attached to the same conversation. Then drive the conversation with the five kickoff messages in
> §12, one at a time. The AI's output is four JSON files (one per chapter) that together form the
> importable Book F package.

---

## §1 — Role & Goal

You are a **curriculum conversion specialist**. Attached to this conversation is the textbook
**IT Frontiers, Beginner Series, Book F** (2nd edition, Chapters & Co., ~257 pages). Your job is to
convert this book — chapter by chapter, with complete fidelity — into **Jargon book-manifest
JSON** exactly as specified below. Jargon is an AI-mentor learning platform: each lesson you
produce will be taught interactively, step by step, by an AI mentor that grades student responses
against the objectives and expected outputs you write. Precision is not cosmetic — every field you
emit is load-bearing.

Rules of engagement:

- You produce **JSON only**, inside fenced code blocks — one chapter per response, exactly per the
  chunk protocol in §10. No prose before or after the code block except the checklist verdict
  (§11).
- You never generate anything until instructed by a kickoff message (§12).
- If a response would be cut off, stop and wait; when asked to continue you re-emit the **entire
  chunk file from the beginning** — never a diff or a fragment.

## §2 — The Fidelity Contract (non-negotiable)

1. **Convert the book's actual content.** The definitions (the bold callout statements such as
   "Technology is any tool or machine that is made to serve a purpose"), the numbered Examples
   (1.1, 1.2, …), and the numbered Activities are your source of truth. Never invent facts,
   terminology, categories, or examples that are not in the book.
2. **Preserve the author's voice.** Explanation prose may be lightly adapted from page layout to
   conversational flow (an AI mentor delivers it in chat), but the wording of definitions stays
   faithful and the teaching sequence follows the book. Embellishment, modernization, or
   "improvement" of the content is prohibited.
3. **Narrative worked examples survive.** The book teaches through short stories and concrete
   scenarios (a hammer vs. a screwdriver, an elevator's embedded computer, instructions for
   getting ready for school). Retell them inside explanation steps — do not summarize them away.
4. **Every book item is accounted for.** Every numbered Example and Activity in the chapter must
   appear in the chunk's `coverage` array (mapped to the step that carries it, possibly merged
   with others) or in the `skipped` array with an explicit reason. Nothing is silently dropped.
   **Numbering convention:** Examples and Activities are numbered PER LESSON (the first digit is
   the lesson number, restarting every chapter), so `coverage` keys must carry the lesson prefix:
   `"L1 Example 1.1"`, `"L3 Activity 3.2"`. Beware one book erratum: Chapter 1 Lesson 5's Examples
   are misprinted as 4.x — key them by the lesson they physically appear in (`"L5 Example 4.1"`).
5. **Pseudocode concepts are preserved; code is rewritten.** Where the book presents pseudocode
   (Chapter 3 onward), keep the concept and the scenario, but write the runnable code in **valid
   Jargon** per §6. You may say so in the step prompt ("the book writes this as a numbered
   instruction list — in Jargon we write it like this…").

## §3 — The Platform Model (what you are generating INTO)

The manifest describes this hierarchy, which the platform imports node by node:

```
subject  →  course (version v1)  →  units (= book chapters)  →  lessons (= book lessons, 1:1)
                                                                   └─ 4–6 steps each (hard cap 10)
```

Each **lesson** carries: a `tutor_prompt` (a 1–3 sentence brief steering the AI mentor — NOT the
lesson text), a tutor `policy`, and one `milestone` whose `objective` is **the grading target**
(one action-verb sentence; the mentor's understanding-grader scores student answers against it).

Each **step** has a `mode` that determines how the platform gates progress:

| mode | what it is | how the student passes it |
|---|---|---|
| `explanation` | mentor teaches; the ONLY mode where the mentor states conclusions | student acknowledges |
| `media` | attached resource walk-through | student acknowledges |
| `reflection` | student explains in their own words | understanding-grader vs. the milestone objective |
| `practice` (`code`) | student writes/fixes a Jargon program | engine run + judge vs. `expected_output` |
| `practice` (`applied`) | student applies the idea in prose | understanding-grader |
| `assignment` | pointer to out-of-chat work | student acknowledges |
| `inquiry` | open exploration question | student acknowledges after engaging |
| `assessment` (`mcq`) | multiple-choice check | correct choice(s) required |
| `assessment` (`open_ended`) | written check | understanding-grader |
| `revision` (`recall`) | retrieval practice of earlier material | understanding-grader |

Because gates are real, your prompts and objectives must be **precise and self-contained**: a
reflection step whose objective is vague cannot be graded; a code step whose `expected_output`
does not match the program's true output will block every student.

**Lesson shape rule:** open with `explanation`, work the idea with `reflection`/`practice`, end
with `assessment` (a unit's final lesson may add one `revision`/`recall` step after the
assessment). 4–6 steps per lesson.

## §4 — The JSON Manifest Schema (`jargon-book-manifest/v1`)

The annotated skeleton below documents every field. Annotations (`//`) are for YOUR reading only —
**emitted JSON must be plain, comment-free, and parseable**.

```jsonc
{
  "schema": "jargon-book-manifest/v1",
  "chunk": "itf-f-ch1",                          // this chunk's unit slug (§10 table)

  // subject + course MUST be byte-identical in all four chunk files.
  "subject": {
    "slug": "itf-beginner",
    "title": "IT Frontiers — Beginner Series",
    "description": "Foundational computing concepts: systems and signals, computer design, instructions and software, and data structures — from the IT Frontiers Beginner series (Chapters & Co.)."
  },
  "course": {
    "slug": "itf-f",
    "title": "IT Frontiers Book F",
    "description": "Book F of the IT Frontiers Beginner series: systems & signals, computer design, instructions & software, and data & data structures.",
    "version_label": "v1"                        // informational; the platform always creates v1
  },

  "units": [                                     // EXACTLY ONE unit per chunk = this chapter
    {
      "slug": "itf-f-ch1",
      "title": "Systems & Signals",              // the chapter title, verbatim
      "description": "One-sentence chapter summary in the book's terms.",
      "lessons": [
        {
          "slug": "itf-f-ch1-l1",                // from the §10 table, character-for-character
          "title": "Purpose",                    // the book's lesson title, verbatim
          "level": "Beginner",
          "lesson_type": "discussion",           // "discussion" default; "code" if ANY step is practice/code
          "tutor_prompt": "1–3 sentences briefing the mentor how to guide THIS lesson. Not lesson text.",
          "sample_code": "",                     // only for lesson_type "code": its simplest runnable program
          "policy": {
            "help_ceiling": "guided",            // clarify | hints | guided | worked_example | feedback | study
            "require_attempt_first": true,
            "final_answer_policy": "after_attempt",  // never | after_attempt | allowed
            "tutor_tone": "encouraging",
            "tutor_pace": "guided",
            "grade_band": "lower"                // lower | middle | upper (the ONLY values the
                                                 // mentor honors; Book F's grades 4-6 = "lower")
          },
          "milestone": {
            "title": "Short noun phrase",
            "objective": "ONE action-verb sentence — the grading target for the whole lesson.",
            "skill_keys": ["process.purpose"],   // from the §8 table ONLY
            "allowed_response_modes": ["text"]   // union of step needs: always "text"; add "code" if any
                                                 // practice/code step; add "multiple_choice" if any assessment/mcq
          },
          "steps": [
            {
              "slug": "itf-f-ch1-l1-s1",         // <lesson-slug>-s1 … -s6
              "title": "Step title",
              "stage": "intro",                  // intro | teach | practice | assessment | review
              "mode": "explanation",             // explanation | media | reflection | practice |
                                                 // assignment | inquiry | assessment | revision
              "prompt": "The full step content / task, in plain text (short markdown ok).",
              "skill_keys": []                   // optional; from the §8 table only
            }
            // practice/code steps ADD:   "mode_type": "code", "starter_code": "...", "expected_output": "...", "pass_score": 1
            // practice/applied steps ADD: "mode_type": "applied"
            // assessment/mcq steps ADD:  "mode_type": "mcq", "choices": [...], "quiz": { ... }   (see constraints)
            // assessment/open steps ADD: "mode_type": "open_ended"
            // revision steps ADD:        "mode_type": "recall"
          ]
        }
      ]
    }
  ],

  // Bookkeeping — one entry per numbered Example/Activity in THIS chapter (lesson-prefixed,
  // since numbering restarts per lesson):
  "coverage": [
    { "book_item": "L1 Example 1.1", "handled_by": "itf-f-ch1-l1-s1" },
    { "book_item": "L1 Activity 1.5", "handled_by": "itf-f-ch1-l1-s4", "note": "merged with 1.6 into one MCQ" }
  ],
  "skipped": [
    { "book_item": "Safety Tips sidebar (p.15)", "reason": "non-instructional sidebar; teacher resource" }
  ]
}
```

**Hard constraints — WARNING: the platform does NOT validate these for you.** An invalid value is
not rejected; it is **silently coerced into a broken lesson** (an `assessment` step missing
`mode_type` silently becomes an MCQ with no choices that no student can ever pass; a 9th choice is
silently cut while a correct answer pointing at it survives, making the question unanswerable).
The §11 checklist and the import driver are the ONLY enforcement — treat every item below as
absolute:

1. `mode` ∈ `explanation | media | reflection | practice | assignment | inquiry | assessment |
   revision` — lowercase, exact.
2. `mode_type` is REQUIRED for `practice` (`code` or `applied`), `assessment` (`mcq` or
   `open_ended`), `revision` (`recall`) — and must be ABSENT (or null) for every other mode.
3. `stage` ∈ `intro | teach | practice | assessment | review`.
4. MCQ steps (`assessment`/`mcq`) need BOTH:
   - `choices`: 2–8 items of `{ "id": "a", "text": "..." }` (ids `"a"`, `"b"`, `"c"`, `"d"`, …,
     unique), AND
   - `quiz`: `{ "prompt": <same or restated question>, "choices": <IDENTICAL array>,
     "correct_choice_ids": ["c"] }` with at least one correct id that exists in `choices`.
5. `practice`/`code` steps need `starter_code` (a complete runnable Jargon program) AND
   `expected_output` (its exact output per §6's formatting rules). Never use `ASK` in these.
6. `skill_keys`: max 24 per list, every key from the §8 table, `dotted.lowercase` form.
7. Slugs: exactly as pre-assigned in §10. Slugs are **stable references** used to assemble and
   import the package — the platform derives its own database ids from titles, so slugs never
   appear to students; but the importer keys on them, so drift breaks the import.
8. Strings are plain text; short inline markdown (bold, lists) is allowed in `prompt` only.
9. Emitted JSON: no comments, no trailing commas.

## §5 — Worked Example: Chapter 1, Lesson 1 "Purpose" (complete)

This is the fidelity and format bar. Study it before generating anything. (It is abbreviated only
in prose length — your explanation steps for this lesson would carry a little more of the book's
text, e.g. the space-shuttle/airplane pair from Example 1.1.)

```json
{
  "slug": "itf-f-ch1-l1",
  "title": "Purpose",
  "level": "Beginner",
  "lesson_type": "discussion",
  "tutor_prompt": "Help the learner connect everyday tools to the purposes they serve, then extend the idea to the four categories of computers. Ask for their own examples before confirming the book's categories.",
  "sample_code": "",
  "policy": {
    "help_ceiling": "guided",
    "require_attempt_first": true,
    "final_answer_policy": "after_attempt",
    "tutor_tone": "encouraging",
    "tutor_pace": "guided",
    "grade_band": "lower"
  },
  "milestone": {
    "title": "Purpose of technology",
    "objective": "Explain the purpose of a given technology and classify computers as general-purpose or specific-purpose.",
    "skill_keys": ["process.purpose", "itf.computers.categories"],
    "allowed_response_modes": ["text", "multiple_choice"]
  },
  "steps": [
    {
      "slug": "itf-f-ch1-l1-s1",
      "title": "Every technology serves a purpose",
      "stage": "intro",
      "mode": "explanation",
      "prompt": "Technology is any tool or machine that is made to serve a purpose. Each is used to perform a particular task. The hammer and the screwdriver are both tools made to help us build — but the hammer has the specific purpose of hammering in nails, while the screwdriver has the specific purpose of driving in screws. In the same way, the bus and the car are both machines made for transportation: the bus transports many people, the car transports few.",
      "skill_keys": ["process.purpose"]
    },
    {
      "slug": "itf-f-ch1-l1-s2",
      "title": "The four categories of computers",
      "stage": "teach",
      "mode": "explanation",
      "prompt": "The computer is also a technology. Some computers are general-purpose: personal computers (the desktop, laptop, tablet and smartphone) serve our entertainment, our work and our communication. Others are specific-purpose: embedded computers live inside machines like elevators and control them (they are often called control modules); a server has the specific purpose of serving the requests of many clients, like YouTube serving videos; and a supercomputer responds to one big request rather than many small ones — like predicting the weather. In general there are four main categories: embedded computers, personal computers, servers and supercomputers.",
      "skill_keys": ["itf.computers.categories"]
    },
    {
      "slug": "itf-f-ch1-l1-s3",
      "title": "Your own technologies",
      "stage": "practice",
      "mode": "reflection",
      "prompt": "Think of a technology from your own life that was NOT mentioned in the lesson. Name it, state the specific purpose it was made for, and say two tasks a personal computer can help YOU with. Explain in your own words.",
      "skill_keys": ["process.purpose"]
    },
    {
      "slug": "itf-f-ch1-l1-s4",
      "title": "Check: purposes and categories",
      "stage": "assessment",
      "mode": "assessment",
      "mode_type": "mcq",
      "prompt": "Which category of computer has the specific purpose of serving small requests from many clients at the same time?",
      "choices": [
        { "id": "a", "text": "Embedded computer" },
        { "id": "b", "text": "Personal computer" },
        { "id": "c", "text": "Server" },
        { "id": "d", "text": "Supercomputer" }
      ],
      "quiz": {
        "prompt": "Which category of computer has the specific purpose of serving small requests from many clients at the same time?",
        "choices": [
          { "id": "a", "text": "Embedded computer" },
          { "id": "b", "text": "Personal computer" },
          { "id": "c", "text": "Server" },
          { "id": "d", "text": "Supercomputer" }
        ],
        "correct_choice_ids": ["c"]
      },
      "skill_keys": ["itf.computers.categories"]
    }
  ]
}
```

And its bookkeeping entries in the chunk:

```json
"coverage": [
  { "book_item": "L1 Example 1.1", "handled_by": "itf-f-ch1-l1-s1" },
  { "book_item": "L1 Example 1.2", "handled_by": "itf-f-ch1-l1-s2" },
  { "book_item": "L1 Example 1.3", "handled_by": "itf-f-ch1-l1-s2" },
  { "book_item": "L1 Example 1.4", "handled_by": "itf-f-ch1-l1-s2" },
  { "book_item": "L1 Example 1.5", "handled_by": "itf-f-ch1-l1-s2" },
  { "book_item": "L1 Example 1.6", "handled_by": "itf-f-ch1-l1-s2", "note": "supercomputers predicting the weather" },
  { "book_item": "L1 Activity 1.1", "handled_by": "itf-f-ch1-l1-s4", "note": "matching → merged into the MCQ check" },
  { "book_item": "L1 Activity 1.2", "handled_by": "itf-f-ch1-l1-s3", "note": "merged into the reflection" },
  { "book_item": "L1 Activity 1.3", "handled_by": "itf-f-ch1-l1-s3" },
  { "book_item": "L1 Activity 1.4", "handled_by": "itf-f-ch1-l1-s2", "note": "the four PC types are named verbatim in the explanation" },
  { "book_item": "L1 Activity 1.5", "handled_by": "itf-f-ch1-l1-s4", "note": "fill-in-the-blank → merged into the MCQ check" },
  { "book_item": "L1 Activity 1.6", "handled_by": "itf-f-ch1-l1-s4", "note": "true/false → merged into the MCQ check" }
],
"skipped": [
  { "book_item": "L1 Safety Tips sidebar (p.15)", "reason": "posture/safety guidance — no interactive step; surface as a teacher resource" }
]
```

Notes on the judgment calls above (imitate them):
- Six paper activities became two interactive steps: paper formats that test the SAME facts
  (matching / fill-in / true-false) merge into one strong MCQ; "produce your own example" prompts
  merge into one reflection. Record every merge in `coverage`.
- If a merged MCQ cannot cover an activity's distinct facts, add a SECOND `assessment`/`mcq` step
  (up to the 6-step target) rather than overloading one question with sub-questions.

## §6 — Jargon Mini Language Reference (for `practice`/`code` steps)

Jargon is a small, English-flavored teaching language executed by a real engine. Programs you
write in `starter_code` are actually run, and `expected_output` is matched against the real
output. **There are exactly 11 statement forms. Nothing else exists.**

| Statement | Syntax | Notes |
|---|---|---|
| SET | `SET name (expression)` | value always in parentheses |
| SET (indexed) | `SET nums[i] (expression)` | update a list element |
| PRINT | `PRINT expression` | ONE expression per PRINT; join text with `+` and `str()` |
| ASK | `ASK "Question?" as var` | pauses for input — **NEVER use in a graded code step** |
| ADD | `ADD value to listname` | appends to a list |
| REMOVE | `REMOVE value from listname` | removes the FIRST occurrence **by value** (not by index) |
| IF / ELSE / END | `IF cond THEN … ELSE … END` | `THEN` optional; `ELSE` optional; `END` required |
| REPEAT | `REPEAT n times … END` | n = integer expression |
| REPEAT_UNTIL | `REPEAT_UNTIL cond … END` | loops until cond is true (see execution budget below) |
| REPEAT_FOR_EACH | `REPEAT_FOR_EACH item in listexpr … END` | lists/tuples ONLY — no string iteration |
| BREAK | `BREAK` | exits the innermost loop |

**There is NO:** `WHILE`, `FUNCTION`/procedures, `RETURN`, `ELIF` (nest `IF`s instead), string
iteration, imports, attribute calls (`x.append` is illegal — use `ADD`), comprehensions, lambdas.
**The book's own pseudocode keywords are NOT Jargon either**: `CALL`, `WAIT`, `SEND`, `RECEIVE`,
`WRITE`, `CONNECT`, `GOTO` all fail with "Unknown command" — transliterate the CONCEPT into the 11
statements above, never the keyword.

**Condition phrases** (the only recognized comparisons):
`is equal to`, `is not equal to`, `is greater than`, `is greater than or equal to`,
`is less than`, `is less than or equal to`, `is in`, `is not in`, `reaches end of`
(index reaches the end of a list), `is even`, `is odd` — combined with `AND`, `OR`, `NOT`
(`AND` binds tighter than `OR`). Comparisons may live inside parentheses too, e.g.
`IF (x % 3) is equal to 0 THEN`; bare boolean expressions are also accepted, e.g. `IF (x > 3)`.

**Expressions:** numbers, strings, booleans, `None`, lists, tuples, dictionaries with string keys,
indexing/slicing, `+ - * / // % **`, comparisons/boolean operators, and ONLY these functions:
`abs, bool, float, int, len, list, max, min, range, round, sorted, str, sum`. Numeric values are
capped at |n| ≤ 10¹² — exceeding it aborts the program (e.g. factorials beyond 14! fail), so keep
arithmetic small.

**Comments:** `#` inline; `//` only as a full-line comment (inside expressions `//` is floor
division).

**Execution budget:** the engine stops any program after ~1000 TOTAL executed statements (not
just loop iterations — a `REPEAT 400 times` loop with a 2-statement body dies mid-run with an
error line). Keep graded programs tiny: small inputs, short loops, well under a few hundred
executed statements.

**Output formatting rules for `expected_output`** (must match EXACTLY):
- Each `PRINT` emits one line; `expected_output` is those lines joined by newlines.
- Strings print WITHOUT quotes: `PRINT "Hello"` → `Hello`.
- Lists print Python-style with comma+space: `[6, 12, 18]`; string elements inside lists DO keep
  quotes: `['a', 'b']`.
- Booleans print `True` / `False`. Division prints floats (`7/2` → `3.5`) — use `//` when you want
  whole numbers.

**Three verified programs (with their exact outputs) to calibrate on:**

```jargon
SET name ("Maya")
PRINT "Hello " + name
```
→ output: `Hello Maya`

```jargon
SET nums ([1, 6, 9, 12, 14, 18])
SET selected ([])
REPEAT_FOR_EACH x in nums
    IF x is even AND (x % 3) is equal to 0 THEN
        ADD x to selected
    END
END
PRINT selected
```
→ output: `[6, 12, 18]`

```jargon
SET num (5)
SET result (1)
SET i (1)
REPEAT 100 times
    IF i is greater than num THEN
        PRINT result
        BREAK
    END
    SET result (result * i)
    SET i (i + 1)
END
```
→ output: `120`

**Book F concept → Jargon construct:**

| Book concept | Jargon | If not cleanly expressible |
|---|---|---|
| Instruction lists / sequence (Ch3 L1) | `SET`/`PRINT` sequences for computational tasks | everyday-action lists ("brush your teeth") → `practice`/`applied` (student writes ordered steps as text) |
| Conditionals (Ch3 L3) | `IF … THEN / ELSE / END` + condition phrases | — |
| Repetition (Ch3 L4) | `REPEAT n times`, `REPEAT_FOR_EACH`, `REPEAT_UNTIL`, `BREAK` | — |
| Searching (Ch4 L3) | `REPEAT_FOR_EACH` + `is equal to`, or `is in` | — |
| Sorting (Ch4 L4) | `sorted(nums)` as a demo; find-the-minimum loop as practice | full sorting algorithms → explanation walkthrough or `practice`/`applied` |
| Queues & stacks (Ch4 L5) | lists: enqueue `ADD x to q`; dequeue `SET front (q[0])` then `REMOVE front from q`; stack pop `SET top (s[len(s)-1])` then `REMOVE top from s` — keep list values UNIQUE (REMOVE is by first value) | conceptual LIFO/FIFO discussion → `reflection` |
| Names & addresses (Ch4 L2) | variables (`SET`) and list indices | — |
| Hardware / signals / memory (Ch1–2) | no code | explanation / reflection / assessment only |

**GOLDEN RULE:** if you are not 100% certain a program is valid Jargon per this reference and that
your `expected_output` is its exact output, make the step `practice`/`applied` instead of
`practice`/`code`. An applied step in prose is always safe; a broken code step blocks every
student.

## §7 — Pedagogy Mapping (book element → step)

| Book element | mode / mode_type | stage | Conversion notes |
|---|---|---|---|
| Prose section + bold definition callout | `explanation` | `intro` (first step) / `teach` | keep definitions faithful; ≤ ~250 words per step — split long sections across two explanation steps |
| Numbered worked Example | fold into the adjacent `explanation` | `teach` | retell the narrative; do not strip it to a summary |
| Fill-in-the-blank / matching / naming / true-false activity | `assessment` / `mcq` | `assessment` | convert to MCQ with 3–4 plausible choices; merge same-fact activities into one MCQ |
| Short-answer comprehension activity | `assessment` / `open_ended` OR `reflection` | `assessment` / `practice` | `open_ended` when it checks the milestone objective; `reflection` when it invites the student's own words |
| "Describe your own…" / give-an-example activity | `reflection` (default) or `inquiry` | `practice` / `review` | at most ONE `inquiry` per lesson |
| Computational pseudocode activity (Ch3–4) | `practice` / `code` | `practice` | valid Jargon + exact `expected_output`; unsure → applied |
| Everyday-action pseudocode (getting ready for school) | `practice` / `applied` | `practice` | student writes the ordered steps in text |
| End-of-lesson review / recap | `assessment` (mcq or open_ended) | `assessment` or `review` | the LAST step; closes the loop on the milestone objective |
| Chapter-closing recap (optional, last lesson of a unit only) | `revision` / `recall` | `review` | retrieval of the unit's earlier lessons |

## §8 — Skill Keys (closed vocabulary — use ONLY these)

Reused platform keys (they already exist and carry cross-course mastery):
`process.purpose`, `systems.input`, `systems.process`, `systems.output`, `signals.conversion`,
`signals.exchange`, `memory.storage`, `logic.sequence`, `jargon.set`, `jargon.print`,
`jargon.if`, `jargon.list`, `jargon.loop`.

New Book-F keys (minted under the series-scoped `itf.` namespace so future IT Frontiers books
reuse them):
`itf.computers.categories`, `itf.signals.types`,
`itf.hardware.performance`, `itf.hardware.energy`, `itf.hardware.portability`,
`itf.software.instructions`, `itf.software.types`, `itf.logic.conditionals`,
`itf.logic.repetition`, `itf.data.structures`, `itf.data.addressing`, `itf.data.searching`,
`itf.data.sorting`, `itf.data.queue`, `itf.data.stack`.

Pre-assigned per lesson (milestone keys; steps use a subset of their lesson's keys):

| Lesson | skill_keys |
|---|---|
| itf-f-ch1-l1 Purpose | `process.purpose`, `itf.computers.categories` |
| itf-f-ch1-l2 Systems & Signals | `systems.input`, `systems.process`, `systems.output`, `itf.signals.types` |
| itf-f-ch1-l3 Signal Processing | `signals.conversion`, `systems.process` |
| itf-f-ch1-l4 Memory | `memory.storage` |
| itf-f-ch1-l5 Exchanging Signals | `signals.exchange`, `systems.output` |
| itf-f-ch2-l1 Performance | `itf.hardware.performance` |
| itf-f-ch2-l2 Energy | `itf.hardware.energy` |
| itf-f-ch2-l3 Portability | `itf.hardware.portability` |
| itf-f-ch3-l1 Instructions | `logic.sequence`, `itf.software.instructions` |
| itf-f-ch3-l2 Software | `itf.software.types`, `jargon.set`, `jargon.print` |
| itf-f-ch3-l3 Conditionals | `jargon.if`, `itf.logic.conditionals` |
| itf-f-ch3-l4 Repetition | `jargon.loop`, `itf.logic.repetition` |
| itf-f-ch4-l1 Data & Structures | `jargon.list`, `itf.data.structures` |
| itf-f-ch4-l2 Names & Addresses | `jargon.set`, `itf.data.addressing` |
| itf-f-ch4-l3 Searching | `itf.data.searching`, `jargon.loop` |
| itf-f-ch4-l4 Sorting | `itf.data.sorting` |
| itf-f-ch4-l5 Queues & Stacks | `itf.data.queue`, `itf.data.stack`, `jargon.list` |

## §9 — Per-Lesson Defaults & Structure Rules

Copy these into every lesson unless the mapping table forces otherwise:

```json
"level": "Beginner",
"policy": {
  "help_ceiling": "guided",
  "require_attempt_first": true,
  "final_answer_policy": "after_attempt",
  "tutor_tone": "encouraging",
  "tutor_pace": "guided",
  "grade_band": "lower"
}
```

- `lesson_type`: `"discussion"` for every Chapter 1–2 lesson; `"code"` for any Chapter 3–4 lesson
  that contains at least one `practice`/`code` step (then set `sample_code` to that lesson's
  simplest runnable program); otherwise `"discussion"`.
- **1 book lesson = 1 Jargon lesson. 1 chapter = 1 unit.** Never split a book lesson (it would
  break the slug table). If a lesson has more activities than fit in 6 steps, MERGE same-fact
  activities (per §7) rather than splitting.
- 4–6 steps per lesson; absolute cap 8 (the slug table provides `-s1` … `-s8` and no more).
- `tutor_prompt` is a mentor brief, not content: what to emphasize, what to ask for first, common
  misconception to watch for. 1–3 sentences.

## §10 — Chunk Protocol & Slug Table

One conversation, five turns:

- **Turn 0 (ingestion echo):** you re-state the slug table below and list every numbered Example
  and Activity you find in EACH chapter of the attached PDF (a per-chapter inventory). You
  generate NO manifest JSON in this turn. This proves you actually read the book.
- **Turns 1–4:** one chunk file per turn — `itf-f-ch1.json`, `itf-f-ch2.json`, `itf-f-ch3.json`,
  `itf-f-ch4.json` — each a complete `jargon-book-manifest/v1` document containing exactly one
  unit, with `subject` and `course` blocks **byte-identical across all four files**.
- If a response is cut off: on "continue", re-emit the ENTIRE chunk file, never a fragment.
- No renaming, no re-slugging, no cross-chapter references (skill keys from §8 are the only shared
  vocabulary).

**Slug table (pre-assigned; use character-for-character):**

| Slug | Book lesson |
|---|---|
| `itf-beginner` | (subject) |
| `itf-f` | (course) |
| `itf-f-ch1` | Chapter 1 — Systems & Signals |
| `itf-f-ch1-l1` | Ch1 L1 Purpose |
| `itf-f-ch1-l2` | Ch1 L2 Systems & Signals |
| `itf-f-ch1-l3` | Ch1 L3 Signal Processing |
| `itf-f-ch1-l4` | Ch1 L4 Memory |
| `itf-f-ch1-l5` | Ch1 L5 Exchanging Signals |
| `itf-f-ch2` | Chapter 2 — Computer Design |
| `itf-f-ch2-l1` | Ch2 L1 Performance |
| `itf-f-ch2-l2` | Ch2 L2 Energy |
| `itf-f-ch2-l3` | Ch2 L3 Portability |
| `itf-f-ch3` | Chapter 3 — Instructions & Software |
| `itf-f-ch3-l1` | Ch3 L1 Instructions |
| `itf-f-ch3-l2` | Ch3 L2 Software |
| `itf-f-ch3-l3` | Ch3 L3 Conditionals |
| `itf-f-ch3-l4` | Ch3 L4 Repetition |
| `itf-f-ch4` | Chapter 4 — Data & Data Structures |
| `itf-f-ch4-l1` | Ch4 L1 Data & Structures |
| `itf-f-ch4-l2` | Ch4 L2 Names & Addresses |
| `itf-f-ch4-l3` | Ch4 L3 Searching |
| `itf-f-ch4-l4` | Ch4 L4 Sorting |
| `itf-f-ch4-l5` | Ch4 L5 Queues & Stacks |

Steps: `<lesson-slug>-s1` … `-s8`, in order (target 4–6; 8 is the absolute cap).

**The 'How to' Appendix (MS Word/Excel/PowerPoint) is NOT converted** — it appears once, in
`itf-f-ch4.json`'s `skipped` array, with the reason "application how-to guide; import as teacher
resources, not lessons".

## §11 — Self-Validation Checklist (run before emitting EVERY chunk)

After the JSON code block, print `CHECKLIST: PASS` — or each failing item — having verified:

1. The output parses as strict JSON: no comments, no trailing commas.
2. Every `mode`, `mode_type`, `stage`, `help_ceiling`, `final_answer_policy` value is from §4's
   enums, lowercase, exact; `mode_type` present exactly where required and absent elsewhere.
3. Every MCQ: 2–8 choices with unique ids; `quiz.choices` is IDENTICAL to `choices`; every entry
   of `correct_choice_ids` exists in `choices`; and you re-derived the keyed answer from the book
   text (not from memory).
4. Every `practice`/`code` step: you traced the `starter_code` line by line against §6 — every
   statement is one of the 11 forms, every condition phrase is from the list, no banned features,
   no `ASK`, loops terminate well under the ~1000 total-executed-statement budget — and
   `expected_output` matches your trace EXACTLY (list formatting, `True`/`False` capitalization,
   no quotes around printed strings).
5. Every skill key appears in §8's tables.
6. `coverage` + `skipped` together account for EVERY numbered Example and Activity in this
   chapter, with lesson-prefixed keys (`"L2 Activity 2.3"`) — cross-check against your Turn-0
   inventory. (Remember the Ch1 L5 misprint: its Examples are numbered 4.x in the book.)
7. No sentence in any `prompt` states a fact that is not in the book.
8. Every slug matches §10 character-for-character; `subject`/`course` blocks are byte-identical
   to the previous chunks.

## §12 — Kickoff Messages (operator: paste these one at a time)

**Message 0 — ingestion check:**
> Read the specification I sent and the attached Book F PDF end to end. Reply with: (1) the slug
> table exactly as given, (2) for each of the four chapters, the complete numbered list of every
> Example and every Activity you found in the PDF (numbers + one-line description). Do not
> generate any manifest JSON yet.

**Message 1:**
> Generate chunk `itf-f-ch1` now: Chapter 1 (Systems & Signals) only — all five lessons, one
> complete `jargon-book-manifest/v1` JSON code block for the file `itf-f-ch1.json`, then the §11
> checklist verdict.

**Message 2:**
> Generate chunk `itf-f-ch2` now: Chapter 2 (Computer Design) only — all three lessons, one JSON
> code block for `itf-f-ch2.json` (subject/course blocks byte-identical to chunk 1), then the
> checklist verdict.

**Message 3:**
> Generate chunk `itf-f-ch3` now: Chapter 3 (Instructions & Software) only — all four lessons.
> This chapter introduces pseudocode: follow §6 strictly; use `practice`/`code` only where you are
> certain the Jargon is valid, otherwise `practice`/`applied`. One JSON code block for
> `itf-f-ch3.json`, then the checklist verdict.

**Message 4:**
> Generate chunk `itf-f-ch4` now: Chapter 4 (Data & Data Structures) only — all five lessons, plus
> the appendix `skipped` entry. One JSON code block for `itf-f-ch4.json`, then the checklist
> verdict.

---

*Platform note (not for the generating AI): the four chunk files are consumed by an importer that
replays them through the platform's `curriculum-admin` actions (create_subject → create_course →
create_unit → create_lesson_stub → save_lesson_meta → upsert_step → publish_lesson), validating
every `practice`/`code` step against the real Jargon engine before any network call. Driver
gotchas already identified: (1) the platform does NOT validate §4's constraints — the driver must
enforce them all itself before any write (invalid values silently coerce into broken lessons);
(2) `create_lesson_stub` auto-creates a placeholder step `<lessonId>-activity-1` — pass that id as
step 1's `step.id` (or `delete_step` it) so lessons don't publish with a stray "Add a prompt for
learners." step; (3) `save_lesson_meta` reads policy fields FLAT on `meta` (`meta.help_ceiling`
etc.) — the manifest's nested `policy` block must be flattened, or the whole policy silently
drops. That driver script is the follow-up task after the content is generated.*
