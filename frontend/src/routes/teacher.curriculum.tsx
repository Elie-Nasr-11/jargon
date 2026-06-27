import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Archive, BookOpen, Check, Eye, FilePlus2, Layers3, NotebookPen, Send } from "lucide-react";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { GradientCard } from "@/components/GradientCard";
import { SettingsMenu } from "@/components/SettingsMenu";
import { Breadcrumb } from "@/components/Breadcrumb";
import {
  createLessonResource,
  fetchCurriculumAuthoringData,
  getSession,
  invokeCurriculumAdmin,
} from "@/lib/api";
import type {
  CurriculumAuthoringData,
  CurriculumBlueprint,
  CurriculumSubject,
  Lesson,
  LessonResource,
  LessonResourceType,
} from "@/lib/types";

type LessonKind = CurriculumBlueprint["lesson"]["type"];
type ResponseMode = CurriculumBlueprint["activity"]["response_mode"];
type ActivityStage = CurriculumBlueprint["activity"]["stage"];

type DraftState = {
  lessonId: string;
  subjectId: string;
  subjectTitle: string;
  subjectDescription: string;
  courseId: string;
  courseTitle: string;
  courseDescription: string;
  unitId: string;
  unitTitle: string;
  unitPosition: string;
  lessonTitle: string;
  lessonLevel: string;
  lessonType: LessonKind;
  tutorPrompt: string;
  sampleCode: string;
  milestoneTitle: string;
  milestoneObjective: string;
  skillKeys: string;
  allowedModes: ResponseMode[];
  activityTitle: string;
  activityStage: ActivityStage;
  activityPrompt: string;
  activityResponseMode: ResponseMode;
  starterCode: string;
  expectedOutput: string;
  rubricNotes: string;
  quizPrompt: string;
  quizChoices: Array<{ id: string; text: string }>;
  quizCorrectChoiceId: string;
  resourceIds: string[];
  newResourceTitle: string;
  newResourceDescription: string;
  newResourceInstructions: string;
  newResourceType: LessonResourceType;
  newResourceUrl: string;
  newResourceFile: File | null;
};

export const Route = createFileRoute("/teacher/curriculum")({
  // Selected lesson lives in the URL (?lesson=) so a lesson editor view is
  // deep-linkable and back/forward works.
  validateSearch: (search: Record<string, unknown>): { lesson?: string } => ({
    lesson: typeof search.lesson === "string" ? search.lesson : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Curriculum - Jargon" },
      {
        name: "description",
        content: "Teacher curriculum authoring studio for Jargon lessons.",
      },
    ],
  }),
  component: CurriculumPage,
});

function CurriculumPage() {
  const navigate = useNavigate();
  const { lesson: lessonParam } = useSearch({ strict: false }) as { lesson?: string };
  const [booting, setBooting] = useState(true);
  const [email, setEmail] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [data, setData] = useState<CurriculumAuthoringData | null>(null);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [draft, setDraft] = useState<DraftState>(() => defaultDraft());
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const session = await getSession();
      if (!session) {
        navigate({ to: "/login", replace: true });
        return;
      }
      const curriculum = await fetchCurriculumAuthoringData(session.user.id);
      setEmail(session.user.email || "");
      setTeacherId(session.user.id);
      setData(curriculum);
      setSelectedClassId((current) => current || curriculum.classes[0]?.id || "");
      setMessage("");
    } catch (error) {
      setMessage((error as Error).message || "Could not load curriculum studio.");
    } finally {
      setBooting(false);
    }
  }, [navigate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedClass = useMemo(
    () => data?.classes.find((item) => item.id === selectedClassId) || null,
    [data, selectedClassId],
  );

  const visibleResources = useMemo(() => {
    if (!data || !selectedClass) return [];
    return data.resources.filter((resource) => {
      return (
        resource.status !== "archived" &&
        (!resource.class_id || resource.class_id === selectedClass.id) &&
        (!resource.organization_id || resource.organization_id === selectedClass.organization_id)
      );
    });
  }, [data, selectedClass]);

  const lessonsById = useMemo(() => {
    const map = new Map<string, Lesson>();
    data?.lessons.forEach((lesson) => map.set(lesson.id, lesson));
    return map;
  }, [data]);

  const selectLesson = (lesson: Lesson) => {
    if (!data) return;
    setDraft(draftFromLesson(lesson, data));
    setMessage(`Editing ${lesson.title}.`);
  };

  // Deep-link: load the lesson named by ?lesson= into the editor when it changes.
  useEffect(() => {
    if (!data || !lessonParam || draft.lessonId === lessonParam) return;
    const lesson = data.lessons.find((item) => item.id === lessonParam);
    if (lesson) selectLesson(lesson);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, lessonParam, draft.lessonId]);

  const setField = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const saveBlueprint = async () => {
    if (!selectedClass || !teacherId) return;
    setSaving(true);
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in to save curriculum.");
      const blueprint = draftToBlueprint(draft);
      const saved = await invokeCurriculumAdmin({
        accessToken: session.access_token,
        action: "save_lesson_blueprint",
        organizationId: selectedClass.organization_id,
        classId: selectedClass.id,
        lessonId: draft.lessonId || undefined,
        blueprint,
      });

      if (hasNewResourceDraft(draft) && saved.lesson_id) {
        await createLessonResource({
          teacherId,
          organizationId: selectedClass.organization_id,
          classId: selectedClass.id,
          lessonId: saved.lesson_id,
          title: draft.newResourceTitle.trim(),
          description: draft.newResourceDescription.trim(),
          studentInstructions: draft.newResourceInstructions.trim(),
          teacherNotes: "",
          resourceType: draft.newResourceType,
          sourceType: draft.newResourceFile ? "upload" : "external_url",
          status: "draft",
          visibility: "class_private",
          displayMode: "card",
          externalUrl: draft.newResourceUrl.trim(),
          file: draft.newResourceFile,
        });
      }

      setDraft((current) => ({
        ...current,
        lessonId: saved.lesson_id || current.lessonId,
        subjectId: saved.subject_id || current.subjectId,
        courseId: saved.course_id || current.courseId,
        unitId: saved.unit_id || current.unitId,
        newResourceTitle: "",
        newResourceDescription: "",
        newResourceInstructions: "",
        newResourceUrl: "",
        newResourceFile: null,
      }));
      setMessage("Lesson blueprint saved as curriculum draft.");
      await loadData();
    } catch (error) {
      setMessage((error as Error).message || "Could not save lesson blueprint.");
    } finally {
      setSaving(false);
    }
  };

  const setPublication = async (action: "publish_lesson" | "archive_lesson") => {
    if (!selectedClass || !draft.lessonId) {
      setMessage("Save the lesson before publishing or archiving it.");
      return;
    }
    setPublishing(true);
    try {
      const session = await getSession();
      if (!session) throw new Error("Sign in to update publishing.");
      await invokeCurriculumAdmin({
        accessToken: session.access_token,
        action,
        organizationId: selectedClass.organization_id,
        classId: selectedClass.id,
        lessonId: draft.lessonId,
      });
      setMessage(action === "publish_lesson" ? "Lesson published." : "Lesson archived.");
      await loadData();
    } catch (error) {
      setMessage((error as Error).message || "Could not update publication status.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <AmbientCanvas intensity={0.2} />
      <header
        className="relative z-20 shrink-0 backdrop-blur-md"
        style={{ background: "color-mix(in oklab, var(--background) 72%, transparent)" }}
      >
        <div className="hairline">
          <div className="mx-auto flex h-[60px] max-w-[1280px] items-center justify-between gap-2 px-3 sm:px-6">
            <Link to="/chat" className="font-serif text-[22px] tracking-tight text-foreground">
              Jargon
            </Link>
            {email ? <SettingsMenu email={email} /> : null}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
        <Breadcrumb
          segments={[
            { label: "Teacher", onClick: () => navigate({ to: "/teacher" }) },
            {
              label: "Curriculum",
              onClick: () => navigate({ to: "/teacher/curriculum", search: {} }),
            },
            ...(draft.lessonId && lessonsById.get(draft.lessonId)
              ? [{ label: lessonsById.get(draft.lessonId)!.title }]
              : []),
          ]}
        />
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              Curriculum studio
            </div>
            <h1 className="font-serif mt-2 text-[38px] leading-tight tracking-tight text-foreground sm:text-[48px]">
              Build the lesson path.
            </h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
              Create structured lessons with milestones, activities, quizzes, resources, and
              publishing control. Preview first, then publish for students.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/teacher"
              className="rounded-full border border-border px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
            >
              Teacher dashboard
            </Link>
            <button
              type="button"
              onClick={() => void loadData()}
              className="rounded-full border border-border px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
            >
              Refresh
            </button>
          </div>
        </section>

        {message ? (
          <GradientCard>
            <div className="p-4 text-[13px] text-muted-foreground">{message}</div>
          </GradientCard>
        ) : null}

        {booting ? (
          <GradientCard>
            <div className="p-6 text-[14px] text-muted-foreground">Loading curriculum...</div>
          </GradientCard>
        ) : !data?.classes.length ? (
          <GradientCard>
            <div className="p-6 text-[14px] text-muted-foreground">
              Teacher curriculum access requires an assigned class.
            </div>
          </GradientCard>
        ) : data && selectedClass ? (
          <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
            <GradientCard>
              <div className="p-4">
                <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  Class scope
                  <select
                    value={selectedClassId}
                    onChange={(event) => setSelectedClassId(event.target.value)}
                    className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none"
                  >
                    {data.classes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <CurriculumTree
                  data={data}
                  activeLessonId={draft.lessonId}
                  onSelectLesson={(lesson) =>
                    navigate({ to: "/teacher/curriculum", search: { lesson: lesson.id } })
                  }
                />
              </div>
            </GradientCard>

            <GradientCard>
              <div className="p-4 sm:p-5">
                <BlueprintEditor
                  draft={draft}
                  resources={visibleResources}
                  lessonsById={lessonsById}
                  onField={setField}
                />
                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void saveBlueprint()}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                    {saving ? "Saving..." : "Save draft"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void setPublication("publish_lesson")}
                    disabled={publishing || !draft.lessonId}
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-500/35 px-4 py-2 text-[12.5px] text-emerald-500 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                    Publish
                  </button>
                  <button
                    type="button"
                    onClick={() => void setPublication("archive_lesson")}
                    disabled={publishing || !draft.lessonId}
                    className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Archive className="h-3.5 w-3.5" strokeWidth={1.7} />
                    Archive
                  </button>
                </div>
              </div>
            </GradientCard>

            <GradientCard>
              <PreviewPanel draft={draft} resources={visibleResources} />
            </GradientCard>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function defaultDraft(): DraftState {
  return {
    lessonId: "",
    subjectId: "",
    subjectTitle: "Logic Foundations",
    subjectDescription: "Structured lessons for clear thinking across subjects.",
    courseId: "",
    courseTitle: "Clear Thinking",
    courseDescription:
      "A teacher-authored path for claims, reasons, evidence, and careful explanation.",
    unitId: "",
    unitTitle: "Claims, Reasons, Evidence",
    unitPosition: "1",
    lessonTitle: "What Makes a Good Reason?",
    lessonLevel: "Any level",
    lessonType: "discussion",
    tutorPrompt:
      "Guide the student to understand that a good reason explains why a claim makes sense. Keep the conversation short, concrete, age-aware, and focused on one reasoning move at a time.",
    sampleCode: "",
    milestoneTitle: "Connect A Claim To A Reason",
    milestoneObjective:
      "The student can identify a claim and give a reason that explains why the claim makes sense.",
    skillKeys: "logic.claims,logic.reasons,logic.evidence",
    allowedModes: ["text"],
    activityTitle: "Reasoning discussion",
    activityStage: "practice",
    activityPrompt:
      "Tell me one thing you believe is true about school, games, or everyday life. What is one reason someone else should believe it too?",
    activityResponseMode: "text",
    starterCode: "",
    expectedOutput: "",
    rubricNotes: "Pass when the student states a claim and gives a reason that supports it.",
    quizPrompt:
      "Which option gives the best reason for the claim: Reading every day helps you learn?",
    quizChoices: [
      { id: "a", text: "Because reading every day is a thing people do." },
      {
        id: "b",
        text: "Because daily reading gives your brain more practice with words and ideas.",
      },
      { id: "c", text: "Because books exist in many places." },
    ],
    quizCorrectChoiceId: "b",
    resourceIds: [],
    newResourceTitle: "",
    newResourceDescription: "",
    newResourceInstructions: "",
    newResourceType: "link",
    newResourceUrl: "",
    newResourceFile: null,
  };
}

function draftFromLesson(lesson: Lesson, data: CurriculumAuthoringData): DraftState {
  const unit = data.units.find((item) => item.id === lesson.unit_id) || null;
  const version = unit
    ? data.courseVersions.find((item) => item.id === unit.course_version_id) || null
    : null;
  const course = version
    ? data.courses.find((item) => item.id === version.course_id) || null
    : null;
  const subject = course
    ? data.subjects.find((item) => item.id === course.subject_id) || null
    : null;
  const milestone = data.milestones.find((item) => item.lesson_id === lesson.id) || null;
  const activity = data.activities.find((item) => item.lesson_id === lesson.id) || null;
  const quiz =
    data.quizzes.find((item) => item.lesson_id === lesson.id && item.status !== "archived") || null;
  const metadata = lesson.curriculum_metadata || {};
  const lessonType =
    parseLessonKind(metadata.lesson_type) ||
    parseLessonKind(activity?.activity_type) ||
    "discussion";

  return {
    ...defaultDraft(),
    lessonId: lesson.id,
    subjectId: subject?.id || "",
    subjectTitle: subject?.title || "Untitled subject",
    subjectDescription: subject?.description || "",
    courseId: course?.id || "",
    courseTitle: course?.title || "Untitled course",
    courseDescription: course?.description || "",
    unitId: unit?.id || "",
    unitTitle: unit?.title || lesson.module || "Unit",
    unitPosition: String(unit?.position || 1),
    lessonTitle: lesson.title,
    lessonLevel: lesson.level || "Any level",
    lessonType,
    tutorPrompt: lesson.tutor_prompt || "",
    sampleCode: lesson.sample_code || "",
    milestoneTitle: milestone?.title || "",
    milestoneObjective: milestone?.objective || "",
    skillKeys: (milestone?.skill_keys || []).join(","),
    allowedModes: milestone?.allowed_response_modes?.length
      ? milestone.allowed_response_modes
      : [activity?.response_mode || "text"],
    activityTitle: activity?.title || "",
    activityStage: parseActivityStage(activity?.stage) || "practice",
    activityPrompt: activity?.prompt || "",
    activityResponseMode: activity?.response_mode || "text",
    starterCode: activity?.starter_code || lesson.sample_code || "",
    expectedOutput: activity?.expected_output || lesson.expected_output || "",
    rubricNotes:
      typeof activity?.rubric?.notes === "string"
        ? activity.rubric.notes
        : "Pass when the student shows the target idea in their own words.",
    quizPrompt: quiz?.prompt || "",
    quizChoices: quiz?.choices?.length ? quiz.choices : defaultDraft().quizChoices,
    quizCorrectChoiceId: quiz?.correct_choice_ids?.[0] || defaultDraft().quizCorrectChoiceId,
    resourceIds: data.resources
      .filter((resource) => resource.lesson_id === lesson.id && resource.status !== "archived")
      .map((resource) => resource.id),
  };
}

function parseLessonKind(value: unknown): LessonKind | null {
  return ["discussion", "code", "reflection", "multiple_choice", "file"].includes(String(value))
    ? (value as LessonKind)
    : null;
}

function parseActivityStage(value: unknown): ActivityStage | null {
  return ["intro", "teach", "practice", "assessment", "review"].includes(String(value))
    ? (value as ActivityStage)
    : null;
}

function draftToBlueprint(draft: DraftState): CurriculumBlueprint {
  const choices = draft.quizChoices
    .map((choice) => ({ id: choice.id.trim(), text: choice.text.trim() }))
    .filter((choice) => choice.id && choice.text);
  return {
    subject: {
      id: draft.subjectId || undefined,
      title: draft.subjectTitle.trim(),
      description: draft.subjectDescription.trim(),
    },
    course: {
      id: draft.courseId || undefined,
      title: draft.courseTitle.trim(),
      description: draft.courseDescription.trim(),
    },
    unit: {
      id: draft.unitId || undefined,
      title: draft.unitTitle.trim(),
      position: Math.max(1, Math.round(Number(draft.unitPosition) || 1)),
    },
    lesson: {
      id: draft.lessonId || undefined,
      title: draft.lessonTitle.trim(),
      level: draft.lessonLevel.trim() || "Any level",
      type: draft.lessonType,
      tutor_prompt: draft.tutorPrompt.trim(),
      sample_code: draft.sampleCode.trim(),
    },
    milestone: {
      title: draft.milestoneTitle.trim(),
      objective: draft.milestoneObjective.trim(),
      skill_keys: draft.skillKeys
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      allowed_response_modes: draft.allowedModes,
    },
    activity: {
      title: draft.activityTitle.trim(),
      stage: draft.activityStage,
      prompt: draft.activityPrompt.trim(),
      response_mode: draft.activityResponseMode,
      starter_code: draft.starterCode.trim(),
      expected_output: draft.expectedOutput.trim(),
      rubric: { notes: draft.rubricNotes.trim() },
    },
    quiz:
      draft.quizPrompt.trim() && choices.length >= 2 && draft.quizCorrectChoiceId
        ? {
            prompt: draft.quizPrompt.trim(),
            choices,
            correct_choice_ids: [draft.quizCorrectChoiceId],
          }
        : undefined,
    resource_ids: draft.resourceIds,
  };
}

function hasNewResourceDraft(draft: DraftState) {
  return Boolean(
    draft.newResourceTitle.trim() && (draft.newResourceFile || draft.newResourceUrl.trim()),
  );
}

function CurriculumTree({
  data,
  activeLessonId,
  onSelectLesson,
}: {
  data: CurriculumAuthoringData;
  activeLessonId: string;
  onSelectLesson: (lesson: Lesson) => void;
}) {
  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-foreground">
        <Layers3 className="h-4 w-4" strokeWidth={1.7} />
        Course tree
      </div>
      <div className="grid max-h-[70vh] gap-3 overflow-auto pr-1">
        {data.subjects.map((subject) => (
          <SubjectBlock
            key={subject.id}
            subject={subject}
            data={data}
            activeLessonId={activeLessonId}
            onSelectLesson={onSelectLesson}
          />
        ))}
      </div>
    </div>
  );
}

function SubjectBlock({
  subject,
  data,
  activeLessonId,
  onSelectLesson,
}: {
  subject: CurriculumSubject;
  data: CurriculumAuthoringData;
  activeLessonId: string;
  onSelectLesson: (lesson: Lesson) => void;
}) {
  const courses = data.courses.filter((course) => course.subject_id === subject.id);
  return (
    <div className="rounded-2xl border border-border bg-background/35 p-3">
      <div className="text-[12px] font-medium text-foreground">{subject.title}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{subject.status}</div>
      <div className="mt-3 grid gap-2">
        {courses.map((course) => {
          const versions = data.courseVersions.filter((version) => version.course_id === course.id);
          return (
            <div key={course.id} className="rounded-xl border border-border bg-background/35 p-2">
              <div className="text-[11.5px] font-medium text-foreground">{course.title}</div>
              {versions.map((version) => {
                const units = data.units.filter((unit) => unit.course_version_id === version.id);
                return units.map((unit) => {
                  const lessons = data.lessons.filter((lesson) => lesson.unit_id === unit.id);
                  return (
                    <div key={unit.id} className="mt-2">
                      <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                        {unit.title}
                      </div>
                      <div className="mt-1 grid gap-1">
                        {lessons.map((lesson) => (
                          <button
                            type="button"
                            key={lesson.id}
                            onClick={() => onSelectLesson(lesson)}
                            className={`rounded-lg px-2 py-2 text-left text-[12px] transition-colors ${
                              activeLessonId === lesson.id
                                ? "bg-foreground text-background"
                                : "text-foreground hover:bg-muted"
                            }`}
                          >
                            <span className="block truncate">{lesson.title}</span>
                            <span
                              className={`mt-0.5 block text-[10.5px] ${
                                activeLessonId === lesson.id
                                  ? "text-background/70"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {lesson.publication_status || "published"}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                });
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BlueprintEditor({
  draft,
  resources,
  lessonsById,
  onField,
}: {
  draft: DraftState;
  resources: LessonResource[];
  lessonsById: Map<string, Lesson>;
  onField: <K extends keyof DraftState>(key: K, value: DraftState[K]) => void;
}) {
  const toggleMode = (mode: ResponseMode) => {
    const exists = draft.allowedModes.includes(mode);
    const next = exists
      ? draft.allowedModes.filter((item) => item !== mode)
      : [...draft.allowedModes, mode];
    onField("allowedModes", next.length ? next : ["text"]);
  };

  const updateChoice = (index: number, patch: Partial<{ id: string; text: string }>) => {
    onField(
      "quizChoices",
      draft.quizChoices.map((choice, choiceIndex) =>
        choiceIndex === index ? { ...choice, ...patch } : choice,
      ),
    );
  };

  const toggleResource = (resourceId: string) => {
    onField(
      "resourceIds",
      draft.resourceIds.includes(resourceId)
        ? draft.resourceIds.filter((id) => id !== resourceId)
        : [...draft.resourceIds, resourceId],
    );
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-medium text-foreground">Lesson blueprint</h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Save drafts freely. Publish only when students should see the lesson.
          </p>
        </div>
        {draft.lessonId ? (
          <span className="rounded-full border border-border px-3 py-1 text-[11.5px] text-muted-foreground">
            {lessonsById.get(draft.lessonId)?.publication_status || "draft"}
          </span>
        ) : null}
      </div>

      <div className="grid gap-4">
        <EditorSection title="Structure" icon={<BookOpen className="h-4 w-4" strokeWidth={1.7} />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Subject"
              value={draft.subjectTitle}
              onChange={(value) => onField("subjectTitle", value)}
            />
            <TextInput
              label="Course"
              value={draft.courseTitle}
              onChange={(value) => onField("courseTitle", value)}
            />
            <TextInput
              label="Unit / chapter"
              value={draft.unitTitle}
              onChange={(value) => onField("unitTitle", value)}
            />
            <TextInput
              label="Unit position"
              value={draft.unitPosition}
              onChange={(value) => onField("unitPosition", value)}
            />
          </div>
          <TextArea
            label="Course description"
            value={draft.courseDescription}
            onChange={(value) => onField("courseDescription", value)}
          />
        </EditorSection>

        <EditorSection title="Lesson" icon={<NotebookPen className="h-4 w-4" strokeWidth={1.7} />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Lesson title"
              value={draft.lessonTitle}
              onChange={(value) => onField("lessonTitle", value)}
            />
            <TextInput
              label="Level"
              value={draft.lessonLevel}
              onChange={(value) => onField("lessonLevel", value)}
            />
            <SelectInput
              label="Lesson type"
              value={draft.lessonType}
              options={["discussion", "code", "reflection", "multiple_choice", "file"]}
              onChange={(value) => onField("lessonType", value as LessonKind)}
            />
            <SelectInput
              label="Activity response"
              value={draft.activityResponseMode}
              options={["text", "code", "multiple_choice", "file"]}
              onChange={(value) => onField("activityResponseMode", value as ResponseMode)}
            />
          </div>
          <TextArea
            label="Mentor prompt"
            value={draft.tutorPrompt}
            onChange={(value) => onField("tutorPrompt", value)}
          />
          <TextArea
            label="Optional starter code"
            value={draft.sampleCode}
            onChange={(value) => onField("sampleCode", value)}
          />
        </EditorSection>

        <EditorSection
          title="Milestone and activity"
          icon={<Layers3 className="h-4 w-4" strokeWidth={1.7} />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Milestone title"
              value={draft.milestoneTitle}
              onChange={(value) => onField("milestoneTitle", value)}
            />
            <TextInput
              label="Skill keys"
              value={draft.skillKeys}
              onChange={(value) => onField("skillKeys", value)}
            />
          </div>
          <TextArea
            label="Milestone objective"
            value={draft.milestoneObjective}
            onChange={(value) => onField("milestoneObjective", value)}
          />
          <div className="grid gap-2">
            <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Allowed answer modes
            </div>
            <div className="flex flex-wrap gap-2">
              {(["text", "code", "multiple_choice", "file"] as ResponseMode[]).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  onClick={() => toggleMode(mode)}
                  className={`rounded-full border px-3 py-1.5 text-[11.5px] transition-colors ${
                    draft.allowedModes.includes(mode)
                      ? "border-foreground/25 bg-foreground text-background"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Activity title"
              value={draft.activityTitle}
              onChange={(value) => onField("activityTitle", value)}
            />
            <SelectInput
              label="Stage"
              value={draft.activityStage}
              options={["intro", "teach", "practice", "assessment", "review"]}
              onChange={(value) => onField("activityStage", value as ActivityStage)}
            />
          </div>
          <TextArea
            label="Student prompt"
            value={draft.activityPrompt}
            onChange={(value) => onField("activityPrompt", value)}
          />
          <TextArea
            label="Rubric / pass notes"
            value={draft.rubricNotes}
            onChange={(value) => onField("rubricNotes", value)}
          />
        </EditorSection>

        <EditorSection
          title="Quiz checkpoint"
          icon={<Send className="h-4 w-4" strokeWidth={1.7} />}
        >
          <TextArea
            label="MCQ prompt"
            value={draft.quizPrompt}
            onChange={(value) => onField("quizPrompt", value)}
          />
          <div className="grid gap-2">
            {draft.quizChoices.map((choice, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[64px_minmax(0,1fr)_90px]">
                <input
                  value={choice.id}
                  onChange={(event) => updateChoice(index, { id: event.target.value })}
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none"
                />
                <input
                  value={choice.text}
                  onChange={(event) => updateChoice(index, { text: event.target.value })}
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none"
                />
                <button
                  type="button"
                  onClick={() => onField("quizCorrectChoiceId", choice.id)}
                  className={`rounded-full border px-3 py-1.5 text-[11.5px] ${
                    draft.quizCorrectChoiceId === choice.id
                      ? "border-emerald-500/35 text-emerald-500"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  Correct
                </button>
              </div>
            ))}
          </div>
        </EditorSection>

        <EditorSection title="Resources" icon={<FilePlus2 className="h-4 w-4" strokeWidth={1.7} />}>
          <div className="grid gap-2">
            <div className="text-[12.5px] text-muted-foreground">
              Attach existing resources, or create one new draft resource while saving.
            </div>
            {resources.length ? (
              <div className="grid gap-2">
                {resources.map((resource) => (
                  <label
                    key={resource.id}
                    className="flex items-center gap-2 text-[12.5px] text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={draft.resourceIds.includes(resource.id)}
                      onChange={() => toggleResource(resource.id)}
                      className="h-4 w-4 accent-foreground"
                    />
                    <span className="min-w-0 truncate">
                      {resource.title} · {resource.resource_type} · {resource.status}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-background/35 p-3 text-[12.5px] text-muted-foreground">
                No reusable resources yet.
              </div>
            )}
          </div>

          <div className="mt-3 grid gap-3 rounded-2xl border border-border bg-background/35 p-3">
            <div className="text-[12px] font-medium text-foreground">New draft resource</div>
            <TextInput
              label="Title"
              value={draft.newResourceTitle}
              onChange={(value) => onField("newResourceTitle", value)}
            />
            <TextArea
              label="Student instructions"
              value={draft.newResourceInstructions}
              onChange={(value) => onField("newResourceInstructions", value)}
            />
            <SelectInput
              label="Type"
              value={draft.newResourceType}
              options={["link", "youtube", "pdf", "video", "audio", "image", "document"]}
              onChange={(value) => onField("newResourceType", value as LessonResourceType)}
            />
            <TextInput
              label="External URL"
              value={draft.newResourceUrl}
              onChange={(value) => onField("newResourceUrl", value)}
            />
            <input
              type="file"
              onChange={(event) => onField("newResourceFile", event.target.files?.[0] || null)}
              className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-[12px] file:text-foreground"
            />
          </div>
        </EditorSection>
      </div>
    </div>
  );
}

function PreviewPanel({ draft, resources }: { draft: DraftState; resources: LessonResource[] }) {
  const attached = resources.filter((resource) => draft.resourceIds.includes(resource.id));
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-2 text-[15px] font-medium text-foreground">
        <Eye className="h-4 w-4" strokeWidth={1.7} />
        Student preview
      </div>
      <div className="grid gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            {draft.subjectTitle} / {draft.unitTitle}
          </div>
          <h2 className="font-serif mt-2 text-[28px] leading-tight text-foreground">
            {draft.lessonTitle || "Untitled lesson"}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {draft.milestoneObjective || "Add an objective to preview the lesson target."}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-background/40 p-4">
          <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Mentor asks
          </div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
            {draft.activityPrompt || "The activity prompt will appear here."}
          </p>
        </div>
        {draft.quizPrompt ? (
          <div className="rounded-2xl border border-border bg-background/40 p-4">
            <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Checkpoint
            </div>
            <p className="text-[13px] text-foreground">{draft.quizPrompt}</p>
            <div className="mt-3 grid gap-2">
              {draft.quizChoices.map((choice) => (
                <div
                  key={choice.id}
                  className="rounded-xl border border-border bg-background/45 px-3 py-2 text-[12.5px] text-muted-foreground"
                >
                  {choice.id}. {choice.text}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="rounded-2xl border border-border bg-background/40 p-4">
          <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Resources
          </div>
          {attached.length ? (
            <div className="grid gap-2">
              {attached.map((resource) => (
                <div
                  key={resource.id}
                  className="rounded-xl border border-border bg-background/45 px-3 py-2"
                >
                  <div className="text-[12.5px] text-foreground">{resource.title}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {resource.resource_type} · {resource.status}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[12.5px] text-muted-foreground">
              No existing resources attached yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EditorSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-background/30 p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-foreground">
        {icon}
        {title}
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[82px] rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case leading-relaxed tracking-normal text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

function SelectInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
