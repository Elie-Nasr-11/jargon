// Conversational lesson-runner UI.
//
// Renders the guided conversation that IS the lesson: AI turns + the right input
// affordance per turn (text / multiple-choice / code / file), a progress bar,
// grading, and a completion card. Talks to window.RunnerEngine (currently the mock;
// later a wrapper around the `chat` flow-engine edge function). Exposes
// window.LessonRunner.{ init(opts), start(lesson) }.
(function () {
  "use strict";

  var client, getUser, root;
  var lessonEl, levelEl, fillEl, progLabel, transcript, dock;
  var currentLesson = null;
  var busy = false;

  function engine() {
    return window.RunnerEngine;
  }

  function init(opts) {
    client = opts.client;
    getUser = opts.getUser;
    root = opts.root;
    if (!root) return;
    root.innerHTML =
      '<div class="runner-head">' +
      '  <div class="runner-title"><span id="runner-lesson"></span>' +
      '  <span id="runner-level" class="level-chip"></span></div>' +
      '  <div class="progress"><div id="progress-fill" class="progress-fill"></div></div>' +
      '  <div id="progress-label" class="progress-label"></div>' +
      "</div>" +
      '<div id="runner-transcript" class="transcript" aria-live="polite"></div>' +
      '<div id="runner-dock" class="dock"></div>';
    lessonEl = root.querySelector("#runner-lesson");
    levelEl = root.querySelector("#runner-level");
    fillEl = root.querySelector("#progress-fill");
    progLabel = root.querySelector("#progress-label");
    transcript = root.querySelector("#runner-transcript");
    dock = root.querySelector("#runner-dock");
  }

  async function start(lesson) {
    if (!root || !engine()) return;
    currentLesson = lesson;
    busy = false;
    lessonEl.textContent = lesson.title || "Lesson";
    levelEl.textContent = "";
    transcript.innerHTML = "";
    dock.innerHTML = "";
    setProgress({ index: 0, total: 1 });
    try {
      render(await engine().start(lesson));
    } catch (e) {
      bubble("ai", "Couldn't start the lesson. Try again.", "Jargon Mentor");
    }
  }

  // ---- helpers ----------------------------------------------------------
  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  function btn(label, fn, cls) {
    var b = el("button", cls);
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function reveal(node) {
    if (window.Motion) window.Motion.reveal(node);
  }

  function setProgress(p) {
    var total = p.total || 1;
    var pct = Math.round((p.index / total) * 100);
    if (fillEl) fillEl.style.width = pct + "%";
    if (progLabel)
      progLabel.textContent =
        p.index >= total ? "Complete" : "Step " + Math.min(p.index + 1, total) + " of " + total;
  }

  function bubble(kind, html, who) {
    var div = el("div", "bubble " + kind);
    if (who) {
      var w = el("div", "who");
      w.textContent = who;
      div.appendChild(w);
    }
    var body = el("div");
    body.innerHTML = html;
    div.appendChild(body);
    transcript.appendChild(div);
    transcript.scrollTop = transcript.scrollHeight;
    reveal(div);
    return div;
  }

  function gradeChip(g) {
    if (!g) return "";
    var cls = g.score >= 80 ? "pass" : g.score >= 50 ? "partial" : "fail";
    return (
      '<span class="grade-chip ' + cls + '">' + g.score + " / 100 — " + esc(g.feedback || "") + "</span><br>"
    );
  }

  // ---- rendering --------------------------------------------------------
  function render(turn) {
    busy = false;
    if (turn.level && levelEl) levelEl.textContent = turn.level;
    if (turn.progress) setProgress(turn.progress);
    bubble("ai", gradeChip(turn.grade) + esc(turn.say), "Jargon Mentor");
    if (turn.done) {
      renderCompletion(turn);
      return;
    }
    renderDock(turn);
  }

  function renderDock(turn) {
    dock.innerHTML = "";
    var mode = turn.expected_mode;

    if (mode === "text") {
      var ta = el("textarea");
      ta.placeholder = "Type your answer…";
      ta.rows = 3;
      ta.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          submitText(ta.value);
        }
      });
      var row = el("div", "dock-row");
      row.appendChild(btn("Send", function () { submitText(ta.value); }));
      dock.appendChild(ta);
      dock.appendChild(row);
    } else if (mode === "mcq") {
      var wrap = el("div", "options");
      (turn.options || []).forEach(function (o) {
        wrap.appendChild(
          btn(o.label, function () { chooseOption(o); }, "option-btn")
        );
      });
      dock.appendChild(wrap);
    } else if (mode === "code") {
      var code = el("textarea", "code-input");
      code.value = turn.starter || "";
      code.spellcheck = false;
      var out = el("div", "runner-output");
      code.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          runCode(code.value, out);
        } else if (e.key === "Tab") {
          e.preventDefault();
          var s = code.selectionStart;
          var en = code.selectionEnd;
          code.value = code.value.slice(0, s) + "  " + code.value.slice(en);
          code.selectionStart = code.selectionEnd = s + 2;
        }
      });
      var row2 = el("div", "dock-row");
      row2.appendChild(btn("Run", function () { runCode(code.value, out); }, "secondary"));
      row2.appendChild(btn("Submit", function () { submitCode(code.value); }));
      dock.appendChild(code);
      dock.appendChild(row2);
      dock.appendChild(out);
    } else if (mode === "file") {
      var file = el("input");
      file.type = "file";
      var row3 = el("div", "dock-row");
      row3.appendChild(file);
      row3.appendChild(btn("Submit", function () { submitFile(file); }));
      dock.appendChild(row3);
    }
    reveal(dock);
  }

  function renderCompletion(turn) {
    dock.innerHTML = "";
    var c = el("div", "completion");
    c.innerHTML =
      '<div class="score">' + (turn.final_grade != null ? turn.final_grade : "—") + " / 100</div>" +
      "<p>Lesson complete.</p>";
    var row = el("div", "dock-row");
    row.style.justifyContent = "center";
    row.appendChild(btn("Retry lesson", function () { start(currentLesson); }));
    c.appendChild(row);
    dock.appendChild(c);
    reveal(c);
  }

  // ---- answer handlers --------------------------------------------------
  function submitText(v) {
    if (busy || !(v || "").trim()) return;
    bubble("me", esc(v), "You");
    next({ mode: "text", value: v });
  }
  function chooseOption(o) {
    if (busy) return;
    bubble("me", esc(o.label), "You");
    next({ mode: "mcq", value: o.id });
  }
  function submitCode(v) {
    if (busy) return;
    bubble("me", "<em>Submitted code</em>", "You");
    next({ mode: "code", value: v });
  }
  function submitFile(input) {
    if (busy) return;
    var name = input.files && input.files[0] ? input.files[0].name : "(skipped)";
    bubble("me", esc(name), "You");
    next({ mode: "file", value: name });
  }

  function lockDock() {
    Array.prototype.forEach.call(dock.querySelectorAll("button, textarea, input"), function (x) {
      x.disabled = true;
    });
  }

  async function next(answer) {
    busy = true;
    lockDock();
    var thinking = el("div", "bubble ai");
    thinking.innerHTML = '<div class="who">Jargon Mentor</div><div class="dots">…</div>';
    transcript.appendChild(thinking);
    transcript.scrollTop = transcript.scrollHeight;
    try {
      var turn = await engine().submit(answer);
      thinking.remove();
      render(turn);
    } catch (e) {
      thinking.remove();
      busy = false;
      bubble("ai", "Hmm, something went wrong — try that again.", "Jargon Mentor");
    }
  }

  // Code answer mode runs against the real `run` edge function. The engine isn't
  // deployed yet, so failures render gracefully and don't block submitting.
  async function runCode(code, out) {
    out.textContent = "Running…";
    try {
      var res = await client.functions.invoke("run", { body: { code: code, answers: [] } });
      if (res.error) throw res.error;
      var d = res.data || {};
      var lines = d.output || d.result || [];
      if (!Array.isArray(lines)) lines = [lines];
      var errs = Array.isArray(d.errors) ? d.errors : [];
      var text = (lines.join("\n") + (errs.length ? "\n" + errs.join("\n") : "")).trim();
      out.textContent = text || "[no output]";
    } catch (err) {
      out.textContent = "[engine not reachable yet] " + (err.message || err);
    }
  }

  window.LessonRunner = { init: init, start: start };
})();
