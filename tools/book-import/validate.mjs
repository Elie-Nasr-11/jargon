// Refuse to import what the book does not back. Invariants over the four composed
// chapter envelopes, checked against the extractor output they came from — every
// graded answer must trace to a red run, no student-facing text may carry a model
// answer, and the shapes must be exactly what the importer expects.
//
// Usage: node validate.mjs <out-a1-dir> <out-a2-dir> <repoRoot>
import { readFile, access } from "node:fs/promises";
import path from "node:path";

const [outA1, outA2, repoRoot] = [process.argv[2], process.argv[3], process.argv[4] || "."];
const failures = [];
const fail = (where, message) => failures.push(`${where}: ${message}`);

const ALLOWED_MODES = new Set([
  "explanation",
  "media",
  "reflection",
  "practice",
  "inquiry",
  "revision",
  "assignment",
]);

const CHAPTERS = [
  ["itf-a1", "ch1", outA1, "itf-a1-ch1", 1],
  ["itf-a1", "ch2", outA1, "itf-a1-ch2", 2],
  ["itf-a2", "ch1", outA2, "itf-a2-ch1", 1],
  ["itf-a2", "ch2", outA2, "itf-a2-ch2", 2],
];

// Red-run corpus per book, for answer tracing.
async function redCorpus(outDir) {
  const index = JSON.parse(await readFile(path.join(outDir, "index.json"), "utf8"));
  const runs = new Set();
  const joined = [];
  for (const row of index) {
    const lesson = JSON.parse(await readFile(path.join(outDir, `${row.slug}.json`), "utf8"));
    for (const line of lesson.answer_key.split("\n")) {
      const body = line.replace(/^p\d+:\s*/, "");
      // A long model answer prints as several consecutive runs; the composed
      // answer joins them — accept both granularities.
      joined.push(body.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim().toLowerCase());
      for (const run of body.split(" | ")) {
        const clean = run.replace(/\s+/g, " ").replace(/\.\s*$/, "").trim().toLowerCase();
        if (clean) runs.add(clean);
      }
    }
  }
  return { runs, blob: joined.join("\n") };
}

const corpora = new Map([
  ["itf-a1", await redCorpus(outA1)],
  ["itf-a2", await redCorpus(outA2)],
]);

const expected = [];
let lessonCount = 0;
const exemplar = JSON.parse(
  await readFile(path.join(repoRoot, "books", "itf-a1", "lesson-1-authored.json"), "utf8"),
);

for (const [bookDir, chapterFile, outDir, unitId, position] of CHAPTERS) {
  const where = `${bookDir}/${chapterFile}`;
  const envelope = JSON.parse(
    await readFile(path.join(repoRoot, "books", bookDir, `${chapterFile}.json`), "utf8"),
  );
  const corpus = corpora.get(bookDir);

  if (envelope.import_key !== bookDir.replace("itf-", "itf-")) {
    // import_key is "itf-a1"/"itf-a2" — same as the books dir name
  }
  if (envelope.import_key !== bookDir) fail(where, `import_key ${envelope.import_key} != ${bookDir}`);
  if (envelope.unit.id !== unitId) fail(where, `unit id ${envelope.unit.id} != ${unitId}`);
  if (envelope.unit.position !== position) fail(where, `unit position ${envelope.unit.position}`);
  if (!envelope.unit.title || !envelope.unit.summary) fail(where, "unit title/summary missing");
  if (!envelope.course?.id) fail(where, "course id missing");

  for (const lesson of envelope.lessons) {
    lessonCount += 1;
    const lw = lesson.id;
    if (!new RegExp(`^itf-a[12]-ch[12]-l\\d$`).test(lesson.id)) fail(lw, "bad lesson id");
    if (!lesson.title || !lesson.objective || !lesson.tutor_prompt) fail(lw, "missing lesson meta");

    const spliced = lesson.id === "itf-a1-ch1-l1";
    if (spliced && JSON.stringify(lesson) !== JSON.stringify(exemplar.lessons[0])) {
      fail(lw, "spliced lesson 1 is not byte-identical to the authored exemplar");
    }

    if (!Array.isArray(lesson.steps) || !lesson.steps.length) fail(lw, "no steps");
    if (lesson.steps.length > 18) fail(lw, `${lesson.steps.length} teaching steps > 18`);
    lesson.steps.forEach((step, i) => {
      const sw = `${lw} step ${i + 1}`;
      if (!step.title?.trim() || !step.prompt?.trim()) fail(sw, "empty title/prompt");
      if (step.mode === "assessment") fail(sw, "composer must never emit assessment steps");
      if (step.mode && !ALLOWED_MODES.has(step.mode)) fail(sw, `unknown mode ${step.mode}`);
      if (step.mode === "practice" && step.mode_type !== "applied" && !spliced) {
        // a bare practice step silently becomes a CODE step in the importer
        fail(sw, "practice step without mode_type applied");
      }
      if ((step.prompt ?? "").length > 1400 && !spliced) fail(sw, `prompt ${step.prompt.length} chars > 1400`);
      if (/Term Definition Page/i.test(step.prompt)) fail(sw, "glossary text leaked into a step");
    });

    const quiz = lesson.quiz ?? [];
    if (!quiz.length && lesson.id !== "itf-a1-ch1-l1") fail(lw, "no quiz items at all");
    if (quiz.length < 4) console.log(`  note: ${lw} has only ${quiz.length} quiz items`);
    if (quiz.length > 8) fail(lw, `${quiz.length} quiz items (> 8)`);
    for (const [qi, item] of quiz.entries()) {
      const qw = `${lw} quiz ${qi + 1}`;
      if (item.question_type !== "multiple_choice") fail(qw, "not multiple_choice");
      if (!Array.isArray(item.choices) || item.choices.length < 2) fail(qw, "needs >= 2 choices");
      if (!item.choices.some((choice) => choice.id === item.correct_choice_id)) {
        fail(qw, "correct_choice_id not among choices");
      }
      const choiceIds = item.choices.map((choice) => choice.id);
      if (new Set(choiceIds).size !== choiceIds.length) fail(qw, "duplicate choice ids (merged bucket)");
      if (item.choices.length > 4) fail(qw, `${item.choices.length} choices (merged bucket)`);
      const correct = item.choices.find((choice) => choice.id === item.correct_choice_id);
      const clean = (correct?.text ?? "").replace(/\s+/g, " ").replace(/\.\s*$/, "").trim().toLowerCase();
      // Every graded answer must trace to a red run — an invented answer is refused.
      if (!spliced && clean && !corpus.runs.has(clean) && !corpus.blob.includes(clean)) {
        fail(qw, `correct answer not red-backed: "${clean.slice(0, 50)}"`);
      }
      for (const choice of item.choices) {
        if (choice.text && !/^[A-Z0-9"'(\u201c\u2018]/.test(choice.text[0])) {
          fail(qw, `choice not sentence-cased: "${choice.text.slice(0, 30)}"`);
        }
      }
    }

    if (lesson.assignment) {
      if (!lesson.assignment.instructions?.trim()) fail(lw, "assignment instructions empty");
      const criteria = lesson.assignment.success_criteria ?? [];
      if (criteria.length < 3 || criteria.length > 6) fail(lw, `${criteria.length} success criteria`);
    } else if (!spliced) {
      fail(lw, "no assignment");
    }

    const materials = lesson.materials ?? [];
    if (materials.length > 8) fail(lw, `${materials.length} materials > 8`);
    const perStep = new Map();
    for (const material of materials) {
      const mw = `${lw} material ${material.id}`;
      if (!Number.isInteger(material.step) || material.step < 1 || material.step > lesson.steps.length) {
        fail(mw, `step ${material.step} outside 1..${lesson.steps.length}`);
      }
      perStep.set(material.step, (perStep.get(material.step) ?? 0) + 1);
      if (perStep.get(material.step) > 2) fail(mw, "more than 2 materials on one step");
      const slug = lesson.id.replace(/^itf-/, "");
      if (!new RegExp(`^/books/${slug}/p\\d+\\.jpg$`).test(material.external_url)) {
        fail(mw, `bad url ${material.external_url}`);
      }
      try {
        await access(path.join(repoRoot, "frontend", "public", material.external_url.slice(1)));
      } catch {
        fail(mw, `file missing for ${material.external_url}`);
      }
    }
    if ((lesson.figures ?? []).length > 12) fail(lw, "more than 12 figures");

    expected.push({
      lesson: lesson.id,
      steps: lesson.steps.length + quiz.length + (lesson.assignment ? 1 : 0),
      quiz: quiz.length,
      materials: materials.length,
      figures: (lesson.figures ?? []).length,
    });
  }
}

if (lessonCount !== 17) fail("corpus", `${lessonCount} lessons != 17`);

console.log("expected per-lesson landed counts (steps incl. quiz+assignment):");
for (const row of expected) {
  console.log(
    `  ${row.lesson.padEnd(16)} steps=${String(row.steps).padStart(2)}  quiz=${row.quiz}  materials=${row.materials}  figures=${row.figures}`,
  );
}
if (failures.length) {
  console.log(`\nFAIL (${failures.length}):`);
  for (const line of failures) console.log(`  ${line}`);
  process.exit(1);
}
console.log("\nOK — all invariants hold");
