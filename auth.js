// Auth pane — Supabase email/password sign in & sign up.
// Exposes window.Auth.init(client). Auth state changes are handled in app.js.
(function () {
  "use strict";

  let client;
  let emailEl, passEl, nameEl, gradeEl, msgEl, submitEl;
  let signupMode = false;

  function init(supabaseClient) {
    client = supabaseClient;

    emailEl = document.getElementById("auth-email");
    passEl = document.getElementById("auth-password");
    nameEl = document.getElementById("auth-name");
    gradeEl = document.getElementById("auth-grade");
    msgEl = document.getElementById("auth-message");
    submitEl = document.getElementById("auth-submit");

    document.getElementById("auth-form").addEventListener("submit", submit);
    document.getElementById("auth-toggle").addEventListener("click", toggleMode);
    document.getElementById("logout-btn").addEventListener("click", () => client.auth.signOut());

    setMode(false);
  }

  function toggleMode(e) {
    e.preventDefault();
    setMode(!signupMode);
  }

  function setMode(signup) {
    signupMode = signup;
    document.getElementById("auth-title").textContent = signup ? "Create your account" : "Sign in";
    document.getElementById("auth-submit").textContent = signup ? "Sign up" : "Sign in";
    document.getElementById("auth-toggle").textContent = signup
      ? "Have an account? Sign in"
      : "New here? Create an account";
    document.getElementById("signup-fields").style.display = signup ? "grid" : "none";
    msgEl.textContent = "";
  }

  async function submit(e) {
    e.preventDefault();
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!email || !password) {
      msgEl.textContent = "Email and password are required.";
      return;
    }

    msgEl.classList.remove("error");
    msgEl.textContent = "Working...";
    submitEl.disabled = true;
    try {
      if (signupMode) {
        const { error } = await client.auth.signUp({
          email,
          password,
          options: { data: { name: nameEl.value.trim(), grade: gradeEl.value.trim() } },
        });
        if (error) throw error;
        setMode(false);
        msgEl.textContent =
          "Account created. If email confirmation is enabled, confirm via the link, then sign in.";
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Success: app.js reacts to the auth state change.
      }
    } catch (err) {
      msgEl.classList.add("error");
      msgEl.textContent = err.message || "Authentication failed.";
    } finally {
      submitEl.disabled = false;
    }
  }

  window.Auth = { init };
})();
