import { useEffect, useRef } from "react";
import * as THREE from "three";

// The ambient layer (DESIGN_V6 §2): ONE full-viewport WebGL shader plane per page — every
// surface tints and pulses this same component via props; nothing else in the app may create a
// WebGL context.
//
// Contract:
//   * `intensity` — the working alpha budget (0.22 working surfaces, up to 0.5 entry surfaces).
//     Changes glide (the frame loop eases toward the target); never hard-cut.
//   * `hue` — a CSS custom property name ("--mode-lesson") or any resolvable CSS color value
//     (var()/color-mix() welcome). The wash tints toward it over ~700ms (the §2 600-900ms
//     blend window). null/undefined = the untinted brand rainbow.
//   * `focusSignal` — a monotonically increasing counter. Each increment fires ONE uFocus
//     bloom: an instant rise eased back down by the frame loop over ~2s. Capped subtle
//     (≤ +45% alpha at peak, center-weighted); never loops.
//
// Reduced motion: a single static frame that still includes the current hue tint — hue and
// intensity changes repaint instantly (no lerp), blooms are suppressed entirely, and the RAF
// loop never starts. The RAF loop also pauses on document.hidden.
//
// Performance floor: DPR capped at 1.5, branchless fragment shader (mix/smoothstep only), and
// zero allocations in the frame loop — all per-frame math mutates preallocated uniforms.

type Props = {
  intensity?: number;
  hue?: string | null;
  focusSignal?: number;
};

// The DOM event surfaces outside the shell's prop reach (e.g. StudentHome's memory-card
// reveal) dispatch on window to request one focus bloom; the shell that owns the mount
// listens and increments its focusSignal. Kept here so the event name and the uniform it
// drives live in one file.
export const AMBIENT_FOCUS_EVENT = "jargon:ambient-focus";

// Resolve a hue prop to 0..1 RGB. Two steps so nothing here ever parses color syntax:
// a probe element in the document computes custom properties / var() / color-mix() down to a
// computed color (getComputedStyle — re-run at mount + on change, per §2), then a 1x1 canvas
// paints it and reads the bytes, which handles oklch()/color() serializations the same way
// the compositor does. Singletons: one probe node + one 2d context for the app's lifetime,
// only ever touched on hue CHANGES, never per frame.
let probeEl: HTMLSpanElement | null = null;
let pickCtx: CanvasRenderingContext2D | null = null;

function resolveCssColor(hue: string): [number, number, number] | null {
  if (typeof document === "undefined" || !document.body) return null;
  if (!probeEl || !probeEl.isConnected) {
    probeEl = document.createElement("span");
    probeEl.style.display = "none";
    document.body.appendChild(probeEl);
  }
  if (!pickCtx) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    // willReadFrequently keeps the 1x1 pick canvas on the CPU path — we read it back every
    // resolve, and a GPU round-trip for one pixel is the slow way.
    pickCtx = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!pickCtx) return null;
  probeEl.style.color = "";
  probeEl.style.color = hue.startsWith("--") ? `var(${hue})` : hue;
  const computed = getComputedStyle(probeEl).color;
  if (!computed) return null;
  pickCtx.fillStyle = "#000000";
  pickCtx.fillStyle = computed;
  pickCtx.fillRect(0, 0, 1, 1);
  const data = pickCtx.getImageData(0, 0, 1, 1).data;
  return [data[0] / 255, data[1] / 255, data[2] / 255];
}

export function AmbientCanvas({ intensity = 0.5, hue = null, focusSignal = 0 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;

  // Mutable ambient state shared between the prop effects and the frame loop, so the render
  // effect mounts the context exactly once and prop changes only write numbers.
  //   hueTarget/hueCurrent — RGB the tint lerps toward / is at (JS-side per-frame lerp).
  //   mixTarget/mixCurrent — the uBlend ramp: 0 = neutral rainbow, 1 = fully tinted.
  //   focus — the live bloom level; the loop decays it toward 0 (~2s ease-out).
  const stateRef = useRef({
    hueTarget: [0.5, 0.5, 0.5],
    hueCurrent: [0.5, 0.5, 0.5],
    mixTarget: 0,
    mixCurrent: 0,
    focus: 0,
    reduce: false,
    renderStatic: null as (() => void) | null,
  });

  // Hue prop → resolved RGB target. Declared BEFORE the render effect so the very first
  // frame (including the reduced-motion static one) already knows the target. Re-resolved on
  // change; under reduced motion the tint snaps (a lerp would need the loop) and repaints.
  useEffect(() => {
    const s = stateRef.current;
    const resolved = hue ? resolveCssColor(hue) : null;
    if (resolved) {
      s.hueTarget[0] = resolved[0];
      s.hueTarget[1] = resolved[1];
      s.hueTarget[2] = resolved[2];
      s.mixTarget = 1;
    } else {
      // No hue = glide back to the neutral rainbow. The target color is left in place so the
      // fade-out departs from the tint it arrived at.
      s.mixTarget = 0;
    }
    if (s.reduce) {
      s.hueCurrent[0] = s.hueTarget[0];
      s.hueCurrent[1] = s.hueTarget[1];
      s.hueCurrent[2] = s.hueTarget[2];
      s.mixCurrent = s.mixTarget;
      s.renderStatic?.();
    }
  }, [hue]);

  // Theme flips change what the SAME custom property resolves to, so watch the <html> class
  // (the .dark toggle) and re-resolve the current hue. Attribute filter keeps this silent for
  // everything except theme changes.
  useEffect(() => {
    if (!hue) return;
    const observer = new MutationObserver(() => {
      const s = stateRef.current;
      const resolved = resolveCssColor(hue);
      if (!resolved) return;
      s.hueTarget[0] = resolved[0];
      s.hueTarget[1] = resolved[1];
      s.hueTarget[2] = resolved[2];
      if (s.reduce) {
        s.hueCurrent[0] = s.hueTarget[0];
        s.hueCurrent[1] = s.hueTarget[1];
        s.hueCurrent[2] = s.hueTarget[2];
        s.renderStatic?.();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [hue]);

  // focusSignal → one bloom per increment. The comparison (not just "changed") keeps a
  // remounted consumer starting at 0 from firing a stray bloom, and reduced motion shows no
  // blooms at all (§2: static frame only).
  const prevFocusSignalRef = useRef(focusSignal);
  useEffect(() => {
    const s = stateRef.current;
    if (focusSignal > prevFocusSignalRef.current && !s.reduce) s.focus = 1;
    prevFocusSignalRef.current = focusSignal;
  }, [focusSignal]);

  // Under reduced motion an intensity prop change must repaint the static frame (the loop
  // that would otherwise pick it up never runs).
  useEffect(() => {
    const s = stateRef.current;
    if (s.reduce) s.renderStatic?.();
  }, [intensity]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const state = stateRef.current;
    state.reduce = reduce;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    // DPR cap 1.5: the wash is low-frequency noise — retina-exact pixels buy nothing, and on
    // a 2x/3x Chromebook or phone the cap quarters the fragment load.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const resize = () => renderer.setSize(window.innerWidth, window.innerHeight, false);
    resize();

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const uniforms = {
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      // The contextual tint (uHue + the uBlend ramp uHueMix) and the bloom scalar (uFocus).
      // Preallocated; the frame loop only mutates them.
      uHue: {
        value: new THREE.Vector3(state.hueCurrent[0], state.hueCurrent[1], state.hueCurrent[2]),
      },
      uHueMix: { value: state.mixCurrent },
      uFocus: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      vertexShader: `void main(){ gl_Position = vec4(position,1.0); }`,
      // Branchless throughout — mix/smoothstep only, no conditionals (§2 performance floor).
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform float uIntensity;
        uniform vec2 uRes;
        uniform vec3 uHue;
        uniform float uHueMix;
        uniform float uFocus;
        // simple value noise
        float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){
          vec2 i=floor(p); vec2 f=fract(p);
          float a=hash(i); float b=hash(i+vec2(1.0,0.0));
          float c=hash(i+vec2(0.0,1.0)); float d=hash(i+vec2(1.0,1.0));
          vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
        }
        void main(){
          vec2 uv = gl_FragCoord.xy / uRes.xy;
          vec2 p = uv * 2.5;
          float t = uTime * 0.05;
          float n = noise(p + vec2(t, -t*0.7));
          n = mix(n, noise(p*1.8 - vec2(t*0.4, t)), 0.5);

          // rainbow: yellow → orange → pink → purple → blue
          vec3 cYellow = vec3(0.965, 0.827, 0.420);
          vec3 cOrange = vec3(0.976, 0.659, 0.420);
          vec3 cPink   = vec3(0.961, 0.522, 0.733);
          vec3 cPurple = vec3(0.561, 0.643, 0.937);
          vec3 cBlue   = vec3(0.447, 0.722, 0.961);
          vec3 col = mix(cYellow, cOrange, smoothstep(0.0, 0.30, n));
          col = mix(col, cPink,   smoothstep(0.25, 0.55, n));
          col = mix(col, cPurple, smoothstep(0.50, 0.80, n));
          col = mix(col, cBlue,   smoothstep(0.75, 1.0,  n));

          // Contextual tint: pull toward uHue by the blend ramp, ceilinged at 0.6 so the
          // brand rainbow always survives underneath a mode accent.
          col = mix(col, uHue, uHueMix * 0.6);

          // soft vignette + low alpha
          float v = smoothstep(1.2, 0.2, distance(uv, vec2(0.5)));
          float a = uIntensity * (0.35 + 0.35 * v);
          // uFocus bloom: a center-weighted lift, ≤ +45% of the local alpha at peak — a
          // slow breath, never a flash.
          a *= 1.0 + uFocus * v * 0.45;
          gl_FragColor = vec4(col, a);
        }
      `,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    let raf = 0;
    let last = performance.now();
    let running = true;
    const tick = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      uniforms.uTime.value += dt;
      // smooth toward target intensity
      uniforms.uIntensity.value += (intensityRef.current - uniforms.uIntensity.value) * 0.05;
      // Hue blend: framerate-independent exponential settle, τ=0.24s → ~95% in ~720ms
      // (inside the §2 600-900ms window). Mutates in place — no allocations here.
      const k = 1 - Math.exp(-dt / 0.24);
      state.mixCurrent += (state.mixTarget - state.mixCurrent) * k;
      state.hueCurrent[0] += (state.hueTarget[0] - state.hueCurrent[0]) * k;
      state.hueCurrent[1] += (state.hueTarget[1] - state.hueCurrent[1]) * k;
      state.hueCurrent[2] += (state.hueTarget[2] - state.hueCurrent[2]) * k;
      uniforms.uHue.value.set(state.hueCurrent[0], state.hueCurrent[1], state.hueCurrent[2]);
      uniforms.uHueMix.value = state.mixCurrent;
      // Focus decay: exponential τ=0.5s is a natural ease-out — visually gone in ~2s; the
      // floor clamp stops sub-perceptual work.
      state.focus = state.focus < 0.01 ? 0 : state.focus * Math.exp(-dt / 0.5);
      uniforms.uFocus.value = state.focus;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    // prefers-reduced-motion: one static frame at full target intensity INCLUDING the
    // current hue tint — the wash stays contextual, the animation loop never starts, and
    // uFocus stays 0 (no blooms).
    const renderStatic = () => {
      uniforms.uIntensity.value = intensityRef.current;
      uniforms.uHue.value.set(state.hueCurrent[0], state.hueCurrent[1], state.hueCurrent[2]);
      uniforms.uHueMix.value = state.mixCurrent;
      uniforms.uFocus.value = 0;
      renderer.render(scene, camera);
    };
    state.renderStatic = renderStatic;
    if (reduce) {
      // Snap to the target tint before the only frame we'll ever draw.
      state.hueCurrent[0] = state.hueTarget[0];
      state.hueCurrent[1] = state.hueTarget[1];
      state.hueCurrent[2] = state.hueTarget[2];
      state.mixCurrent = state.mixTarget;
      renderStatic();
    } else {
      raf = requestAnimationFrame(tick);
    }

    const onResize = () => {
      resize();
      uniforms.uRes.value.set(window.innerWidth, window.innerHeight);
      if (reduce) renderStatic();
    };
    window.addEventListener("resize", onResize);
    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduce) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      state.renderStatic = null;
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      material.dispose();
      mesh.geometry.dispose();
      renderer.dispose();
    };
    // Mount-once by design: intensity/hue/focusSignal all reach the live context through
    // refs + stateRef (see the effects above) — recreating the WebGL context per prop change
    // is exactly what this component exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
