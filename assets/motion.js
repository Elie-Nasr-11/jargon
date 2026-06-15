// GSAP motion layer for the cinematic shell. All animation is progressive:
// if GSAP fails to load or reduced motion is requested, the UI stays usable.
(function () {
  "use strict";

  var hasGsap = typeof gsap !== "undefined";
  var reduce =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var on = hasGsap && !reduce;

  function from(target, vars) {
    if (!on || !target) return;
    try {
      var nodes = gsap.utils.toArray(target);
      var duration = typeof vars.duration === "number" ? vars.duration : 0;
      var delay = typeof vars.delay === "number" ? vars.delay : 0;
      var stagger = typeof vars.stagger === "number" ? vars.stagger * Math.max(nodes.length - 1, 0) : 0;
      gsap.from(target, { ...vars, clearProps: "opacity,transform" });
      window.setTimeout(function () {
        nodes.forEach(function (node) {
          node.style.opacity = "";
          node.style.transform = "";
        });
      }, Math.ceil((duration + delay + stagger + 0.2) * 1000));
    } catch (e) {
      /* animation must never break the lesson */
    }
  }

  function fromTo(target, fromVars, toVars) {
    if (!on || !target) return;
    try {
      gsap.fromTo(target, fromVars, toVars);
    } catch (e) {
      /* no-op */
    }
  }

  window.Motion = {
    enterAuth: function () {
      from(".brand, .top-nav span", {
        y: -12,
        opacity: 0,
        duration: 0.7,
        stagger: 0.05,
        ease: "power3.out",
      });
      from(".logic-label span, .system-pill, .auth-foot span", {
        x: -20,
        opacity: 0,
        duration: 0.75,
        stagger: 0.06,
        delay: 0.12,
        ease: "power3.out",
      });
      from(".auth-card", {
        y: 34,
        opacity: 0,
        duration: 0.85,
        delay: 0.1,
        ease: "power3.out",
      });
      from(".auth-card > *", {
        y: 14,
        opacity: 0,
        duration: 0.55,
        stagger: 0.045,
        delay: 0.24,
        ease: "power2.out",
      });
    },
    enterApp: function () {
      from(".app-header > *", {
        y: -14,
        opacity: 0,
        duration: 0.65,
        stagger: 0.045,
        ease: "power3.out",
      });
      from(".side-rail, .lesson-meta-card, .mentor-card, .workbench-card, .app-footer span", {
        y: 24,
        opacity: 0,
        duration: 0.75,
        stagger: 0.07,
        delay: 0.08,
        ease: "power3.out",
      });
    },
    lessonChange: function () {
      fromTo(
        ".lesson-meta-card, .runner-grid",
        { opacity: 0.64, y: 8 },
        { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }
      );
    },
    reveal: function (node) {
      from(node, { y: 12, opacity: 0, duration: 0.42, ease: "power2.out" });
    },
    pulseOutput: function (node) {
      fromTo(
        node,
        { boxShadow: "0 0 0 rgba(82,103,255,0)" },
        {
          boxShadow: "0 0 26px rgba(82,103,255,0.34)",
          duration: 0.28,
          yoyo: true,
          repeat: 1,
          ease: "power2.out",
        }
      );
    },
  };
})();
