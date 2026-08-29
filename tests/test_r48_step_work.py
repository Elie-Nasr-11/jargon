"""R48 — quiz/assignment as lesson STEPS (+ R47 debt polish).

The last big noun consolidation from the approved "Steal These Flows" synthesis (P8):
a teacher authoring an assignment- or assessment-mode step creates the REAL work item
linked to that step (assignments/assessments.activity_id); a student hits the step
mid-lesson and the mentor's reply carries a work card that opens the matching focus
surface; the step HOLDS until the submission lands (requirements.work); grading stays
in the Classwork work views.

Contracts pinned here:
- linkage schema: activity_id (TEXT, FK lesson_activities ON DELETE SET NULL) on
  assignments + assessments, loose on checkpoints; sync triggers carry it; the deploy
  workflow replays the migration.
- chat runtime: loadStepWork's status-filtered queries, the late-enrollee recipient
  guard (null = unlinked), the failure split (link read fail-OPEN, satisfaction read
  fail-CLOSED), the requirementsFor third parameter (purity boundary — NO post-hoc
  clamping), stepDone's work gate, the tri-state work_offer emission, and the
  await_step_work directive rung.
- client: work_offer REPLAYS from history (mode_offer pattern, NOT artifact_offer's
  live-only rule); the card opens AssignmentSurface/AssessmentSurface; the submit
  fires ONE continue control turn; the dock/panel rows carry a kind discriminator so
  required assignments are no longer a dead-end.
- R47 debt: assessment grading's final feedback is an inline field, not window.prompt.
"""
from pathlib import Path
import unittest
from tests.teacher_sources import authoring_source, console_source


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"

MIGRATION = (ROOT / "supabase" / "migrations" / "20261015000000_step_work_links.sql").read_text(
    encoding="utf-8"
)
DEPLOY_YML = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
ADMIN = (ROOT / "supabase" / "functions" / "assessment-admin" / "index.ts").read_text(
    encoding="utf-8"
)
API = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")
TYPES = (FRONTEND / "lib" / "types.ts").read_text(encoding="utf-8")
CONSOLE = console_source()
STUDIO = authoring_source()
CHAT_MSGS = (FRONTEND / "features" / "student" / "chat" / "chatMessages.ts").read_text(
    encoding="utf-8"
)
TRANSCRIPT = (FRONTEND / "student" / "Transcript.tsx").read_text(encoding="utf-8")
USE_CONV = (FRONTEND / "student" / "useConversation.ts").read_text(encoding="utf-8")
ASSIGN_SURFACE = (FRONTEND / "student" / "AssignmentSurface.tsx").read_text(encoding="utf-8")
STUDENT_APP = (FRONTEND / "student" / "StudentApp.tsx").read_text(encoding="utf-8")
CHECKPOINTS = (FRONTEND / "student" / "checkpoints.ts").read_text(encoding="utf-8")
ASSESS_VIEW = (FRONTEND / "features" / "teacher" / "AssessmentGrading.tsx").read_text(
    encoding="utf-8"
)


def _slice(text: str, start: str, end: str) -> str:
    """The region of `text` between the first `start` and the next `end`."""
    tail = text.split(start, 1)
    assert len(tail) == 2, f"marker not found: {start!r}"
    return tail[1].split(end, 1)[0]


class MigrationTests(unittest.TestCase):
    def test_linkage_columns_are_set_null_fks(self):
        # Deleting a step must ORPHAN its work item (it survives as standalone classwork),
        # never delete it — history and grades outlive lesson editing.
        for table in ("assignments", "assessments"):
            self.assertIn(
                f"alter table public.{table}\n  add column if not exists activity_id text "
                "references public.lesson_activities(id) on delete set null;",
                MIGRATION,
            )
        # Checkpoints mirror the link loosely (no FK) — they're derived rows.
        self.assertIn("alter table public.checkpoints\n  add column if not exists activity_id text;", MIGRATION)

    def test_partial_indexes_cover_the_loader_lookup(self):
        # loadStepWork queries by activity_id every held turn; the partial index keeps
        # standalone rows (activity_id null — the vast majority) out of it.
        self.assertIn("assignments_activity_idx", MIGRATION)
        self.assertIn("assessments_activity_idx", MIGRATION)
        self.assertIn("where activity_id is not null", MIGRATION)

    def test_sync_triggers_carry_the_link(self):
        # The checkpoint mirror rows must inherit the step link or the dock loses it.
        for fn in ("sync_checkpoint_from_assignment", "sync_checkpoint_from_assessment"):
            self.assertIn(fn, MIGRATION)
        self.assertIn("activity_id = excluded.activity_id", MIGRATION)

    def test_migration_is_registered_in_the_deploy_workflow(self):
        # The workflow replays an EXPLICIT migration list — an unregistered migration
        # simply never reaches prod (bitten before; pinned since).
        self.assertIn("20261015000000_step_work_links.sql", DEPLOY_YML)


class ChatRuntimeTests(unittest.TestCase):
    def test_loader_is_mode_gated_and_status_filtered(self):
        # Only assignment/assessment steps load work; archived/draft rows un-gate
        # (status filters), and the newest live row wins.
        self.assertIn("async function loadStepWork(", CHAT)
        body = _slice(CHAT, "async function loadStepWork(", "\n}\n")
        self.assertIn('stepMode !== "assignment" && stepMode !== "assessment"', body)
        self.assertIn("status=eq.assigned", body)
        self.assertIn("status=eq.published", body)
        self.assertIn("order=created_at.desc&limit=1", body)

    def test_late_enrollee_recipient_guard(self):
        # A linked assessment with NO recipient row for this student is UNLINKED for
        # them — RLS would brick start_assessment, so the step must not gate.
        body = _slice(CHAT, "async function loadStepWork(", "\n}\n")
        self.assertIn("assessment_recipients", body)
        self.assertIn("if (!recipients.length) return null; // late enrollee", body)

    def test_failure_split_fail_open_link_fail_closed_satisfaction(self):
        # Link read fails → null (unlinked; protects every unlinked step from a table
        # outage). Satisfaction read fails on a CONFIRMED link → satisfied: null → hold
        # (steps_done is monotonic; a wrong skip is permanent, a wrong hold retries).
        body = _slice(CHAT, "async function loadStepWork(", "\n}\n")
        self.assertIn("satisfied: null,", body)
        self.assertIn("// fail-closed: hold the step this turn", body)
        self.assertIn("return null; // link read fails open", body)

    def test_requirements_spine_owns_the_gate(self):
        # Purity boundary: the gate is a THIRD requirementsFor parameter, never a
        # post-hoc clamp of finishedCurrentActivity (activitiesDoneThisTurn re-derives
        # independently and would disagree).
        self.assertIn("stepWork: StepWork | null = null", CHAT)
        self.assertIn("work?: boolean", CHAT)
        self.assertIn("!(req.work === true)", CHAT)
        # A linked step OVERRIDES its in-chat gates: no code/quiz/understanding demands
        # in chat — the real work item is the assessment now.
        override = _slice(
            CHAT,
            'if (stepWork && (stepMode === "assignment" || stepMode === "assessment")) {',
            "}",
        )
        self.assertIn("quiz: false", override)
        self.assertIn("work: stepWork.satisfied !== true", override)

    def test_revisits_never_gate_on_work(self):
        # The live-turn call passes stepWork ONLY outside a revisit frame — replaying an
        # old step must not re-demand its submission.
        self.assertIn("inRevisit ? null : context.stepWork,", CHAT)

    def test_work_offer_is_tristate_next_to_artifact_offer(self):
        # Value while pending, null when satisfied (the client retires the card),
        # absent when unlinked (old envelopes stay byte-identical).
        self.assertIn("work_offer?:", CHAT)
        self.assertIn("envelope.work_offer = null;", CHAT)
        emission = _slice(CHAT, "const effectiveWork = inRevisit ? null : context.stepWork;", "}")
        self.assertIn("requirements.work === true", emission)

    def test_await_step_work_directive_rung(self):
        # The held turn owns its directive — without this rung content_discuss claimed
        # held work turns and the mentor chatted the gate away.
        self.assertIn('"await_step_work"', CHAT)
        self.assertIn('"present_step"', CHAT)
        self.assertIn("never collect answers in chat", CHAT)


class AssessmentAdminTests(unittest.TestCase):
    def test_create_assessment_accepts_the_link(self):
        self.assertIn("body.activity_id", ADMIN)
        self.assertIn("activity_id: activityId || null,", ADMIN)


class ApiTests(unittest.TestCase):
    def test_create_assignment_inserts_the_link_conditionally(self):
        # Belt-and-braces for the deploy race: the column is only named when a link is
        # actually being made, so an old DB schema can't fail standalone creates.
        self.assertIn("...(input.activityId ? { activity_id: input.activityId } : {}),", API)

    def test_create_assessment_forwards_the_link(self):
        self.assertIn("activity_id: input.activityId || null,", API)

    def test_authoring_data_is_cached_and_invalidated(self):
        # R47 debt: back-from-work-item no longer refetches the whole studio — the
        # authoring read is cached 60s and every authoring WRITE invalidates it.
        self.assertIn("cached(`authoring:${userId}`", API)
        self.assertIn("export async function fetchCurriculumAuthoringData(", API)
        self.assertGreaterEqual(API.count('invalidateSurface("authoring:")'), 2)


class StudioTests(unittest.TestCase):
    def test_classwork_items_carry_the_step_link(self):
        self.assertIn("activityId: string | null;", STUDIO)

    def test_step_card_matches_its_work_item(self):
        # The strip matches on the LINK, and materials are excluded — a bound material
        # shares activityId but is not the step's work.
        self.assertIn('item.activityId === activity.id && item.kind !== "material"', STUDIO)

    def test_step_work_strip_states(self):
        strip = _slice(STUDIO, "R48: assignment/assessment steps run on a REAL work item", "P8: mentor-built activities")
        # Linked → open the work view where grading lives (in the Activity room since
        # R60); unlinked → create pre-bound.
        self.assertIn("Open in Activity", strip)
        self.assertIn("Create the assignment for this step", strip)
        self.assertIn("Create the quiz for this step", strip)
        # Gated on the SAVED mode and on the temp-id swap (same rule as materials).
        self.assertIn('activity.mode === "assignment" || activity.mode === "assessment"', strip)
        self.assertIn("disabled={busy || !bindable}", strip)
        self.assertIn("onCreateForStep(", strip)
        self.assertIn("activityId: activity.id", strip)


class ConsoleTests(unittest.TestCase):
    def test_create_for_step_is_a_separate_seam(self):
        # test_r47 pins onCreate/createOpen; the step path is ADDITIVE — its own
        # callback and its own context state, so the plain + Create flow is untouched.
        # R80: a step lives on the lesson screen, so the seam moved there with it —
        # and the step id still rides into the dialog, which is the whole point.
        self.assertIn("onCreateForStep={(kind, ctx) => {", STUDIO)
        self.assertIn("setCreateForStep(ctx.activityId);", STUDIO)
        self.assertIn("context={{ lessonId, activityId: createForStep }}", STUDIO)
        self.assertIn("setCreateForStep(ctx.activityId);", STUDIO)
        self.assertIn("createForStep", STUDIO)

    def test_managers_prefill_and_lock_the_lesson(self):
        # A step-created item is born on the step's lesson — the select locks so the
        # link can't be quietly re-pointed while the dialog is open.
        self.assertIn("disabled={Boolean(context)}", CONSOLE)
        self.assertGreaterEqual(CONSOLE.count("activityId: context.activityId"), 2)

    def test_save_handlers_forward_the_link(self):
        self.assertGreaterEqual(CONSOLE.count("activityId: input.activityId ?? null,"), 2)


class StudentClientTests(unittest.TestCase):
    def test_envelope_type_carries_work_offer(self):
        self.assertIn("work_offer?: {", TYPES)

    def test_work_offer_replays_from_history(self):
        # mode_offer pattern, NOT artifact_offer's live-only rule: the step stays held
        # until the submission lands, so a reload without the card would strand the
        # student mid-lesson with nothing to click.
        self.assertIn("workOffer?: WorkOffer;", CHAT_MSGS)
        self.assertIn("payload.work_offer", CHAT_MSGS)
        self.assertIn("workOffer: envelope.work_offer ?? undefined,", CHAT_MSGS)

    def test_transcript_renders_the_card_on_the_latest_reply_only(self):
        self.assertIn(
            "message.workOffer && isLatestBot && !message.isError && onOpenWork", TRANSCRIPT
        )

    def test_send_work_done_is_one_continue_control_turn(self):
        # The server re-reads satisfaction on this turn — a real submission releases the
        # step; a phantom "done" without one keeps it held.
        block = _slice(USE_CONV, "const sendWorkDone", "}, [sendAnswer]);")
        self.assertIn('"I\'ve submitted it."', block)
        self.assertIn('control: { type: "continue" }', block)

    def test_assignment_surface_is_the_submit_caller(self):
        # submitAssignment shipped with the schema but had ZERO callers — this surface
        # is the first, with the documented client-side limits enforced before upload.
        self.assertIn("submitAssignment({ assignmentId, content, code: \"\", files })", ASSIGN_SURFACE)
        self.assertIn("fetchStudentAssignments()", ASSIGN_SURFACE)
        self.assertIn("MAX_SUBMISSION_FILES", ASSIGN_SURFACE)
        self.assertIn("MAX_SUBMISSION_FILE_BYTES", ASSIGN_SURFACE)

    def test_shell_arms_the_handshake_only_from_the_card(self):
        # Work opened from the dock/panel finishes WITHOUT injecting a chat turn; only
        # the lesson's card arms the continue handshake, and it's consumed once.
        self.assertIn("openedFromOfferRef.current = true;", STUDENT_APP)
        self.assertIn("const workDoneFromOffer = () => {", STUDENT_APP)
        self.assertIn("conversation.sendWorkDone();", STUDENT_APP)
        self.assertIn("<AssignmentSurface", STUDENT_APP)
        # A step-created assessment may be missing from the 60s-stale cached bundle.
        self.assertIn('invalidateSurface("assessments");', STUDENT_APP)


class DockTests(unittest.TestCase):
    def test_rows_carry_a_kind_discriminator(self):
        self.assertIn('kind: "assessment" | "assignment";', CHECKPOINTS)
        self.assertIn("export function assignmentRows(", CHECKPOINTS)

    def test_shell_dispatches_rows_by_kind(self):
        # The pre-existing dead-end: a required assignment could hold the lesson-end
        # gate with no student surface anywhere to open it. Rows now dispatch.
        self.assertIn("const openWorkRow = (row: CheckpointRowModel) => {", STUDENT_APP)
        self.assertIn("setOpenAssignmentId(row.id);", STUDENT_APP)


class GradingDebtTests(unittest.TestCase):
    def test_return_feedback_is_inline_not_a_prompt(self):
        self.assertNotIn("window.prompt", ASSESS_VIEW)
        self.assertIn("Final feedback for the student", ASSESS_VIEW)

    def test_return_result_contract_is_stable(self):
        # R47 pins the label and the handler shape; the debt fix must not move them.
        self.assertIn("Return result", ASSESS_VIEW)
        self.assertIn(
            "onReturnAssessment: (input: { attemptId: string; feedback: string }) => Promise<void>;",
            ASSESS_VIEW,
        )


if __name__ == "__main__":
    unittest.main()
