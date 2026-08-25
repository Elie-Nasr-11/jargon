// Turn a Teacher Edition PDF into structured per-lesson source for curriculum
// authoring.
//
// The books are beautifully regular, and the Teacher Edition marks every answer in
// red — both the correct MCQ option and the written model answers — so the answer
// key is EXTRACTED, never inferred: a composed quiz is right because the book says
// so. R61 v2: the books use THREE answer reds (the AI chapter is set almost
// entirely in the second one), red is marked at the ITEM level so answers never
// leak into student-facing text, activities come out as structured objects with
// their answers attached, page anchors survive, and the Appendix/glossary is split
// off the final lesson into its own document.
//
// Type scale (measured): 27 = lesson title, 24+ = chapter, 18 = section heading /
// "Activity N.N", 15 = definitions, examples and callouts, 13 = running header,
// 12 = body.
import { getDocument, OPS } from "../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const [file, bookKey, outDir] = [process.argv[2], process.argv[3], process.argv[4]];
// All three inks the books print answers in. #ff5739 dominates book A1, #ff4227
// carries nearly the whole AI chapter of A2, #ff7657 is an occasional variant.
const ANSWER_REDS = new Set(["#ff5739", "#ff4227", "#ff7657"]);

const doc = await getDocument({
  data: new Uint8Array(await readFile(file)),
  useSystemFonts: true,
}).promise;

// Colour comes from the operator list, text from getTextContent. v2 joins them at
// the ITEM level: each red show-text run is matched (in order) against the text
// items, and the matched items are flagged red. A red item never enters block or
// activity text — that IS the leak-strip — it becomes the answer attached to the
// question it follows in reading order, which also makes the two-column page
// scramble harmless: answers ride WITH their questions. never re-sort questions.
async function pageParts(pageNo) {
  const page = await doc.getPage(pageNo);
  const [content, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
  const redRuns = [];
  let fill = "";
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    if (ops.fnArray[i] === OPS.setFillRGBColor) {
      // pdf.js normalises this to ONE css hex string, not an r,g,b triple.
      const arg = ops.argsArray[i][0];
      fill = typeof arg === "string" ? arg.toLowerCase() : "";
    } else if (ops.fnArray[i] === OPS.showText) {
      const glyphs = Array.isArray(ops.argsArray[i][0]) ? ops.argsArray[i][0] : [];
      const text = glyphs
        .map((g) => (g && typeof g === "object" && g.unicode) || "")
        .join("")
        .trim();
      if (text && ANSWER_REDS.has(fill)) redRuns.push(text);
    }
  }
  const items = content.items
    .filter((it) => it.str.trim())
    .map((it) => ({
      str: it.str.replace(/\s+/g, " "),
      size: Math.round(Math.abs(it.transform[3])),
      red: false,
    }));
  // Join red runs to items by ordered text match (contains either way — pdf.js
  // sometimes splits a run across items or merges two runs into one item).
  const unmatched = [];
  let cursor = 0;
  for (const run of redRuns) {
    const norm = run.replace(/\s+/g, " ").trim();
    let found = -1;
    for (let i = cursor; i < items.length; i += 1) {
      const s = items[i].str.trim();
      if (!s) continue;
      // Short runs ("T", "F", "b") must match exactly — substring matching would
      // hit any word containing that letter.
      if (norm.length <= 2 || s.length <= 2) {
        if (s === norm) {
          found = i;
          break;
        }
        continue;
      }
      if (s.includes(norm) || norm.includes(s)) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      unmatched.push(norm);
      continue;
    }
    items[found].red = true;
    cursor = found;
    // A long run spanning several items: keep flagging while the remainder of the
    // run starts with the next item's text.
    let rest = norm;
    const head = items[found].str.trim();
    if (rest.startsWith(head)) rest = rest.slice(head.length).trim();
    else rest = "";
    let j = found + 1;
    while (rest && j < items.length) {
      const s = items[j].str.trim();
      if (s && rest.startsWith(s)) {
        items[j].red = true;
        rest = rest.slice(s.length).trim();
        cursor = j;
      } else if (!s) {
        // skip empties
      } else break;
      j += 1;
    }
  }
  return { items, redRuns, unmatched };
}

const RUNNING_HEADER = /^(chapter|lesson)\s|^\d{1,3}$/i;
const ACTIVITY_RE = /^Activity\s+(\d+)\.(\d+)(?:\s*\(continued\))?(?:\s*[-–—]\s*(.+))?$/i;

// The books are set justified with hyphenation, and the PDF keeps the hyphen as its
// own run: "Process - ing", "per - form". Left alone the mentor would read them
// aloud that way. Rejoin only where a lowercase fragment meets a lowercase
// fragment — real dashes ("cold, wet - smooth") keep their spaces.
function dehyphenate(text) {
  return text
    .replace(/([a-z]{2,}) - ([a-z]{2,})/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

// The AI chapter's display font decodes badly and its running titles dodge the
// size filter, leaking lines like "artifi ia al li i t t aai i tiit 168". A line
// of many mostly-1-2-char tokens is that garbage, never prose.
function isGarbledHead(text) {
  const cleaned = text.replace(/\s+\d{1,3}$/, "");
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length < 5) return false;
  const tiny = tokens.filter((t) => t.length <= 2).length;
  return tiny / tokens.length >= 0.7;
}

// The garbage also arrives GLUED to real prose in one item ("artifi ia al li i t
// t aai i tiit Through repetition…") — strip the longest garbled prefix.
function stripGarbledPrefix(text) {
  const tokens = text.split(/\s+/);
  let cut = 0;
  for (let window = Math.min(tokens.length, 15); window >= 5; window -= 1) {
    const head = tokens.slice(0, window);
    // Garble is LETTER shrapnel — digit tokens ("4.4"), dashes and real acronyms
    // must not count, or "Activity 4.4 - Exploring AI" reads as trash.
    const tiny = head.filter((t) => /^[a-z]{1,2}$/i.test(t) && !/^(a|i|an|is|it|of|to|in|on|at|we|he|by|or|as|be|do|if|no|so|up|us)$/i.test(t)).length;
    if (tiny / window >= 0.6) {
      cut = window;
      break;
    }
  }
  return cut ? tokens.slice(cut).join(" ") : text;
}

const lessons = [];
let current = null;
let chapter = { number: 0, title: "" };
let pendingChapterTitle = "";

for (let n = 1; n <= doc.numPages; n += 1) {
  const { items, redRuns, unmatched } = await pageParts(n);

  // A page that opens a lesson or a chapter re-titles the current bucket.
  const bigs = items.filter((it) => it.size >= 24).map((it) => it.str.trim());
  const bigLine = bigs.join(" ").replace(/\s+/g, " ").trim();
  const lessonMatch = bigLine.match(/Lesson\s+(\d+)\s*:?\s*(.*)$/i);
  if (lessonMatch) {
    const lessonNumber = Number(lessonMatch[1]);
    // Lesson 1 after a later lesson means a new chapter started; the divider page
    // gave us its title.
    if (current && lessonNumber <= current.number) {
      chapter = { number: chapter.number + 1, title: pendingChapterTitle || chapter.title };
      pendingChapterTitle = "";
    }
    current = {
      book: bookKey,
      chapter: { ...chapter },
      number: lessonNumber,
      title: lessonMatch[2].trim() || bigs[bigs.length - 1] || "",
      firstPage: n,
      lastPage: n,
      blocks: [],
      notes: [],
      activities: [],
      answers: [],
      answersUnmatched: [],
      openActivity: null,
      openNote: null,
    };
    lessons.push(current);
  } else if (bigLine && items.length < 8 && !/table of contents|teacher|frontiers/i.test(bigLine)) {
    // A chapter divider: a big title on an otherwise empty page. Hold the title —
    // the chapter turns over when the next lesson numbering restarts.
    if (!chapter.title) chapter = { number: 1, title: bigLine };
    else pendingChapterTitle = bigLine;
    continue;
  }
  if (!current) continue;
  current.lastPage = n;
  if (redRuns.length) current.answers.push({ page: n, runs: redRuns });
  if (unmatched.length) current.answersUnmatched.push({ page: n, runs: unmatched });

  // Page footers print the running titles at body size ("computers 26") — a line
  // whose words (digits stripped) are all title words is furniture, inside an
  // activity as much as in prose.
  // Single-letter tokens are never title words — "a1" would otherwise donate "a"
  // and swallow every "a)" option marker.
  const titleWords = new Set(
    `${current.title} ${current.chapter.title}`
      .toLowerCase()
      .replace(/[^a-z ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2),
  );
  const isFooter = (text) => {
    const words = text.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
    return words.length > 0 && words.length <= 4 && words.every((w) => titleWords.has(w));
  };

  // The books sometimes paint one heading as several size-18 items ("Activity" +
  // "1.6") — coalesce consecutive heading items into ONE unit before classifying,
  // or the activity boundary is missed and the next questions bleed backward.
  const units = [];
  for (const it of items) {
    const str = it.str.trim();
    if (!str) continue;
    if (it.size === 13 && RUNNING_HEADER.test(str)) continue; // running header
    if (it.size >= 24) continue; // already captured as the lesson title
    if (/^\d{1,3}$/.test(str) && it.size <= 15) continue; // page number
    if (isGarbledHead(str)) continue; // decoded-font running-title garbage
    if (!it.red && it.size <= 15 && isFooter(str)) continue; // page footer
    const cleanStr = it.red || it.size >= 18 ? str : stripGarbledPrefix(str);
    if (!cleanStr) continue;
    const last = units[units.length - 1];
    if (it.size === 18 && !it.red && last && last.kind === "heading") {
      last.text += ` ${cleanStr}`;
    } else {
      units.push({
        kind: it.size === 18 && !it.red ? "heading" : "item",
        text: cleanStr,
        size: it.size,
        red: Boolean(it.red),
      });
    }
  }

  for (const it of units) {
    const str = it.text.trim();
    if (it.kind === "heading") {
      const activityMatch = str.match(ACTIVITY_RE);
      current.openNote = null;
      if (activityMatch) {
        const number = `${activityMatch[1]}.${activityMatch[2]}`;
        const continued = /\(continued\)/i.test(str);
        // "(continued)" (a page-break re-emit) merges into the SAME activity.
        if (continued && current.openActivity?.number === number) {
          current.openActivity.pageEnd = n;
        } else if (current.openActivity?.number === number) {
          current.openActivity.pageEnd = n;
        } else {
          current.openActivity = {
            number,
            title: (activityMatch[3] || "").trim(),
            page: n,
            pageEnd: n,
            frags: [], // ordered {red, text} fragments
          };
          current.activities.push(current.openActivity);
        }
      } else if (/^notes$/i.test(str)) {
        // Teacher-edition sidebar: collected separately, out of the main flow.
        current.openActivity = null;
        current.openNote = { page: n, text: "" };
        current.notes.push(current.openNote);
      } else {
        current.openActivity = null;
        current.blocks.push({ kind: "heading", page: n, text: str });
      }
      continue;
    }

    if (current.openActivity) {
      current.openActivity.pageEnd = n;
      current.openActivity.frags.push({ red: it.red, text: str });
      continue;
    }
    if (it.red) continue; // red outside an activity: answer_key keeps it; text never does
    if (current.openNote) {
      current.openNote.text += current.openNote.text ? ` ${str}` : str;
      continue;
    }
    const kind = it.size === 15 ? "callout" : "body";
    const last = current.blocks[current.blocks.length - 1];
    if (last && last.kind === kind && last.page === n) last.text += ` ${str}`;
    else current.blocks.push({ kind, page: n, text: str });
  }
}

// ---------------------------------------------------------------------------
// Activity parsing: fragments → {intro, items[{n, stem, options, answer}]}.
// Question numbering follows READING order — the two-column layout scrambles it
// (1,3,2,4) and the red answers follow the SAME scramble, so we never re-sort.
// ---------------------------------------------------------------------------

function parseActivity(activity, lessonAnswers) {
  // 1. Coalesce consecutive same-colour fragments into alternating spans.
  const spans = [];
  for (const frag of activity.frags) {
    const text = dehyphenate(frag.text);
    if (!text) continue;
    const last = spans[spans.length - 1];
    if (last && last.red === frag.red) last.text += ` ${text}`;
    else spans.push({ red: frag.red, text });
  }
  for (const span of spans) {
    if (!span.red) span.text = stripGarbledPrefix(span.text);
  }

  // 2. Build the parse string. A red span that immediately follows an option
  //    marker IS that option's text (the book prints the CORRECT option in red) —
  //    it is inlined so the option list stays complete, AND recorded as the
  //    answer. Every other red span is a model answer: recorded, never inlined —
  //    that is the leak-strip.
  let text = "";
  const reds = []; // {offset, text, inline}
  for (const span of spans) {
    if (!span.red) {
      text += text ? ` ${span.text}` : span.text;
      continue;
    }
    const inline = /(?:^|\s)[a-d]\)$/.test(text.trimEnd());
    reds.push({ offset: text.length, text: span.text, inline });
    if (inline) text += ` ${span.text}`;
  }

  // The Appendix has no size-18 heading, so the book's back matter rides into the
  // final open activity — truncate the parse string at the marker and hand the
  // spill back for the book-level glossary.
  let spilled = "";
  const glossaryAt = text.search(/Appendix\s+Term Definition Page/i);
  if (glossaryAt >= 0) {
    spilled = text.slice(glossaryAt);
    text = text.slice(0, glossaryAt).replace(/\s+\d{1,3}\s*$/, "").trim();
  }

  // 3. Question starts, in READING order (the two-column scramble emits 1,3,2,4 —
  //    the answers follow the same order, so we never re-sort).
  const starts = [];
  const qre = /(?:^|\s)(\d{1,2})[.)]\s+(?=\S)/g;
  let match;
  while ((match = qre.exec(text))) {
    const qn = Number(match[1]);
    if (qn >= 1 && qn <= 25) {
      starts.push({ n: qn, at: match.index, bodyAt: qre.lastIndex });
    }
  }
  const intro = text.slice(0, starts.length ? starts[0].at : text.length).trim();

  const buckets = starts.map((startMark, i) => ({
    n: startMark.n,
    from: startMark.at,
    bodyAt: startMark.bodyAt,
    to: i + 1 < starts.length ? starts[i + 1].at : text.length,
  }));

  const norm = (t) => t.replace(/\s+/g, " ").replace(/\.\s*$/, "").trim().toLowerCase();
  const items = buckets.map((bucket) => {
    const body = text.slice(bucket.bodyAt, bucket.to).trim();
    const parts = body.split(/\s(?=[a-d]\)\s)/);
    let stem = body;
    let options = [];
    if (parts.length > 1) {
      stem = parts[0].trim();
      options = parts
        .slice(1)
        .map((part) => {
          const m = part.match(/^([a-d])\)\s*(.+)$/s);
          return m ? { id: m[1], text: m[2].trim() } : null;
        })
        .filter(Boolean);
    }
    const last = options[options.length - 1];
    if (last && last.text.length > 120) {
      const cut = last.text.indexOf(". ");
      if (cut > 15) last.text = last.text.slice(0, cut).trim();
    }
    return { n: bucket.n, from: bucket.from, to: bucket.to, stem, options, answer: { letter: null, text: null, tf: null } };
  });

  // 4. Assign reds to their bucket by offset; intro-level reds keep separately.
  const introAnswers = [];
  const tfLetters = [];
  const tfTokens = (t) => t.split(/[\s|]+/).filter(Boolean);
  for (const red of reds) {
    const asTf = tfTokens(red.text);
    const isTfRun = asTf.length > 0 && asTf.every((tok) => /^[TF]$/i.test(tok));
    if (isTfRun) tfLetters.push(...asTf.map((tok) => tok.toUpperCase()));
    const bucket = items.find((item) => red.offset >= item.from && red.offset < item.to);
    if (!bucket) {
      if (!isTfRun) introAnswers.push(red.text);
      continue;
    }
    if (red.inline) {
      // The red option: find which option carries this text — record the letter,
      // the option itself stays in the list. When the option text ran past the red
      // run (the last option of a bucket absorbs trailing prose), the red run IS
      // the true option text — restore it.
      const target = norm(red.text);
      const hit =
        bucket.options.find((o) => norm(o.text) === target) ||
        bucket.options.find((o) => norm(o.text).startsWith(target) || target.startsWith(norm(o.text)));
      if (hit) {
        bucket.answer.letter = hit.id;
        if (norm(hit.text) !== target && norm(hit.text).startsWith(target)) hit.text = red.text;
      }
      if (!bucket.answer.text) bucket.answer.text = red.text;
    } else if (isTfRun && asTf.length === 1) {
      bucket.answer.tf = asTf[0].toUpperCase();
    } else if (!isTfRun) {
      bucket.answer.text = bucket.answer.text ? `${bucket.answer.text} | ${red.text}` : red.text;
    }
  }

  const named = Boolean(activity.title);
  // The teacher edition sometimes prints the instruction line itself in red — the
  // type cue can live in either colour.
  const allText = `${intro} ${introAnswers.join(" ")}`;
  const tfType =
    /write on the line provided/i.test(allText) ||
    /['\u2018\u2019"]T['\u2018\u2019"] if it is true/i.test(allText);
  const matchType = /match each word/i.test(allText);

  // T/F grids print unnumbered statements under a "Statement" column header —
  // bucket them by sentence when no numbered questions were found.
  if (tfType && items.length === 0) {
    const gridText = intro
      .replace(/^.*?\bStatement\b/s, "")
      .replace(/(?:\s+[TF])+\s*$/g, "")
      .trim();
    const sentences = gridText.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
    for (const sentence of sentences) {
      items.push({ n: items.length + 1, from: -1, to: -1, stem: sentence, options: [], answer: { letter: null, text: null, tf: null } });
    }
  }

  // T/F grids print the letters as a trailing column. The OP-LEVEL red runs are
  // the exact per-letter sequence (item joins can merge two letters and shift the
  // grid) — prefer the run-derived list for pairing, in listed order.
  const runLetters = [];
  for (const bucket of lessonAnswers) {
    if (bucket.page < activity.page || bucket.page > activity.pageEnd) continue;
    for (const run of bucket.runs) {
      if (/^[TF]$/i.test(run.trim())) runLetters.push(run.trim().toUpperCase());
    }
  }
  const letters = runLetters.length >= tfLetters.length ? runLetters : tfLetters;
  if (tfType && letters.length) {
    items.forEach((item, i) => {
      if (letters[i]) item.answer.tf = letters[i];
    });
  }

  const type = named
    ? "project"
    : tfType
      ? "tf"
      : matchType
        ? "match"
        : items.some((item) => item.options.length >= 2)
          ? "mcq"
          : "open";

  // Project tips: "Tips: • … • …" bullets anywhere in the activity text.
  let tips = [];
  const tipsMatch = text.match(/Tips:\s*(.+)$/i);
  if (named && tipsMatch) {
    tips = tipsMatch[1]
      .split(/\s*\u2022\s*/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  return {
    number: activity.number,
    page: activity.page,
    pageEnd: activity.pageEnd,
    type,
    title: activity.title || "",
    intro,
    items: items.map(({ from, to, ...item }) => item),
    intro_answers: introAnswers,
    tips,
    answers_unmatched: [],
    spilled,
  };
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

await mkdir(outDir, { recursive: true });
const index = [];
const glossary = { book: bookKey, from_page: null, raw: "", entries: [] };

for (const lesson of lessons) {
  const titleWords = new Set(
    `${lesson.title} ${lesson.chapter.title}`
      .toLowerCase()
      .replace(/[^a-z ]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
  const isRunningTitle = (text) => {
    const words = text.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
    // A short line made only of words from the running head is page furniture.
    return words.length > 0 && words.length <= 4 && words.every((w) => titleWords.has(w));
  };

  let blocks = lesson.blocks
    .map((b) => ({ ...b, text: stripGarbledPrefix(dehyphenate(b.text)) }))
    .filter((b) => b.text && !(b.kind === "body" && isRunningTitle(b.text)));

  // Glossary split: the final lesson of each book swallows the Appendix. Truncate
  // at the marker and route the remainder to the book-level glossary document.
  const GLOSSARY_RE = /Appendix\s+Term Definition Page/i;
  for (let i = 0; i < blocks.length; i += 1) {
    const m = blocks[i].text.match(GLOSSARY_RE);
    if (!m) continue;
    const at = blocks[i].text.search(GLOSSARY_RE);
    const kept = blocks[i].text.slice(0, at).replace(/\s+\d{1,3}\s*$/, "").trim();
    const spilled = blocks[i].text.slice(at);
    glossary.from_page = blocks[i].page;
    glossary.raw = [spilled, ...blocks.slice(i + 1).map((b) => b.text)].join("\n");
    blocks = blocks.slice(0, i);
    if (kept) blocks.push({ kind: "body", page: glossary.from_page, text: kept });
    break;
  }

  const activities = lesson.activities.map((activity) => parseActivity(activity, lesson.answers));
  for (const activity of activities) {
    if (activity.spilled) {
      glossary.from_page = glossary.from_page ?? activity.pageEnd;
      glossary.raw += (glossary.raw ? "\n" : "") + activity.spilled;
    }
    delete activity.spilled;
  }
  // Per-page unmatched reds ride on the activity covering that page (else lesson-level).
  for (const bucket of lesson.answersUnmatched) {
    const owner = activities.find((a) => bucket.page >= a.page && bucket.page <= a.pageEnd);
    if (owner) owner.answers_unmatched.push(...bucket.runs);
  }

  const sections = blocks
    .filter((b) => b.kind === "heading")
    .map((b) => ({ title: b.text, page: b.page }));
  const notes = lesson.notes
    .map((note) => ({ page: note.page, text: dehyphenate(note.text) }))
    .filter((note) => note.text);

  // Stitched source, with [pN] anchors at page turns, for eyeballing and joins.
  let lastPage = 0;
  const body = blocks
    .map((b) => {
      const anchor = b.page !== lastPage ? `[p${b.page}] ` : "";
      lastPage = b.page;
      return b.kind === "heading" ? `\n## ${anchor}${b.text}\n` : b.kind === "callout" ? `> ${anchor}${b.text}` : `${anchor}${b.text}`;
    })
    .join("\n");
  const answerKey = lesson.answers
    .map((a) => `p${a.page}: ${a.runs.map(dehyphenate).join(" | ")}`)
    .join("\n");

  const slug = `${bookKey}-ch${lesson.chapter.number}-l${lesson.number}`;
  const out = {
    slug,
    book: bookKey,
    chapter: lesson.chapter,
    lesson: { number: lesson.number, title: lesson.title },
    pages: [lesson.firstPage, lesson.lastPage],
    chars: body.length,
    sections,
    blocks,
    notes,
    activities,
    source: body,
    answer_key: answerKey,
  };
  await writeFile(`${outDir}/${slug}.json`, JSON.stringify(out, null, 2));
  index.push({
    slug,
    chapter: lesson.chapter.title,
    title: lesson.title,
    pages: out.pages,
    chars: body.length,
    sections: sections.length,
    activities: activities.length,
    answered: activities.filter((a) =>
      a.items.some((item) => item.answer.letter || item.answer.text || item.answer.tf),
    ).length,
  });
}

if (glossary.raw) {
  // Best-effort entries: "Term Definition p. NN" triples.
  glossary.entries = glossary.raw
    .split(/(?<=p\.\s?\d{1,3})\s+/)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter((chunk) => /p\.\s?\d{1,3}$/.test(chunk));
  await writeFile(`${outDir}/glossary.json`, JSON.stringify(glossary, null, 2));
}

await writeFile(`${outDir}/index.json`, JSON.stringify(index, null, 2));
console.log(`${bookKey}: ${lessons.length} lessons${glossary.raw ? " + glossary" : ""}`);
for (const row of index) {
  console.log(
    `  ${row.slug.padEnd(14)} p${String(row.pages[0]).padStart(3)}-${String(row.pages[1]).padStart(3)}  ${String(row.chars).padStart(6)}c  ${String(row.sections).padStart(2)} sections  ${String(row.activities).padStart(2)} activities (${row.answered} answered)  ${row.chapter} / ${row.title}`,
  );
}
