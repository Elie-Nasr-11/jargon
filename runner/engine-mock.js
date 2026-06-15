// Mock flow engine for the conversational lesson-runner.
//
// Stands in for Codex's backend flow engine (B8) so the frontend can be built and
// demoed end-to-end now. It emits "turns" in the frozen contract the real `chat`
// edge function will produce:
//
//   { say, expected_mode: text|mcq|code|file|done, options?, starter?, grade?,
//     level?, progress:{index,total}, done?, final_grade? }
//
// Swap window.RunnerEngine for a thin wrapper around
// supabase.functions.invoke("chat", ...) when B8 lands — the runner UI is unchanged.
(function () {
  "use strict";

  var state = null;

  function delay(value, ms) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(value);
      }, ms || 500);
    });
  }

  // Authored, lesson-aware flow that exercises every answer mode and the Level 0-3
  // ladder. Real lesson content + grading come from the flow engine + curriculum.
  function buildSteps(lesson) {
    var title = lesson.title || "this lesson";
    var starter = lesson.sample_code || '// Try a little Jargon\nPRINT "Hello, Jargon"';
    return [
      {
        mode: "text",
        level: "Level 0 · Natural logic",
        say:
          "Let's begin with " + title +
          ". In your own words, what do you think it's about? A sentence or two is perfect.",
        grade: function (v) {
          v = (v || "").trim();
          if (v.length >= 14) return { score: 100, feedback: "Clear thinking — nice." };
          if (v.length > 0) return { score: 65, feedback: "Good start — try expanding it into a full thought." };
          return { score: 0, feedback: "Give it a go in your own words." };
        },
      },
      {
        mode: "mcq",
        level: "Level 1 · Structured language",
        say: "Which statement best captures the idea behind “" + title + "”?",
        options: [
          { id: "a", label: title + " is something we can reason about step by step." },
          { id: "b", label: "It's only about memorizing definitions." },
          { id: "c", label: "It has nothing to do with logic or process." },
        ],
        grade: function (v) {
          return v === "a"
            ? { score: 100, feedback: "Exactly — it's a process you can reason through." }
            : { score: 0, feedback: "Not quite — think about the process behind it." };
        },
      },
      {
        mode: "code",
        level: "Level 2 · Jargon",
        say:
          "Now turn the idea into Jargon. Edit the starter below, press Run to see the output, then Submit when you're happy.",
        starter: starter,
        grade: function (v) {
          return (v || "").trim().length > 0
            ? { score: 100, feedback: "Great — you turned an idea into runnable steps." }
            : { score: 0, feedback: "Write at least one line of Jargon, then submit." };
        },
      },
      {
        mode: "file",
        level: "Level 3 · Python bridge",
        say:
          "Optional last step: upload a short reflection — or your Python version of the idea. You can also just Submit to skip.",
        grade: function () {
          return { score: 100, feedback: "Thanks for sharing." };
        },
      },
    ];
  }

  function turnFor(index, grade) {
    var steps = state.steps;
    if (index >= steps.length) {
      var total = state.grades.length || 1;
      var avg = Math.round(state.grades.reduce(function (a, b) { return a + b; }, 0) / total);
      return {
        say: "That's the lesson — well done. You climbed from plain reasoning all the way to a code bridge.",
        expected_mode: "done",
        done: true,
        final_grade: avg,
        grade: grade || null,
        progress: { index: steps.length, total: steps.length },
      };
    }
    var s = steps[index];
    return {
      say: s.say,
      expected_mode: s.mode,
      options: s.options || null,
      starter: s.starter || null,
      grade: grade || null,
      level: s.level || null,
      progress: { index: index, total: steps.length },
    };
  }

  window.RunnerEngine = {
    start: function (lesson) {
      state = { lesson: lesson, steps: buildSteps(lesson), index: 0, grades: [] };
      return delay(turnFor(0, null), 350);
    },
    submit: function (answer) {
      if (!state) return Promise.resolve(turnFor(0, null));
      var step = state.steps[state.index];
      var g = step && step.grade ? step.grade(answer && answer.value) : { score: 100, feedback: "Got it." };
      state.grades.push(g.score);
      state.index += 1;
      return delay(turnFor(state.index, g), 500);
    },
  };
})();
