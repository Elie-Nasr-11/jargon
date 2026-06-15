// GSAP motion layer — view transitions, staggered entrances, and reveal-on-add for
// chat messages and interpreter output. Uses gsap.from() throughout so that if GSAP
// fails to load (or reduced motion is requested) elements simply stay in their final
// state. Exposes window.Motion for app.js to call at lifecycle points.
(function () {
  "use strict";

  var hasGsap = typeof gsap !== "undefined";
  var reduce =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var on = hasGsap && !reduce;

  function from(target, vars) {
    if (!on || !target) return;
    try {
      gsap.from(target, vars);
    } catch (e) {
      /* never let an animation break the app */
    }
  }

  var Motion = {
    enterAuth: function () {
      from(".auth-card", { y: 26, opacity: 0, duration: 0.7, ease: "power3.out" });
      from(".auth-card > *", {
        y: 14,
        opacity: 0,
        duration: 0.5,
        stagger: 0.06,
        delay: 0.12,
        ease: "power2.out",
      });
    },
    enterApp: function () {
      from(".app-header", { y: -18, opacity: 0, duration: 0.6, ease: "power3.out" });
      from(".lesson-bar", { y: 10, opacity: 0, duration: 0.5, delay: 0.1, ease: "power2.out" });
      from(".pane", {
        y: 30,
        opacity: 0,
        duration: 0.75,
        stagger: 0.12,
        delay: 0.12,
        ease: "power3.out",
      });
    },
    lessonChange: function () {
      if (!on) return;
      try {
        gsap.fromTo(
          ".pane h2",
          { opacity: 0.25, y: -4 },
          { opacity: 1, y: 0, duration: 0.4, stagger: 0.05, ease: "power2.out" }
        );
      } catch (e) {
        /* no-op */
      }
    },
    reveal: function (node) {
      from(node, { y: 10, opacity: 0, duration: 0.45, ease: "power2.out" });
    },
  };
  window.Motion = Motion;
  // The lesson-runner calls Motion.reveal() explicitly for new bubbles, so no
  // global MutationObserver is needed here.
})();
