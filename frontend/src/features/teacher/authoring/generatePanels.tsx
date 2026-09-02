/**
 * The generate-and-review panels.
 *
 * Each one runs the same loop: read the chosen material, ask for a draft, show
 * the draft with what changed since the last pass, let the teacher refine a
 * single item or the whole thing, and only then write it. Nothing here saves
 * without an explicit approval - the draft state is local until it does.
 */
import { useMemo, useState } from "react";
import { ArtifactFrame } from "@/components/ArtifactFrame";
import { DeckRenderer } from "@/components/DeckRenderer";
import { TextArea, ViewToggle } from "@/features/teacher/authoring/fields";
import { AiReferenceInput } from "@/features/teacher/authoring/referenceInput";
import type {
  ArtifactApprovePayload,
  ArtifactGenArgs,
  OutlineGenArgs,
  StepsGenArgs,
} from "@/features/teacher/authoring/types";
import { lintArtifactHtml } from "@/lib/artifact-lint";
import { parseArtifactConfig } from "@/lib/artifact-schema";
import type { DeckSpec } from "@/lib/artifact-schema";
import { DEFAULT_VOICE } from "@/lib/jargon-store";
import type {
  CurriculumAdminResponse,
  CurriculumLessonPackage,
  CurriculumOutlineDraft,
  CurriculumStepDraft,
  Lesson,
  LessonResource,
} from "@/lib/types";
import { Check, ChevronRight, MessageSquare, Save, Sparkles } from "lucide-react";
import { countOf } from "@/lib/format";

export type ItemStatus = "added" | "changed" | "same";

// Compare item signatures by index; used to highlight what a refine changed.
export function diffStatuses(prev: string[] | null, next: string[]): ItemStatus[] {
  return next.map((sig, i) => {
    if (!prev || prev[i] === undefined) return prev ? "added" : "same";
    return prev[i] === sig ? "same" : "changed";
  });
}

export function statusRing(status: ItemStatus): string {
  if (status === "added") return "border-success/45 bg-success/5";
  if (status === "changed") return "border-amber-400/60 bg-amber-400/10";
  return "border-border bg-depth-sub";
}

export function statusLabel(status: ItemStatus): string | null {
  if (status === "added") return "new";
  if (status === "changed") return "changed";
  return null;
}

export function RefineBox({
  loading,
  placeholder,
  onSubmit,
  onCancel,
}: {
  loading: boolean;
  placeholder: string;
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="mt-2 grid gap-1.5">
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        className="jargon-input"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSubmit(text.trim())}
          disabled={loading || !text.trim()}
          className="btn btn-secondary btn-sm"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
          {loading ? "Refining…" : "Refine"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-meta text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// R56 "build from material" — the one-stop authoring moment. The teacher points at
// what they already have (upload, paste, link, or an existing lesson resource), and
// the platform drafts the whole lesson: steps, a wrap-up quiz, and an assignment.
// Everything shown here is a DRAFT — Apply writes it as an unpublished lesson.
export function BuildFromMaterialPanel({
  busy,
  resources,
  onGenerate,
  onApply,
}: {
  busy: boolean;
  resources: LessonResource[];
  onGenerate: (args: {
    prompt: string;
    referenceText: string;
    includeQuiz: boolean;
    includeAssignment: boolean;
  }) => Promise<CurriculumLessonPackage | null>;
  onApply: (pkg: CurriculumLessonPackage) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [includeQuiz, setIncludeQuiz] = useState(true);
  const [includeAssignment, setIncludeAssignment] = useState(true);
  const [loading, setLoading] = useState(false);
  const [pkg, setPkg] = useState<CurriculumLessonPackage | null>(null);

  const run = async () => {
    setLoading(true);
    const result = await onGenerate({
      prompt: prompt.trim(),
      referenceText,
      includeQuiz,
      includeAssignment,
    });
    setLoading(false);
    if (result) setPkg(result);
  };

  return (
    <div className="rounded-card border border-border bg-depth-sub p-4">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        <div className="min-w-0">
          <h4 className="text-body font-medium text-foreground">New lesson</h4>
          <p className="mt-0.5 text-meta text-muted-foreground">
            Say what the lesson should teach. Add reference material if you have it — a chapter,
            your notes, a link — and Jargon will ground the lesson in it. Either way you get steps,
            a wrap-up quiz and an assignment to review before anything is published.
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3">
        {/* R76: the ASK leads and the material follows. Building from material was never a
            different kind of building — it is this same act with a source attached — so the
            panel no longer opens by demanding an upload. */}
        <TextArea
          label="What should this lesson teach? — e.g. Grade 7, one period, how a CPU fetches an instruction"
          value={prompt}
          onChange={setPrompt}
        />
        {/* A field label, not a new section — the R75 ratchet is right that this room
            does not get another always-on heading. */}
        <div className="grid gap-1.5">
          <span className="text-meta text-muted-foreground">Reference material (optional)</span>
          <AiReferenceInput
            resources={resources}
            busy={busy || loading}
            onChange={setReferenceText}
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-meta text-foreground">
            <input
              type="checkbox"
              checked={includeQuiz}
              onChange={() => setIncludeQuiz((value) => !value)}
              className="h-3.5 w-3.5 accent-foreground"
            />
            Include a wrap-up quiz
          </label>
          <label className="flex items-center gap-2 text-meta text-foreground">
            <input
              type="checkbox"
              checked={includeAssignment}
              onChange={() => setIncludeAssignment((value) => !value)}
              className="h-3.5 w-3.5 accent-foreground"
            />
            Include an assignment
          </label>
        </div>
        <div>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || loading || (!referenceText.trim() && !prompt.trim())}
            className="btn btn-primary btn-sm"
          >
            {loading ? "Building the lesson…" : "Build lesson"}
          </button>
          {!referenceText.trim() && !prompt.trim() ? (
            <span className="ml-2 text-meta text-muted-foreground">
              Say what the lesson should teach first.
            </span>
          ) : null}
        </div>
      </div>

      {pkg ? (
        <div className="mt-4 grid gap-3 border-t border-border pt-4">
          {!pkg.grounded ? (
            <p className="text-meta text-warning">
              Built from your brief alone — no material was attached, so check the facts before
              publishing.
            </p>
          ) : null}
          <div className="rounded-card border border-border bg-depth-card p-3">
            <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Lesson
            </div>
            <div className="mt-1 text-body font-medium text-foreground">{pkg.lesson.title}</div>
            {pkg.lesson.objective ? (
              <div className="mt-0.5 text-meta text-muted-foreground">{pkg.lesson.objective}</div>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {pkg.steps.length} steps
            </div>
            {pkg.steps.map((step, index) => (
              <div key={index} className="rounded-card border border-border bg-depth-card p-2.5">
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-border px-2 py-0.5 text-overline uppercase text-muted-foreground">
                    {step.mode || step.kind}
                  </span>
                  <span className="min-w-0 truncate text-meta font-medium text-foreground">
                    {step.title}
                  </span>
                </div>
                {step.prompt ? (
                  <p className="mt-1 line-clamp-2 text-meta text-muted-foreground">{step.prompt}</p>
                ) : null}
              </div>
            ))}
          </div>

          {pkg.quiz.items.length ? (
            <div className="grid gap-1.5">
              <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Wrap-up quiz · {pkg.quiz.items.length} questions
              </div>
              {pkg.quiz.items.map((item, index) => (
                <div key={index} className="rounded-card border border-border bg-depth-card p-2.5">
                  <div className="text-meta text-foreground">{item.prompt}</div>
                  {item.choices.length ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {item.choices.map((choice) => (
                        <span
                          key={choice.id}
                          className={`rounded-full border px-2 py-0.5 text-overline ${
                            item.correct_choice_ids.includes(choice.id)
                              ? "border-success/45 text-success"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          {choice.text}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 text-overline uppercase text-muted-foreground">
                      Written answer
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {pkg.assignment ? (
            <div className="rounded-card border border-border bg-depth-card p-3">
              <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Assignment
              </div>
              <div className="mt-1 text-meta font-medium text-foreground">
                {pkg.assignment.title}
              </div>
              <p className="mt-1 text-meta text-muted-foreground">{pkg.assignment.instructions}</p>
              {pkg.assignment.success_criteria.length ? (
                <ul className="mt-2 grid gap-0.5">
                  {pkg.assignment.success_criteria.map((line, index) => (
                    <li key={index} className="text-meta text-muted-foreground">
                      · {line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onApply(pkg);
                setPkg(null);
              }}
              disabled={busy}
              className="btn btn-primary btn-sm"
            >
              Add this lesson
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy || loading}
              className="btn btn-secondary btn-sm"
            >
              Rebuild
            </button>
            <button
              type="button"
              onClick={() => setPkg(null)}
              disabled={busy}
              className="btn btn-ghost btn-sm"
            >
              Discard
            </button>
            <span className="text-meta text-muted-foreground">
              Lands as a draft — publish it when you're happy.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AiOutlinePanel({
  busy,
  resources,
  onGenerate,
  onApply,
  onBuild,
}: {
  busy: boolean;
  resources: LessonResource[];
  onGenerate: (args: OutlineGenArgs) => Promise<CurriculumOutlineDraft | null>;
  onApply: (outline: CurriculumOutlineDraft) => void;
  // R57: apply the outline AND write every lesson from the same material.
  onBuild: (outline: CurriculumOutlineDraft, material: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<CurriculumOutlineDraft | null>(null);
  const [statuses, setStatuses] = useState<ItemStatus[]>([]);
  const [refineFor, setRefineFor] = useState<number | null>(null);

  const sigOf = (unit: CurriculumOutlineDraft["units"][number]) => JSON.stringify(unit);
  const lessonCount = draft
    ? draft.units.reduce((total, unit) => total + unit.lessons.length, 0)
    : 0;

  const generate = async () => {
    // R57: material alone is a brief — a chapter upload IS the instruction. Either
    // one is enough; both together is best.
    if (!prompt.trim() && !referenceText.trim()) return;
    setLoading(true);
    const result = await onGenerate({ prompt: prompt.trim(), referenceText });
    if (result) {
      setDraft(result);
      setStatuses(result.units.map(() => "same"));
      setRefineFor(null);
    }
    setLoading(false);
  };

  const refine = async (index: number, feedback: string) => {
    if (!draft || !feedback) return;
    setLoading(true);
    const prevSigs = draft.units.map(sigOf);
    const result = await onGenerate({
      prompt,
      referenceText,
      current: draft,
      feedback,
      target: `Unit "${draft.units[index]?.title || index + 1}"`,
    });
    if (result) {
      setStatuses(diffStatuses(prevSigs, result.units.map(sigOf)));
      setDraft(result);
      setRefineFor(null);
    }
    setLoading(false);
  };

  return (
    <section className="rounded-card border border-border bg-depth-sub p-4">
      <div className="mb-2 flex items-center gap-2 text-title font-medium text-foreground">
        <Sparkles className="h-4 w-4" strokeWidth={1.7} />
        Add units &amp; lessons
      </div>
      <p className="mb-3 text-meta text-muted-foreground">
        Say what this course covers and it proposes the chapters and the lessons inside them. You
        review every unit before anything is created, then choose whether to write the lessons too.
      </p>
      <TextArea
        label="What does this course cover? — e.g. Grade 8 IT, one term, chapters 1–4 of Book A1"
        value={prompt}
        onChange={setPrompt}
      />
      <div className="mt-3 grid gap-1.5">
        <span className="text-meta text-muted-foreground">Reference material (optional)</span>
        <AiReferenceInput resources={resources} busy={busy} onChange={setReferenceText} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading || busy || (!prompt.trim() && !referenceText.trim())}
          className="btn btn-secondary"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
          {loading ? "Working…" : draft ? "Regenerate" : "Generate outline"}
        </button>
      </div>

      {draft ? (
        <div className="mt-3 grid gap-2 rounded-card border border-border bg-depth-field p-3">
          {draft.units.length === 0 ? (
            <div className="text-meta text-muted-foreground">
              The model did not return any units. Try a more specific brief.
            </div>
          ) : (
            draft.units.map((unit, i) => {
              const status = statuses[i] || "same";
              return (
                <div key={i} className={`rounded-control border p-2.5 ${statusRing(status)}`}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-meta font-medium text-foreground">
                      {unit.title}
                    </span>
                    {statusLabel(status) ? (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                        {statusLabel(status)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setRefineFor(refineFor === i ? null : i)}
                      title="Refine this unit"
                      aria-label="Refine this unit"
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-depth-field hover:text-foreground"
                    >
                      <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </div>
                  <ul className="mt-1 ml-4 list-disc text-meta text-muted-foreground">
                    {unit.lessons.map((lesson, j) => (
                      <li key={j}>{lesson.title}</li>
                    ))}
                  </ul>
                  {refineFor === i ? (
                    <RefineBox
                      loading={loading}
                      placeholder="e.g. add a hands-on lesson, make it easier…"
                      onSubmit={(feedback) => void refine(i, feedback)}
                      onCancel={() => setRefineFor(null)}
                    />
                  ) : null}
                </div>
              );
            })
          )}
          {draft.units.length ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  onBuild(draft, referenceText);
                  setDraft(null);
                  setStatuses([]);
                  setPrompt("");
                }}
                disabled={busy}
                title={`Create the units and write all ${countOf(lessonCount, "lesson")}`}
                className="btn btn-primary"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
                Build {countOf(lessonCount, "lesson")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onApply(draft);
                  setDraft(null);
                  setStatuses([]);
                  setPrompt("");
                }}
                disabled={busy}
                title="Create the units and empty lessons only — write them yourself later"
                className="inline-flex items-center gap-2 rounded-full border border-success/35 px-4 py-2 text-meta text-success transition-colors hover:bg-success/10 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                Outline only
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setStatuses([]);
                }}
                className="text-meta text-muted-foreground hover:text-foreground"
              >
                Discard
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function AiStepsPanel({
  busy,
  resources,
  onGenerate,
  onApply,
}: {
  busy: boolean;
  resources: LessonResource[];
  onGenerate: (args: StepsGenArgs) => Promise<CurriculumStepDraft[] | null>;
  onApply: (drafts: CurriculumStepDraft[]) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<CurriculumStepDraft[] | null>(null);
  const [statuses, setStatuses] = useState<ItemStatus[]>([]);
  const [refineFor, setRefineFor] = useState<number | null>(null);

  const sigOf = (step: CurriculumStepDraft) => JSON.stringify(step);

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    const result = await onGenerate({ prompt: prompt.trim(), referenceText });
    if (result) {
      setDrafts(result);
      setStatuses(result.map(() => "same"));
      setRefineFor(null);
    }
    setLoading(false);
  };

  const refine = async (index: number, feedback: string) => {
    if (!drafts || !feedback) return;
    setLoading(true);
    const prevSigs = drafts.map(sigOf);
    const result = await onGenerate({
      prompt,
      referenceText,
      current: drafts,
      feedback,
      target: `Step ${index + 1}: "${drafts[index]?.title || ""}"`,
    });
    if (result) {
      setStatuses(diffStatuses(prevSigs, result.map(sigOf)));
      setDrafts(result);
      setRefineFor(null);
    }
    setLoading(false);
  };

  return (
    <div>
      {/* R85: named after what it does, not after the machinery. "Draft steps with AI"
          framed the assistant as the point; the teacher's point is the steps. This is
          the one deliberate path for "I know what I want, here is the brief" — the
          empty lesson drafts on its own without ever coming here. */}
      <div className="mb-2 flex items-center gap-2 text-title font-medium text-foreground">
        <Sparkles className="h-4 w-4" strokeWidth={1.7} />
        Draft steps from a brief
      </div>
      <p className="mb-3 text-meta text-muted-foreground">
        Say what this lesson should teach. Jargon reads the lesson and any material you attach, and
        proposes the steps — refine any of them, then add them.
      </p>
      <TextArea label="Brief" value={prompt} onChange={setPrompt} />
      <div className="mt-3">
        <AiReferenceInput resources={resources} busy={busy} onChange={setReferenceText} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading || busy || !prompt.trim()}
          className="btn btn-secondary"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
          {loading ? "Working…" : drafts ? "Regenerate" : "Generate"}
        </button>
      </div>

      {drafts ? (
        <div className="mt-3 grid gap-2 rounded-card border border-border bg-depth-field p-3">
          {drafts.length === 0 ? (
            <div className="text-meta text-muted-foreground">
              The model did not return any steps. Try a more specific brief.
            </div>
          ) : (
            drafts.map((step, i) => {
              const status = statuses[i] || "same";
              return (
                <div key={i} className={`rounded-control border p-2.5 ${statusRing(status)}`}>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                      {step.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-meta font-medium text-foreground">
                      {step.title}
                    </span>
                    {statusLabel(status) ? (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                        {statusLabel(status)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setRefineFor(refineFor === i ? null : i)}
                      title="Refine this step"
                      aria-label="Refine this step"
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-depth-field hover:text-foreground"
                    >
                      <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-meta text-muted-foreground">
                    {step.prompt}
                  </p>
                  {step.kind === "checkpoint" && step.choices.length ? (
                    <ul className="mt-1 ml-4 list-disc text-meta text-muted-foreground">
                      {step.choices.map((choice) => (
                        <li
                          key={choice.id}
                          className={choice.id === step.correct_choice_id ? "text-success" : ""}
                        >
                          {choice.text}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {refineFor === i ? (
                    <RefineBox
                      loading={loading}
                      placeholder="e.g. make this a code task, harder, clearer wording…"
                      onSubmit={(feedback) => void refine(i, feedback)}
                      onCancel={() => setRefineFor(null)}
                    />
                  ) : null}
                </div>
              );
            })
          )}
          {drafts.length ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  onApply(drafts);
                  setDrafts(null);
                  setStatuses([]);
                  setPrompt("");
                }}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-full border border-success/35 px-4 py-2 text-meta text-success transition-colors hover:bg-success/10 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                Add these steps
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrafts(null);
                  setStatuses([]);
                }}
                className="text-meta text-muted-foreground hover:text-foreground"
              >
                Discard
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// P7: generate → preview → approve an interactive artifact for a step. Mirrors AiStepsPanel:
// a brief drives a read-only generate, the draft renders in the SAME ArtifactFrame/DeckRenderer
// the student sees, and Approve persists it as a published resource bound to this step.
export function ArtifactGeneratePanel({
  busy,
  bindable,
  onGenerate,
  onApprove,
}: {
  busy: boolean;
  bindable: boolean;
  onGenerate: (args: ArtifactGenArgs) => Promise<CurriculumAdminResponse | null>;
  onApprove: (payload: ArtifactApprovePayload) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"html_sim" | "deck">("html_sim");
  const [brief, setBrief] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState("");
  const [deck, setDeck] = useState<DeckSpec | null>(null);
  const [lintViolations, setLintViolations] = useState<string[]>([]);
  const hasDraft = Boolean(html) || Boolean(deck);

  const artifactConfig = useMemo(
    () => (html ? parseArtifactConfig({ kind: "html_sim", version: 1 }) : null),
    [html],
  );

  const generate = async () => {
    if (!brief.trim()) return;
    setLoading(true);
    try {
      const result = await onGenerate({
        kind,
        brief,
        feedback: hasDraft ? feedback : undefined,
        current: hasDraft ? (kind === "deck" ? { deck: deck ?? undefined } : { html }) : undefined,
      });
      if (result) {
        if (result.artifact_kind === "deck" && result.deck) {
          setDeck(result.deck);
          setHtml("");
          setLintViolations([]);
        } else if (result.artifact_html) {
          setHtml(result.artifact_html);
          setDeck(null);
          setLintViolations(result.lint?.ok === false ? result.lint.violations : []);
        }
        setFeedback("");
      }
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setHtml("");
    setDeck(null);
    setLintViolations([]);
    setFeedback("");
  };

  const approve = () => {
    if (html) {
      // Courtesy re-lint before publishing (the sandbox is the real boundary).
      if (!lintArtifactHtml(html).ok) {
        setLintViolations(lintArtifactHtml(html).violations);
        return;
      }
      onApprove({
        kind: "html_sim",
        title: brief.trim().slice(0, 80) || "Activity",
        posterText: brief.trim(),
        html,
      });
    } else if (deck) {
      onApprove({
        kind: "deck",
        title: deck.title || brief.trim().slice(0, 80) || "Slides",
        deck,
      });
    }
    setOpen(false);
    reset();
  };

  return (
    <div className="rounded-card border border-border bg-depth-sub">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <Sparkles className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
        <span className="flex-1 text-body text-foreground">Generate an activity</span>
        <ChevronRight
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          strokeWidth={1.7}
        />
      </button>
      {open ? (
        <div className="grid gap-3 border-t border-border p-3">
          {!bindable ? (
            <div className="rounded-control border border-dashed border-border px-3 py-2 text-meta text-muted-foreground">
              Save this step first, then generate an activity for it.
            </div>
          ) : null}
          <div className="flex items-center gap-1 rounded-full border border-border p-0.5 justify-self-start">
            <ViewToggle
              active={kind === "html_sim"}
              onClick={() => {
                setKind("html_sim");
                reset();
              }}
              label="Simulation"
            />
            <ViewToggle
              active={kind === "deck"}
              onClick={() => {
                setKind("deck");
                reset();
              }}
              label="Slide deck"
            />
          </div>
          <TextArea
            label={
              kind === "html_sim" ? "Describe the interactive activity" : "Describe the slide deck"
            }
            value={brief}
            onChange={setBrief}
          />
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy || loading || !bindable || !brief.trim()}
            className="btn btn-secondary self-start"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
            {loading ? "Generating…" : hasDraft ? "Regenerate" : "Generate"}
          </button>

          {lintViolations.length ? (
            <div className="rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-meta text-warning">
              This activity tripped a safety check ({lintViolations.join(", ")}). Regenerate before
              approving.
            </div>
          ) : null}

          {html && artifactConfig ? (
            <ArtifactFrame
              title={brief.trim().slice(0, 80) || "Preview"}
              artifact={artifactConfig}
              fetchHtml={async () => html}
              onTelemetry={() => {}}
            />
          ) : deck ? (
            <DeckRenderer
              deck={deck}
              title={deck.title || "Preview"}
              voice={DEFAULT_VOICE}
              accessToken=""
              lessonId=""
              sessionId={null}
              onVoiceEvent={() => {}}
              readAloud={false}
            />
          ) : null}

          {hasDraft ? (
            <>
              <TextArea
                label="Feedback to refine (optional)"
                value={feedback}
                onChange={setFeedback}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={approve}
                  disabled={busy || loading || lintViolations.length > 0}
                  className="inline-flex items-center gap-2 rounded-full border border-success/35 px-4 py-2 text-meta text-success transition-colors hover:bg-success/10 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                  Approve &amp; add to step
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="text-meta text-muted-foreground hover:text-foreground"
                >
                  Discard
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ordering, parsing + breadcrumb helpers.
// ---------------------------------------------------------------------------
