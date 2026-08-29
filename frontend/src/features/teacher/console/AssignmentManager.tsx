/**
 * Assignments: setting the work, and reading what came back.
 *
 * The panel writes the assignment and then becomes its inbox - who submitted,
 * what still needs a grade, and the work itself opened for marking.
 */
import { useEffect, useState } from "react";
import { Collapsible } from "@/components/Collapsible";
import { displayName } from "@/features/teacher/classShared";
import type {
  Assignment,
  AssignmentStatus,
  Lesson,
  LessonResource,
  Profile,
  TeacherClassSummary,
} from "@/lib/types";
import { Send } from "lucide-react";

export type AssignmentFormValues = {
  organizationId: string;
  classId: string;
  lessonId: string;
  // R48: set when the dialog was opened FROM a lesson step — links the created row.
  activityId?: string | null;
  title: string;
  instructions: string;
  dueAt: string;
  status: Extract<AssignmentStatus, "draft" | "assigned">;
  required: boolean;
  recipientIds: string[];
  resourceIds: string[];
};

export function defaultAssignmentForm(
  classSummary: TeacherClassSummary,
  lessons: Lesson[],
  studentIds: string[],
): AssignmentFormValues {
  return {
    organizationId: classSummary.organization_id,
    classId: classSummary.id,
    lessonId: lessons[0]?.id || "",
    title: "",
    instructions: "",
    dueAt: "",
    status: "assigned",
    required: false,
    recipientIds: studentIds,
    resourceIds: [],
  };
}

export function AssignmentManager({
  classSummary,
  lessons,
  resources,
  studentIds,
  profilesById,
  saving,
  context = null,
  onSaveAssignment,
}: {
  classSummary: TeacherClassSummary;
  lessons: Lesson[];
  resources: LessonResource[];
  studentIds: string[];
  profilesById: Map<string, Profile>;
  saving: boolean;
  // R48: present when the dialog was opened FROM a lesson step — the lesson is locked
  // to that step's lesson and the created row carries the step link.
  context?: { lessonId: string; activityId: string | null } | null;
  onSaveAssignment: (input: AssignmentFormValues) => Promise<void>;
}) {
  const seedDraft = () => ({
    ...defaultAssignmentForm(classSummary, lessons, studentIds),
    ...(context ? { lessonId: context.lessonId, activityId: context.activityId } : {}),
  });
  const [draft, setDraft] = useState<AssignmentFormValues>(seedDraft);
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const resourcesForLesson = resources.filter(
    (resource) => resource.lesson_id === draft.lessonId && resource.status !== "archived",
  );

  useEffect(() => {
    setDraft(seedDraft());
    setAssignmentMessage("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classSummary, lessons, studentIds, context]);

  const setField = <K extends keyof AssignmentFormValues>(
    key: K,
    value: AssignmentFormValues[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleRecipient = (studentId: string) => {
    setDraft((current) => {
      const exists = current.recipientIds.includes(studentId);
      return {
        ...current,
        recipientIds: exists
          ? current.recipientIds.filter((id) => id !== studentId)
          : [...current.recipientIds, studentId],
      };
    });
  };

  const toggleResource = (resourceId: string) => {
    setDraft((current) => {
      const exists = current.resourceIds.includes(resourceId);
      return {
        ...current,
        resourceIds: exists
          ? current.resourceIds.filter((id) => id !== resourceId)
          : [...current.resourceIds, resourceId],
      };
    });
  };

  const submit = async () => {
    try {
      const title = draft.title.trim();
      const instructions = draft.instructions.trim();
      if (!title) throw new Error("Add an assignment title.");
      if (!instructions) throw new Error("Add student instructions.");
      if (!draft.lessonId) throw new Error("Choose a lesson.");
      if (!draft.recipientIds.length) throw new Error("Choose at least one student.");

      await onSaveAssignment({
        ...draft,
        title,
        instructions,
        dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : "",
      });
      setAssignmentMessage(
        draft.status === "assigned"
          ? "Assignment created and assigned."
          : "Draft assignment saved.",
      );
      setDraft(defaultAssignmentForm(classSummary, lessons, studentIds));
    } catch (error) {
      setAssignmentMessage((error as Error).message || "Could not create assignment.");
    }
  };

  return (
    <div className="pt-1">
      {/* Hosted inside the Structure section's "Assignments" bench — title + count live on the
          Collapsible header; grading moved to Students + performance. */}
      <p className="mb-3 text-meta text-muted-foreground">
        Create class work for a lesson, choose recipients, and assign or save as draft.
      </p>

      <div className="grid gap-4">
        <div className="rounded-card border border-border bg-depth-sub p-4">
          <div className="text-body font-medium text-foreground">Create assignment</div>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Lesson
              <select
                value={draft.lessonId}
                disabled={Boolean(context)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    lessonId: event.target.value,
                    resourceIds: [],
                  }))
                }
                className="jargon-input normal-case tracking-normal"
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
                placeholder="Purpose reflection"
                className="jargon-input normal-case tracking-normal"
              />
            </label>

            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Instructions
              <textarea
                value={draft.instructions}
                onChange={(event) => setField("instructions", event.target.value)}
                placeholder="Use the resource and explain what the tool is for in your own words."
                className="jargon-input min-h-[86px] normal-case leading-relaxed tracking-normal"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Due date
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
                      event.target.value as Extract<AssignmentStatus, "draft" | "assigned">,
                    )
                  }
                  className="jargon-input normal-case tracking-normal"
                >
                  <option value="assigned">Assigned</option>
                  <option value="draft">Draft</option>
                </select>
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
                  Students can't finish the lesson until they complete this assignment.
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

            <div className="rounded-card border border-border bg-depth-field p-3">
              <div className="mb-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Optional resources
              </div>
              {resourcesForLesson.length ? (
                <div className="grid gap-2">
                  {resourcesForLesson.map((resource) => (
                    <label
                      key={resource.id}
                      className="flex items-center gap-2 text-meta text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={draft.resourceIds.includes(resource.id)}
                        onChange={() => toggleResource(resource.id)}
                        className="h-4 w-4 accent-foreground"
                      />
                      <span className="min-w-0 truncate">
                        {resource.title} · {resource.status}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-meta text-muted-foreground">
                  No resources are attached to this lesson yet.
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="btn btn-secondary mt-1"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.7} />
              {saving ? "Saving..." : draft.status === "assigned" ? "Assign work" : "Save draft"}
            </button>
            {assignmentMessage ? (
              <div className="text-meta leading-relaxed text-muted-foreground">
                {assignmentMessage}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
