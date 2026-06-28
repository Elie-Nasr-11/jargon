import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, ClipboardList, Send } from "lucide-react";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { GradientCard } from "@/components/GradientCard";
import {
  fetchPrimaryRole,
  fetchStudentAssessments,
  getSession,
  roleHome,
  startAssessment,
  submitAssessment,
} from "@/lib/api";
import type {
  Assessment,
  AssessmentAttempt,
  AssessmentItem,
  AssessmentItemAttempt,
  CurriculumQuizItem,
  StudentAssessmentBundle,
} from "@/lib/types";

export const Route = createFileRoute("/quiz/$assessmentId")({
  head: () => ({
    meta: [
      { title: "Quiz - Jargon" },
      { name: "description", content: "Complete a teacher-assigned Jargon assessment." },
    ],
  }),
  component: QuizPage,
});

type AnswerDraft = {
  choiceId: string;
  text: string;
  code: string;
};

function QuizPage() {
  const navigate = useNavigate();
  const { assessmentId } = Route.useParams();
  const [bundle, setBundle] = useState<StudentAssessmentBundle | null>(null);
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [booting, setBooting] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const assessment = bundle?.assessments.find((item) => item.id === assessmentId) || null;
  const items = useMemo(
    () =>
      (bundle?.items || [])
        .filter((item) => item.assessment_id === assessmentId)
        .sort((a, b) => a.position - b.position),
    [bundle?.items, assessmentId],
  );
  const quizzesById = useMemo(
    () => new Map((bundle?.quizzes || []).map((quiz) => [quiz.id, quiz])),
    [bundle?.quizzes],
  );
  const itemAttempts = useMemo(() => {
    if (!attempt || !bundle) return [];
    return bundle.itemAttempts.filter((item) => item.assessment_attempt_id === attempt.id);
  }, [attempt, bundle]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const session = await getSession();
        if (!session) {
          navigate({ to: "/login", replace: true });
          return;
        }
        const role = await fetchPrimaryRole(session.access_token, session.user.id);
        if (!alive) return;
        if (role !== "student") {
          navigate({ to: roleHome(role), replace: true });
          return;
        }
        const liveBundle = await fetchStudentAssessments();
        if (!alive) return;
        const liveAssessment = liveBundle.assessments.find((item) => item.id === assessmentId);
        if (!liveAssessment) throw new Error("This quiz is not assigned to you.");
        const existingAttempt =
          liveBundle.attempts
            .filter((item) => item.assessment_id === assessmentId)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null;
        if (existingAttempt && existingAttempt.status !== "in_progress") {
          setBundle(liveBundle);
          setAttempt(existingAttempt);
          return;
        }
        const started = await startAssessment(assessmentId);
        const refreshed = await fetchStudentAssessments();
        if (!alive) return;
        setBundle(refreshed);
        setAttempt(
          (started?.attempt as AssessmentAttempt | undefined) ||
            refreshed.attempts.find((item) => item.assessment_id === assessmentId) ||
            null,
        );
      } catch (error) {
        if (alive) setMessage((error as Error).message || "Could not load quiz.");
      } finally {
        if (alive) setBooting(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [assessmentId, navigate]);

  const setDraft = (itemId: string, patch: Partial<AnswerDraft>) => {
    setDrafts((current) => ({
      ...current,
      [itemId]: {
        choiceId: current[itemId]?.choiceId || "",
        text: current[itemId]?.text || "",
        code: current[itemId]?.code || "",
        ...patch,
      },
    }));
  };

  const submit = async () => {
    if (!attempt) return;
    const missing = items.find((item) => {
      if (!item.required) return false;
      const quiz = quizzesById.get(item.quiz_item_id);
      const draft = drafts[item.id];
      if (!quiz) return false;
      if (quiz.question_type === "multiple_choice") return !draft?.choiceId;
      if (quiz.question_type === "code") return !draft?.code.trim();
      return !draft?.text.trim();
    });
    if (missing) {
      setMessage("Answer each required question before submitting.");
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      await submitAssessment({
        attemptId: attempt.id,
        answers: items.map((item) => {
          const quiz = quizzesById.get(item.quiz_item_id);
          const draft = drafts[item.id] || { choiceId: "", text: "", code: "" };
          return {
            assessmentItemId: item.id,
            answerMode:
              quiz?.question_type === "multiple_choice"
                ? "multiple_choice"
                : quiz?.question_type === "code"
                  ? "code"
                  : "text",
            answerText: draft.text,
            answerCode: draft.code,
            choiceId: draft.choiceId,
          };
        }),
      });
      const refreshed = await fetchStudentAssessments();
      setBundle(refreshed);
      setAttempt(
        refreshed.attempts
          .filter((item) => item.assessment_id === assessmentId)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null,
      );
      setMessage("Quiz submitted.");
    } catch (error) {
      setMessage((error as Error).message || "Could not submit quiz.");
    } finally {
      setSubmitting(false);
    }
  };

  const completed = attempt && attempt.status !== "in_progress";

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <AmbientCanvas />
      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: "/chat" })}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background/55 px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.7} />
            Back to chat
          </button>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Lesson quiz
          </div>
        </div>

        <GradientCard innerClassName="overflow-hidden">
          <div className="bg-background/80 p-5 sm:p-7">
            {booting ? (
              <div className="text-[13px] text-muted-foreground">Loading quiz...</div>
            ) : assessment ? (
              <QuizContent
                assessment={assessment}
                items={items}
                quizzesById={quizzesById}
                itemAttempts={itemAttempts}
                attempt={attempt}
                drafts={drafts}
                completed={Boolean(completed)}
                submitting={submitting}
                message={message}
                onSetDraft={setDraft}
                onSubmit={submit}
              />
            ) : (
              <div className="text-[13px] text-muted-foreground">
                {message || "This quiz could not be loaded."}
              </div>
            )}
          </div>
        </GradientCard>
      </main>
    </div>
  );
}

function QuizContent({
  assessment,
  items,
  quizzesById,
  itemAttempts,
  attempt,
  drafts,
  completed,
  submitting,
  message,
  onSetDraft,
  onSubmit,
}: {
  assessment: Assessment;
  items: AssessmentItem[];
  quizzesById: Map<string, CurriculumQuizItem>;
  itemAttempts: AssessmentItemAttempt[];
  attempt: AssessmentAttempt | null;
  drafts: Record<string, AnswerDraft>;
  completed: boolean;
  submitting: boolean;
  message: string;
  onSetDraft: (itemId: string, patch: Partial<AnswerDraft>) => void;
  onSubmit: () => Promise<void>;
}) {
  const attemptByItemId = new Map(itemAttempts.map((item) => [item.assessment_item_id, item]));
  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.7} />
            {assessment.status}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            {assessment.title}
          </h1>
          {assessment.instructions ? (
            <p className="mt-3 max-w-2xl whitespace-pre-wrap text-[14px] leading-relaxed text-muted-foreground">
              {assessment.instructions}
            </p>
          ) : null}
        </div>
        {completed ? (
          <div className="rounded-2xl border border-border bg-background/45 p-3 text-right">
            <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Result
            </div>
            <div className="mt-1 text-[22px] font-semibold text-foreground">
              {attempt?.final_score === null || attempt?.final_score === undefined
                ? "Pending"
                : formatPercent(attempt.final_score)}
            </div>
            <div className="mt-1 text-[11.5px] text-muted-foreground">
              {attempt?.status === "submitted" ? "Teacher review needed" : "Returned"}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-6 grid gap-4">
        {items.map((item, index) => {
          const quiz = quizzesById.get(item.quiz_item_id);
          const draft = drafts[item.id] || { choiceId: "", text: "", code: "" };
          const itemAttempt = attemptByItemId.get(item.id);
          if (!quiz) return null;
          return (
            <div key={item.id} className="rounded-3xl border border-border bg-background/35 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
                  Question {index + 1} · {quiz.question_type.replace("_", " ")} · {item.points} pt
                </div>
                {itemAttempt ? (
                  <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
                    {itemAttempt.review_state.replace("_", " ")}
                  </span>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
                {quiz.prompt}
              </p>
              <div className="mt-4">
                {quiz.question_type === "multiple_choice" ? (
                  <div className="grid gap-2">
                    {quiz.choices.map((choice) => (
                      <label
                        key={choice.id}
                        className={`flex items-start gap-2 rounded-2xl border px-3 py-2 text-[13px] ${
                          completed
                            ? "border-border bg-background/35 text-muted-foreground"
                            : "border-border bg-background/55 text-foreground"
                        }`}
                      >
                        <input
                          type="radio"
                          disabled={completed}
                          checked={(itemAttempt?.choice_id || draft.choiceId) === choice.id}
                          onChange={() => onSetDraft(item.id, { choiceId: choice.id })}
                          className="mt-0.5 h-4 w-4 accent-foreground"
                        />
                        {choice.text}
                      </label>
                    ))}
                  </div>
                ) : quiz.question_type === "code" ? (
                  <textarea
                    value={itemAttempt?.answer_code || draft.code}
                    disabled={completed}
                    onChange={(event) => onSetDraft(item.id, { code: event.target.value })}
                    placeholder="Write code for this answer..."
                    className="min-h-[150px] w-full rounded-2xl border border-border bg-[var(--code-background)] px-3 py-2 text-[13px] leading-relaxed text-[var(--code-foreground)] outline-none placeholder:text-muted-foreground disabled:opacity-70"
                    style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                  />
                ) : (
                  <textarea
                    value={itemAttempt?.answer_text || draft.text}
                    disabled={completed}
                    onChange={(event) => onSetDraft(item.id, { text: event.target.value })}
                    placeholder="Write your answer..."
                    className="min-h-[120px] w-full rounded-2xl border border-border bg-background/55 px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-70"
                  />
                )}
              </div>
              {itemAttempt ? (
                <div className="mt-3 rounded-2xl border border-border bg-background/45 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                    Score:{" "}
                    {itemAttempt.score === null || itemAttempt.score === undefined
                      ? "pending"
                      : `${itemAttempt.score}/${itemAttempt.max_score}`}
                    {itemAttempt.passed === false ? " · needs review" : ""}
                  </div>
                  {itemAttempt.feedback ? (
                    <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground">
                      {itemAttempt.feedback}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12.5px] text-muted-foreground">
          {message ||
            (completed
              ? attempt?.feedback || "Your quiz has been submitted."
              : "Submit when you are ready. Text and code answers may need teacher review.")}
        </div>
        {!completed ? (
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-[13px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Send className="h-4 w-4" strokeWidth={1.7} />
            {submitting ? "Submitting..." : "Submit quiz"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}
