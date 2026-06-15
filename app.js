// App controller — creates the Supabase client, gates on auth, loads lessons, and
// drives the conversational lesson-runner (the split-view Mentor/Interpreter is legacy).
document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey || cfg.anonKey.indexOf("PASTE") === 0) {
    document.body.innerHTML =
      "<p style='padding:2rem;font-family:sans-serif'>Supabase is not configured yet. " +
      "Set <code>url</code> and <code>anonKey</code> in <code>config.js</code>.</p>";
    return;
  }

  const client = window.supabase.createClient(cfg.url, cfg.anonKey);

  const authView = document.getElementById("auth-view");
  const appView = document.getElementById("app-view");
  const select = document.getElementById("lessonSelector");
  const userLabel = document.getElementById("user-label");
  const lessonMeta = document.getElementById("lesson-meta");

  let lessons = [];
  let currentUser = null;

  Auth.init(client);
  const runnerEngine =
    typeof window.makeRunnerEngine === "function" ? window.makeRunnerEngine(client) : window.RunnerEngineMock;
  LessonRunner.init({
    root: document.getElementById("runner-root"),
    client,
    getUser: () => currentUser,
    engine: runnerEngine,
    fallback: window.RunnerEngineMock,
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

  function showAuth() {
    authView.style.display = "block";
    appView.style.display = "none";
    if (window.Motion) window.Motion.enterAuth();
  }

  async function showApp() {
    authView.style.display = "none";
    appView.style.display = "block";
    if (window.Motion) window.Motion.enterApp();
    await loadProfileLabel();
    if (!lessons.length) await loadLessons();
    if (lessons.length) {
      select.value = lessons[0].id;
      applyLesson(lessons[0].id);
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
      userLabel.textContent = data.grade ? `${data.name} (grade ${data.grade})` : data.name;
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
    lessons.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l.id;
      const base = l.module ? `${l.module}: ${l.title}` : `Lesson ${l.position}: ${l.title}`;
      opt.textContent = l.level ? `${base} — ${l.level}` : base;
      select.appendChild(opt);
    });
  }

  function applyLesson(id) {
    const lesson = lessons.find((l) => l.id === id);
    if (!lesson) return;
    if (lessonMeta) lessonMeta.textContent = lesson.level || lesson.module || "";
    if (window.Motion) window.Motion.lessonChange();
    LessonRunner.start(lesson);
  }

  select.addEventListener("change", (e) => applyLesson(e.target.value));
});
