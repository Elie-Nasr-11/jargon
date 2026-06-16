// Ambient focus field for the centered Jargon studio. This is intentionally
// background-only: no centerpiece object, just edge glows, faint particles, and
// slow parallax to keep attention anchored on the lesson surface.
(function () {
  "use strict";

  if (typeof THREE === "undefined") return;

  var canvas = document.getElementById("bg-canvas");
  if (!canvas) return;

  var reduce =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  } catch (_err) {
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  var scene = new THREE.Scene();
  var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  camera.position.z = 5;

  var group = new THREE.Group();
  scene.add(group);

  function makeGlowTexture(colorHex) {
    var size = 256;
    var glowCanvas = document.createElement("canvas");
    glowCanvas.width = glowCanvas.height = size;
    var ctx = glowCanvas.getContext("2d");
    var grad = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
    var color = new THREE.Color(colorHex);
    grad.addColorStop(0, "rgba(" + Math.round(color.r * 255) + ", " + Math.round(color.g * 255) + ", " + Math.round(color.b * 255) + ", 0.92)");
    grad.addColorStop(0.18, "rgba(" + Math.round(color.r * 255) + ", " + Math.round(color.g * 255) + ", " + Math.round(color.b * 255) + ", 0.45)");
    grad.addColorStop(0.48, "rgba(" + Math.round(color.r * 255) + ", " + Math.round(color.g * 255) + ", " + Math.round(color.b * 255) + ", 0.14)");
    grad.addColorStop(1, "rgba(" + Math.round(color.r * 255) + ", " + Math.round(color.g * 255) + ", " + Math.round(color.b * 255) + ", 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(glowCanvas);
  }

  function makeGlow(texture, opacity, scaleX, scaleY, x, y, z) {
    var sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    sprite.scale.set(scaleX, scaleY, 1);
    sprite.position.set(x, y, z || 0);
    group.add(sprite);
    return sprite;
  }

  var glowTeal = makeGlowTexture(0x66f3e9);
  var glowBlue = makeGlowTexture(0x3d8fff);
  var glowMist = makeGlowTexture(0xb9d2ff);

  var plumes = [
    makeGlow(glowTeal, 0.82, 1.8, 1.35, -1.18, -0.88, -0.15),
    makeGlow(glowBlue, 0.88, 1.7, 1.28, 1.16, -0.82, -0.1),
    makeGlow(glowMist, 0.12, 1.75, 1.1, 0, -1.04, -0.2),
    makeGlow(glowTeal, 0.18, 0.96, 0.72, -1.06, 0.48, -0.18),
    makeGlow(glowBlue, 0.16, 0.9, 0.74, 1.02, 0.42, -0.18),
  ];

  var particleCount = 80;
  var positions = new Float32Array(particleCount * 3);
  var colors = new Float32Array(particleCount * 3);
  var teal = new THREE.Color(0x66f3e9);
  var blue = new THREE.Color(0x3d8fff);
  for (var i = 0; i < particleCount; i++) {
    var side = i % 2 === 0 ? -1 : 1;
    positions[i * 3] = side * (0.92 + Math.random() * 0.5);
    positions[i * 3 + 1] = -0.9 + Math.random() * 1.45;
    positions[i * 3 + 2] = Math.random() * 0.2;
    var color = i % 3 === 0 ? teal : blue;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  var particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  var particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      size: 0.012,
      transparent: true,
      opacity: 0.44,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
  );
  group.add(particles);

  var pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  var sceneMode = "auth";
  var sceneScale = 1;

  window.addEventListener(
    "pointermove",
    function (event) {
      pointer.tx = event.clientX / window.innerWidth - 0.5;
      pointer.ty = event.clientY / window.innerHeight - 0.5;
    },
    { passive: true }
  );

  function setSize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    sceneScale = Math.max(0.92, Math.min(1.24, window.innerWidth / 1280));
  }

  function posePlumes(t) {
    var authMode = sceneMode === "auth";
    var rise = authMode ? 0.04 : -0.02;
    plumes[0].position.set(-1.18 + pointer.x * 0.08, -0.88 + rise + Math.sin(t * 0.15) * 0.04, -0.15);
    plumes[1].position.set(1.16 + pointer.x * 0.07, -0.82 + rise + Math.cos(t * 0.16) * 0.04, -0.1);
    plumes[2].position.set(pointer.x * -0.05, authMode ? -0.98 : -1.08, -0.2);
    plumes[3].position.set(-1.02 + pointer.x * 0.04, authMode ? 0.34 : 0.44, -0.18);
    plumes[4].position.set(1.0 + pointer.x * 0.04, authMode ? 0.36 : 0.46, -0.18);
    plumes[0].scale.set(1.82 * sceneScale, 1.36 * sceneScale, 1);
    plumes[1].scale.set(1.72 * sceneScale, 1.3 * sceneScale, 1);
    plumes[2].scale.set(1.72 * sceneScale, 1.02 * sceneScale, 1);
  }

  function renderFrame(now) {
    var t = now * 0.001;
    pointer.x += (pointer.tx - pointer.x) * 0.025;
    pointer.y += (pointer.ty - pointer.y) * 0.025;

    posePlumes(t);
    group.position.x = pointer.x * 0.05;
    group.position.y = pointer.y * -0.03;
    group.rotation.z = pointer.x * 0.02;

    particles.position.y = Math.sin(t * 0.09) * 0.03;
    particles.rotation.z = Math.sin(t * 0.05) * 0.018;

    renderer.render(scene, camera);
  }

  function loop(now) {
    renderFrame(now);
    if (!reduce && !document.hidden) requestAnimationFrame(loop);
  }

  setSize();
  window.addEventListener("resize", setSize);

  window.SceneField = {
    setMode: function (mode) {
      sceneMode = mode === "app" ? "app" : "auth";
      renderFrame(performance.now());
    },
  };

  if (reduce) {
    renderFrame(performance.now());
  } else {
    requestAnimationFrame(loop);
  }
})();
