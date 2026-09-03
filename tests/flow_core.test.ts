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
  autoTierRoute,
  briskPace,
  CONTINUE_PHRASE_RE,
  CONTINUE_SIGNAL_RE,
  deriveTurn,
  emptyStepState,
  isSkipRequest,
  learnerSteer,
  pickProbe,
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
    studentMode: "lesson",
    modeOfferAccept: null,
    brainHints: { ...BRAIN_NONE },
  } as never;
}

// One witness vector per rung of the R64 ladder — executable documentation that every
// KEPT branch is reachable, in the ladder's own order. A rung nothing can reach is
// dead code; a changed key is a contract change. Both should fail loudly here. The
// dissolved conversational rungs have their own test below: their old trigger shapes
// must now yield the "brief" default (the flow world-brief + SYSTEM prompt carry
// those turns), and must NEVER mint their retired keys again.
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
  ["present_step", (a) => {
    a.presentedBefore = false;
    a.stepStateBefore.presented_at = null;
    a.stepMode = "assignment" as never;
    a.requirements = req({ acknowledge: true, work: true });
    (a as never as { stepWork: unknown }).stepWork = {
      kind: "assignment",
      title: "Label the computer parts",
    };
  }],
  ["await_step_work", (a) => {
    a.stepMode = "assignment" as never;
    a.requirements = req({ acknowledge: true, work: true });
    (a as never as { stepWork: unknown }).stepWork = {
      kind: "assignment",
      title: "Label the computer parts",
    };
  }],
  ["revision_stuck", (a) => {
    a.stepMode = "revision" as never;
    a.draftFlow = { stage: "complete", responseMode: "text", nextAction: "complete", choices: [] };
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
  ["assessment_pending", (a) => {
    a.stepMode = "assessment" as never;
    a.stepModeType = "open_ended";
  }],
  ["brief", (_a) => {}],
];

Deno.test("directive: every kept rung of the ladder is reachable and keyed as documented", () => {
  for (const [key, mutate] of WITNESSES) {
    const args = baseArgs();
    mutate(args);
    const got = turnDirective(args).key;
    eq(got, key, `witness vector for '${key}' selected '${got}'`);
  }
});

// R64 dissolution: each retired rung's old trigger shape, verbatim from the pre-R64
// witness list, must now fall through to the "brief" default — the flow brief plus
// the SYSTEM prompt's STEP TYPES / CONVERSATION FLOW / CLOSING A STEP rules carry
// those turns. If any of these ever selects its old key again, the ladder has grown
// a script back.
const DISSOLVED: Array<[string, (a: DirectiveArgs) => void]> = [
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
  ["readiness_ack", (a) => {
    a.answer = { mode: "text", text: "ready" };
  }],
  ["explanation_pending", (a) => {
    a.requirements = req({ understanding: true });
  }],
  ["present_step_preempted", (a) => {
    a.presentedBefore = false;
    a.stepStateBefore.presented_at = null;
  }],
  ["present_step_content", (a) => {
    a.presentedBefore = false;
    a.stepStateBefore.presented_at = null;
    a.stepMode = "explanation" as never;
  }],
  ["converse", (_a) => {}],
];

Deno.test("directive: every dissolved shape now yields the brief default", () => {
  for (const [old, mutate] of DISSOLVED) {
    const args = baseArgs();
    mutate(args);
    const got = turnDirective(args);
    eq(got.key, "brief", `dissolved '${old}' must fall to brief, selected '${got.key}'`);
    // R64.1: the brief default is genuinely EMPTY — the no-button denial moved to a
    // flow.room fact at the call site. Any text here is a rung growing back.
    eq(got.text, "", `brief carries no script (dissolved '${old}')`);
  }
});

Deno.test("R64.1: a correct quiz tap on a quiz-bearing revision step is a pass, not a stuck cap", () => {
  const args = baseArgs();
  args.stepMode = "revision" as never;
  args.requirements = req({ quiz: true, quizChoices: [{ id: "a" }] as never });
  args.answer = { mode: "multiple_choice", choice_id: "a" } as never;
  args.assessment = { score: 1, passed: true, feedback: "", source: "orchestrator" } as never;
  args.draftState.quiz_passed_at = T0;
  args.stepStateBefore.quiz_presented_at = T0;
  args.draftFlow = { stage: "complete", responseMode: "text", nextAction: "complete", choices: [] };
  const got = turnDirective(args);
  eq(got.key, "quiz_passed", "the pass owns the conclusion — never revision_stuck");
});

Deno.test("R64.1: the lesson way-back pill gets its own script, not the discuss one", () => {
  const args = baseArgs();
  args.modeOfferAccept = { mode: "lesson", topic: "pick the lesson back up" } as never;
  const got = turnDirective(args);
  eq(got.key, "mode_offer_accept", "the accept rung owns the tap");
  ok(got.text.includes("way BACK to the lesson"), "the lesson branch speaks");
  ok(!got.text.includes("discuss pill"), "the discuss script must not claim the lesson tap");
});

// The retired keys must never be minted again — by the fuzz (below, via KNOWN_KEYS)
// and by name here, so a partial revert fails loudly.
const KNOWN_KEYS = new Set<string>([...WITNESSES.map(([k]) => k)]);

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
    a.modeOfferAccept = r() < 0.08 ? { mode: "discuss", topic: "energy" } : null;
    // R48 linked work rides the fuzz too, coupled the way the loader couples it: only
    // work-mode steps carry stepWork, and requirements must agree (work: true).
    if ((a.stepMode === "assignment" || a.stepMode === "assessment") && r() < 0.3) {
      (a as never as { stepWork: unknown }).stepWork = {
        kind: a.stepMode === "assessment" ? "assessment" : "assignment",
        title: "Linked work item",
      };
      a.requirements = { ...req({ acknowledge: true }), work: true };
    }
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

// ---- R48: linked-work steps (work items as lesson steps) -----------------------------
Deno.test("R48: work gate holds stepDone false regardless of every other timestamp", () => {
  const r = rng(0x48a);
  for (let run = 0; run < 80; run++) {
    const state: StepState = {
      ...emptyStepState("a1"),
      presented_at: r() < 0.8 ? T0 : null,
      code_passed_at: r() < 0.5 ? T0 : null,
      quiz_passed_at: r() < 0.5 ? T0 : null,
      understanding_at: r() < 0.5 ? T0 : null,
      acknowledged_at: r() < 0.5 ? T0 : null,
    };
    ok(!stepDone(state, req({ work: true })), "work:true must hold the step in every state");
    const base = req({ acknowledge: r() < 0.5, quiz: r() < 0.5 });
    eq(
      stepDone(state, { ...base, work: false }),
      stepDone(state, base),
      "work:false must be identical to work-absent",
    );
  }
});

Deno.test("R48: requirementsFor with stepWork null is byte-identical to the two-arg call", () => {
  const activities = [
    null,
    { id: "a1", mode: "assignment" },
    { id: "a2", mode: "assessment", mode_type: "mcq" },
    { id: "a3", mode: "assessment", mode_type: "open_ended" },
    { id: "a4", mode: "explanation" },
    { id: "a5", mode: "practice", mode_type: "applied" },
    { id: "a6", response_mode: "code" },
  ];
  const quizzes = [null, { id: "q1", choices: [{ id: "c1" }, { id: "c2" }] }];
  for (const activity of activities) {
    for (const quiz of quizzes) {
      eq(
        requirementsFor(activity as never, quiz as never, null),
        requirementsFor(activity as never, quiz as never),
        `third-arg null must not change requirements (${JSON.stringify(activity)})`,
      );
    }
  }
});

Deno.test("R48: a linked work item replaces every in-chat gate with acknowledge + work", () => {
  const work = (satisfied: boolean | null) => ({
    kind: "assessment" as const,
    id: "w1",
    title: "Input devices check",
    status: "published",
    satisfied,
  });
  for (const mode of ["assignment", "assessment"]) {
    const activity = { id: "a1", mode, mode_type: mode === "assessment" ? "mcq" : "" };
    const quiz = { id: "q1", choices: [{ id: "c1" }, { id: "c2" }] };
    const pending = requirementsFor(activity as never, quiz as never, work(false));
    eq(
      { code: pending.code, quiz: pending.quiz, understanding: pending.understanding },
      { code: false, quiz: false, understanding: false },
      `linked ${mode} step must drop the in-chat gates`,
    );
    ok(pending.acknowledge, "linked steps keep the present→continue beat");
    ok(pending.work === true, "unsubmitted linked work must gate");
    ok(
      requirementsFor(activity as never, quiz as never, work(true)).work === false,
      "submitted linked work must not gate",
    );
    ok(
      requirementsFor(activity as never, quiz as never, work(null)).work === true,
      "unknown satisfaction must hold the step (fail-closed)",
    );
  }
  // Linked work on a NON-work mode is ignored (the loader never produces this, but the
  // pure function must not invent gates for it).
  eq(
    requirementsFor({ id: "a9", mode: "explanation" } as never, null, work(false)),
    requirementsFor({ id: "a9", mode: "explanation" } as never, null),
    "linked work must be inert on non-work modes",
  );
});

Deno.test("R48: the await_step_work rung fires only after presentation, on held work", () => {
  const baseArgs = {
    currentStage: "practice" as never,
    answer: null,
    stepStateBefore: emptyStepState("a1"),
    draftState: { ...emptyStepState("a1"), presented_at: T0 },
    draftFlow: { stage: "practice", responseMode: "text", nextAction: "reply", choices: [] } as never,
    requirements: req({ acknowledge: true, work: true }),
    activityMode: "text" as never,
    stepMode: "assignment" as never,
    stepModeType: "",
    gradedUnderstanding: null,
    gradedCode: null,
    runtimeTimedOut: false,
    assessment: null,
    attachedResources: [],
    routedKind: "answer_attempt" as never,
    inRevisit: false,
    navAction: null,
    studentMode: null,
    modeOfferAccept: null,
    stepWork: { kind: "assignment" as const, title: "Label the computer parts" },
    brainHints: {
      recallIdea: null,
      compress: false,
      practiceTarget: null,
      practiceStretch: null,
      figure: null,
      practiceBank: null,
    },
  };
  const presenting = turnDirective({ ...baseArgs, presentedBefore: false } as never);
  eq(presenting.key, "present_step", "first turn presents the work hand-off");
  ok(
    presenting.text.includes("Label the computer parts"),
    "presentation names the work item",
  );
  const held = turnDirective({ ...baseArgs, presentedBefore: true } as never);
  eq(held.key, "await_step_work", "held turns use the await rung");
  ok(held.text.includes("never collect answers in chat"), "await rung forbids chat collection");
  // R63/R64: an integrity gate refuses OUT LOUD — a skip-shaped message against held
  // work makes the await rung say plainly that submitting can't be skipped.
  const skipped = turnDirective({
    ...baseArgs,
    presentedBefore: true,
    answer: { mode: "text", text: "no can we move on now" },
  } as never);
  eq(skipped.key, "await_step_work", "a skip against held work stays on the await rung");
  ok(skipped.text.includes("can't be skipped"), "the refusal is spoken, not silent");
});

// ---- R63: mentor-steered pacing ----------------------------------------------------
// Elissar's session (prod transcript 689bd990, 2026-08-26): four verbatim skip
// requests never discharged a pacing gate. They are permanent fixtures — if one of
// these stops matching, her session happens again.
const ELISSAR_SKIPS = [
  "no can we move on now",
  "I said move on I dont want to name anything now. next part od the lesson",
  "gooooo next fast",
  "YESYESYEYSEYSYYSYSYSYSS",
] as const;
const NOT_SKIPS = [
  "no",
  "not yet",
  "no I'm not ready",
  "no I don't want to move on",
  "wait",
  "hold on",
  "green means go",
  "what comes next",
  "tell me what's next",
  "how about phone car backpack?",
  "I said no",
  "the purpose is to move people and things",
  "is this the entire lesson????",
  "I said don't move on",
] as const;

Deno.test("R63: every Elissar fixture reads as a skip request; refusals and answers never do", () => {
  for (const text of ELISSAR_SKIPS) {
    ok(isSkipRequest(text), `fixture must match: "${text}"`);
  }
  for (const text of NOT_SKIPS) {
    ok(!isSkipRequest(text), `must NOT match: "${text}"`);
  }
  // The polite-question form is a skip request even without a leading "no".
  ok(isSkipRequest("can we move on now"), "polite-question skip");
  ok(isSkipRequest("could we just skip this please"), "polite skip with please");
});

Deno.test("R63: mentor movement discharges pacing gates only — never code, quiz, or work", () => {
  const presented: StepState = { ...emptyStepState("a1"), presented_at: T0 };
  // Acknowledge gate: movement opens it even when the router filed the words as meta.
  const ack = applyTurn(
    presented,
    req({ acknowledge: true }),
    { mode: "text", text: "no can we move on now" } as never,
    null,
    null,
    T0,
    null,
    "meta" as never,
    "advance",
  );
  ok(Boolean(ack.acknowledged_at), "movement discharges the acknowledge gate over a meta routing");
  // Understanding gate: movement wraps the step like the stuck cap does.
  const und = applyTurn(
    presented,
    req({ understanding: true }),
    { mode: "text", text: "gooooo next fast" } as never,
    null,
    null,
    T0,
    null,
    "meta" as never,
    "advance",
  );
  ok(Boolean(und.understanding_at), "movement discharges the understanding gate");
  // Integrity gates: movement alone can never make the step done.
  for (const integrity of [req({ code: true }), req({ quiz: true, quizChoices: [{ id: "a" }] as never })]) {
    const out = applyTurn(
      presented,
      integrity,
      { mode: "text", text: "skip this" } as never,
      null,
      null,
      T0,
      null,
      "continue_signal" as never,
      "advance",
    );
    ok(!stepDone(out, integrity), "movement must not complete a code/quiz-gated step");
    eq(out.code_passed_at, null, "movement never passes code");
    eq(out.quiz_passed_at, null, "movement never passes a quiz");
  }
  const workReq: StepRequirements = { ...req({ acknowledge: true }), work: true };
  const work = applyTurn(
    presented,
    workReq,
    { mode: "text", text: "I said move on" } as never,
    null,
    null,
    T0,
    null,
    null,
    "advance",
  );
  ok(!stepDone(work, workReq), "movement must not complete a linked-work step");
});

Deno.test("R63: the router-outage fallback hears the impatient register too", () => {
  const presented: StepState = { ...emptyStepState("a1"), presented_at: T0 };
  for (const text of ELISSAR_SKIPS) {
    const out = applyTurn(
      presented,
      req({ acknowledge: true }),
      { mode: "text", text } as never,
      null,
      null,
      T0,
      null,
      null,
    );
    ok(Boolean(out.acknowledged_at), `router-null fallback must acknowledge: "${text}"`);
  }
  const refuse = applyTurn(
    presented,
    req({ acknowledge: true }),
    { mode: "text", text: "no I don't want to move on" } as never,
    null,
    null,
    T0,
    null,
    null,
  );
  eq(refuse.acknowledged_at, null, "a refusal must never acknowledge");
});

Deno.test("R63: a skip against live quiz options gets the spoken refusal", () => {
  const args = baseArgs();
  args.stepStateBefore.quiz_presented_at = T0;
  args.draftFlow = { stage: "assessment", responseMode: "multiple_choice", nextAction: "choose", choices: [] };
  args.answer = { mode: "text", text: "no can we move on now" } as never;
  const out = turnDirective(args);
  eq(out.key, "quiz_active_chat", "chat during a live quiz stays on the quiz rung");
  ok(out.text.includes("can't be skipped"), "the integrity refusal is spoken");
});

Deno.test("R63: briskPace trips on repeated skips and stays quiet otherwise", () => {
  const student = (content: string) => ({ role: "student", content, payload: {} });
  const mentor = (movement: string | null) => ({
    role: "mentor",
    content: "…",
    payload: movement ? { movement } : {},
  });
  ok(
    briskPace([mentor("advance"), student("gooooo next fast"), mentor(null)] as never),
    "two signals in the window are brisk",
  );
  ok(
    !briskPace([student("what does purpose mean"), mentor(null), student("ok")] as never),
    "ordinary conversation is not brisk",
  );
  ok(!briskPace([student("no can we move on now")] as never), "one signal alone is not brisk");
  // Signals age out: past the 8-turn window they stop counting.
  const old = Array.from({ length: 8 }, () => student("what about this part"));
  ok(
    !briskPace([...old, mentor("advance"), mentor("advance")] as never),
    "signals beyond the window no longer count",
  );
});


// R72: auto-tiering. The asymmetry is the whole safety argument — being wrong toward
// the benchmark costs money, being wrong toward the cheap lane costs a student their
// lesson. These pin that the cheap lane opens ONLY for turns the machine already
// decided, and that every teaching or judging shape stays on the benchmark.
Deno.test("R72: only machine-decided turns take the cheap lane", () => {
  const base = {
    presentsThisTurn: false,
    routedKind: null as string | null,
    answerMode: null as string | null,
    controlType: null as string | null,
    isTextExplanation: false,
    quizLive: false,
    inRevisit: false,
    helpRequest: false,
  };

  // --- the cheap lane, and only these ---
  eq(
    autoTierRoute({ ...base, answerMode: "multiple_choice" }),
    "mechanical",
    "a quiz tap the server already graded is mechanical",
  );
  eq(
    autoTierRoute({ ...base, controlType: "continue" }),
    "mechanical",
    "an explicit control press is mechanical",
  );
  eq(
    autoTierRoute({ ...base, routedKind: "continue_signal" }),
    "mechanical",
    "a plain move-on in prose is mechanical",
  );

  // --- teaching and judgment never go cheap ---
  eq(
    autoTierRoute({ ...base, presentsThisTurn: true, controlType: "continue" }),
    "default",
    "presenting new material outranks every mechanical signal",
  );
  eq(
    autoTierRoute({ ...base, isTextExplanation: true, routedKind: "continue_signal" }),
    "default",
    "grading prose outranks a continue signal",
  );
  eq(
    autoTierRoute({ ...base, inRevisit: true, answerMode: "multiple_choice" }),
    "default",
    "a revisit is re-teaching, never cheap",
  );
  eq(
    autoTierRoute({ ...base, helpRequest: true, controlType: "continue" }),
    "default",
    "a student saying they are lost is never answered by the cheap lane",
  );
  eq(
    autoTierRoute({ ...base, answerMode: "multiple_choice", quizLive: true }),
    "default",
    "a tap while a quiz is still live is not a settled grade",
  );

  // --- anything unrecognised routes UP ---
  eq(autoTierRoute(base), "default", "an unrecognised turn stays on the benchmark");
  eq(
    autoTierRoute({ ...base, routedKind: "question" }),
    "default",
    "a question is the benchmark's job",
  );
  eq(
    autoTierRoute({ ...base, routedKind: "answer_attempt", answerMode: "text" }),
    "default",
    "a typed attempt is judgment",
  );
  eq(
    autoTierRoute({ ...base, routedKind: "continue_signal", answerMode: "code" }),
    "default",
    "a continue signal carrying code is not a bare move-on",
  );
});

// --- R91: rubric §19 — the cognition profile steers the mentor --------------------
// learnerSteer turns a stored cognition profile into AT MOST TWO imperative moves for
// the mentor. These are the promises the §19 wiring makes: if one fails, a real student
// is being steered wrongly, so fix the steer rather than the assertion.

const profile = (over: Record<string, unknown> = {}) => ({
  retrieval: 3,
  organization: 3,
  reasoning: 3,
  elaboration: 3,
  vocabulary: 3,
  expression: 3,
  independence: 3,
  metacognition: 3,
  scaffold_earlier: 2,
  scaffold_recent: 2,
  turns_scored: 8,
  ...over,
});

Deno.test("R91: no profile, or too little evidence, steers nothing", () => {
  eq(learnerSteer(null), null, "a missing profile must not steer");
  eq(learnerSteer(undefined), null, "an absent profile must not steer");
  eq(
    learnerSteer(profile({ turns_scored: 2, retrieval: 0 })),
    null,
    "two judged responses is below the floor — one bad answer must not set a posture",
  );
});

Deno.test("R91: never more than two moves (EXACTLY ONE ASK survives)", () => {
  const steer = learnerSteer(
    profile({
      retrieval: 1,
      organization: 1,
      reasoning: 1,
      elaboration: 1,
      vocabulary: 1,
      expression: 1,
      metacognition: 1,
      independence: 1,
    }),
  );
  eq(steer!.moves.length, 2, "every dimension weak still yields a short, ordered list");
});

Deno.test("R91: dependency outranks everything (§19's first rule)", () => {
  const steer = learnerSteer(
    profile({ independence: 1, retrieval: 0, scaffold_recent: 4, scaffold_earlier: 4 }),
  );
  ok(
    steer!.moves[0].startsWith("REDUCE ASSISTANCE"),
    "low production UNDER heavy help means the AI is doing the thinking — cut help first",
  );
});

Deno.test("R91: low independence WITHOUT heavy help is not dependency", () => {
  const steer = learnerSteer(
    profile({ independence: 1, retrieval: 0, scaffold_recent: 0, scaffold_earlier: 0 }),
  );
  ok(
    !steer!.moves.some((move: string) => move.startsWith("REDUCE ASSISTANCE")),
    "never cut help a student was not actually given",
  );
  ok(steer!.moves[0].startsWith("RETRIEVAL FIRST"), "steer the weak dimension instead");
});

Deno.test("R91: mastery fades scaffolding and introduces transfer (§19's last rule)", () => {
  const steer = learnerSteer(profile());
  eq(steer!.moves.length, 1, "a mastering student needs one move, not a list");
  ok(steer!.moves[0].startsWith("FADE AND TRANSFER"), "strong work earns transfer, not more scaffolding");
});

Deno.test("R91: the weakest dimension is steered first", () => {
  const steer = learnerSteer(profile({ elaboration: 0, vocabulary: 2, independence: 2 }));
  ok(
    steer!.moves[0].startsWith("ASK THEM TO DEVELOP IT"),
    "elaboration at 0 outranks vocabulary at 2",
  );
});

Deno.test("R91: §18 — weak expression beside strong reasoning asks for a reformulation", () => {
  const steer = learnerSteer(profile({ expression: 1, reasoning: 4, independence: 2 }));
  ok(
    steer!.moves[0].startsWith("ASK THEM TO REFORMULATE"),
    "sound thinking in poor wording is a language fix, not a teaching one",
  );
});

Deno.test("R91: §18 — weak expression AND weak reasoning steers the reasoning", () => {
  const steer = learnerSteer(profile({ expression: 1, reasoning: 1, independence: 2 }));
  ok(
    !steer!.moves.some((move: string) => move.startsWith("ASK THEM TO REFORMULATE")),
    "language weakness must never be mistaken for weak thinking",
  );
  ok(steer!.moves[0].startsWith("MAKE THEM REASON"), "the reasoning is what needs work here");
});

Deno.test("R91: a move never carries a score, a number, or the word rubric", () => {
  // The student experiences the CHANGE, never the measurement (docs/COGNITION.md).
  const cases = [
    profile({ retrieval: 0, independence: 1, scaffold_recent: 4 }),
    profile({ elaboration: 1, vocabulary: 1 }),
    profile({ expression: 0, reasoning: 4 }),
    profile(),
  ];
  for (const row of cases) {
    for (const move of learnerSteer(row)!.moves) {
      ok(!/\d/.test(move), `a move must carry no digits: ${move}`);
      ok(!/rubric|score|dimension/i.test(move), `a move must not name the measurement: ${move}`);
    }
  }
});

Deno.test("R91: the scaffold trend reads the direction of help over time", () => {
  eq(
    learnerSteer(profile({ scaffold_earlier: 4, scaffold_recent: 1 }))!.scaffold_trend,
    "falling",
    "less help over time is the trend we want",
  );
  eq(
    learnerSteer(profile({ scaffold_earlier: 1, scaffold_recent: 4, independence: 1 }))!
      .scaffold_trend,
    "rising",
    "more help over time is the dependency warning",
  );
  eq(
    learnerSteer(profile({ scaffold_earlier: null, scaffold_recent: null }))!.scaffold_trend,
    null,
    "no trend without two halves to compare",
  );
});


// ---------------------------------------------------------------------------
// R100: the delayed unaided ask (§10 transfer, §11 retention, §20).
//
// pickProbe only CHOOSES which idea to ask about; whether to ask at all is the handler's,
// because it needs reads a pure function cannot do. These are the promises the choosing
// makes — and each one, broken, produces a question that measures nothing: an idea the
// student has never met, one they were taught ten minutes ago, or a different idea every
// time the database returns rows in a different order.

const HOUR = 3_600_000;
const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

const idea = (key: string, title = key) => ({ key, title });
const evidence = (key: string, hoursAgo: number, score: number, attempts = 2) => ({
  idea_key: key,
  score,
  attempts,
  last_evidence_at: ago(hoursAgo),
});

const probeInput = (over: Record<string, unknown> = {}) => ({
  mastery: [evidence("photosynthesis", 48, 0.5)],
  ideas: [idea("photosynthesis", "How plants eat light")],
  lessonIdeaKeys: [] as string[],
  sessionStartedAt: ago(1),
  now: NOW,
  ...over,
});

Deno.test("R100: an idea with no evidence is never probed", () => {
  eq(
    pickProbe(probeInput({ mastery: [evidence("photosynthesis", 48, 0.5, 0)] })),
    null,
    "no attempts means nothing to remember — that is a first lesson, not a recall check",
  );
});

Deno.test("R100: an idea met inside this very session is never probed", () => {
  eq(
    pickProbe(
      probeInput({ mastery: [evidence("photosynthesis", 0.5, 0.5)], sessionStartedAt: ago(1) }),
    ),
    null,
    "evidence from this sitting is not delayed retrieval, it is a comprehension check",
  );
});

Deno.test("R100: an idea younger than the gap is never probed", () => {
  eq(
    pickProbe(probeInput({ mastery: [evidence("photosynthesis", 3, 0.5)], sessionStartedAt: null })),
    null,
    "three hours is not a delay",
  );
  const ok = pickProbe(
    probeInput({ mastery: [evidence("photosynthesis", 30, 0.5)], sessionStartedAt: null }),
  );
  eq(ok?.idea_key, "photosynthesis", "past the gap it is fair game");
});

Deno.test("R100: an idea with no published title is never probed", () => {
  eq(
    pickProbe(probeInput({ ideas: [] })),
    null,
    "a probe names the idea out loud, so an untitled key cannot be asked",
  );
});

Deno.test("R100: mastery decides which QUESTION gets asked", () => {
  eq(
    pickProbe(probeInput({ mastery: [evidence("photosynthesis", 48, 0.4)] }))?.kind,
    "retention",
    "a fading idea is asked what they remember",
  );
  eq(
    pickProbe(probeInput({ mastery: [evidence("photosynthesis", 48, 0.95)] }))?.kind,
    "transfer",
    "an idea they own is asked where else it applies",
  );
});

Deno.test("R100: fading beats mastered, and related beats unrelated", () => {
  const pick = pickProbe(
    probeInput({
      mastery: [evidence("solid", 48, 0.95), evidence("fading", 48, 0.4)],
      ideas: [idea("solid"), idea("fading")],
    }),
  );
  eq(pick?.idea_key, "fading", "a delayed check is most informative where knowledge is going");

  const related = pickProbe(
    probeInput({
      mastery: [evidence("far", 48, 0.45), evidence("near", 48, 0.45)],
      ideas: [idea("far"), idea("near")],
      lessonIdeaKeys: ["near"],
    }),
  );
  eq(related?.idea_key, "near", "at equal strength, ask about what today is about");
});

Deno.test("R100: the same inputs always choose the same idea", () => {
  const rows = [
    evidence("alpha", 48, 0.5),
    evidence("beta", 48, 0.5),
    evidence("gamma", 48, 0.5),
  ];
  const ideas = [idea("alpha"), idea("beta"), idea("gamma")];
  const forward = pickProbe(probeInput({ mastery: rows, ideas }));
  const backward = pickProbe(probeInput({ mastery: [...rows].reverse(), ideas }));
  eq(
    forward?.idea_key,
    backward?.idea_key,
    "row order is a database detail; it must not decide what a child is asked",
  );
});

Deno.test("R100: nothing to ask about is a valid answer", () => {
  eq(pickProbe(probeInput({ mastery: [] })), null, "no evidence anywhere means no probe");
});

Deno.test("R100: a failed delayed check outranks the in-lesson medians", () => {
  // Reasoning is the only dimension the lesson itself flagged, and retrieval looks fine
  // in the room — but they could not retrieve it a day later, so retrieval leads.
  const steer = learnerSteer(profile({ reasoning: 2, retention: 1 }));
  eq(
    steer!.moves[0].startsWith("RETRIEVAL FIRST"),
    true,
    "a failed delayed check IS a retrieval finding, whatever the in-lesson median says",
  );
  eq(steer!.moves.length <= 2, true, "the two-move cap is not negotiable");
  eq(
    learnerSteer(profile({ reasoning: 2 }))!.moves[0].startsWith("MAKE THEM REASON"),
    true,
    "without a failed check the weakest in-lesson dimension still leads",
  );
});

Deno.test("R100: nobody is called mastered on evidence a day old that failed", () => {
  const strong = { retrieval: 4, reasoning: 4, independence: 4 };
  eq(
    learnerSteer(profile({ ...strong }))!.moves[0].startsWith("FADE AND TRANSFER"),
    true,
    "strong in-lesson work still fades when nothing contradicts it",
  );
  for (const [label, over] of [
    ["retention", { retention: 1 }],
    ["transfer", { transfer: 1 }],
  ] as const) {
    const steer = learnerSteer(profile({ ...strong, ...over }))!;
    eq(
      steer.moves.some((m) => m.startsWith("FADE AND TRANSFER")),
      false,
      `a failed ${label} check is the §14 case: supported proficiency is not proficiency`,
    );
    // Blocking the fade is not enough. A measurement that changes nothing is the exact
    // failure §19 exists to prevent, so the mentor is told what to do instead.
    eq(
      steer.moves.some((m) => m.startsWith("CONSOLIDATE, DO NOT FADE")),
      true,
      `a failed ${label} check must produce a move, not silence`,
    );
    eq(steer.moves.length <= 2, true, "the two-move cap still holds");
  }
});

Deno.test("R100: a probe turn asks and does not teach", () => {
  const directive = turnDirective({
    currentStage: "teach",
    answer: null,
    presentedBefore: false,
    stepStateBefore: emptyStepState("a1"),
    draftState: emptyStepState("a1"),
    draftFlow: { stage: "teach", responseMode: "text", nextAction: "reply", choices: [] },
    requirements: requirementsFor({ response_mode: "text" }),
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
    studentMode: null,
    modeOfferAccept: null,
    brainHints: {
      recallIdea: null,
      compress: false,
      practiceTarget: null,
      practiceStretch: null,
      figure: null,
      practiceBank: null,
    },
    probeAsk: { kind: "retention" as const, title: "How plants eat light" },
  } as never);
  eq(directive.key, "probe_opener", "the probe owns the whole reply");
  eq(
    directive.key === "present_step" || directive.key === "brief",
    false,
    "presentsThisTurn accepts only those two keys — a probe turn must not present the step",
  );
  eq(directive.text.includes("EXACTLY ONE question"), true, "one ask, as always");
  eq(directive.text.includes("no hint"), true, "unaided is the whole point of the measurement");
});
