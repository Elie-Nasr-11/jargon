# Book import tools

Turning an *IT Frontiers* Teacher Edition PDF into curriculum source.

These books are unusually good input: clean selectable text, a strict type scale,
and — the important part — **the Teacher Edition prints every answer in red**
(`#ff5739`), both the correct multiple-choice option and the written model answers.
So the answer key is *extracted*, never inferred: a quiz built from this source is
right because the book says so, not because a model guessed well.

## The type scale (measured, not assumed)

| size | meaning |
|-----:|---------|
| 27 | lesson title (`Lesson 1: Introducing Computers`) |
| 24+ | chapter divider |
| 18 | section heading, and `Activity N.N` |
| 15 | definitions, examples, callouts |
| 13 | running header |
| 12 | body |

## Usage

```bash
cd tools/book-import
node extract.mjs <book.pdf> <key> <outDir>     # per-lesson source + answer key
node survey.mjs  <book.pdf>                    # pages, text volume, image count
node sections.mjs <book.pdf>                   # the lesson/section skeleton
node colors.mjs  <book.pdf> <page>             # what the red key holds on one page
```

`extract.mjs` writes one JSON per book lesson (`<key>-ch<N>-l<N>.json`) plus an
`index.json`, each carrying:

- `source` — the lesson's text in reading order, section headings as `## X`,
  definitions and examples as `> …`, justified hyphenation rejoined
  (the PDF stores `Process - ing` as three runs; left alone the mentor reads it aloud)
- `answer_key` — every red run, by page

## Structure found

- **A1** (224pp): Ch1 *Computers* (5 lessons) · Ch2 *Computers & Beyond* (4 lessons)
- **A2** (256pp): Ch3 *Data & Information* (4 lessons) · Ch4 *Artificial Intelligence* (4 lessons)

17 book lessons total. Each is ~20–35 pages: several concept sections plus ~10
numbered activities — which is why one book lesson becomes one platform lesson with
many steps rather than a handful.

Chapters are detected by lesson numbering RESTARTING, not by page heuristics: that
is the book's own signal and it does not drift.
