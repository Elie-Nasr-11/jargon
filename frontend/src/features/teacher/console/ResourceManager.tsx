/**
 * Uploading and attaching a class's material.
 *
 * Resources belong to a class, a unit or a lesson, and this is where they are
 * added, described and re-scoped. Building content reads the same list, so what
 * is uploaded here is what a generation can be pointed at.
 */
import { useEffect, useState } from "react";
import { OverflowMenu } from "@/components/OverflowMenu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResourceStatusChip } from "@/features/teacher/console/chrome";
import { getLessonResourceSignedUrl, updateLessonResource } from "@/lib/api";
import { notifyUndo } from "@/lib/feedback";
import type {
  Lesson,
  LessonResource,
  LessonResourceDisplayMode,
  LessonResourceSource,
  LessonResourceStatus,
  LessonResourceType,
  LessonResourceVisibility,
  TeacherClassSummary,
} from "@/lib/types";
import { Archive, ExternalLink } from "lucide-react";

export type ResourceFormValues = {
  resourceId?: string;
  organizationId: string;
  classId: string;
  lessonId: string;
  title: string;
  description: string;
  studentInstructions: string;
  teacherNotes: string;
  resourceType: LessonResourceType;
  sourceType: LessonResourceSource;
  status: LessonResourceStatus;
  visibility: LessonResourceVisibility;
  displayMode: LessonResourceDisplayMode;
  externalUrl?: string;
  file?: File | null;
};

export function defaultResourceForm(
  classSummary: TeacherClassSummary,
  lessons: Lesson[],
): ResourceFormValues {
  return {
    organizationId: classSummary.organization_id,
    classId: classSummary.id,
    lessonId: lessons[0]?.id || "",
    title: "",
    description: "",
    studentInstructions: "",
    teacherNotes: "",
    resourceType: "pdf",
    sourceType: "upload",
    status: "draft",
    visibility: "class_private",
    displayMode: "card",
    externalUrl: "",
    file: null,
  };
}

export function ResourceManager({
  classSummary,
  lessons,
  saving,
  open,
  resource,
  onSaveResource,
  onUpdateResource,
  onClose,
}: {
  classSummary: TeacherClassSummary;
  lessons: Lesson[];
  saving: boolean;
  // R47: a controlled dialog — the + Create menu opens it empty, a material row opens it
  // in edit mode. The old in-page list is gone (rows live in the Classwork list).
  open: boolean;
  resource: LessonResource | null;
  onSaveResource: (input: ResourceFormValues) => Promise<void>;
  onUpdateResource: (resource: LessonResource) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ResourceFormValues>(() =>
    defaultResourceForm(classSummary, lessons),
  );
  const [resourceMessage, setResourceMessage] = useState("");
  const [openingId, setOpeningId] = useState("");

  // Seed the draft each time the dialog opens: edit mode from the material row,
  // create mode from the + Create menu.
  useEffect(() => {
    if (!open) return;
    if (resource) {
      setDraft({
        resourceId: resource.id,
        organizationId: resource.organization_id || classSummary.organization_id,
        classId: resource.class_id || classSummary.id,
        lessonId: resource.lesson_id || lessons[0]?.id || "",
        title: resource.title,
        description: resource.description || "",
        studentInstructions: resource.student_instructions || "",
        teacherNotes: resource.teacher_notes || "",
        resourceType: resource.resource_type,
        sourceType: resource.source_type,
        status: resource.status,
        visibility: resource.visibility,
        displayMode: "card",
        externalUrl: resource.external_url || "",
        file: null,
      });
      setResourceMessage("Editing resource metadata. File/source cannot be replaced in v1.");
    } else {
      setDraft(defaultResourceForm(classSummary, lessons));
      setResourceMessage("");
    }
  }, [open, resource, classSummary, lessons]);

  const setField = <K extends keyof ResourceFormValues>(key: K, value: ResourceFormValues[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = async () => {
    try {
      const title = draft.title.trim();
      const externalUrl = draft.externalUrl?.trim() || "";
      if (!title) throw new Error("Add a resource title.");
      if (!draft.lessonId) throw new Error("Choose a lesson.");
      if (draft.sourceType === "upload" && !draft.resourceId && !draft.file) {
        throw new Error("Choose a file to upload.");
      }
      if (draft.sourceType === "external_url") {
        const parsed = new URL(externalUrl);
        if (
          draft.resourceType === "youtube" &&
          !["youtube.com", "www.youtube.com", "youtu.be"].includes(parsed.hostname)
        ) {
          throw new Error("YouTube resources must use youtube.com or youtu.be.");
        }
      }

      await onSaveResource({
        ...draft,
        title,
        description: draft.description.trim(),
        studentInstructions: draft.studentInstructions.trim(),
        teacherNotes: draft.teacherNotes.trim(),
        externalUrl,
      });
      setResourceMessage(draft.resourceId ? "Resource metadata saved." : "Resource created.");
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not save resource.");
    }
  };

  const setStatus = async (
    target: LessonResource,
    status: LessonResourceStatus,
    isUndo = false,
  ) => {
    const prev = target.status;
    try {
      const updated = await updateLessonResource(target.id, { status });
      onUpdateResource(updated);
      if (!isUndo && prev !== status) {
        const label =
          status === "published"
            ? "published"
            : status === "archived"
              ? "archived"
              : "moved to draft";
        notifyUndo(`Resource ${label}.`, () => void setStatus(updated, prev, true));
      }
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not update resource status.");
    }
  };

  const openResource = async (target: LessonResource) => {
    try {
      setOpeningId(target.id);
      const url = await getLessonResourceSignedUrl(target);
      if (!url) throw new Error("This resource does not have an openable URL.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not open resource.");
    } finally {
      setOpeningId("");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{draft.resourceId ? "Edit resource" : "New resource"}</DialogTitle>
        </DialogHeader>

        {resource ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void openResource(resource)}
              className="btn btn-secondary btn-sm"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.6} />
              {openingId === resource.id ? "Opening..." : "Open"}
            </button>
            <OverflowMenu
              actions={[
                {
                  label: "Set to draft",
                  onClick: () => void setStatus(resource, "draft"),
                  disabled: resource.status === "draft",
                },
                {
                  label: "Publish",
                  onClick: () => void setStatus(resource, "published"),
                  disabled: resource.status === "published",
                },
                {
                  label: "Archive",
                  icon: Archive,
                  onClick: () => void setStatus(resource, "archived"),
                  disabled: resource.status === "archived",
                },
              ]}
            />
            <ResourceStatusChip status={resource.status} />
          </div>
        ) : null}

        <div className="grid gap-3">
          <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Lesson
            <select
              value={draft.lessonId}
              onChange={(event) => setField("lessonId", event.target.value)}
              disabled={Boolean(draft.resourceId)}
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
              placeholder="Purpose explainer PDF"
              className="jargon-input normal-case tracking-normal"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Source
              <select
                value={draft.sourceType}
                onChange={(event) => {
                  const next = event.target.value as LessonResourceSource;
                  setDraft((current) => ({
                    ...current,
                    sourceType: next,
                    resourceType: next === "external_url" ? "link" : "pdf",
                    file: null,
                  }));
                }}
                disabled={Boolean(draft.resourceId)}
                className="jargon-input normal-case tracking-normal disabled:opacity-60"
              >
                <option value="upload">Upload</option>
                <option value="external_url">External URL</option>
              </select>
            </label>

            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Type
              <select
                value={draft.resourceType}
                onChange={(event) =>
                  setField("resourceType", event.target.value as LessonResourceType)
                }
                disabled={draft.sourceType === "upload" || Boolean(draft.resourceId)}
                className="jargon-input normal-case tracking-normal disabled:opacity-60"
              >
                <option value="pdf">PDF</option>
                <option value="video">Video</option>
                <option value="audio">Audio</option>
                <option value="image">Image</option>
                <option value="document">Document</option>
                <option value="youtube">YouTube</option>
                <option value="link">Link</option>
              </select>
            </label>
          </div>

          {draft.sourceType === "upload" && !draft.resourceId ? (
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              File
              <input
                type="file"
                accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,image/*,audio/*,video/*"
                onChange={(event) => setField("file", event.target.files?.[0] || null)}
                className="jargon-input normal-case tracking-normal file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-meta file:text-foreground"
              />
            </label>
          ) : null}

          {draft.sourceType === "external_url" ? (
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              External URL
              <input
                value={draft.externalUrl || ""}
                onChange={(event) => setField("externalUrl", event.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="jargon-input normal-case tracking-normal"
              />
            </label>
          ) : null}

          <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Student instructions
            <textarea
              value={draft.studentInstructions}
              onChange={(event) => setField("studentInstructions", event.target.value)}
              placeholder="Open this before the checkpoint and look for the input/process/output idea."
              className="jargon-input min-h-[72px] normal-case leading-relaxed tracking-normal"
            />
          </label>

          <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Description
            <textarea
              value={draft.description}
              onChange={(event) => setField("description", event.target.value)}
              placeholder="Short student-facing summary."
              className="jargon-input min-h-[66px] normal-case leading-relaxed tracking-normal"
            />
          </label>

          <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Teacher notes
            <textarea
              value={draft.teacherNotes}
              onChange={(event) => setField("teacherNotes", event.target.value)}
              placeholder="Private classroom context for teachers."
              className="jargon-input min-h-[66px] normal-case leading-relaxed tracking-normal"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Status
              <select
                value={draft.status}
                onChange={(event) => setField("status", event.target.value as LessonResourceStatus)}
                className="jargon-input normal-case tracking-normal"
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </label>

            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Visibility
              <select
                value={draft.visibility}
                onChange={(event) =>
                  setField("visibility", event.target.value as LessonResourceVisibility)
                }
                className="jargon-input normal-case tracking-normal"
              >
                <option value="class_private">Class private</option>
                <option value="org_private">Organization private</option>
                <option value="public">Public metadata</option>
              </select>
            </label>
          </div>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="btn btn-secondary mt-1"
          >
            {saving ? "Saving..." : draft.resourceId ? "Save resource" : "Create resource"}
          </button>
          {resourceMessage ? (
            <div className="text-meta leading-relaxed text-muted-foreground">{resourceMessage}</div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
