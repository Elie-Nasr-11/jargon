// Adapter engine: drives the lesson-runner against Codex's real `chat` flow engine.
//
// Request  : { lesson_id, session_id?, answer:{ mode, text?, code?, choice_id?, run_result? } }
// Envelope : { status, reply, session_id, stage, response_mode, choices, exercise,
//              assessment, next_action, guardrail }
//
// It maps that envelope onto the runner's turn shape and throws on a non-typed /
// error response so the runner can fall back to the local preview (mock) engine
// until the backend (migrations + OPENAI_API_KEY + deployed chat) is live.
(function () {
  "use strict";

  var MODE_TO_RUNNER = { text: "text", code: "code", multiple_choice: "mcq", file: "file" };
  var MODE_TO_API = { text: "text", code: "code", mcq: "multiple_choice", file: "file" };
  var STAGE_ORDER = ["intro", "teach", "practice", "assessment", "review"];

  function normChoices(choices) {
    if (!Array.isArray(choices) || !choices.length) return null;
    return choices.map(function (c, i) {
      if (c && typeof c === "object") {
        var id = c.id != null ? c.id : c.value != null ? c.value : i;
        var label = c.label != null ? c.label : c.text != null ? c.text : c.title != null ? c.title : id;
        return { id: String(id), label: String(label) };
      }
      return { id: String(c), label: String(c) };
    });
  }

  function toTurn(env, lesson) {
    var mode = MODE_TO_RUNNER[env.response_mode] || "text";
    var done = env.stage === "complete" || env.next_action === "complete";
    var idx = STAGE_ORDER.indexOf(env.stage);
    if (idx < 0) idx = 0;
    var total = STAGE_ORDER.length;

    var grade = null;
    if (env.assessment && typeof env.assessment === "object") {
      var a = env.assessment;
      grade = {
        score: typeof a.score === "number" ? a.score : null,
        passed: typeof a.passed === "boolean" ? a.passed : null,
        feedback: typeof a.feedback === "string" ? a.feedback : "",
      };
    }

    var starter = "";
    if (env.exercise && typeof env.exercise === "object") {
      starter = env.exercise.starter || env.exercise.code || env.exercise.starter_code || "";
    }
    if (!starter && mode === "code") starter = (lesson && lesson.sample_code) || "";

    var stageLabel = env.stage ? env.stage.charAt(0).toUpperCase() + env.stage.slice(1) : "";

    return {
      say: env.reply || "",
      expected_mode: done ? "done" : mode,
      options: normChoices(env.choices),
      starter: starter || null,
      grade: grade,
      level: stageLabel ? "Stage · " + stageLabel : null,
      progress: { index: done ? total : idx, total: total },
      done: done,
      final_grade: done && grade && typeof grade.score === "number" ? grade.score : null,
    };
  }

  function isEnvelope(d) {
    return (
      d &&
      typeof d === "object" &&
      typeof d.reply === "string" &&
      typeof d.response_mode === "string" &&
      typeof d.stage === "string" &&
      d.status !== "error"
    );
  }

  function toApiAnswer(answer) {
    if (!answer) return undefined;
    var mode = MODE_TO_API[answer.mode] || "text";
    var out = { mode: mode };
    if (mode === "text") out.text = String(answer.value || "");
    else if (mode === "code") out.code = String(answer.value || "");
    else if (mode === "multiple_choice") out.choice_id = String(answer.value || "");
    // file mode is deferred server-side; nothing meaningful to send yet
    if (answer.run_result) out.run_result = answer.run_result;
    return out;
  }

  window.makeRunnerEngine = function (client) {
    var sessionId = null;
    var lesson = null;

    async function call(body) {
      var res = await client.functions.invoke("chat", { body: body });
      if (res.error) throw res.error;
      var d = res.data;
      if (!isEnvelope(d)) throw new Error("chat returned a non-typed response");
      if (d.session_id) sessionId = String(d.session_id);
      return toTurn(d, lesson);
    }

    return {
      start: function (l) {
        lesson = l;
        sessionId = null;
        return call({ lesson_id: l.id });
      },
      submit: function (answer) {
        return call({ lesson_id: lesson.id, session_id: sessionId, answer: toApiAnswer(answer) });
      },
    };
  };
})();
