// Flow rebuild Pillar 4: executable property + reachability tests over the REAL flow
// core — applyTurn, deriveTurn, applyModeCeiling, stepDone, turnDirective — imported
// from the chat function itself (the harness copies this file next to a jsr-stripped
// copy of index.ts and runs `JARGON_FLOW_TEST=1 deno test --no-check`; the env guard
// keeps Deno.serve from starting). Driven by tests/test_flow_pillar4_properties.py.
//
// These are the invariants the deterministic spine PROMISES. If one fails, the spine
// broke — do not weaken the assertion to make it pass.
import {
  applyModeCeiling,
  applyTurn,
  CONTINUE_PHRASE_RE,
  CONTINUE_SIGNAL_RE,
  deriveTurn,
  emptyStepState,
  requirementsFor,
  stepDone,
  turnDirective,
  type StepRequirements,
  type StepState,
} from "./chat_index.ts";

// ---- tiny assert helpers (jsr/std is unreachable offline; zero deps) ----------------
function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`ASSERT: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

// Deterministic PRNG (mulberry32) — every failure reproduces from the same seed.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const choice = <T>(r: () => number, items: readonly T[]): T =>
  items[Math.floor(r() * items.length)];

const T0 = "2026-08-16T00:00:00.000Z";
const KINDS = [null, "answer_attempt", "question", "continue_signal", "navigate_back", "tangent", "meta"] as const;
const MODES = [null, "lesson", "practice", "discuss"] as const;

function req(over: Partial<StepRequirements> = {}): StepRequirements {
  return { code: false, quiz: false, understanding: false, acknowledge: false, quizChoices: [], ...over };
}

// ---- applyModeCeiling: the exact mapping, enumerated -------------------------------
Deno.test("ceiling: discuss/practice lift gate-closing kinds to question; lesson/null pass through", () => {
  for (const kind of KINDS) {
    for (const mode of MODES) {
      const out = applyModeCeiling(mode as never, kind as never);
      if (mode === "discuss" || mode === "practice") {
        if (kind === null || kind === "answer_attempt" || kind === "continue_signal") {
          eq(out, "question", `ceiling(${mode}, ${kind})`);
        } else {
          eq(out, kind, `ceiling(${mode}, ${kind}) passes non-gating kinds`);
        }
      } else {
        eq(out, kind, `ceiling(${mode}, ${kind}) is identity outside the two registers`);
      }
    }
  }
});

// ---- applyTurn: gate monotonicity + the acknowledge doors ---------------------------
Deno.test("applyTurn: gates are monotonic and attempts never decrease over random sequences", () => {
  const r = rng(0xf10a);
  for (let run = 0; run < 60; run++) {
    const requirements = req({
      code: r() < 0.3,
      quiz: r() < 0.3,
      understanding: r() < 0.4,
      acknowledge: r() < 0.4,
    });
    let state: StepState = emptyStepState("a1");
    for (let i = 0; i < 40; i++) {
      const mode = choice(r, ["text", "code", "multiple_choice", "file"] as const);
      const answer =
        r() < 0.15
          ? null
          : {
              mode,
              text: mode === "text" ? choice(r, ["yes", "why does it work?", "an answer with words", ""]) : "",
              code: mode === "code" ? "print(1)" : undefined,
            };
      const passed = r() < 0.4;
      const assessment =
        r() < 0.5 ? null : { score: passed ? 1 : 0, passed, feedback: "", source: "orchestrator" as const };
      const understanding =
        r() < 0.6 ? null : { demonstrated: r() < 0.5, level: "partial" as const, note: "" };
      const next = applyTurn(
        state,
        requirements,
        answer as never,
        assessment as never,
        understanding as never,
        T0,
        choice(r, [null, "explanation", "inquiry", "revision"] as never[]),
        choice(r, KINDS) as never,
      );
      for (const gate of [
        "presented_at",
        "code_passed_at",
        "quiz_passed_at",
        "quiz_presented_at",
        "understanding_at",
        "acknowledged_at",
      ] as const) {
        if (state[gate]) eq(next[gate], state[gate], `${gate} must never un-set or change once set`);
      }
      ok(next.attempts >= state.attempts, "attempts never decrease");
      ok(next.graded_fails >= state.graded_fails, "graded_fails never decrease");
      state = next;
    }
  }
});

Deno.test("applyTurn: only continue_signal (or legacy-null readiness text) discharges the acknowledge gate", () => {
  const requirements = req({ acknowledge: true });
  const presented: StepState = { ...emptyStepState("a1"), presented_at: T0 };
  for (const kind of ["answer_attempt", "question", "tangent", "meta"] as const) {
    const out = applyTurn(
      presented,
      requirements,
      { mode: "text", text: "I think it means energy" } as never,
      null,
      null,
      T0,
      null,
      kind as never,
    );
    eq(out.acknowledged_at, null, `routed ${kind} must not acknowledge a content step`);
  }
  const viaSignal = applyTurn(
    presented,
    requirements,
    { mode: "text", text: "yes" } as never,
    null,
    null,
    T0,
    null,
    "continue_signal" as never,
  );
  ok(Boolean(viaSignal.acknowledged_at), "continue_signal acknowledges");
  const legacyProse = applyTurn(
    presented,
    requirements,
    { mode: "text", text: "the mitochondria makes energy" } as never,
    null,
    null,
    T0,
    null,
    null,
  );
  eq(legacyProse.acknowledged_at, null, "legacy-null ordinary prose must NOT acknowledge");
  const legacyReady = applyTurn(
    presented,
    requirements,
    { mode: "text", text: "ready" } as never,
    null,
    null,
    T0,
    null,
    null,
  );
  ok(Boolean(legacyReady.acknowledged_at), "legacy-null readiness-shaped text acknowledges");
});

Deno.test("applyTurn: conversation kinds never stamp presentation before the step is shown", () => {
  for (const kind of ["question", "tangent", "meta"] as const) {
    const out = applyTurn(
      emptyStepState("a1"),
      req(),
      { mode: "text", text: "what is this about?" } as never,
      null,
      null,
      T0,
      null,
      kind as never,
    );
    eq(out.presented_at, null, `${kind} before presentation must not stamp presented_at`);
  }
});

Deno.test("applyTurn: understanding closes only on attempts (or the stuck cap), never on conversation kinds", () => {
  const requirements = req({ understanding: true });
  const presented: StepState = { ...emptyStepState("a1"), presented_at: T0 };
  const demonstrated = { demonstrated: true, level: "solid" as const, note: "" };
  for (const kind of ["question", "tangent", "meta"] as const) {
    const out = applyTurn(
      presented,
      requirements,
      { mode: "text", text: "why does that work?" } as never,
      null,
      demonstrated as never,
      T0,
      null,
      kind as never,
    );
    eq(out.understanding_at, null, `a routed ${kind} must never close the understanding gate`);
  }
  const attempt = applyTurn(
    presented,
    requirements,
    { mode: "text", text: "because the gradient stores energy" } as never,
    null,
    demonstrated as never,
    T0,
    null,
    "answer_attempt" as never,
  );
  ok(Boolean(attempt.understanding_at), "a demonstrated answer_attempt closes the gate");
  const stuck = applyTurn(
    { ...presented, attempts: 4 },
    requirements,
    { mode: "text", text: "i still do not know" } as never,
    null,
    { demonstrated: false, level: "partial", note: "" } as never,
    T0,
    null,
    "answer_attempt" as never,
  );
  ok(Boolean(stuck.understanding_at), "the stuck cap (>=4 attempts) concludes the step");
});

// ---- deriveTurn: flow decisions match the gates -------------------------------------
Deno.test("deriveTurn: complete iff presented and every required gate is closed", () => {
  const r = rng(0xd11e);
  for (let i = 0; i < 400; i++) {
    const requirements = req({
      code: r() < 0.4,
      quiz: r() < 0.4,
      understanding: r() < 0.4,
      acknowledge: r() < 0.4,
    });
    const state: StepState = {
      ...emptyStepState("a1"),
      presented_at: r() < 0.8 ? T0 : null,
      code_passed_at: r() < 0.5 ? T0 : null,
      quiz_passed_at: r() < 0.5 ? T0 : null,
      quiz_presented_at: r() < 0.5 ? T0 : null,
      understanding_at: r() < 0.5 ? T0 : null,
      acknowledged_at: r() < 0.5 ? T0 : null,
    };
    const presentedBefore = Boolean(state.presented_at);
    const flow = deriveTurn(state, requirements, presentedBefore, "text");
    if (presentedBefore && stepDone(state, requirements)) {
      eq(flow.nextAction, "complete", "done step must complete");
    } else {
      ok(flow.nextAction !== "complete", "an un-done (or unpresented) step must never complete");
    }
    if (flow.nextAction === "choose" && presentedBefore) {
      ok(requirements.quiz && !state.quiz_passed_at, "choose only while the quiz gate is open");
      ok(!requirements.code || Boolean(state.code_passed_at), "quiz never before a required code gate");
    }
  }
});

// ---- turnDirective: reachability of every rung + precedence fuzz --------------------
type DirectiveArgs = Parameters<typeof turnDirective>[0];

const BRAIN_NONE = {
  recallIdea: null,
  compress: false,
  practiceTarget: null,
  practiceStretch: null,
  figure: null,
  practiceBank: null,
};

function baseArgs(): DirectiveArgs {
  const shown: StepState = { ...emptyStepState("a1"), presented_at: T0, attempts: 1 };
  return {
    currentStage: "practice",
    answer: { mode: "text", text: "tell me more about this" },
    presentedBefore: true,
    stepStateBefore: shown,
    draftState: { ...shown },
    draftFlow: { stage: "practice", responseMode: "text", nextAction: "reply", choices: [] },
    requirements: req(),
    activityMode: "text",
    stepMode: null,
    stepModeType: "",
    gradedUnderstanding: null,
    gradedCode: null,
    runtimeTimedOut: false,
    assessment: null,
    attachedResources: [],
    routedKind: null,
    inRevisit: false,
    navAction: null,
    preemptedNote: null,
    studentMode: "lesson",
    advanceAskedButCeilinged: false,
    attemptCeilinged: false,
    modeOfferAccept: null,
    brainHints: { ...BRAIN_NONE },
  } as never;
}

// One witness vector per rung of the ladder — executable documentation that every
// branch is reachable, in the ladder's own order. A rung nothing can reach is dead
// code; a changed key is a contract change. Both should fail loudly here.
const WITNESSES: Array<[string, (a: DirectiveArgs) => void]> = [
  ["revisit_open", (a) => {
    a.navAction = "revisit";
    a.inRevisit = true;
  }],
  ["revisit_converse", (a) => {
    a.inRevisit = true;
  }],
  ["resume_recap", (a) => {
    a.navAction = "resume";
  }],
  ["navigate_back_offer", (a) => {
    a.routedKind = "navigate_back" as never;
  }],
  ["post_completion", (a) => {
    a.currentStage = "complete" as never;
  }],
  ["runtime_timeout", (a) => {
    a.runtimeTimedOut = true;
  }],
  ["mode_offer_accept", (a) => {
    a.modeOfferAccept = { mode: "practice", topic: "fractions" };
  }],
  ["practice_register", (a) => {
    a.studentMode = "practice" as never;
  }],
  ["advance_needs_lesson_mode", (a) => {
    a.studentMode = "discuss" as never;
    a.advanceAskedButCeilinged = true;
  }],
  ["attempt_not_graded_here", (a) => {
    a.studentMode = "discuss" as never;
    a.attemptCeilinged = true;
  }],
  ["question_answer", (a) => {
    a.routedKind = "question" as never;
  }],
  ["meta_reply", (a) => {
    a.routedKind = "meta" as never;
  }],
  ["tangent_engage", (a) => {
    a.routedKind = "tangent" as never;
  }],
  ["content_discuss", (a) => {
    a.requirements = req({ acknowledge: true });
    a.routedKind = "answer_attempt" as never;
  }],
  ["content_nudge", (a) => {
    a.requirements = req({ acknowledge: true });
    a.routedKind = "answer_attempt" as never;
    a.draftState.attempts = 4;
  }],
  ["revision_practice", (a) => {
    a.stepMode = "revision" as never;
  }],
  ["revision_concluded", (a) => {
    a.stepMode = "revision" as never;
    a.draftFlow = { stage: "complete", responseMode: "text", nextAction: "complete", choices: [] };
    a.gradedUnderstanding = { demonstrated: true, level: "solid", note: "" } as never;
  }],
  ["revision_stuck", (a) => {
    a.stepMode = "revision" as never;
    a.draftFlow = { stage: "complete", responseMode: "text", nextAction: "complete", choices: [] };
  }],
  ["understanding_demonstrated", (a) => {
    a.gradedUnderstanding = { demonstrated: true, level: "solid", note: "" } as never;
  }],
  ["inquiry_answer", (a) => {
    a.stepMode = "inquiry" as never;
    a.requirements = req({ acknowledge: true });
    a.draftState.question_count = 1;
  }],
  ["explanation_concluded", (a) => {
    a.stepMode = "explanation" as never;
    a.requirements = req({ acknowledge: true });
    a.draftState.acknowledged_at = T0;
  }],
  ["assessment_concluded", (a) => {
    a.stepMode = "assessment" as never;
    a.stepModeType = "open_ended";
    a.draftState.understanding_at = T0;
  }],
  ["assessment_miss", (a) => {
    a.stepMode = "assessment" as never;
    a.stepModeType = "open_ended";
    a.assessment = { score: 0, passed: false, feedback: "", source: "orchestrator" } as never;
  }],
  ["code_objective_met", (a) => {
    a.gradedCode = { demonstrated: true, level: "solid", note: "" } as never;
  }],
  ["step_concluding_stuck", (a) => {
    a.requirements = req({ understanding: true });
    a.draftFlow = { stage: "complete", responseMode: "text", nextAction: "complete", choices: [] };
    a.draftState.understanding_at = T0;
  }],
  ["quiz_first_presentation", (a) => {
    a.draftFlow = { stage: "assessment", responseMode: "multiple_choice", nextAction: "choose", choices: [] };
  }],
  ["quiz_passed", (a) => {
    a.answer = { mode: "multiple_choice", choice_id: "b" };
    a.assessment = { score: 1, passed: true, feedback: "", source: "orchestrator" } as never;
  }],
  ["quiz_wrong", (a) => {
    a.answer = { mode: "multiple_choice", choice_id: "c" };
    a.assessment = { score: 0, passed: false, feedback: "", source: "orchestrator" } as never;
    a.stepStateBefore.quiz_presented_at = T0;
    a.draftFlow = { stage: "assessment", responseMode: "multiple_choice", nextAction: "choose", choices: [] };
  }],
  ["quiz_active_chat", (a) => {
    a.stepStateBefore.quiz_presented_at = T0;
    a.draftFlow = { stage: "assessment", responseMode: "multiple_choice", nextAction: "choose", choices: [] };
  }],
  ["run_failed", (a) => {
    a.answer = { mode: "code", code: "print(1)" };
    a.assessment = { score: 0, passed: false, feedback: "", source: "orchestrator" } as never;
  }],
  ["readiness_ack", (a) => {
    a.answer = { mode: "text", text: "ready" };
  }],
  ["assessment_pending", (a) => {
    a.stepMode = "assessment" as never;
    a.stepModeType = "open_ended";
  }],
  ["explanation_pending", (a) => {
    a.requirements = req({ understanding: true });
  }],
  ["present_step_preempted", (a) => {
    a.presentedBefore = false;
    a.preemptedNote = "they spotted the purpose idea on step one";
  }],
  ["present_step", (a) => {
    a.presentedBefore = false;
    a.stepMode = "explanation" as never;
  }],
  ["converse", (_a) => {}],
];

Deno.test("directive: every rung of the ladder is reachable and keyed as documented", () => {
  for (const [key, mutate] of WITNESSES) {
    const args = baseArgs();
    mutate(args);
    const got = turnDirective(args).key;
    eq(got, key, `witness vector for '${key}' selected '${got}'`);
  }
});

// The `${stepMode}_concluded` template can only mint keys for modes that actually
// carry the acknowledge gate (requirementsFor is the coupling — the fuzz below derives
// requirements through it, so a phantom like "practice_concluded" would fail here).
const KNOWN_KEYS = new Set<string>([
  ...WITNESSES.map(([k]) => k),
  "media_concluded",
  "assignment_concluded",
  "inquiry_concluded",
]);

Deno.test("directive: fuzzing never leaves the known key set, and precedence holds", () => {
  const r = rng(0xd1c7);
  for (let i = 0; i < 2500; i++) {
    const a = baseArgs();
    a.currentStage = choice(r, ["practice", "assessment", "review", "complete"] as never[]);
    a.presentedBefore = r() < 0.8;
    if (!a.presentedBefore) a.stepStateBefore.presented_at = null;
    a.routedKind = choice(r, KINDS) as never;
    a.studentMode = choice(r, MODES) as never;
    a.stepMode = choice(r, [null, "explanation", "media", "assignment", "inquiry", "revision", "assessment", "practice"] as never[]);
    a.stepModeType =
      a.stepMode === "assessment"
        ? r() < 0.6
          ? "open_ended"
          : ""
        : r() < 0.2
          ? "applied"
          : "";
    // Requirements come from the REAL coupling (requirementsFor), not free random bits:
    // in production a practice step can never carry the acknowledge gate, so a fuzz
    // vector that invents one would test states the runtime cannot reach.
    a.requirements = requirementsFor(
      a.stepMode
        ? ({
            mode: a.stepMode,
            mode_type: a.stepModeType || undefined,
            response_mode: "text",
          } as never)
        : ({ response_mode: choice(r, ["text", "code"] as const) } as never),
      r() < 0.2 ? ({ choices: [{ id: "a" }, { id: "b" }] } as never) : null,
    );
    a.runtimeTimedOut = r() < 0.05;
    a.inRevisit = r() < 0.1;
    a.navAction = a.inRevisit ? (r() < 0.5 ? "revisit" : null) : r() < 0.05 ? "resume" : null;
    a.advanceAskedButCeilinged = r() < 0.1;
    a.attemptCeilinged = r() < 0.1;
    a.modeOfferAccept = r() < 0.08 ? { mode: "discuss", topic: "energy" } : null;
    a.gradedUnderstanding =
      r() < 0.2 ? ({ demonstrated: r() < 0.5, level: "partial", note: "" } as never) : null;
    a.draftState.attempts = Math.floor(r() * 6);
    a.draftState.acknowledged_at = r() < 0.3 ? T0 : null;
    a.draftState.understanding_at = r() < 0.3 ? T0 : null;
    a.stepStateBefore.quiz_presented_at = r() < 0.3 ? T0 : null;
    if (r() < 0.25) {
      a.draftFlow = { stage: "assessment", responseMode: "multiple_choice", nextAction: "choose", choices: [] };
    }
    if (r() < 0.3) {
      a.answer = choice(r, [
        { mode: "text", text: "ready" },
        { mode: "text", text: "why is it like that?" },
        { mode: "multiple_choice", choice_id: "a" },
        { mode: "code", code: "x" },
        null,
      ] as never[]);
    }

    const first = turnDirective(a);
    ok(KNOWN_KEYS.has(first.key), `unknown directive key '${first.key}'`);
    // Precedence: the navigation frames outrank everything.
    if (a.navAction === "revisit") eq(first.key, "revisit_open", "revisit control wins");
    else if (a.inRevisit) eq(first.key, "revisit_converse", "revisit frame wins");
    else if (a.navAction === "resume") eq(first.key, "resume_recap", "resume wins");
    // Determinism: same facts, same directive.
    const second = turnDirective(a);
    eq(second, first, "turnDirective must be a pure function of its arguments");
  }
});

// ---- readiness recognizers: the closed class stays closed ---------------------------
Deno.test("readiness: content-bearing text never matches either recognizer", () => {
  for (const text of [
    "yes, I think the answer is 4",
    "continue the story about mars",
    "let's go over my mistake",
    "ok so photosynthesis converts light",
    "I'm ready to talk about energy",
  ]) {
    ok(!CONTINUE_SIGNAL_RE.test(text) && !CONTINUE_PHRASE_RE.test(text), `must not match: ${text}`);
  }
  for (const text of ["yes", "Yes — let's head there!", "keep going", "next part"]) {
    ok(CONTINUE_SIGNAL_RE.test(text) || CONTINUE_PHRASE_RE.test(text), `must match: ${text}`);
  }
});
