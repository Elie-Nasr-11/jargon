// Mentor pane — the AI tutor chat.
// Calls the Supabase `chat` edge function and persists the conversation to the
// chat_messages table (RLS scopes rows to the signed-in user).
// Exposes window.Mentor.{ init(opts), setLesson(lesson) }.
(function () {
  "use strict";

  let client, getUser;
  let chatContainer, inputField, form;
  let currentLesson = null;
  let chatHistory = [];

  function init(opts) {
    client = opts.client;
    getUser = opts.getUser;
    const root = opts.root;

    chatContainer = root.querySelector("#chat-container");
    inputField = root.querySelector("#user-input");
    form = root.querySelector("#chat-form");

    form.addEventListener("submit", sendMessage);
    inputField.addEventListener("input", autoGrow);
    inputField.addEventListener("keydown", tabIndent);
  }

  function lessonContext(lesson) {
    const meta = [];
    if (lesson.module) meta.push(`Module: ${lesson.module}`);
    if (lesson.level) meta.push(`Level: ${lesson.level}`);
    const header = `Current lesson: ${lesson.title}${meta.length ? " (" + meta.join(", ") + ")" : ""}.`;
    return `${header}\n\n${lesson.tutor_prompt || ""}`;
  }

  async function setLesson(lesson) {
    currentLesson = lesson;
    chatHistory = [{ role: "system", content: lessonContext(lesson) }];
    chatContainer.innerHTML = "";

    const saved = await loadSaved(lesson.id);
    if (saved.length) {
      saved.forEach((m) => {
        chatHistory.push({ role: m.role, content: m.content });
        appendMessage(m.role, m.content, false);
      });
    } else {
      appendMessage("assistant", `You are now speaking to the mentor for ${lesson.title}.`);
    }
  }

  async function loadSaved(lessonId) {
    const user = getUser();
    if (!user) return [];
    const { data, error } = await client
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("user_id", user.id)
      .eq("lesson_id", lessonId)
      .in("role", ["user", "assistant"])
      .order("created_at");
    if (error) {
      console.error("Failed to load chat history:", error);
      return [];
    }
    return data || [];
  }

  async function saveMessage(role, content) {
    const user = getUser();
    if (!user || !currentLesson) return;
    const { error } = await client
      .from("chat_messages")
      .insert({ user_id: user.id, lesson_id: currentLesson.id, role, content });
    if (error) console.error("Failed to save message:", error);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function formatText(text) {
    return escapeHtml(text)
      .replace(/```(\w+)?\n?([^`]+)```/g, (_, lang, codeText) =>
        `<pre><code>${lang ? lang + "\n" : ""}${codeText}</code></pre><button class="copy-button">Copy</button>`)
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  function appendMessage(role, text, animated) {
    const div = document.createElement("div");
    const label = role === "user" ? "You: " : "Jargon Mentor: ";
    div.className = role === "user" ? "user" : "assistant";

    chatContainer.querySelectorAll("div").forEach((el) => el.classList.add("older"));

    div.textContent = label;

    const contentDiv = document.createElement("div");
    contentDiv.style.fontWeight = "300";
    contentDiv.style.whiteSpace = "pre-wrap";

    const formatted = formatText(text);

    if (animated && role === "assistant") {
      let index = 0;
      chatContainer.classList.add("flash");
      (function typeChar() {
        contentDiv.innerHTML = formatted.slice(0, index++);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        if (index <= formatted.length) {
          requestAnimationFrame(typeChar);
        } else {
          chatContainer.classList.remove("flash");
          setTimeout(addCopyListeners, 100);
        }
      })();
    } else {
      contentDiv.innerHTML = formatted;
      setTimeout(addCopyListeners, 100);
    }

    div.appendChild(contentDiv);
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function addCopyListeners() {
    document.querySelectorAll(".copy-button").forEach((btn) => {
      btn.onclick = () => {
        const codeBlock = btn.previousElementSibling.querySelector("code");
        if (!codeBlock) return;
        navigator.clipboard.writeText(codeBlock.innerText).then(() => {
          btn.innerText = "Copied!";
          setTimeout(() => (btn.innerText = "Copy"), 1000);
        });
      };
    });
  }

  async function sendMessage(event) {
    event.preventDefault();
    const message = inputField.value.trim();
    if (!message) return;

    inputField.value = "";
    autoGrow.call(inputField);

    appendMessage("user", message);
    chatHistory.push({ role: "user", content: message });
    saveMessage("user", message);

    inputField.classList.add("flash-border");
    setTimeout(() => inputField.classList.remove("flash-border"), 300);

    try {
      const { data, error } = await client.functions.invoke("chat", {
        body: { messages: chatHistory },
      });
      if (error) throw error;
      const reply = (data && data.reply) || "No response.";
      appendMessage("assistant", reply, true);
      chatHistory.push({ role: "assistant", content: reply });
      saveMessage("assistant", reply);
    } catch (err) {
      appendMessage("assistant", `[ERROR] ${err.message}`);
    }
  }

  function autoGrow() {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 130) + "px";
  }

  function tabIndent(e) {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = this.selectionStart;
      const end = this.selectionEnd;
      this.setRangeText("  ", start, end, "end");
    }
  }

  window.Mentor = { init, setLesson };
})();
