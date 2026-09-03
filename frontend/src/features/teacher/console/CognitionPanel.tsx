/**
 * The Thinking tab — the Independent Cognitive Production Profile (docs/COGNITION.md).
 *
 * The rubric's whole point rendered: never "63%". A teacher reads WHAT this student's
 * own thinking produced — eight dimensions at 0-4, how much tutor assistance sat under
 * each response (S0-S5), whether that assistance is falling (the §14 trajectory), and
 * a narrative in sentences: what they understand, what they confuse, the one next move.
 *
 * Scoring runs on demand and is idempotent: "Read the thinking" judges only responses
 * not yet judged, so pressing it twice costs one model call, not two.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, Loader2, RefreshCw } from "lucide-react";
// R93: one home for the dimension vocabulary — this panel and the class room view
// render the same eight names, and two copies of a label list drift.
import { DIMENSION_LABELS, PROBE_LABELS } from "@/features/teacher/cognition/labels";
import {
  attributionFallback,
  attributionSide,
  dimensionQuotes,
  signalsLine,
  traceableShareLabel,
} from "@/features/teacher/cognition/evidence";
import { EmptyInline, Panel } from "@/features/teacher/console/chrome";
import { formatDateTime, lessonName } from "@/features/teacher/classShared";
import { countOf } from "@/lib/format";
import {
  fetchCognitionProfile,
  getSession,
  scoreCognitionLesson,
  type CognitionDims,
  type CognitionResponse,
  type CognitionTurnScore,
} from "@/lib/api";
import type { LearningSession, Lesson } from "@/lib/types";

function DimensionRow({
  label,
  value,
  pending = false,
}: {
  label: string;
  value: number | null;
  /** Nothing has been asked yet — different from "asked and scored nothing". */
  pending?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 text-meta text-muted-foreground">{label}</span>
      <span
        className="flex items-center gap-1"
        aria-label={`${label}: ${value !== null ? `${value} of 4` : pending ? "not checked yet" : "no evidence"}`}
      >
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-2 w-6 rounded-full ${
              value !== null && value >= step ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </span>
      <span className="text-meta font-medium text-foreground">
        {value !== null ? `${value}/4` : pending ? "Pending" : "—"}
      </span>
    </div>
  );
}

/**
 * What the judge actually saw, for one response.
 *
 * Closed by default: a teacher reading top to bottom wants the sentence, and the
 * quotes are what they open when they doubt it — or when a parent asks how the system
 * knows. Everything here is quotes and counts. §15's rule that the model is never one
 * number holds one level down too: no score appears in this disclosure, and the
 * traceable share is words rather than a percentage.
 */
function ResponseEvidence({ turn }: { turn: CognitionTurnScore }) {
  const quotes = dimensionQuotes(
    turn.evidence,
    DIMENSION_LABELS.map(({ key }) => key),
  );
  const fromTutor = attributionSide(turn.evidence, "ai_supplied");
  const theirOwn = attributionSide(turn.evidence, "student_originated");
  const tutorFallback = attributionFallback(turn.evidence, "ai_supplied");
  const ownFallback = attributionFallback(turn.evidence, "student_originated");
  const line = signalsLine(turn.signals);
  const share = traceableShareLabel(turn.signals);

  if (
    !quotes.length &&
    !fromTutor.length &&
    !theirOwn.length &&
    !tutorFallback &&
    !ownFallback &&
    !line
  ) {
    return null;
  }

  const labelFor = (key: string) =>
    DIMENSION_LABELS.find((entry) => entry.key === key)?.label ?? key;

  return (
    <details className="mt-1.5 group">
      <summary className="cursor-pointer list-none text-meta text-muted-foreground transition-colors hover:text-foreground">
        Evidence
        {share ? <span className="ml-2 text-muted-foreground">· {share}</span> : null}
      </summary>
      <div className="mt-2 grid gap-2 border-l border-border pl-3">
        {quotes.length ? (
          <div className="grid gap-1">
            {quotes.map(({ dimension, quote }) => (
              <p key={dimension} className="text-meta text-muted-foreground">
                <span className="text-foreground">{labelFor(dimension)}</span> — “{quote}”
              </p>
            ))}
          </div>
        ) : null}

        {fromTutor.length || theirOwn.length || tutorFallback || ownFallback ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <AttributionColumn
              title="From the tutor"
              rows={fromTutor}
              fallback={tutorFallback}
              empty="Nothing was supplied before this."
            />
            <AttributionColumn
              title="Their own"
              rows={theirOwn}
              fallback={ownFallback}
              empty="Nothing new in this response."
            />
          </div>
        ) : null}

        {line ? <p className="font-mono text-[10px] text-muted-foreground">{line}</p> : null}
      </div>
    </details>
  );
}

function AttributionColumn({
  title,
  rows,
  fallback,
  empty,
}: {
  title: string;
  rows: ReturnType<typeof attributionSide>;
  /** Pre-R99 rows carry one free-text string instead of the five categories. */
  fallback: string;
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {title}
      </div>
      {rows.length ? (
        <ul className="mt-1 grid gap-0.5">
          {rows.map(({ category, label, quotes }) => (
            <li key={category} className="text-meta text-muted-foreground">
              <span className="text-foreground">{label}:</span> {quotes.join("; ")}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-meta text-muted-foreground">{fallback || empty}</p>
      )}
    </div>
  );
}

export function CognitionPanel({
  studentId,
  sessions,
  lessonsById,
}: {
  studentId: string;
  sessions: LearningSession[];
  lessonsById: Map<string, Lesson>;
}) {
  // Lessons this student has actually worked in, most recent first.
  const lessonIds = useMemo(() => {
    const ordered = [...sessions].sort((a, b) =>
      String(b.updated_at || "").localeCompare(String(a.updated_at || "")),
    );
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const session of ordered) {
      if (!session.lesson_id || seen.has(session.lesson_id)) continue;
      seen.add(session.lesson_id);
      ids.push(session.lesson_id);
    }
    return ids;
  }, [sessions]);

  const [lessonId, setLessonId] = useState(lessonIds[0] ?? "");
  useEffect(() => {
    if (lessonIds.length && !lessonIds.includes(lessonId)) setLessonId(lessonIds[0]);
  }, [lessonIds, lessonId]);

  const [data, setData] = useState<CognitionResponse | null>(null);
  const [busy, setBusy] = useState<"load" | "score" | null>(null);
  const [error, setError] = useState("");

  // Stored truth on open/lesson-change — cheap, no judging.
  useEffect(() => {
    if (!lessonId) return;
    let cancelled = false;
    setBusy("load");
    setError("");
    void (async () => {
      try {
        const session = await getSession();
        if (!session) throw new Error("Sign in again to read this.");
        const response = await fetchCognitionProfile({
          accessToken: session.access_token,
          userId: studentId,
          lessonId,
        });
        if (!cancelled) setData(response);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Could not load.");
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, lessonId]);

  const score = useCallback(async () => {
    if (!lessonId || busy) return;
    setBusy("score");
    setError("");
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in again to read this.");
      const response = await scoreCognitionLesson({
        accessToken: session.access_token,
        userId: studentId,
        lessonId,
      });
      setData(response);
    } catch (err) {
      setError((err as Error).message || "Scoring failed.");
    } finally {
      setBusy(null);
    }
  }, [studentId, lessonId, busy]);

  const profile = data?.profile ?? null;
  const turns = data?.turns ?? [];
  const scaffoldTrend =
    profile && profile.scaffold_recent !== null && profile.scaffold_earlier !== null
      ? profile.scaffold_recent < profile.scaffold_earlier
        ? "falling"
        : profile.scaffold_recent > profile.scaffold_earlier
          ? "rising"
          : "steady"
      : null;

  return (
    <div className="mt-5 grid gap-4">
      <Panel title="How they think" icon={<Brain className="h-4 w-4" strokeWidth={1.6} />}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={lessonId}
            onChange={(event) => setLessonId(event.target.value)}
            aria-label="Lesson"
            className="rounded-control border border-border bg-depth-field px-2.5 py-1.5 text-meta text-foreground"
          >
            {lessonIds.map((id) => (
              <option key={id} value={id}>
                {lessonName(lessonsById, id)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void score()}
            disabled={!lessonId || busy !== null}
            className="btn btn-primary btn-sm"
          >
            {busy === "score" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
            {busy === "score" ? "Reading the thinking…" : "Read the thinking"}
          </button>
          {typeof data?.remaining === "number" && data.remaining > 0 ? (
            <span className="text-meta text-muted-foreground">
              {data.remaining} more to read — press again.
            </span>
          ) : null}
        </div>

        {error ? <p className="text-meta text-danger">{error}</p> : null}
        {busy === "score" ? (
          <p className="mb-3 text-meta text-muted-foreground">
            Jargon is reading this student's responses against the lesson and the help they were
            given. A first pass takes a minute or two.
          </p>
        ) : null}

        {!lessonIds.length ? (
          <EmptyInline
            title="No lesson work yet"
            body="Nothing to read until this student has worked in a lesson."
          />
        ) : !profile && busy !== "score" ? (
          <EmptyInline
            title="Nothing read yet"
            body="Jargon reads new work on its own every fifteen minutes. Read the thinking now if you would rather not wait."
          />
        ) : null}

        {profile ? (
          <div className="grid gap-4">
            {profile.narrative ? (
              // The rubric's deliverable: sentences a teacher acts on, not a number.
              <p className="rounded-card border border-primary/25 bg-primary/[0.04] px-4 py-3 font-serif text-body leading-relaxed text-foreground">
                {profile.narrative}
              </p>
            ) : null}

            <div className="grid gap-1.5">
              {DIMENSION_LABELS.map(({ key, label }) => (
                <DimensionRow key={key} label={label} value={profile[key]} />
              ))}
              {/* R100 (§10/§11): what a delayed unaided question found. Kept apart from
                  the eight by a hairline, because these come from a different KIND of
                  evidence — one question at the start of a later session, not the work
                  the lesson itself collected. "Pending" is the honest reading before one
                  has been asked; the rubric's own §15 example prints "Retention: Pending"
                  the same way. */}
              <div className="mt-1 border-t border-border pt-1.5">
                {PROBE_LABELS.map(({ key, label }) => (
                  <DimensionRow
                    key={key}
                    label={label}
                    value={typeof profile[key] === "number" ? (profile[key] as number) : null}
                    pending={!profile.probes_answered}
                  />
                ))}
              </div>
            </div>

            <p className="text-meta text-muted-foreground">
              {countOf(profile.turns_scored, "response")} judged.
              {typeof profile.unaided_count === "number" && profile.turns_scored ? (
                <>
                  {" "}
                  {profile.unaided_count} of {profile.turns_scored} came with no help before them.
                </>
              ) : null}
              {scaffoldTrend ? (
                <>
                  {" "}
                  Tutor assistance under them:{" "}
                  <span className="font-medium text-foreground">
                    S{profile.scaffold_earlier} → S{profile.scaffold_recent}
                  </span>{" "}
                  <span
                    className={
                      scaffoldTrend === "falling"
                        ? "text-success"
                        : scaffoldTrend === "rising"
                          ? "text-warning"
                          : "text-muted-foreground"
                    }
                  >
                    ({scaffoldTrend}
                    {scaffoldTrend === "falling" ? " — the direction you want" : ""})
                  </span>
                </>
              ) : null}
            </p>

            {turns.length ? (
              <div className="grid gap-2">
                <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Response by response
                </div>
                {turns.slice(0, 12).map((turn) => (
                  <div
                    key={turn.id}
                    className="flex items-start gap-2.5 rounded-card border border-border bg-depth-sub px-3 py-2"
                  >
                    <span
                      title={`Assistance immediately before this response: S${turn.scaffold_level}`}
                      className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10px] ${
                        turn.scaffold_level >= 4
                          ? "border-warning/40 text-warning"
                          : turn.scaffold_level >= 2
                            ? "border-border text-muted-foreground"
                            : "border-success/40 text-success"
                      }`}
                    >
                      S{turn.scaffold_level}
                    </span>
                    <span className="min-w-0 flex-1 text-meta leading-relaxed text-foreground">
                      {turn.note || "Judged — no note."}
                      <span className="ml-2 text-muted-foreground">
                        {formatDateTime(turn.created_at)}
                      </span>
                      <ResponseEvidence turn={turn} />
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
