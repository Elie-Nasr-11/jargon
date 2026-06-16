// App controller — auth gate, lesson loading, overlay menus, and mentor
// preferences for the flat runtime shell.
document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey || cfg.anonKey.indexOf("PASTE") === 0) {
    document.body.innerHTML =
      "<p style='padding:2rem;font-family:Inter,sans-serif;color:#fff;background:#000'>Supabase is not configured yet. " +
      "Set <code>url</code> and <code>anonKey</code> in <code>config.js</code>.</p>";
    return;
  }

  const client = window.supabase.createClient(cfg.url, cfg.anonKey);
  const MENTOR_PREFS_KEY = "jargon.mentorPreferences";
  const DEFAULT_MENTOR_PREFS = {
    pace: "balanced",
    tone: "neutral",
    hint_level: "medium",
  };

  const authView = document.getElementById("auth-view");
  const appView = document.getElementById("app-view");
  const select = document.getElementById("lesson-select");
  const userLabel = document.getElementById("user-label");
  const currentLessonLabel = document.getElementById("current-lesson-label");
  const lessonTitleValue = document.getElementById("lesson-title-value");
  const lessonModuleValue = document.getElementById("lesson-module-value");
  const lessonLevelValue = document.getElementById("lesson-level-value");
  const progressLesson = document.getElementById("progress-lesson");
  const progressStage = document.getElementById("progress-stage");
  const progressStep = document.getElementById("progress-step");
  const progressScore = document.getElementById("progress-score");
  const progressMode = document.getElementById("progress-mode");
  const progressStatus = document.getElementById("progress-status");
  const progressFeedback = document.getElementById("progress-feedback");
  const mentorPace = document.getElementById("mentor-pace");
  const mentorTone = document.getElementById("mentor-tone");
  const mentorHintLevel = document.getElementById("mentor-hint-level");
  const mentorSummary = document.getElementById("mentor-summary");
  const backdrop = document.getElementById("panel-backdrop");
  const panels = {
    lessons: document.getElementById("panel-lessons"),
    progress: document.getElementById("panel-progress"),
    mentor: document.getElementById("panel-mentor"),
  };
  const navButtons = {
    lessons: document.getElementById("nav-lessons"),
    progress: document.getElementById("nav-progress"),
    mentor: document.getElementById("nav-mentor"),
  };

  let lessons = [];
  let currentUser = null;
  let currentLesson = null;
  let runnerState = null;
  let mentorPreferences = loadMentorPreferences();

  Auth.init(client);
  hydrateMentorControls();

  const runnerEngine =
    typeof window.makeRunnerEngine === "function"
      ? window.makeRunnerEngine(client, { getMentorPreferences })
      : window.RunnerEngineMock;

  LessonRunner.init({
    root: document.getElementById("runner-root"),
    client,
    getUser: () => currentUser,
    engine: runnerEngine,
    fallback: window.RunnerEngineMock,
    onStateChange: handleRunnerState,
  });

  client.auth.onAuthStateChange((_event, session) => {
    const user = session ? session.user : null;
    const wasSignedIn = !!currentUser;
    currentUser = user;
    if (user && !wasSignedIn) showApp();
    else if (!user) showAuth();
  });

  client.auth.getSession().then(({ data }) => {
    currentUser = data.session ? data.session.user : null;
    if (currentUser) showApp();
    else showAuth();
  });

  Object.keys(navButtons).forEach((name) => {
    navButtons[name].addEventListener("click", () => togglePanel(name));
  });

  backdrop.addEventListener("click", closePanels);
  document.querySelectorAll("[data-close-panel]").forEach((button) => {
    button.addEventListener("click", closePanels);
  });

  select.addEventListener("change", (event) => {
    applyLesson(event.target.value);
    closePanels();
  });

  mentorPace.addEventListener("change", saveMentorPreferencesFromUi);
  mentorTone.addEventListener("change", saveMentorPreferencesFromUi);
  mentorHintLevel.addEventListener("change", saveMentorPreferencesFromUi);

  function showAuth() {
    closePanels();
    authView.style.display = "flex";
    appView.style.display = "none";
  }

  async function showApp() {
    authView.style.display = "none";
    appView.style.display = "grid";
    await loadProfileLabel();
    if (!lessons.length) await loadLessons();
    if (lessons.length) {
      const nextLesson =
        currentLesson && lessons.some((lesson) => lesson.id === currentLesson.id)
          ? currentLesson.id
          : lessons[0].id;
      select.value = nextLesson;
      applyLesson(nextLesson);
    }
  }

  async function loadProfileLabel() {
    userLabel.textContent = currentUser.email;
    const { data } = await client
      .from("profiles")
      .select("name, grade")
      .eq("id", currentUser.id)
      .maybeSingle();
    if (data && data.name) {
      userLabel.textContent = data.grade ? `${data.name} (${data.grade})` : data.name;
    }
  }

  async function loadLessons() {
    const { data, error } = await client.from("lessons").select("*").order("position");
    if (error) {
      console.error("Failed to load lessons:", error);
      return;
    }
    lessons = data || [];
    select.innerHTML = "";
    lessons.forEach((lesson) => {
      const option = document.createElement("option");
      option.value = lesson.id;
      option.textContent = lesson.module ? `${lesson.module}: ${lesson.title}` : lesson.title;
      select.appendChild(option);
    });
  }

  function applyLesson(id) {
    const lesson = lessons.find((entry) => entry.id === id);
    if (!lesson) return;
    currentLesson = lesson;
    renderLessonSummary();
    renderProgressSummary();
    LessonRunner.start(lesson);
  }

  function renderLessonSummary() {
    if (!currentLesson) return;
    currentLessonLabel.textContent = `${currentLesson.module || "Course"} / ${currentLesson.title}`;
    lessonTitleValue.textContent = currentLesson.title || "-";
    lessonModuleValue.textContent = currentLesson.module || "-";
    lessonLevelValue.textContent = currentLesson.level || "-";
  }

  function handleRunnerState(nextState) {
    runnerState = nextState;
    renderProgressSummary();
  }

  function renderProgressSummary() {
    progressLesson.textContent = currentLesson ? currentLesson.title : "-";
    progressStage.textContent = runnerState && runnerState.stageLabel ? runnerState.stageLabel : "-";
    progressStep.textContent = runnerState && runnerState.progressLabel ? runnerState.progressLabel : "-";

    if (runnerState && typeof runnerState.finalGrade === "number") {
      progressScore.textContent = `${runnerState.finalGrade}`;
    } else if (runnerState && runnerState.grade && typeof runnerState.grade.score === "number") {
      progressScore.textContent = `${runnerState.grade.score}`;
    } else {
      progressScore.textContent = "-";
    }

    progressMode.textContent =
      runnerState && runnerState.expectedMode && runnerState.expectedMode !== "done"
        ? runnerState.expectedMode
        : "-";
    progressStatus.textContent =
      runnerState && runnerState.preview ? runnerState.preview : "Live";
    progressFeedback.textContent =
      runnerState && runnerState.feedback ? runnerState.feedback : "No activity yet.";
  }

  function togglePanel(name) {
    if (!panels[name]) return;
    const shouldOpen = panels[name].hidden;
    closePanels();
    if (!shouldOpen) return;
    panels[name].hidden = false;
    backdrop.hidden = false;
    navButtons[name].setAttribute("aria-expanded", "true");
  }

  function closePanels() {
    Object.keys(panels).forEach((name) => {
      panels[name].hidden = true;
      navButtons[name].setAttribute("aria-expanded", "false");
    });
    backdrop.hidden = true;
  }

  function loadMentorPreferences() {
    try {
      const raw = localStorage.getItem(MENTOR_PREFS_KEY);
      if (!raw) return { ...DEFAULT_MENTOR_PREFS };
      const parsed = JSON.parse(raw);
      return {
        pace: validPreference(parsed.pace, ["brief", "balanced", "guided"], DEFAULT_MENTOR_PREFS.pace),
        tone: validPreference(parsed.tone, ["neutral", "encouraging"], DEFAULT_MENTOR_PREFS.tone),
        hint_level: validPreference(
          parsed.hint_level,
          ["low", "medium", "high"],
          DEFAULT_MENTOR_PREFS.hint_level
        ),
      };
    } catch (_err) {
      return { ...DEFAULT_MENTOR_PREFS };
    }
  }

  function validPreference(value, values, fallback) {
    return values.indexOf(value) >= 0 ? value : fallback;
  }

  function hydrateMentorControls() {
    mentorPace.value = mentorPreferences.pace;
    mentorTone.value = mentorPreferences.tone;
    mentorHintLevel.value = mentorPreferences.hint_level;
    renderMentorSummary();
  }

  function renderMentorSummary() {
    mentorSummary.textContent =
      `Next mentor turn: ${mentorPreferences.pace} pace, ${mentorPreferences.tone} tone, ${mentorPreferences.hint_level} hints.`;
  }

  function saveMentorPreferencesFromUi() {
    mentorPreferences = {
      pace: mentorPace.value,
      tone: mentorTone.value,
      hint_level: mentorHintLevel.value,
    };
    localStorage.setItem(MENTOR_PREFS_KEY, JSON.stringify(mentorPreferences));
    renderMentorSummary();
  }

  function getMentorPreferences() {
    return { ...mentorPreferences };
  }
});
