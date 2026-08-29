/**
 * Quizzes: writing them, scheduling them, and seeing who still owes one.
 *
 * A quiz can stand alone or be the thing a lesson step IS; either way it is
 * edited here, question by question, and released to the class from the same
 * panel that lists what has come back.
 */
import { useEffect, useState } from "react";
import { Collapsible } from "@/components/Collapsible";
import { displayName } from "@/features/teacher/classShared";
import type {
  AssessmentGradingMode,
  AssessmentResultReleasePolicy,
  AssessmentStatus,
  CurriculumQuizItem,
  Lesson,
  Profile,
  TeacherClassSummary,
} from "@/lib/types";
import { Send } from "lucide-react";

export type AssessmentFormQuestion = {
  quizItemId?: string;
  prompt?: string;
  questionType?: "multiple_choice" | "text" | "code";
  choices?: Array<{ id: string; text: string }>;
  correctChoiceIds?: string[];
  rubric?: Record<string, unknown>;
  skillKeys?: string[];
  points: number;
  required: boolean;
};

export type AssessmentFormValues = {
  organizationId: string;
  classId: string;
  lessonId: string;
  // R48: set when the dialog was opened FROM a lesson step — links the created row.
  activityId?: string | null;
  title: string;
  instructions: string;
  dueAt: string;
  status: Extract<AssessmentStatus, "draft" | "published">;
  gradingMode: AssessmentGradingMode;
  resultReleasePolicy: AssessmentResultReleasePolicy;
  attemptLimit: number;
  required: boolean;
  recipientIds: string[];
  items: AssessmentFormQuestion[];
};

export function defaultAssessmentQuestion(): AssessmentFormQuestion {
  return {
    prompt: "",
    questionType: "multiple_choice",
    choices: [
      { id: "a", text: "" },
      { id: "b", text: "" },
      { id: "c", text: "" },
    ],
    correctChoiceIds: ["a"],
    skillKeys: [],
    points: 1,
    required: true,
  };
}

export function defaultAssessmentForm(
  classSummary: TeacherClassSummary,
  lessons: Lesson[],
  studentIds: string[],
): AssessmentFormValues {
  return {
    organizationId: classSummary.organization_id,
    classId: classSummary.id,
    lessonId: lessons[0]?.id || "",
    title: "",
    instructions: "",
    dueAt: "",
    status: "published",
    gradingMode: "mixed",
    resultReleasePolicy: "after_review",
    attemptLimit: 1,
    required: false,
    recipientIds: studentIds,
    items: [defaultAssessmentQuestion(), { ...defaultAssessmentQuestion() }],
  };
}

export function AssessmentManager({
  classSummary,
  lessons,
  quizItems,
  studentIds,
  profilesById,
  saving,
  context = null,
  onSaveAssessment,
}: {
  classSummary: TeacherClassSummary;
  lessons: Lesson[];
  quizItems: CurriculumQuizItem[];
  studentIds: string[];
  profilesById: Map<string, Profile>;
  saving: boolean;
  // R48: present when the dialog was opened FROM a lesson step — the lesson is locked
  // to that step's lesson and the created row carries the step link.
  context?: { lessonId: string; activityId: string | null } | null;
  onSaveAssessment: (input: AssessmentFormValues) => Promise<void>;
}) {
  const seedDraft = () => ({
    ...defaultAssessmentForm(classSummary, lessons, studentIds),
    ...(context ? { lessonId: context.lessonId, activityId: context.activityId } : {}),
  });
  const [draft, setDraft] = useState<AssessmentFormValues>(seedDraft);
  const [assessmentMessage, setAssessmentMessage] = useState("");
  const lessonQuizItems = quizItems.filter(
    (quiz) => quiz.lesson_id === draft.lessonId && quiz.status !== "archived",
  );

  useEffect(() => {
    setDraft(seedDraft());
    setAssessmentMessage("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classSummary, lessons, studentIds, context]);

  const setField = <K extends keyof AssessmentFormValues>(key: K, value: AssessmentFormValues[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const updateQuestion = (index: number, patch: Partial<AssessmentFormQuestion>) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  };

  const toggleRecipient = (studentId: string) => {
    setDraft((current) => ({
      ...current,
      recipientIds: current.recipientIds.includes(studentId)
        ? current.recipientIds.filter((id) => id !== studentId)
        : [...current.recipientIds, studentId],
    }));
  };

  const updateChoice = (questionIndex: number, choiceId: string, text: string) => {
    const question = draft.items[questionIndex];
    const choices = (question.choices || []).map((choice) =>
      choice.id === choiceId ? { ...choice, text } : choice,
    );
    updateQuestion(questionIndex, { choices });
  };

  const submit = async () => {
    try {
      if (!draft.title.trim()) throw new Error("Add an assessment title.");
      if (!draft.lessonId) throw new Error("Choose a lesson.");
      if (!draft.recipientIds.length) throw new Error("Choose at least one student.");
      const items = draft.items.map((item) => {
        if (item.quizItemId) return item;
        const prompt = item.prompt?.trim() || "";
        if (!prompt) throw new Error("Every new question needs a prompt.");
        if (item.questionType === "multiple_choice") {
          const choices = (item.choices || []).filter((choice) => choice.text.trim());
          if (choices.length < 2)
            throw new Error("Multiple-choice questions need at least two choices.");
          if (!item.correctChoiceIds?.[0])
            throw new Error("Choose the correct answer for each MCQ.");
          return { ...item, choices, prompt };
        }
        return { ...item, prompt };
      });

      await onSaveAssessment({
        ...draft,
        title: draft.title.trim(),
        instructions: draft.instructions.trim(),
        dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : "",
        items,
      });
      setAssessmentMessage(
        draft.status === "published" ? "Quiz created and assigned." : "Draft quiz saved.",
      );
      setDraft(defaultAssessmentForm(classSummary, lessons, studentIds));
    } catch (error) {
      setAssessmentMessage((error as Error).message || "Could not create quiz.");
    }
  };

  return (
    <div className="pt-1">
      {/* Hosted inside the Structure section's "Quizzes" bench — title + count live on the
          Collapsible header; grading moved to Students + performance. */}
      <p className="mb-3 text-meta text-muted-foreground">
        Build and publish multi-question quizzes for a lesson. MCQ items auto-grade on submission.
      </p>

      <div className="grid gap-4">
        <div className="rounded-card border border-border bg-depth-sub p-4">
          <div className="text-body font-medium text-foreground">Create quiz</div>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Lesson
              <select
                value={draft.lessonId}
                onChange={(event) => setField("lessonId", event.target.value)}
                disabled={Boolean(context)}
                className="jargon-input normal-case tracking-normal disabled:opacity-60"
              >
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Title
              <input
                value={draft.title}
                onChange={(event) => setField("title", event.target.value)}
                placeholder="Clear reasons checkpoint"
                className="jargon-input normal-case tracking-normal"
              />
            </label>
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Instructions
              <textarea
                value={draft.instructions}
                onChange={(event) => setField("instructions", event.target.value)}
                placeholder="Answer each question carefully. Written answers will be reviewed by your teacher."
                className="jargon-input min-h-[76px] normal-case leading-relaxed tracking-normal"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Due
                <input
                  type="datetime-local"
                  value={draft.dueAt}
                  onChange={(event) => setField("dueAt", event.target.value)}
                  className="jargon-input normal-case tracking-normal"
                />
              </label>
              <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Status
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setField(
                      "status",
                      event.target.value as Extract<AssessmentStatus, "draft" | "published">,
                    )
                  }
                  className="jargon-input normal-case tracking-normal"
                >
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </label>
              <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Attempts
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={draft.attemptLimit}
                  onChange={(event) => setField("attemptLimit", Number(event.target.value) || 1)}
                  className="jargon-input normal-case tracking-normal"
                />
              </label>
            </div>

            <label className="flex items-start gap-2.5 rounded-card border border-border bg-depth-field p-3">
              <input
                type="checkbox"
                checked={draft.required}
                onChange={(event) => setField("required", event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-foreground"
              />
              <span className="text-meta text-foreground">
                Required for lesson completion
                <span className="mt-0.5 block text-meta text-muted-foreground">
                  Students can't finish the lesson until they complete this quiz.
                </span>
              </span>
            </label>

            <div className="rounded-card border border-border bg-depth-field p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Recipients
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setField(
                      "recipientIds",
                      draft.recipientIds.length === studentIds.length ? [] : studentIds,
                    )
                  }
                  className="text-meta text-muted-foreground transition-colors hover:text-foreground"
                >
                  {draft.recipientIds.length === studentIds.length ? "Clear" : "All students"}
                </button>
              </div>
              <div className="grid gap-2">
                {studentIds.map((studentId) => {
                  const profile = profilesById.get(studentId) || null;
                  return (
                    <label
                      key={studentId}
                      className="flex items-center gap-2 text-meta text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={draft.recipientIds.includes(studentId)}
                        onChange={() => toggleRecipient(studentId)}
                        className="h-4 w-4 accent-foreground"
                      />
                      {displayName(profile, studentId)}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Questions
                </div>
                <button
                  type="button"
                  onClick={() => setField("items", [...draft.items, defaultAssessmentQuestion()])}
                  className="btn btn-secondary btn-sm"
                >
                  Add question
                </button>
              </div>
              {draft.items.map((question, index) => (
                <div key={index} className="rounded-card border border-border bg-depth-sub p-3">
                  <div className="mb-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                    <select
                      value={question.quizItemId || ""}
                      onChange={(event) =>
                        updateQuestion(index, {
                          quizItemId: event.target.value || undefined,
                          prompt: event.target.value ? "" : question.prompt,
                        })
                      }
                      className="jargon-input"
                    >
                      <option value="">New question</option>
                      {lessonQuizItems.map((quiz) => (
                        <option key={quiz.id} value={quiz.id}>
                          Existing: {quiz.prompt.slice(0, 70)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0.1}
                      step={0.5}
                      value={question.points}
                      onChange={(event) =>
                        updateQuestion(index, { points: Number(event.target.value) || 1 })
                      }
                      className="jargon-input"
                    />
                  </div>
                  {!question.quizItemId ? (
                    <div className="grid gap-2">
                      <select
                        value={question.questionType || "multiple_choice"}
                        onChange={(event) =>
                          updateQuestion(index, {
                            questionType: event.target
                              .value as AssessmentFormQuestion["questionType"],
                          })
                        }
                        className="jargon-input"
                      >
                        <option value="multiple_choice">Multiple choice</option>
                        <option value="text">Text response</option>
                        <option value="code">Code response</option>
                      </select>
                      <textarea
                        value={question.prompt || ""}
                        onChange={(event) => updateQuestion(index, { prompt: event.target.value })}
                        placeholder="Question prompt"
                        className="jargon-input min-h-[72px] leading-relaxed"
                      />
                      {question.questionType === "multiple_choice" ? (
                        <div className="grid gap-2">
                          {(question.choices || []).map((choice) => (
                            <div
                              key={choice.id}
                              className="grid gap-2 sm:grid-cols-[72px_minmax(0,1fr)]"
                            >
                              <label className="flex items-center gap-2 text-meta text-muted-foreground">
                                <input
                                  type="radio"
                                  checked={question.correctChoiceIds?.[0] === choice.id}
                                  onChange={() =>
                                    updateQuestion(index, { correctChoiceIds: [choice.id] })
                                  }
                                  className="h-4 w-4 accent-foreground"
                                />
                                {choice.id.toUpperCase()}
                              </label>
                              <input
                                value={choice.text}
                                onChange={(event) =>
                                  updateChoice(index, choice.id, event.target.value)
                                }
                                placeholder={`Choice ${choice.id.toUpperCase()}`}
                                className="jargon-input"
                              />
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <input
                        value={(question.skillKeys || []).join(", ")}
                        onChange={(event) =>
                          updateQuestion(index, {
                            skillKeys: event.target.value
                              .split(",")
                              .map((item) => item.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="Skill keys, comma separated"
                        className="jargon-input"
                      />
                    </div>
                  ) : (
                    <div className="text-meta text-muted-foreground">
                      Uses existing lesson question. Points and recipients are controlled here.
                    </div>
                  )}
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        setField(
                          "items",
                          draft.items.length > 1
                            ? draft.items.filter((_, itemIndex) => itemIndex !== index)
                            : draft.items,
                        )
                      }
                      className="text-meta text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="btn btn-secondary mt-1"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.7} />
              {saving ? "Saving..." : draft.status === "published" ? "Assign quiz" : "Save draft"}
            </button>
            {assessmentMessage ? (
              <div className="text-meta leading-relaxed text-muted-foreground">
                {assessmentMessage}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
