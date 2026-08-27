import { BookOpen, ClipboardCheck } from "lucide-react";
import type { CurriculumUnit, Lesson } from "@/lib/types";

// R73: the book is the front door.
//
// The console was built as a general-purpose LMS: subjects → courses → units → lessons,
// with "build from material" tucked inside a "+ Lesson" menu. But the thing this product
// actually claims — and the only thing a competitor cannot copy without content deals —
// is that the school's OWN book becomes a taught course. If that is the claim, it cannot
// be a dropdown item; it has to be the first thing a teacher sees in the Content room.
//
// This panel says, per book: how much of it is in, how much is still a draft nobody has
// checked, and where to go to check it. It reports what is there — it never invents
// completeness (a book with three chapters loaded says three chapters, not "25%").
export type BookSummary = {
  key: string;
  title: string;
  chapters: number;
  lessons: number;
  drafts: number;
  firstDraftUnitId: string | null;
};

export function summarizeBooks(
  units: CurriculumUnit[],
  lessonsForUnit: (unitId: string) => Lesson[],
): BookSummary[] {
  const byBook = new Map<string, BookSummary>();
  for (const unit of units) {
    for (const lesson of lessonsForUnit(unit.id)) {
      const key = String(lesson.import_key || "");
      // Hand-authored lessons have no book and are never counted into one.
      if (!key) continue;
      const title = (lesson.course_title || key).trim();
      const entry =
        byBook.get(key) ||
        ({ key, title, chapters: 0, lessons: 0, drafts: 0, firstDraftUnitId: null } as BookSummary);
      entry.lessons += 1;
      if ((lesson.publication_status || "published") !== "published") {
        entry.drafts += 1;
        if (!entry.firstDraftUnitId) entry.firstDraftUnitId = unit.id;
      }
      byBook.set(key, entry);
    }
  }
  // Chapters counted per book from the units that actually carry its lessons.
  for (const [key, entry] of byBook) {
    entry.chapters = units.filter((unit) =>
      lessonsForUnit(unit.id).some((lesson) => String(lesson.import_key || "") === key),
    ).length;
  }
  return [...byBook.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function BooksPanel({
  books,
  onReview,
}: {
  books: BookSummary[];
  onReview: (unitId: string) => void;
}) {
  if (!books.length) return null;
  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-5">
        <div className="flex items-center gap-2 text-title font-medium text-foreground">
          <BookOpen className="h-4 w-4" strokeWidth={1.7} />
          Your books
        </div>
        <p className="mt-1 text-meta text-muted-foreground">
          What has been built from your own material, and what is still waiting on you.
        </p>
        <div className="mt-3 grid gap-1.5">
          {books.map((book) => (
            <div
              key={book.key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border/70 bg-depth-sub px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="truncate text-meta font-medium text-foreground">{book.title}</div>
                <div className="text-overline uppercase tracking-[0.08em] text-muted-foreground">
                  {book.chapters} {book.chapters === 1 ? "chapter" : "chapters"} ·{" "}
                  {book.lessons} {book.lessons === 1 ? "lesson" : "lessons"}
                  {book.drafts ? ` · ${book.drafts} awaiting review` : " · all published"}
                </div>
              </div>
              {book.drafts && book.firstDraftUnitId ? (
                <button
                  type="button"
                  onClick={() => onReview(book.firstDraftUnitId as string)}
                  className="btn btn-secondary btn-sm shrink-0"
                >
                  <ClipboardCheck className="h-3.5 w-3.5" strokeWidth={1.8} />
                  Review &amp; publish
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
