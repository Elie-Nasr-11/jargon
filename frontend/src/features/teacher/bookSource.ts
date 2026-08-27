import type { Lesson, LessonBookSource } from "@/lib/types";

// R73: the teacher console is being realigned around one claim — this is YOUR book,
// taught one-on-one. A teacher can only trust that claim if they can see it and check
// it against the copy on their desk, so every place a lesson appears now says which
// book it came from and which pages it covers.
//
// A lesson is a BOOK lesson only when it carries an import_key. Hand-authored lessons
// return null and render exactly as they always did — the console must not imply a
// source that does not exist.
export function bookSourceFor(
  lesson: Pick<Lesson, "import_key" | "course_title">,
  pagesByLesson?: Map<string, { first: number; last: number }>,
  lessonId?: string,
): LessonBookSource | null {
  if (!lesson.import_key) return null;
  const book = (lesson.course_title || "").trim();
  if (!book) return null;
  const pages = lessonId ? pagesByLesson?.get(lessonId) : undefined;
  return {
    book,
    firstPage: pages ? pages.first : null,
    lastPage: pages ? pages.last : null,
  };
}

// "IT Frontiers Advanced — Book A1 · pages 10–20". Pages are omitted rather than
// guessed when no figure carried a page number.
export function bookSourceLabel(source: LessonBookSource | null): string {
  if (!source) return "";
  if (source.firstPage === null) return source.book;
  const pages =
    source.lastPage !== null && source.lastPage !== source.firstPage
      ? `pages ${source.firstPage}–${source.lastPage}`
      : `page ${source.firstPage}`;
  return `${source.book} · ${pages}`;
}

// Page ranges come from the figures the importer cropped out of the book, which are
// the only rows that carry a page number today.
export function pageRangesFromFigures(
  figures: { lesson_id?: string | null; source_page?: number | null }[],
): Map<string, { first: number; last: number }> {
  const out = new Map<string, { first: number; last: number }>();
  for (const figure of figures) {
    const lessonId = String(figure.lesson_id || "");
    const page = Number(figure.source_page);
    if (!lessonId || !Number.isFinite(page) || page <= 0) continue;
    const current = out.get(lessonId);
    if (!current) out.set(lessonId, { first: page, last: page });
    else {
      if (page < current.first) current.first = page;
      if (page > current.last) current.last = page;
    }
  }
  return out;
}
