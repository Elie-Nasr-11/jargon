import { useEffect, useRef } from "react";
import * as THREE from "three";

type Props = { intensity?: number };

export function AmbientCanvas({ intensity = 0.5 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const resize = () => renderer.setSize(window.innerWidth, window.innerHeight, false);
    resize();

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const uniforms = {
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      vertexShader: `void main(){ gl_Position = vec4(position,1.0); }`,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform float uIntensity;
        uniform vec2 uRes;
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

          // soft vignette + low alpha
          float v = smoothstep(1.2, 0.2, distance(uv, vec2(0.5)));
          float a = uIntensity * (0.35 + 0.35 * v);
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
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    if (!reduce) raf = requestAnimationFrame(tick);

    const onResize = () => {
      resize();
      uniforms.uRes.value.set(window.innerWidth, window.innerHeight);
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
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      material.dispose();
      mesh.geometry.dispose();
      renderer.dispose();
    };
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
