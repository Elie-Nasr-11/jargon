// Interpreter pane — the Jargon code editor.
// Calls the Supabase `run` edge function (which proxies the Jargon engine) and
// persists runs to the code_submissions table. Surfaces the full engine result
// shape ({ output, errors, status, limits_hit, ask, ask_var }) and degrades
// gracefully to the older { result, ask } shape. Exposes
// window.Editor.{ init(opts), setLesson(lesson) }.
(function () {
  "use strict";

  let client, getUser;
  let textarea, statusEl, output, errorsEl, askField, askInput;
  let cm = null; // CodeMirror instance, if available
  let currentLesson = null;
  let code = "";
  let answers = [];
  let askVar = null;
  let running = false;

  // ---- A tiny Jargon syntax mode for CodeMirror 5 (optional) -------------
  function defineJargonMode() {
    if (!window.CodeMirror || !CodeMirror.defineSimpleMode) return false;
    if (CodeMirror.modes && CodeMirror.modes.jargon) return true;
    CodeMirror.defineSimpleMode("jargon", {
      start: [
        { regex: /\/\/.*/, token: "comment" },
        { regex: /#.*/, token: "comment" },
        { regex: /"(?:[^\\"]|\\.)*"?/, token: "string" },
        {
          regex: /\b(?:SET|PRINT|ASK|ADD|REMOVE|IF|THEN|ELSE|END|REPEAT_UNTIL|REPEAT_FOR_EACH|REPEAT|BREAK)\b/i,
          token: "keyword",
        },
        {
          regex: /\b(?:AND|OR|NOT|is|in|to|from|as|times|greater|less|than|equal|even|odd|reaches|of)\b/i,
          token: "operator",
        },
        { regex: /\b(?:True|False|None)\b/, token: "atom" },
        { regex: /\b\d+(?:\.\d+)?\b/, token: "number" },
      ],
      meta: { lineComment: "#" },
    });
    return true;
  }

  function init(opts) {
    client = opts.client;
    getUser = opts.getUser;
    const root = opts.root;

    textarea = root.querySelector("#inputCode");
    statusEl = root.querySelector("#run-status");
    output = root.querySelector("#output");
    errorsEl = root.querySelector("#errors");
    askField = root.querySelector("#askField");
    askInput = root.querySelector("#askInput");

    // Progressive enhancement: swap the textarea for CodeMirror if it loaded.
    if (defineJargonMode()) {
      try {
        cm = CodeMirror.fromTextArea(textarea, {
          mode: "jargon",
          lineNumbers: true,
          lineWrapping: true,
          indentUnit: 2,
          tabSize: 2,
          smartIndent: false,
          extraKeys: { "Ctrl-Enter": sendCode, "Cmd-Enter": sendCode },
        });
        cm.setSize(null, "auto");
      } catch (e) {
        cm = null; // fall back to the textarea
      }
    }
    if (!cm) {
      textarea.addEventListener("keydown", tabIndent);
      textarea.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          sendCode();
        }
      });
    }

    root.querySelector("#runBtn").addEventListener("click", sendCode);
    root.querySelector("#resetBtn").addEventListener("click", resetToSample);
    root.querySelector("#submitAnswer").addEventListener("click", sendAnswer);
    root.querySelector("#copyInput").addEventListener("click", copyInput);
    root.querySelector("#copyOutput").addEventListener("click", copyOutput);

    askInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendAnswer();
      }
    });
  }

  function getCode() {
    return cm ? cm.getValue() : textarea.value;
  }

  function setCode(text) {
    if (cm) cm.setValue(text || "");
    else textarea.value = text || "";
  }

  async function setLesson(lesson) {
    currentLesson = lesson;
    clearRunState();
    const saved = await loadLatest(lesson.id);
    setCode((saved && saved.code) || lesson.sample_code || "");
  }

  async function loadLatest(lessonId) {
    const user = getUser();
    if (!user) return null;
    const { data, error } = await client
      .from("code_submissions")
      .select("code, output, created_at")
      .eq("user_id", user.id)
      .eq("lesson_id", lessonId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error("Failed to load submissions:", error);
      return null;
    }
    return (data && data[0]) || null;
  }

  async function saveSubmission(outputText) {
    const user = getUser();
    if (!user || !currentLesson) return;
    const { error } = await client
      .from("code_submissions")
      .insert({ user_id: user.id, lesson_id: currentLesson.id, code, output: outputText });
    if (error) console.error("Failed to save submission:", error);
  }

  // Normalize both the new ({output,errors,status,...}) and old ({result,ask})
  // engine response shapes into one object the UI can render.
  function normalize(data) {
    const out = data.output || data.result || [];
    const outArr = Array.isArray(out) ? out : [out];
    const errors = Array.isArray(data.errors) ? data.errors : [];
    let status = data.status;
    if (!status) {
      if (data.ask) status = "waiting_for_input";
      else if (errors.length) status = "error";
      else status = "ok";
    }
    return {
      output: outArr,
      errors,
      status,
      ask: data.ask || null,
      askVar: data.ask_var || null,
      limitsHit: Array.isArray(data.limits_hit) ? data.limits_hit : [],
      truncated: !!data.truncated,
    };
  }

  async function callEngine(persist) {
    if (running) return;
    running = true;
    setStatus("running", "Running…");
    try {
      const { data, error } = await client.functions.invoke("run", {
        body: { code, answers },
      });
      if (error) throw error;

      const r = normalize(data || {});

      renderOutput(r.output);
      renderErrors(r.errors, r.limitsHit, r.truncated);
      setStatus(statusKind(r.status), statusLabel(r.status));

      const waiting = r.status === "waiting_for_input" || !!r.ask;
      askVar = waiting ? r.askVar : null;
      askField.classList.toggle("active", waiting);
      if (waiting) {
        askInput.placeholder = r.ask || "Your answer";
        askInput.value = "";
        askInput.focus();
      }

      if (persist) saveSubmission(r.output.join("\n"));
    } catch (err) {
      renderOutput([]);
      renderErrors([`Could not reach the engine: ${err.message || err}`], [], false);
      setStatus("error", "Error");
    } finally {
      running = false;
    }
  }

  function sendCode() {
    code = getCode().trim();
    if (!code) {
      renderOutput([]);
      renderErrors(["Nothing to run — write some Jargon first."], [], false);
      setStatus("error", "Empty");
      return;
    }
    answers = [];
    askVar = null;
    askField.classList.remove("active");
    callEngine(true);
  }

  function sendAnswer() {
    if (!askVar) return;
    answers.push(askInput.value);
    callEngine(false);
  }

  // ---- Rendering --------------------------------------------------------
  function setStatus(kind, label) {
    statusEl.className = "status-badge " + (kind || "");
    statusEl.textContent = label || "";
  }

  function statusKind(status) {
    if (status === "ok") return "ok";
    if (status === "waiting_for_input") return "waiting";
    if (status === "limit_exceeded") return "limit";
    return "error"; // error, sandbox_error, anything else
  }

  function statusLabel(status) {
    return (
      {
        ok: "Success",
        error: "Error",
        waiting_for_input: "Waiting for input",
        limit_exceeded: "Limit reached",
        sandbox_error: "Sandbox error",
      }[status] || status || ""
    );
  }

  function renderOutput(lines) {
    output.innerHTML = "";
    (lines && lines.length ? lines : []).forEach((line) => {
      const div = document.createElement("div");
      div.className = "response-line";
      div.textContent = String(line);
      output.appendChild(div);
    });
    output.classList.remove("highlight");
    // restart the flash animation
    void output.offsetWidth;
    output.classList.add("highlight");
    output.scrollTop = output.scrollHeight;
  }

  function renderErrors(errors, limitsHit, truncated) {
    errorsEl.innerHTML = "";
    (errors || []).forEach((e) => {
      const div = document.createElement("div");
      div.textContent = String(e);
      errorsEl.appendChild(div);
    });
    if (limitsHit && limitsHit.length) {
      const div = document.createElement("div");
      div.className = "limits-note";
      div.textContent = `Limits reached: ${limitsHit.join(", ")}`;
      errorsEl.appendChild(div);
    }
    if (truncated) {
      const div = document.createElement("div");
      div.className = "limits-note";
      div.textContent = "Output was truncated.";
      errorsEl.appendChild(div);
    }
  }

  function copyInput() {
    navigator.clipboard.writeText(getCode()).then(() => flashStatus("Input copied"));
  }

  function copyOutput() {
    navigator.clipboard.writeText(output.textContent).then(() => flashStatus("Output copied"));
  }

  function flashStatus(msg) {
    const prevClass = statusEl.className;
    const prevText = statusEl.textContent;
    setStatus("ok", msg);
    setTimeout(() => {
      statusEl.className = prevClass;
      statusEl.textContent = prevText;
    }, 900);
  }

  function clearRunState() {
    answers = [];
    askVar = null;
    askInput.value = "";
    askField.classList.remove("active");
    output.innerHTML = "";
    errorsEl.innerHTML = "";
    setStatus("", "");
  }

  function resetToSample() {
    clearRunState();
    setCode((currentLesson && currentLesson.sample_code) || "");
  }

  function tabIndent(e) {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = this.selectionStart;
      const end = this.selectionEnd;
      this.value = this.value.substring(0, start) + "  " + this.value.substring(end);
      this.selectionStart = this.selectionEnd = start + 2;
    }
  }

  window.Editor = { init, setLesson };
})();
