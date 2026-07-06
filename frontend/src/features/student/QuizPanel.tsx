import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Send } from "lucide-react";
import { ReadAloudAction } from "@/components/ReadAloudAction";
import { CodeArea } from "@/components/CodeArea";
import { fetchStudentAssessments, startAssessment, submitAssessment } from "@/lib/api";
import type { VoiceSettings } from "@/lib/jargon-store";
import type {
  Assessment,
  AssessmentAttempt,
  AssessmentItem,
  AssessmentItemAttempt,
  CurriculumQuizItem,
  StudentAssessmentBundle,
} from "@/lib/types";

// The quiz-taking surface, prop-driven for the chat's quiz modal (formerly the /quiz route —
// retired so all formal work stays one overlay away from the conversation). Starts/resumes the
// attempt on mount and re-fetches after submit so results show in place.

type AnswerDraft = {
  choiceId: string;
  text: string;
  code: string;
};

export function QuizPanel({
  assessmentId,
  accessToken,
  voice,
}: {
  assessmentId: string;
  // For per-question read-aloud (accessibility): the same TTS control the chat uses.
  accessToken: string;
  voice: VoiceSettings;
}) {
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
  }, [assessmentId]);

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

  if (booting) {
    return <div className="py-6 text-[13px] text-muted-foreground">Loading quiz...</div>;
  }
  if (!assessment) {
    return (
      <div className="py-6 text-[13px] text-muted-foreground">
        {message || "This quiz could not be loaded."}
      </div>
    );
  }
  return (
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
      accessToken={accessToken}
      voice={voice}
    />
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
  accessToken,
  voice,
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
  accessToken: string;
  voice: VoiceSettings;
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
          <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-foreground">
            {assessment.title}
          </h2>
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
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
                  {quiz.prompt}
                </p>
                <ReadAloudAction
                  text={quiz.prompt}
                  voice={voice}
                  accessToken={accessToken}
                  lessonId={assessment.lesson_id ?? ""}
                  sessionId={null}
                  onVoiceEvent={() => {}}
                />
              </div>
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
                  <CodeArea
                    value={itemAttempt?.answer_code || draft.code}
                    readOnly={completed}
                    onChange={(code) => onSetDraft(item.id, { code })}
                    height={150}
                    placeholder="Write code for this answer..."
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
