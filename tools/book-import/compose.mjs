// Compose the book-faithful import documents from the extractor's structured
// output. One envelope per chapter; every section becomes teaching steps in the
// book's own words, every activity keeps its real questions, the graded quiz uses
// the book's printed red answers, and page images bind to the steps that teach
// those pages. Deterministic by design: the same inputs always produce the same
// documents, and no answer is ever invented — a quiz question without a
// red-derived letter never becomes a graded item.
//
// Usage: node compose.mjs <out-a1-dir> <out-a2-dir> <repoRoot>
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const [outA1, outA2, repoRoot] = [process.argv[2], process.argv[3], process.argv[4] || "."];
const RAW_L1 = process.argv.includes("--raw");

// The only authored text in the pipeline: envelope identity and one summary
// sentence per chapter. Everything else is the book's.
const BOOKS = {
  a1: {
    importKey: "itf-a1",
    course: {
      id: "itf-adv-a1",
      title: "IT Frontiers Advanced — Book A1",
      subject: "IT Frontiers — Advanced Series",
      level: "Advanced",
    },
    bookLabel: "A1",
    outDir: () => outA1,
    chapters: {
      1: {
        id: "itf-a1-ch1",
        title: "Chapter 1 · Computers",
        summary:
          "What computers are, what processing means, and how information is created, shared and stored.",
        position: 1,
      },
      2: {
        id: "itf-a1-ch2",
        title: "Chapter 2 · Computers & Beyond",
        summary:
          "How people and computers interact — interfaces, connected devices, the cloud, and the information systems built on them.",
        position: 2,
      },
    },
  },
  a2: {
    importKey: "itf-a2",
    course: {
      id: "itf-adv-a2",
      title: "IT Frontiers Advanced — Book A2",
      subject: "IT Frontiers — Advanced Series",
      level: "Advanced",
    },
    bookLabel: "A2",
    outDir: () => outA2,
    chapters: {
      1: {
        id: "itf-a2-ch1",
        title: "Chapter 3 · Data & Information",
        summary:
          "How raw data becomes information — collecting it, structuring it, and searching and sorting it.",
        position: 1,
      },
      2: {
        id: "itf-a2-ch2",
        title: "Chapter 4 · Artificial Intelligence",
        summary:
          "What artificial intelligence is — machine learning, prediction, logic and reasoning, and AI in the real world.",
        position: 2,
      },
    },
  },
};

const SEGMENT_SPLIT = 1800; // split a section's prose into steps past this
const SEGMENT_MERGE = 400; // merge a sliver into its neighbour under this
const EXCERPT_CAP = 1000; // book text carried inside one step prompt
const PROMPT_CLAMP = 1400;
const MAX_TEACHING_STEPS = 18;
const MAX_EXPLANATIONS = 8;
const QUIZ_CAP = 8;
const QUIZ_TARGET = 4;

const warnings = [];
const warn = (slug, message) => warnings.push(`${slug}: ${message}`);

function trimAtSentence(text, cap) {
  if (text.length <= cap) return text;
  const window = text.slice(0, cap);
  const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
  return (cut > cap * 0.5 ? window.slice(0, cut + 1) : window).trim();
}

function clampPrompt(text) {
  return trimAtSentence(text.replace(/\s+/g, " ").trim(), PROMPT_CLAMP);
}

// Sentence-case a choice AFTER the correct letter was derived from the raw text —
// casing first would break the derivation. First character only, so "AI", "CPU"
// and proper nouns survive untouched.
function sentenceCase(text) {
  const t = text.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

function splitParagraph(text, cap) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > cap) {
    const window = rest.slice(0, cap);
    const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
    const at = cut > cap * 0.4 ? cut + 1 : cap;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// ---------------------------------------------------------------------------
// Teaching segments: the prose between headings, with its callouts and pages.
// ---------------------------------------------------------------------------

function buildSegments(lessonDoc) {
  const segments = [];
  let open = null;
  const start = (title, page) => {
    open = { title, pageFrom: page, pageTo: page, body: "", callouts: [] };
    segments.push(open);
  };
  for (const block of lessonDoc.blocks) {
    if (block.kind === "heading") {
      start(block.text, block.page);
      continue;
    }
    if (!open) start("", block.page);
    open.pageTo = Math.max(open.pageTo, block.page);
    if (block.kind === "callout") open.callouts.push(block.text);
    else open.body += open.body ? ` ${block.text}` : block.text;
  }

  // Merge slivers into their neighbour, then split long prose into step-sized
  // chunks that keep their section title.
  const merged = [];
  for (const segment of segments) {
    const weight = segment.body.length + segment.callouts.join(" ").length;
    const prev = merged[merged.length - 1];
    if (weight < SEGMENT_MERGE && prev) {
      prev.body += segment.body ? ` ${segment.body}` : "";
      prev.callouts.push(...segment.callouts);
      prev.pageTo = Math.max(prev.pageTo, segment.pageTo);
      if (!prev.title && segment.title) prev.title = segment.title;
    } else {
      merged.push({ ...segment, callouts: [...segment.callouts] });
    }
  }

  const sized = [];
  for (const segment of merged) {
    if (segment.body.length <= SEGMENT_SPLIT) {
      sized.push(segment);
      continue;
    }
    const parts = splitParagraph(segment.body, SEGMENT_SPLIT);
    parts.forEach((part, i) => {
      sized.push({
        title: i === 0 ? segment.title : `${segment.title || "The lesson"} (cont.)`,
        pageFrom: segment.pageFrom,
        pageTo: segment.pageTo,
        body: part,
        callouts: i === 0 ? segment.callouts : [],
      });
    });
  }
  return sized.filter((segment) => segment.body || segment.callouts.length);
}

function explanationStep(lessonDoc, segment) {
  const title = segment.title || `${lessonDoc.lesson.title} (p${segment.pageFrom})`;
  const lines = [
    `Teach the book's section "${title}" in dialogue — never lecture more than a few sentences before asking something.`,
    `Book content to work through: ${trimAtSentence(segment.body, EXCERPT_CAP)}`,
  ];
  if (segment.callouts.length) {
    lines.push(
      `Definitions to land in the student's own words: ${segment.callouts
        .slice(0, 3)
        .map((callout) => `"${callout}"`)
        .join(" · ")}`,
    );
  }
  return {
    mode: "explanation",
    title: title.slice(0, 60),
    prompt: clampPrompt(lines.join(" ")),
    pageFrom: segment.pageFrom,
    pageTo: segment.pageTo,
  };
}

// ---------------------------------------------------------------------------
// Activity steps. The book's own practice, with the teacher edition's marked
// answers embedded as MENTOR guidance — the marking guide, never text to read out.
// ---------------------------------------------------------------------------

function activityStep(activity) {
  const base = { pageFrom: activity.page, pageTo: activity.pageEnd };
  if (activity.type === "tf") {
    const statements = activity.items
      .map((item, i) => `${i + 1}. ${item.stem} — ${item.answer.tf ?? "?"}`)
      .join(" ");
    return {
      ...base,
      mode: "inquiry",
      title: "Quick check: true or false",
      prompt: clampPrompt(
        `Run the book's true-or-false check (${activity.items.length} statements). Read each aloud and have the student commit to T or F before you confirm. Statements with the book's answers: ${statements}`,
      ),
    };
  }
  if (activity.type === "mcq") {
    const questions = activity.items
      .map((item) => {
        const options = item.options.map((option) => `${option.id}) ${option.text}`).join(" ");
        const key = item.answer.letter ? ` [correct: ${item.answer.letter}]` : "";
        return `${item.n}. ${item.stem} ${options}${key}`;
      })
      .join(" ");
    return {
      ...base,
      mode: "inquiry",
      title: `Check yourself (Activity ${activity.number})`,
      prompt: clampPrompt(
        `Ask the book's questions one at a time, options and all — the correct answer is marked for YOU; confirm only after the student commits. ${questions}`,
      ),
    };
  }
  if (activity.type === "match") {
    const pairs = activity.items
      .map((item) => `${item.stem}${item.answer.text ? ` → ${item.answer.text}` : ""}`)
      .join(" · ");
    return {
      ...base,
      mode: "inquiry",
      title: `Match the terms (Activity ${activity.number})`,
      prompt: clampPrompt(
        `Run the book's matching exercise aloud. ${activity.intro} Pairs (the book's key, for your marking only): ${pairs}`,
      ),
    };
  }
  // Open-ended: reflection when the questions address the student directly;
  // hands-on making with no printed answers is applied practice.
  const questions = activity.items.map((item) => `${item.n}. ${item.stem}`).join(" ");
  const answers = activity.items
    .filter((item) => item.answer.text)
    .map((item) => `${item.n}) ${item.answer.text}`)
    .join(" ");
  const handsOn =
    !answers && /\b(write|draw|design|create|build)\b/i.test(activity.intro + " " + questions);
  if (handsOn) {
    return {
      ...base,
      mode: "practice",
      mode_type: "applied",
      title: `Your turn (Activity ${activity.number})`,
      prompt: clampPrompt(`${activity.intro} ${questions}`),
    };
  }
  const personal = /\byou(r)?\b/i.test(activity.items[0]?.stem ?? "");
  const guidance = answers
    ? ` Model answers from the teacher edition — guide toward these, never read them out: ${answers}`
    : "";
  return {
    ...base,
    mode: personal ? "reflection" : "inquiry",
    title: `Talk it through (Activity ${activity.number})`,
    prompt: clampPrompt(`${activity.intro || "Work through the book's questions."} ${questions}${guidance}`),
  };
}

// ---------------------------------------------------------------------------
// Graded quiz: walk mcq activities in REVERSE book order, take only questions
// whose correct letter was derived from the book's red ink, cap at QUIZ_CAP. The
// composer never emits a step with mode "assessment" — only lesson.quiz[] creates
// graded quiz_items rows, and only red-backed questions may enter it.
// ---------------------------------------------------------------------------

function selectQuiz(slug, activities) {
  const quiz = [];
  const consumed = new Map(); // activity.number -> Set of item ns fully consumed
  for (const activity of [...activities].reverse()) {
    if (activity.type !== "mcq") continue;
    for (const item of activity.items) {
      if (quiz.length >= QUIZ_CAP) break;
      if (!item.answer.letter) continue;
      if (item.options.length < 2) continue;
      // Table-layout questions scramble into empty stems and fragment options —
      // never gradeable material.
      if (item.stem.trim().length < 15 || /^[a-d]\)/.test(item.stem.trim())) continue;
      if (item.options.some((option) => option.text.trim().length < 2)) continue;
      // A lost question-number glyph merges two questions into one bucket: the
      // option ids duplicate and the second question's red overwrites the first's
      // letter. The FIRST question is recoverable — its options end where the id
      // sequence restarts, and answer.text (always the first red) picks its
      // letter; anything less certain is skipped, never guessed.
      let options = item.options;
      let letter = item.answer.letter;
      const ids = options.map((option) => option.id);
      const restart = ids.findIndex((id, i) => i > 0 && id <= ids[i - 1]);
      if (restart !== -1 || ids.length > 4) {
        options = restart === -1 ? options.slice(0, 4) : options.slice(0, restart);
        if (options.length < 2) continue;
        // A recovered bucket is already sketchy — only an EXACT text match may
        // pick the letter; a polluted first red is grounds to skip, never guess.
        const norm = (t) => t.replace(/\s+/g, " ").replace(/\.\s*$/, "").trim().toLowerCase();
        const target = norm(item.answer.text ?? "");
        const hit = options.find((option) => norm(option.text) === target);
        if (!hit || !target) continue;
        letter = hit.id;
      }
      if (new Set(options.map((o) => o.id)).size !== options.length) continue;
      if (!options.some((option) => option.id === letter)) continue;
      quiz.push({
        question_type: "multiple_choice",
        prompt: item.stem,
        choices: options.map((option) => ({ id: option.id, text: sentenceCase(option.text) })),
        correct_choice_id: letter,
      });
      if (!consumed.has(activity.number)) consumed.set(activity.number, new Set());
      consumed.get(activity.number).add(item.n);
    }
    if (quiz.length >= QUIZ_CAP) break;
  }
  quiz.reverse(); // book order within the wrap-up
  if (quiz.length < QUIZ_TARGET) {
    warn(slug, `only ${quiz.length} red-backed quiz questions available`);
  }
  return { quiz, consumed };
}

// ---------------------------------------------------------------------------
// Assignment: the book's named projects where they exist (two in the corpus);
// otherwise synthesized from the last open activity, the way lesson 1 was
// hand-authored.
// ---------------------------------------------------------------------------

function buildAssignment(lessonDoc, activities) {
  const project = activities.find((activity) => activity.type === "project");
  if (project) {
    const body = `${project.intro} ${project.items.map((item) => `${item.n}. ${item.stem}`).join(" ")}`;
    return {
      used: project,
      assignment: {
        title: project.title || `Project: ${lessonDoc.lesson.title}`,
        instructions: trimAtSentence(body.replace(/Tips:.*$/i, "").trim(), 1500),
        success_criteria: [
          ...project.tips.slice(0, 5).map((tip) => trimAtSentence(tip, 160)),
          "Uses the lesson's own vocabulary, each term explained",
        ].slice(0, 6),
      },
    };
  }
  const open = [...activities].reverse().find((activity) => activity.type === "open" && activity.items.length);
  if (!open) return { used: null, assignment: null };
  const stems = open.items.slice(0, 3).map((item) => item.stem);
  return {
    used: open,
    assignment: {
      title: `${lessonDoc.lesson.title}: your own answer`,
      instructions: trimAtSentence(
        `Write up your answers to these questions from the lesson, in your own words: ${stems
          .map((stem, i) => `${i + 1}. ${stem}`)
          .join(" ")} Use at least three of the lesson's own terms and explain each as you use it.`,
        1500,
      ),
      success_criteria: [
        ...stems.map((stem) => `Answers: ${trimAtSentence(stem, 80)}`),
        "Uses the lesson's own vocabulary, each term explained",
        "Explains the reasoning in the student's own words",
      ].slice(0, 6),
    },
  };
}

// ---------------------------------------------------------------------------
// Lesson assembly
// ---------------------------------------------------------------------------

function composeLesson(lessonDoc, book, pagesForLesson, chapterPages) {
  const slug = lessonDoc.slug;
  const lessonId = `itf-${slug}`;
  const activities = lessonDoc.activities;

  const { quiz, consumed } = selectQuiz(slug, activities);
  const { used: assignmentSource, assignment } = buildAssignment(lessonDoc, activities);
  if (!assignment) warn(slug, "no open activity to build an assignment from");

  // Steps: explanation segments and activity steps interleaved in page order.
  const segments = buildSegments(lessonDoc).map((segment) => explanationStep(lessonDoc, segment));
  let explanations = segments;
  while (explanations.length > MAX_EXPLANATIONS) {
    // merge the two smallest adjacent explanations
    let at = 0;
    let best = Infinity;
    for (let i = 0; i + 1 < explanations.length; i += 1) {
      const weight = explanations[i].prompt.length + explanations[i + 1].prompt.length;
      if (weight < best) {
        best = weight;
        at = i;
      }
    }
    const [a, b] = [explanations[at], explanations[at + 1]];
    explanations.splice(at, 2, {
      ...a,
      pageTo: Math.max(a.pageTo, b.pageTo),
      prompt: clampPrompt(`${a.prompt} Then: ${b.prompt.replace(/^Teach the book's section /, "move to ")}`),
    });
  }

  const activitySteps = activities
    .filter((activity) => activity !== assignmentSource)
    .map((activity) => {
      const eaten = consumed.get(activity.number);
      if (activity.type === "mcq" && eaten && eaten.size >= activity.items.filter((i) => i.answer.letter).length && activity.items.every((item) => eaten.has(item.n) || !item.answer.letter)) {
        // Every answerable question moved to the wrap-up quiz — no inquiry step left.
        return null;
      }
      if (activity.type === "mcq" && eaten) {
        const remaining = { ...activity, items: activity.items.filter((item) => !eaten.has(item.n)) };
        if (!remaining.items.length) return null;
        return activityStep(remaining);
      }
      return activityStep(activity);
    })
    .filter(Boolean);

  let steps = [...explanations, ...activitySteps].sort((a, b) => a.pageFrom - b.pageFrom || (a.mode === "explanation" ? -1 : 1));
  while (steps.length > MAX_TEACHING_STEPS) {
    const removable = steps.map((step, i) => ({ step, i })).filter(({ step }) => step.mode === "explanation");
    if (removable.length < 2) break;
    let bestPair = null;
    for (let i = 0; i + 1 < removable.length; i += 1) {
      if (removable[i + 1].i !== removable[i].i + 1) continue;
      const weight = removable[i].step.prompt.length + removable[i + 1].step.prompt.length;
      if (!bestPair || weight < bestPair.weight) bestPair = { at: removable[i].i, weight };
    }
    if (!bestPair) break;
    const [a, b] = [steps[bestPair.at], steps[bestPair.at + 1]];
    steps.splice(bestPair.at, 2, {
      ...a,
      pageTo: Math.max(a.pageTo, b.pageTo),
      prompt: clampPrompt(`${a.prompt} Then: ${b.prompt.replace(/^Teach the book's section /, "move to ")}`),
    });
  }

  // Notes fold into the step covering their page as mentor asides.
  for (const note of lessonDoc.notes) {
    const host = steps.find((step) => note.page >= step.pageFrom && note.page <= step.pageTo);
    if (!host) continue;
    const withNote = `${host.prompt} Teacher note from the book: ${trimAtSentence(note.text, 280)}`;
    if (withNote.length <= PROMPT_CLAMP + 300) host.prompt = clampPrompt(withNote);
  }

  // Page images: bind each selected page to the step that teaches it.
  const materials = [];
  const figures = [];
  for (const entry of pagesForLesson) {
    let index = steps.findIndex((step) => entry.page >= step.pageFrom && entry.page <= step.pageTo);
    if (index === -1) {
      let best = Infinity;
      steps.forEach((step, i) => {
        const distance = Math.min(Math.abs(step.pageFrom - entry.page), Math.abs(step.pageTo - entry.page));
        if (distance < best) {
          best = distance;
          index = i;
        }
      });
    }
    if (index === -1) continue;
    // At most 3 images auto-show on one step; the overflow still lands, as
    // lesson-level rows (no step) the student browses and the mentor can hand out.
    const bound = materials.filter((material) => material.step === index + 1).length;
    const url = `/books/${slug}/p${entry.page}.jpg`;
    materials.push({
      id: `${lessonId}-p${entry.page}`,
      title: `Book page ${entry.page} — ${entry.heading}`,
      external_url: url,
      ...(bound < 3 ? { step: index + 1 } : {}),
      source_page: entry.page,
    });
    figures.push({
      id: `${lessonId}-pg${entry.page}`,
      idea_key: entry.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
      title: `Page ${entry.page} — ${entry.heading}`,
      caption: "",
      alt_text: `Page ${entry.page} of Book ${book.bookLabel}, ${lessonDoc.lesson.title}`,
      image_url: url,
      source_page: entry.page,
    });
  }

  const sectionTitles = lessonDoc.sections.map((section) => section.title);
  const arc = sectionTitles.length
    ? sectionTitles.join(" → ")
    : `the book's own sequence of activities (pp. ${lessonDoc.pages[0]}–${lessonDoc.pages[1]})`;
  // The chapter TITLE carries the book's printed number ("4 Artificial
  // Intelligence"); chapter.number restarts per book.
  const printedChapter = parseInt(lessonDoc.chapter.title, 10) || lessonDoc.chapter.number;
  const tutorPrompt =
    `You are teaching Lesson ${lessonDoc.lesson.number} of Chapter ${printedChapter} from IT Frontiers Advanced Book ${book.bookLabel}: "${lessonDoc.lesson.title}". ` +
    `Work through the book's own arc: ${trimAtSentence(arc, 260)}. ` +
    `Use the book's own examples, definitions and activities — the steps carry them verbatim — rather than inventing your own. ` +
    `Where a step includes the book's marked answers, treat them as your marking guide, never as text to read out. ` +
    `Never hand over a definition or an answer the student is one question away from reaching. Keep language concrete and age-appropriate.`;
  const objective = sectionTitles.length
    ? `Work through "${lessonDoc.lesson.title}" from the book: ${sectionTitles.slice(0, 4).map((t) => t.toLowerCase()).join(", ")}.`
    : `Work through "${lessonDoc.lesson.title}" from the book.`;

  // The book itself, three zoom levels per lesson (R62): the lesson's own pages,
  // its chapter, the whole book — every graph, diagram and page not shown inline
  // is reachable through these. All three render in-app (resource_type pdf).
  const chapterSlug = slug.replace(/-l\d$/, "");
  const chapterTitleBare = lessonDoc.chapter.title.replace(/^\d+\s*/, "").trim();
  const documents = [
    {
      id: `${lessonId}-doc-lesson`,
      type: "pdf",
      title: `Lesson PDF — ${lessonDoc.lesson.title} (book pp. ${lessonDoc.pages[0]}–${lessonDoc.pages[1]})`,
      external_url: `/books/pdf/${slug}.pdf`,
      description: `This lesson exactly as printed in IT Frontiers Advanced Book ${book.bookLabel}.`,
      student_instructions:
        "Open this to read the lesson straight from the book — every diagram, chart and activity is on these pages.",
    },
    {
      id: `${lessonId}-doc-chapter`,
      type: "pdf",
      title: `Chapter ${printedChapter} PDF — ${chapterTitleBare} (book pp. ${chapterPages[0]}–${chapterPages[1]})`,
      external_url: `/books/pdf/${chapterSlug}.pdf`,
      description: `The whole chapter this lesson belongs to, as printed in Book ${book.bookLabel}.`,
      student_instructions:
        "Use this to look back at earlier lessons in the chapter or read ahead — the full chapter, straight from the book.",
    },
    {
      id: `${lessonId}-doc-book`,
      type: "pdf",
      title: `Book PDF — IT Frontiers Advanced ${book.bookLabel} (Teacher Edition)`,
      external_url: `/books/pdf/${slug.slice(0, 2)}-book.pdf`,
      description: `The complete Book ${book.bookLabel}, both chapters, as one PDF.`,
      student_instructions:
        "The whole book in one file — handy for the contents pages, the glossary and anything outside this chapter.",
    },
  ];

  return {
    id: lessonId,
    title: lessonDoc.lesson.title,
    level: "Advanced",
    objective,
    tutor_prompt: tutorPrompt,
    steps: steps.map(({ pageFrom, pageTo, ...step }) => step),
    quiz,
    ...(assignment ? { assignment } : {}),
    ...(materials.length ? { materials } : {}),
    documents,
    ...(figures.length ? { figures } : {}),
  };
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

for (const [bookKey, book] of Object.entries(BOOKS)) {
  const outDir = book.outDir();
  const index = JSON.parse(await readFile(path.join(outDir, "index.json"), "utf8"));
  const pagesManifest = JSON.parse(
    await readFile(path.join(repoRoot, "books", `itf-${bookKey}`, "pages.json"), "utf8"),
  );
  const byChapter = new Map();
  for (const row of index) {
    const lessonDoc = JSON.parse(await readFile(path.join(outDir, `${row.slug}.json`), "utf8"));
    const chapterNo = lessonDoc.chapter.number <= Object.keys(book.chapters).length ? lessonDoc.chapter.number : ((lessonDoc.chapter.number - 1) % 2) + 1;
    if (!byChapter.has(chapterNo)) byChapter.set(chapterNo, []);
    byChapter.get(chapterNo).push(lessonDoc);
  }

  for (const [chapterNo, lessonDocs] of [...byChapter.entries()].sort((a, b) => a[0] - b[0])) {
    const chapter = book.chapters[chapterNo];
    if (!chapter) throw new Error(`no chapter config for ${bookKey} chapter ${chapterNo}`);
    const chapterPages = [
      Math.min(...lessonDocs.map((d) => d.pages[0])),
      Math.max(...lessonDocs.map((d) => d.pages[1])),
    ];
    let lessons = lessonDocs
      .sort((a, b) => a.lesson.number - b.lesson.number)
      .map((lessonDoc) =>
        composeLesson(lessonDoc, book, pagesManifest.lessons[lessonDoc.slug] ?? [], chapterPages),
      );

    // Lesson 1 of A1 chapter 1 is already live, hand-authored and owner-approved —
    // splice it verbatim so re-import is a pure in-place update (same 18 step ids,
    // zero orphan risk). --raw keeps the mechanical version for diffing.
    if (bookKey === "a1" && chapterNo === 1 && !RAW_L1) {
      const authored = JSON.parse(
        await readFile(path.join(repoRoot, "books", "itf-a1", "lesson-1-authored.json"), "utf8"),
      );
      lessons = lessons.map((lesson) =>
        lesson.id === "itf-a1-ch1-l1" ? authored.lessons[0] : lesson,
      );
    }

    const envelope = {
      import_key: book.importKey,
      course: book.course,
      unit: { id: chapter.id, title: chapter.title, summary: chapter.summary, position: chapter.position },
      lessons,
    };
    const outPath = path.join(repoRoot, "books", `itf-${bookKey}`, `ch${chapterNo}${RAW_L1 ? ".raw" : ""}.json`);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(envelope, null, 2));
    const stepTotal = lessons.reduce(
      (sum, lesson) => sum + lesson.steps.length + (lesson.quiz?.length ?? 0) + (lesson.assignment ? 1 : 0),
      0,
    );
    console.log(
      `${bookKey} ch${chapterNo}: ${lessons.length} lessons, ${stepTotal} total steps -> ${outPath}`,
    );
    for (const lesson of lessons) {
      console.log(
        `    ${lesson.id.padEnd(16)} ${String(lesson.steps.length).padStart(2)} teach + ${String(lesson.quiz?.length ?? 0)} quiz + ${lesson.assignment ? 1 : 0} assign  (${lesson.materials?.length ?? 0} materials, ${lesson.documents?.length ?? 0} docs, ${lesson.figures?.length ?? 0} figures)`,
      );
    }
  }
}

if (warnings.length) {
  console.log("\nwarnings:");
  for (const line of warnings) console.log(`  ${line}`);
}
