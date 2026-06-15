// Ambient three.js background — drifting brand-colored particles plus a couple of
// faint wireframe polyhedra (a quiet nod to "structured logic"), with gentle pointer
// parallax. Pure progressive enhancement: bails cleanly if THREE is missing, WebGL
// is unavailable, or the user prefers reduced motion.
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
  } catch (e) {
    return; // no WebGL — leave the CSS gradient as the backdrop
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.z = 14;

  var palette = [0x0077cc, 0xc42d88, 0x27c147].map(function (c) {
    return new THREE.Color(c);
  });

  // ---- Drifting particles -------------------------------------------------
  var count = Math.max(70, Math.min(420, Math.floor(window.innerWidth / 4)));
  var pgeo = new THREE.BufferGeometry();
  var pos = new Float32Array(count * 3);
  var col = new Float32Array(count * 3);
  for (var i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 42;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 26;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 22;
    var c = palette[i % palette.length];
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  pgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  pgeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  var pmat = new THREE.PointsMaterial({
    size: 0.14,
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    sizeAttenuation: true,
  });
  var points = new THREE.Points(pgeo, pmat);
  scene.add(points);

  // ---- Faint wireframe polyhedra ------------------------------------------
  var shapes = [];
  function addShape(radius, color, x, y, z, opacity) {
    var edges = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(radius, 1));
    var line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: opacity })
    );
    line.position.set(x, y, z);
    scene.add(line);
    shapes.push(line);
  }
  addShape(5.6, 0x0077cc, -9, 3, -6, 0.1);
  addShape(3.6, 0xc42d88, 10, -4, -4, 0.1);

  // ---- Pointer parallax ---------------------------------------------------
  var pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener(
    "pointermove",
    function (e) {
      pointer.tx = e.clientX / window.innerWidth - 0.5;
      pointer.ty = e.clientY / window.innerHeight - 0.5;
    },
    { passive: true }
  );

  function resize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  var t0 = performance.now();
  function render(now) {
    var t = (now - t0) / 1000;
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;

    points.rotation.y = t * 0.02 + pointer.x * 0.3;
    points.rotation.x = Math.sin(t * 0.05) * 0.05 + pointer.y * 0.2;
    for (var i = 0; i < shapes.length; i++) {
      shapes[i].rotation.x = t * 0.03 * (i + 1) * 0.6;
      shapes[i].rotation.y = t * 0.04 * (i + 1) * 0.5;
    }
    camera.position.x += (pointer.x * 2 - camera.position.x) * 0.05;
    camera.position.y += (-pointer.y * 1.4 - camera.position.y) * 0.05;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

  var running = true;
  function loop() {
    if (!running) return;
    render(performance.now());
    requestAnimationFrame(loop);
  }

  if (reduce) {
    render(performance.now()); // one static, composed frame
  } else {
    document.addEventListener("visibilitychange", function () {
      running = !document.hidden;
      if (running) loop();
    });
    loop();
  }
})();
