/**
 * An old bookmark, forwarded.
 *
 * The authoring studio had its own page until R42, when building moved inside a
 * class. R80 finished that move: the curriculum IS the class's Course screen, and
 * a lesson is its own address. All that survives here is the redirect that keeps
 * old links working — a lesson link lands on the lesson, anything else on the
 * teacher's first class.
 */
import { useEffect } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { RouteLoader } from "@/components/RouteLoader";
import { fetchTeacherClasses, getSession } from "@/lib/api";
import type { CurriculumSearch } from "@/features/teacher/authoring/types";

export const Route = createFileRoute("/teacher/curriculum")({
  validateSearch: (search: Record<string, unknown>): CurriculumSearch => ({
    subject: typeof search.subject === "string" ? search.subject : undefined,
    course: typeof search.course === "string" ? search.course : undefined,
    unit: typeof search.unit === "string" ? search.unit : undefined,
    lesson: typeof search.lesson === "string" ? search.lesson : undefined,
  }),
  head: () => ({ meta: [{ title: "Curriculum - Jargon" }] }),
  component: CurriculumRedirect,
});

function CurriculumRedirect() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as CurriculumSearch;
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const session = await getSession();
        if (!alive) return;
        if (!session) {
          navigate({ to: "/login", replace: true });
          return;
        }
        const classes = await fetchTeacherClasses(session.user.id);
        if (!alive) return;
        const first = classes[0];
        if (!first) {
          navigate({ to: "/teacher", replace: true });
          return;
        }
        if (search.lesson) {
          navigate({
            to: "/teacher/class/$classId/lesson/$lessonId",
            params: { classId: first.id, lessonId: search.lesson },
            replace: true,
          });
          return;
        }
        navigate({
          to: "/teacher/class/$classId",
          params: { classId: first.id },
          search: { tab: "content" },
          replace: true,
        });
      } catch {
        if (alive) navigate({ to: "/teacher", replace: true });
      }
    })();
    return () => {
      alive = false;
    };
    // Runs once on mount — `search` is only forwarded, never re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);
  return <RouteLoader label="Loading…" />;
}
