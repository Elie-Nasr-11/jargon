/**
 * The rare, real settings for one lesson — one deliberate click from the header.
 *
 * These govern how the mentor teaches this lesson: how much help it may give,
 * whether it must see an attempt first, the tone and pace it defaults to. They
 * matter, and almost nobody changes them, so they are not part of the page a
 * teacher edits every day (Law 4).
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check } from "lucide-react";
import { SelectInput, TextArea, TextInput } from "@/features/teacher/authoring/fields";
import type { LessonKind, ResponseMode } from "@/features/teacher/authoring/types";
import type { LessonMetaFields } from "@/features/teacher/lesson/lessonMeta";

export function LessonSettings({
  open,
  onClose,
  lessonId,
  fields,
  onField,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  lessonId: string;
  fields: LessonMetaFields;
  onField: <K extends keyof LessonMetaFields>(field: K, value: LessonMetaFields[K]) => void;
  busy: boolean;
}) {
  const toggleMode = (mode: ResponseMode) => {
    const next = fields.allowedModes.includes(mode)
      ? fields.allowedModes.filter((item) => item !== mode)
      : [...fields.allowedModes, mode];
    onField("allowedModes", next.length ? next : ["text"]);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Lesson settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <p className="text-meta text-muted-foreground">
            Changes here are saved by the lesson&apos;s Save, like everything else on the page.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Level"
              value={fields.level}
              onChange={(value) => onField("level", value)}
            />
            <SelectInput
              label="Lesson type"
              value={fields.lessonType}
              options={["discussion", "code", "reflection", "multiple_choice", "file"]}
              onChange={(value) => onField("lessonType", value as LessonKind)}
            />
          </div>
          <div className="grid gap-1">
            <TextArea
              label="Mentor prompt"
              value={fields.tutorPrompt}
              onChange={(value) => onField("tutorPrompt", value)}
            />
          </div>
          <TextInput
            label="Skill keys (comma separated)"
            value={fields.skillKeys}
            onChange={(value) => onField("skillKeys", value)}
          />
          <div className="grid gap-2">
            <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Allowed answer modes
            </div>
            <div className="flex flex-wrap gap-2">
              {(["text", "code", "multiple_choice", "file"] as ResponseMode[]).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  onClick={() => toggleMode(mode)}
                  className={`rounded-full border px-3 py-1.5 text-meta transition-colors ${
                    fields.allowedModes.includes(mode)
                      ? "border-primary/25 bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 border-t border-border/60 pt-4">
            <div>
              <div className="text-body font-medium text-foreground">Tutor behavior</div>
              <p className="mt-0.5 text-meta text-muted-foreground">
                Govern how much help the mentor may give and whether it must see an attempt first.
                The student&apos;s chosen mode can ask for help only up to the ceiling.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectInput
                label="Help ceiling"
                value={fields.helpCeiling}
                options={["clarify", "hints", "guided", "worked_example", "feedback", "study"]}
                onChange={(value) => onField("helpCeiling", value)}
              />
              <SelectInput
                label="Final answer"
                value={fields.finalAnswerPolicy}
                options={["never", "after_attempt", "allowed"]}
                onChange={(value) => onField("finalAnswerPolicy", value)}
              />
              <SelectInput
                label="Grade band"
                value={fields.gradeBand || "auto"}
                options={["auto", "lower", "middle", "upper"]}
                onChange={(value) => onField("gradeBand", value === "auto" ? "" : value)}
              />
              <SelectInput
                label="Default tone"
                value={fields.tutorTone || "default"}
                options={["default", "encouraging", "neutral", "direct"]}
                onChange={(value) => onField("tutorTone", value === "default" ? "" : value)}
              />
              <SelectInput
                label="Default pace"
                value={fields.tutorPace || "default"}
                options={["default", "brief", "balanced", "guided"]}
                onChange={(value) => onField("tutorPace", value === "default" ? "" : value)}
              />
            </div>
            <button
              type="button"
              onClick={() => onField("requireAttemptFirst", !fields.requireAttemptFirst)}
              className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-meta transition-colors ${
                fields.requireAttemptFirst
                  ? "border-primary/25 bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {fields.requireAttemptFirst ? (
                <Check className="h-3.5 w-3.5" strokeWidth={1.8} />
              ) : null}
              Require an attempt before the mentor helps
            </button>
            <div className="grid gap-1">
              <button
                type="button"
                onClick={() => onField("allowLiveArtifacts", !fields.allowLiveArtifacts)}
                className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-meta transition-colors ${
                  fields.allowLiveArtifacts
                    ? "border-primary/25 bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {fields.allowLiveArtifacts ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={1.8} />
                ) : null}
                Live mentor-built activities
              </button>
              <p className="text-meta text-muted-foreground">
                Lets the mentor offer to build a one-off interactive activity for a struggling
                student — private to that student until you share it.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
