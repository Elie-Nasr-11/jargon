// Conversational lesson-runner UI for the focused cinematic shell.
(function () {
  "use strict";

  var client, root, onStateChange;
  var shellEl, lessonEl, levelEl, modeEl, fillEl, progLabel, transcript, dock;
  var currentLesson = null;
  var busy = false;
  var primaryEngine, fallbackEngine, activeEngine;

  function init(opts) {
    client = opts.client;
    root = opts.root;
    onStateChange = typeof opts.onStateChange === "function" ? opts.onStateChange : null;
    primaryEngine = opts.engine || window.RunnerEngineMock;
    fallbackEngine = opts.fallback || window.RunnerEngineMock;
    activeEngine = primaryEngine;
    if (!root) return;

    root.innerHTML =
      '<div class="runner-shell">' +
      '  <section class="runner-meta">' +
      '    <div class="runner-meta-top">' +
      '      <div class="runner-meta-copy">' +
      '        <span class="runner-kicker">Current lesson</span>' +
      '        <span id="runner-lesson" class="runner-lesson"></span>' +
      "      </div>" +
      '      <div class="runner-state">' +
      '        <span id="runner-level" class="runner-chip"></span>' +
      '        <span id="runner-mode" class="runner-chip"></span>' +
      "      </div>" +
      "    </div>" +
      '    <div class="runner-meta-row">' +
      '      <span id="progress-label" class="runner-progress-label"></span>' +
      "    </div>" +
      '    <div class="progress"><div id="progress-fill" class="progress-fill"></div></div>' +
      "  </section>" +
      '  <section id="runner-transcript" class="transcript" aria-live="polite" data-compact="true"></section>' +
      '  <section id="runner-dock" class="dock"></section>' +
      "</div>";

    shellEl = root.querySelector(".runner-shell");
    lessonEl = root.querySelector("#runner-lesson");
    levelEl = root.querySelector("#runner-level");
    modeEl = root.querySelector("#runner-mode");
    fillEl = root.querySelector("#progress-fill");
    progLabel = root.querySelector("#progress-label");
    transcript = root.querySelector("#runner-transcript");
    dock = root.querySelector("#runner-dock");
  }

  async function start(lesson) {
    if (!root) return;
    currentLesson = lesson;
    busy = false;
    activeEngine = primaryEngine;
    lessonEl.textContent = lesson.title || "Lesson";
    levelEl.textContent = "";
    modeEl.textContent = "";
    transcript.innerHTML = "";
    dock.innerHTML = "";
    dock.dataset.mode = "";
    shellEl.dataset.mode = "";
    root.__lastRunResult = null;
    syncTranscriptDensity();
    setProgress({ index: 0, total: 1 });
    bubble("ai", "Syncing lesson…", "Jargon Mentor");

    try {
      transcript.innerHTML = "";
      syncTranscriptDensity();
      render(await activeEngine.start(lesson));
    } catch (_err) {
      if (fallbackEngine && fallbackEngine !== activeEngine) {
        activeEngine = fallbackEngine;
        modeEl.textContent = "Preview";
        try {
          render(await activeEngine.start(lesson));
          return;
        } catch (_fallbackErr) {
          /* fall through */
        }
      }
      busy = false;
      bubble("ai", "Lesson could not start.", "Jargon Mentor");
    }
  }

  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  function btn(label, fn, cls) {
    var node = el("button", cls);
    node.type = "button";
    node.textContent = label;
    node.addEventListener("click", fn);
    return node;
  }

  function esc(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function setProgress(progress) {
    var total = Math.max(progress.total || 1, 1);
    var current = Math.min(Math.max(progress.index + 1, 1), total);
    var pct = Math.round((current / total) * 100);
    fillEl.style.width = pct + "%";
    progLabel.textContent = progress.index >= total ? "Complete" : "Step " + current + " of " + total;
  }

  function syncTranscriptDensity() {
    transcript.dataset.compact = transcript.children.length <= 2 ? "true" : "false";
  }

  function bubble(kind, html, who) {
    var wrapper = el("div", "bubble " + kind);
    if (who) {
      var label = el("div", "who");
      label.textContent = who;
      wrapper.appendChild(label);
    }
    var body = el("div", "bubble-body");
    body.innerHTML = html;
    wrapper.appendChild(body);
    transcript.appendChild(wrapper);
    syncTranscriptDensity();
    transcript.scrollTop = transcript.scrollHeight;
    window.Motion?.reveal(wrapper);
    return wrapper;
  }

  function gradeChip(grade) {
    if (!grade) return "";
    var cls =
      grade.passed === true ? "pass" : grade.passed === false ? "fail" : grade.score >= 80 ? "pass" : grade.score >= 50 ? "partial" : "fail";
    var score = typeof grade.score === "number" ? String(grade.score) : "";
    var feedback = grade.feedback || "";
    return '<span class="grade-chip ' + cls + '">' + esc([score, feedback].filter(Boolean).join(" / ")) + "</span>";
  }

  function render(turn) {
    busy = false;
    levelEl.textContent = turn.level || "";
    if (!modeEl.textContent) modeEl.textContent = "";
    if (turn.progress) setProgress(turn.progress);
    bubble("ai", (gradeChip(turn.grade) ? gradeChip(turn.grade) + "<br>" : "") + esc(turn.say), "Jargon Mentor");
    if (turn.done) {
      renderCompletion(turn);
    } else {
      renderDock(turn);
    }
    publishState(turn);
  }

  function renderDock(turn) {
    dock.innerHTML = "";
    var mode = turn.expected_mode;
    dock.dataset.mode = mode || "";
    shellEl.dataset.mode = mode || "";
    root.__lastRunResult = null;

    if (mode === "text") {
      var text = el("textarea");
      text.rows = 3;
      text.placeholder = "Type your answer";
      text.addEventListener("keydown", function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          submitText(text.value);
        }
      });
      var textRow = el("div", "dock-row");
      textRow.appendChild(btn("Send", function () { submitText(text.value); }));
      dock.appendChild(text);
      dock.appendChild(textRow);
      window.Motion?.dockMode(dock);
      return;
    }

    if (mode === "mcq") {
      var options = el("div", "options");
      (turn.options || []).forEach(function (option) {
        options.appendChild(btn(option.label, function () { chooseOption(option); }, "option-btn"));
      });
      dock.appendChild(options);
      window.Motion?.dockMode(dock);
      return;
    }

    if (mode === "code") {
      var code = el("textarea", "code-input");
      var output = el("div", "runner-output");
      code.value = turn.starter || "";
      code.spellcheck = false;
      code.addEventListener("input", function () {
        root.__lastRunResult = null;
      });
      code.addEventListener("keydown", function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          runCode(code.value, output);
        } else if (event.key === "Tab") {
          event.preventDefault();
          var start = code.selectionStart;
          var end = code.selectionEnd;
          code.value = code.value.slice(0, start) + "  " + code.value.slice(end);
          code.selectionStart = code.selectionEnd = start + 2;
        }
      });
      var codeRow = el("div", "dock-row");
      codeRow.appendChild(btn("Run", function () { runCode(code.value, output); }, "secondary"));
      codeRow.appendChild(btn("Submit", function () { submitCode(code.value); }));
      dock.appendChild(code);
      dock.appendChild(codeRow);
      dock.appendChild(output);
      window.Motion?.dockMode(dock);
      return;
    }

    if (mode === "file") {
      var file = el("input");
      file.type = "file";
      var fileRow = el("div", "dock-row");
      fileRow.appendChild(file);
      fileRow.appendChild(btn("Submit", function () { submitFile(file); }));
      dock.appendChild(fileRow);
      window.Motion?.dockMode(dock);
    }
  }

  function renderCompletion(turn) {
    dock.innerHTML = "";
    dock.dataset.mode = "done";
    shellEl.dataset.mode = "done";
    var completion = el("div", "completion");
    var score = el("div", "score");
    score.textContent = turn.final_grade != null ? String(turn.final_grade) : "—";
    completion.appendChild(score);
    var text = el("p");
    text.textContent = "Lesson complete.";
    completion.appendChild(text);
    var row = el("div", "dock-row");
    row.appendChild(btn("Retry lesson", function () { start(currentLesson); }));
    completion.appendChild(row);
    dock.appendChild(completion);
    window.Motion?.dockMode(dock);
  }

  function submitText(value) {
    if (busy || !(value || "").trim()) return;
    bubble("me", esc(value), "You");
    next({ mode: "text", value: value });
  }

  function chooseOption(option) {
    if (busy) return;
    bubble("me", esc(option.label), "You");
    next({ mode: "mcq", value: option.id });
  }

  function submitCode(value) {
    if (busy) return;
    bubble("me", "<em>Submitted code</em>", "You");
    var answer = { mode: "code", value: value };
    if (root.__lastRunResult) answer.run_result = root.__lastRunResult;
    next(answer);
  }

  function submitFile(input) {
    if (busy) return;
    var name = input.files && input.files[0] ? input.files[0].name : "(skipped)";
    bubble("me", esc(name), "You");
    next({ mode: "file", value: name });
  }

  function lockDock() {
    Array.prototype.forEach.call(dock.querySelectorAll("button, textarea, input"), function (node) {
      node.disabled = true;
    });
  }

  async function next(answer) {
    busy = true;
    lockDock();
    var thinking = bubble("ai", '<span class="dots">…</span>', "Jargon Mentor");
    try {
      var turn = await activeEngine.submit(answer);
      thinking.remove();
      syncTranscriptDensity();
      render(turn);
    } catch (_err) {
      thinking.remove();
      syncTranscriptDensity();
      busy = false;
      bubble("ai", "Something went wrong. Try again.", "Jargon Mentor");
    }
  }

  async function runCode(code, out) {
    out.textContent = "Running...";
    try {
      var res = await client.functions.invoke("run", { body: { code: code, answers: [] } });
      if (res.error) throw res.error;
      var data = res.data || {};
      root.__lastRunResult = data;
      var lines = data.output || data.result || [];
      if (!Array.isArray(lines)) lines = [lines];
      var errs = Array.isArray(data.errors) ? data.errors : [];
      var text = (lines.join("\n") + (errs.length ? "\n" + errs.join("\n") : "")).trim();
      out.textContent = text || "[no output]";
      window.Motion?.pulseOutput(out);
    } catch (err) {
      out.textContent = "[engine not reachable] " + (err.message || err);
    }
  }

  function publishState(turn) {
    if (!onStateChange) return;
    onStateChange({
      lessonId: currentLesson && currentLesson.id ? currentLesson.id : "",
      lessonTitle: currentLesson && currentLesson.title ? currentLesson.title : "",
      module: currentLesson && currentLesson.module ? currentLesson.module : "",
      lessonLevel: currentLesson && currentLesson.level ? currentLesson.level : "",
      stage: turn && turn.stage ? turn.stage : "",
      stageLabel: levelEl.textContent || "",
      progressLabel: progLabel.textContent || "",
      progress: turn && turn.progress ? turn.progress : null,
      grade: turn && turn.grade ? turn.grade : null,
      feedback: turn && turn.grade && turn.grade.feedback ? turn.grade.feedback : turn && turn.say ? turn.say : "",
      done: !!(turn && turn.done),
      finalGrade: turn && turn.final_grade != null ? turn.final_grade : null,
      preview: modeEl.textContent || "",
      expectedMode: turn && turn.expected_mode ? turn.expected_mode : "",
      reply: turn && turn.say ? turn.say : "",
    });
  }

  window.LessonRunner = { init: init, start: start };
})();
