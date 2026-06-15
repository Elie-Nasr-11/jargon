// Interpreter pane — the Jargon code editor.
// Calls the Supabase `run` edge function (which proxies the Jargon engine) and
// persists runs to the code_submissions table. Supports the engine's interactive
// "ask" protocol. Exposes window.Editor.{ init(opts), setLesson(lesson) }.
(function () {
  "use strict";

  let client, getUser;
  let textarea, output, askField, askInput;
  let currentLesson = null;
  let code = "";
  let answers = [];
  let askVar = null;

  function init(opts) {
    client = opts.client;
    getUser = opts.getUser;
    const root = opts.root;

    textarea = root.querySelector("#inputCode");
    output = root.querySelector("#output");
    askField = root.querySelector("#askField");
    askInput = root.querySelector("#askInput");

    root.querySelector("#runBtn").addEventListener("click", sendCode);
    root.querySelector("#resetBtn").addEventListener("click", resetAll);
    root.querySelector("#submitAnswer").addEventListener("click", sendAnswer);
    root.querySelector("#copyInput").addEventListener("click", copyInput);
    root.querySelector("#copyOutput").addEventListener("click", copyOutput);

    textarea.addEventListener("keydown", tabIndent);
    askInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendAnswer();
      }
    });
  }

  async function setLesson(lesson) {
    currentLesson = lesson;
    resetAll();
    const saved = await loadLatest(lesson.id);
    textarea.value = (saved && saved.code) || lesson.sample_code || "";
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

  async function callEngine(persist) {
    try {
      const { data, error } = await client.functions.invoke("run", {
        body: { code, answers },
      });
      if (error) throw error;

      askField.style.display = data.ask ? "flex" : "none";
      askVar = data.ask ? data.ask_var : null;

      if (data.ask) {
        askInput.placeholder = data.ask;
        askInput.value = "";
        askInput.focus();
      }

      const result = data.result || "[No output returned]";
      appendStyledOutput(result);
      highlightOutput();

      if (persist) {
        saveSubmission(Array.isArray(result) ? result.join("\n") : String(result));
      }
    } catch (err) {
      appendStyledOutput(`[ERROR] ${err.message}`);
    }
  }

  function sendCode() {
    code = textarea.value.trim();
    answers = [];
    askVar = null;
    askField.style.display = "none";
    callEngine(true);
  }

  function sendAnswer() {
    if (!askVar) return;
    answers.push(askInput.value);
    callEngine(false);
  }

  function typeOutput(text, container, index, callback) {
    if (index < text.length) {
      container.textContent += text.charAt(index);
      setTimeout(() => typeOutput(text, container, index + 1, callback), 15);
    } else {
      container.textContent += "\n\n";
      if (callback) callback();
    }
  }

  function fadeOldResponses() {
    output.querySelectorAll("div.response-line").forEach((line) => {
      line.style.color = "var(--text)";
      line.style.fontWeight = "normal";
      line.style.fontSize = "0.8em";
    });
  }

  function appendStyledOutput(lines) {
    if (!Array.isArray(lines)) lines = [lines];
    fadeOldResponses();
    lines.forEach((line) => {
      const div = document.createElement("div");
      div.className = "response-line";
      div.style.marginTop = "1em";
      output.appendChild(div);
      typeOutput(String(line), div, 0, () => (output.scrollTop = output.scrollHeight));
    });
  }

  function highlightOutput() {
    output.classList.add("highlight");
    setTimeout(() => output.classList.remove("highlight"), 300);
  }

  function copyInput() {
    navigator.clipboard.writeText(textarea.value).then(() => flash("[Input copied]"));
  }

  function copyOutput() {
    navigator.clipboard.writeText(output.textContent).then(() => flash("[Output copied]"));
  }

  function flash(msg) {
    const old = output.textContent;
    output.textContent = msg;
    output.classList.add("flash");
    setTimeout(() => {
      output.textContent = old;
      output.classList.remove("flash");
    }, 600);
  }

  function resetAll() {
    textarea.value = "";
    output.innerHTML = "";
    answers = [];
    askVar = null;
    askInput.value = "";
    askField.style.display = "none";
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
