// Turn a Teacher Edition PDF into clean per-lesson source for curriculum authoring.
//
// The books are beautifully regular, and the Teacher Edition marks every answer in
// red (#ff5739) — both the correct MCQ option and the written model answers. That
// means the answer key is EXTRACTED, never inferred, so a generated quiz is right
// because the book says so.
//
// Type scale (measured): 27 = lesson title, 24+ = chapter, 18 = section heading /
// "Activity N.N", 15 = definitions, examples and callouts, 13 = running header,
// 12 = body.
import { getDocument, OPS } from "../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const [file, bookKey, outDir] = [process.argv[2], process.argv[3], process.argv[4]];
const ANSWER_RED = "#ff5739";

const doc = await getDocument({
  data: new Uint8Array(await readFile(file)),
  useSystemFonts: true,
}).promise;

// Colour comes from the operator list, text from getTextContent; join them by
// walking the ops in order and matching each show-text run to the next text item.
async function pageParts(pageNo) {
  const page = await doc.getPage(pageNo);
  const [content, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
  const answers = [];
  let fill = "";
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    if (ops.fnArray[i] === OPS.setFillRGBColor) {
      // pdf.js normalises this to ONE css hex string, not an r,g,b triple.
      const arg = ops.argsArray[i][0];
      fill = typeof arg === "string" ? arg.toLowerCase() : "";
    } else if (ops.fnArray[i] === OPS.showText) {
      const glyphs = Array.isArray(ops.argsArray[i][0]) ? ops.argsArray[i][0] : [];
      const text = glyphs.map((g) => (g && typeof g === "object" && g.unicode) || "").join("").trim();
      if (text && fill === ANSWER_RED) answers.push(text);
    }
  }
  const items = content.items
    .filter((it) => it.str.trim())
    .map((it) => ({ str: it.str.replace(/\s+/g, " "), size: Math.round(Math.abs(it.transform[3])) }));
  return { items, answers };
}

const RUNNING_HEADER = /^(chapter|lesson)\s|^\d{1,3}$/i;

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

const lessons = [];
let current = null;
let chapter = { number: 0, title: "" };
let pendingChapterTitle = "";

for (let n = 1; n <= doc.numPages; n += 1) {
  const { items, answers } = await pageParts(n);

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
      answers: [],
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
  if (answers.length) current.answers.push({ page: n, runs: answers });

  for (const it of items) {
    const str = it.str.trim();
    if (!str) continue;
    if (it.size === 13 && RUNNING_HEADER.test(str)) continue; // running header
    if (it.size >= 24) continue; // already captured as the lesson title
    if (/^\d{1,3}$/.test(str) && it.size <= 13) continue; // page number
    const kind = it.size === 18 ? "heading" : it.size === 15 ? "callout" : "body";
    const last = current.blocks[current.blocks.length - 1];
    if (last && last.kind === kind && last.page === n) last.text += ` ${str}`;
    else current.blocks.push({ kind, page: n, text: str });
  }
}

await mkdir(outDir, { recursive: true });
const index = [];
for (const lesson of lessons) {
  // Stitch the blocks into readable markdown-ish source: headings become "## X",
  // callouts keep their own marker so an author can tell a definition from prose.
  const titleWords = new Set(
    `${lesson.title} ${lesson.chapter.title}`.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean),
  );
  const isRunningTitle = (text) => {
    const words = text.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
    // A short line made only of words from the running head is page furniture.
    return words.length > 0 && words.length <= 4 && words.every((w) => titleWords.has(w));
  };
  const body = lesson.blocks
    .map((b) => ({ ...b, text: dehyphenate(b.text) }))
    .filter((b) => b.text && !(b.kind === "body" && isRunningTitle(b.text)))
    .map((b) => (b.kind === "heading" ? `\n## ${b.text}\n` : b.kind === "callout" ? `> ${b.text}` : b.text))
    .join("\n");
  const answerKey = lesson.answers
    .map((a) => `p${a.page}: ${a.runs.map(dehyphenate).join(" | ")}`)
    .join("\n");
  const slug = `${bookKey}-ch${lesson.chapter.number}-l${lesson.number}`;
  const doc = {
    slug,
    book: bookKey,
    chapter: lesson.chapter,
    lesson: { number: lesson.number, title: lesson.title },
    pages: [lesson.firstPage, lesson.lastPage],
    chars: body.length,
    source: body,
    answer_key: answerKey,
  };
  await writeFile(`${outDir}/${slug}.json`, JSON.stringify(doc, null, 2));
  index.push({ slug, chapter: lesson.chapter.title, title: lesson.title, pages: doc.pages, chars: body.length, answers: lesson.answers.length });
}
await writeFile(`${outDir}/index.json`, JSON.stringify(index, null, 2));
console.log(`${bookKey}: ${lessons.length} lessons`);
for (const row of index) {
  console.log(`  ${row.slug.padEnd(14)} p${String(row.pages[0]).padStart(3)}-${String(row.pages[1]).padStart(3)}  ${String(row.chars).padStart(6)}c  ${String(row.answers).padStart(2)} answer pages  ${row.chapter} / ${row.title}`);
}
