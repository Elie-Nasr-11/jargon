// Progressive motion layer for the focused cinematic shell.
(function () {
  "use strict";

  var hasGsap = typeof gsap !== "undefined";
  var reduce =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var enabled = hasGsap && !reduce;

  function toArray(target) {
    if (!target) return [];
    if (Array.isArray(target)) return target.filter(Boolean);
    if (typeof target === "string") return gsap.utils.toArray(target);
    return [target];
  }

  function animateIn(targets, vars) {
    if (!enabled) return;
    var nodes = toArray(targets);
    if (!nodes.length) return;
    try {
      gsap.from(nodes, vars);
    } catch (_err) {
      /* animation should never break the lesson */
    }
  }

  function animateTo(targets, vars) {
    if (!enabled) return;
    var nodes = toArray(targets);
    if (!nodes.length) return;
    try {
      gsap.to(nodes, vars);
    } catch (_err) {
      /* no-op */
    }
  }

  window.Motion = {
    enterAuth: function (stage) {
      if (!enabled || !stage) return;
      animateIn(stage, {
        opacity: 0,
        y: 20,
        duration: 0.8,
        ease: "power3.out",
        clearProps: "opacity,transform",
      });
      animateIn(stage.querySelectorAll(".stage-header-auth > *, .auth-copy > *, .auth-card > *"), {
        opacity: 0,
        y: 18,
        duration: 0.72,
        stagger: 0.05,
        delay: 0.12,
        ease: "power3.out",
        clearProps: "opacity,transform",
      });
    },

    enterApp: function (stage) {
      if (!enabled || !stage) return;
      animateIn(stage, {
        opacity: 0,
        y: 24,
        duration: 0.8,
        ease: "power3.out",
        clearProps: "opacity,transform",
      });
      animateIn(stage.querySelectorAll(".studio-header > *, .runner-meta, .transcript, .dock"), {
        opacity: 0,
        y: 24,
        duration: 0.76,
        stagger: 0.08,
        delay: 0.12,
        ease: "power3.out",
        clearProps: "opacity,transform",
      });
    },

    lessonChange: function (target) {
      if (!enabled || !target) return;
      animateIn(target, {
        opacity: 0.4,
        y: 16,
        duration: 0.48,
        ease: "power2.out",
        clearProps: "opacity,transform",
      });
    },

    reveal: function (node) {
      if (!enabled || !node) return;
      animateIn(node, {
        opacity: 0,
        y: 14,
        scale: 0.985,
        duration: 0.42,
        ease: "power2.out",
        clearProps: "opacity,transform",
      });
    },

    pulseOutput: function (node) {
      if (!enabled || !node) return;
      animateTo(node, {
        boxShadow: "0 0 0 rgba(103,242,231,0), 0 18px 42px rgba(60,144,255,0.12)",
        duration: 0.25,
        yoyo: true,
        repeat: 1,
        ease: "power2.out",
      });
    },

    openSheet: function (node) {
      if (!enabled || !node) return;
      animateIn(node, {
        opacity: 0,
        y: 22,
        scale: 0.98,
        duration: 0.34,
        ease: "power2.out",
        clearProps: "opacity,transform",
      });
    },

    closeSheet: function (node, done) {
      if (!enabled || !node) {
        if (typeof done === "function") done();
        return;
      }
      try {
        gsap.to(node, {
          opacity: 0,
          y: 16,
          scale: 0.985,
          duration: 0.22,
          ease: "power1.in",
          onComplete: function () {
            gsap.set(node, { clearProps: "opacity,transform" });
            if (typeof done === "function") done();
          },
        });
      } catch (_err) {
        if (typeof done === "function") done();
      }
    },

    dockMode: function (dock) {
      if (!enabled || !dock) return;
      animateIn(dock.children, {
        opacity: 0,
        y: 18,
        duration: 0.34,
        stagger: 0.04,
        ease: "power2.out",
        clearProps: "opacity,transform",
      });
    },
  };
})();
