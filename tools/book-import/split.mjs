// Cut a book into the pieces a teacher would actually upload.
//
// Two granularities, because they answer different questions:
//   chapters/ — "here is a chapter, work out the lessons"  (the R57 outline→build flow)
//   lessons/  — "here is one lesson, build it"             (the R56 single-lesson flow)
//
// Page ranges come from extract.mjs's own lesson map, so the cuts follow the book's
// structure rather than a guess.
import { PDFDocument } from "pdf-lib";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const [src, indexPath, outRoot, label] = process.argv.slice(2);
const index = JSON.parse(await readFile(indexPath, "utf8"));
const bytes = await readFile(src);

await mkdir(`${outRoot}/lessons`, { recursive: true });
await mkdir(`${outRoot}/chapters`, { recursive: true });

const safe = (s) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

async function cut(from, to, outPath) {
  const source = await PDFDocument.load(bytes);
  const out = await PDFDocument.create();
  const wanted = [];
  for (let i = from - 1; i <= to - 1 && i < source.getPageCount(); i += 1) wanted.push(i);
  const copied = await out.copyPages(source, wanted);
  for (const page of copied) out.addPage(page);
  await writeFile(outPath, await out.save());
  return wanted.length;
}

// One PDF per book lesson.
for (const row of index) {
  const name = `${row.slug}-${safe(row.title)}.pdf`;
  const pages = await cut(row.pages[0], row.pages[1], `${outRoot}/lessons/${name}`);
  console.log(`  lesson  ${name}  (${pages}pp)`);
}

// One PDF per chapter: first page of its first lesson to last page of its last.
const chapters = new Map();
for (const row of index) {
  const key = row.chapter;
  const entry = chapters.get(key) || { title: key, from: row.pages[0], to: row.pages[1], lessons: 0 };
  entry.from = Math.min(entry.from, row.pages[0]);
  entry.to = Math.max(entry.to, row.pages[1]);
  entry.lessons += 1;
  chapters.set(key, entry);
}
for (const [, ch] of chapters) {
  const name = `${label}-${safe(ch.title)}.pdf`;
  const pages = await cut(ch.from, ch.to, `${outRoot}/chapters/${name}`);
  console.log(`  chapter ${name}  (${pages}pp, ${ch.lessons} lessons)`);
}
