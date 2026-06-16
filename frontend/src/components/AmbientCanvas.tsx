import { useEffect, useRef } from "react";
import * as THREE from "three";

export function AmbientCanvas({ intensity = 0.5 }: { intensity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    const resize = () => renderer.setSize(window.innerWidth, window.innerHeight, false);
    resize();

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const uniforms = {
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    };

    const material = new THREE.ShaderMaterial({
      transparent: true,
      uniforms,
      vertexShader: `void main(){ gl_Position = vec4(position, 1.0); }`,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform float uIntensity;
        uniform vec2 uResolution;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        void main() {
          vec2 uv = gl_FragCoord.xy / uResolution.xy;
          vec2 p = uv * 2.8;
          float t = uTime * 0.05;
          float n = noise(p + vec2(t, -t * 0.8));
          n = mix(n, noise(p * 1.6 - vec2(t * 0.5, t)), 0.55);

          vec3 teal = vec3(0.278, 0.850, 0.835);
          vec3 blue = vec3(0.422, 0.553, 1.0);
          vec3 deep = vec3(0.020, 0.027, 0.050);

          float lowerLeft = smoothstep(0.58, -0.02, distance(uv, vec2(0.16, 0.92)));
          float lowerRight = smoothstep(0.54, -0.01, distance(uv, vec2(0.86, 0.90)));
          float blend = clamp(n * 0.65 + lowerRight * 0.8, 0.0, 1.0);
          vec3 color = mix(teal, blue, blend);
          color = mix(deep, color, max(lowerLeft, lowerRight));

          float centerFade = 1.0 - smoothstep(0.0, 0.55, distance(uv, vec2(0.5)));
          float alpha = (max(lowerLeft, lowerRight) * 0.30 + n * 0.06) * uIntensity;
          alpha *= 1.0 - centerFade * 0.72;
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    let frame = 0;
    let last = performance.now();
    let running = true;

    const tick = (now: number) => {
      if (!running) return;
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      uniforms.uTime.value += delta;
      uniforms.uIntensity.value += (intensityRef.current - uniforms.uIntensity.value) * 0.05;
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(tick);
    };

    if (!reduceMotion) {
      frame = window.requestAnimationFrame(tick);
    } else {
      renderer.render(scene, camera);
    }

    const handleResize = () => {
      resize();
      uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
      if (reduceMotion) renderer.render(scene, camera);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        running = false;
        window.cancelAnimationFrame(frame);
      } else if (!reduceMotion) {
        running = true;
        last = performance.now();
        frame = window.requestAnimationFrame(tick);
      }
    };

    window.addEventListener("resize", handleResize);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibility);
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
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
