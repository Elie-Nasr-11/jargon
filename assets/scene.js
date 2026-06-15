// Cinematic Three.js logic field. Progressive enhancement only: the app works
// without WebGL, and reduced-motion users receive one composed still frame.
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
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 15);

  var root = new THREE.Group();
  scene.add(root);

  var ambient = new THREE.AmbientLight(0x8fa6ff, 0.25);
  var key = new THREE.PointLight(0x78d8ff, 2.1, 40);
  var rim = new THREE.PointLight(0x4d60ff, 1.6, 34);
  key.position.set(-5, 4, 8);
  rim.position.set(5, -3, 6);
  scene.add(ambient, key, rim);

  var glass = new THREE.MeshPhysicalMaterial({
    color: 0x101827,
    metalness: 0.5,
    roughness: 0.18,
    transmission: 0.18,
    transparent: true,
    opacity: 0.82,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  });

  var shell = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 4), glass);
  root.add(shell);

  var wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3.24, 3)),
    new THREE.LineBasicMaterial({
      color: 0xbfd2ff,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
    })
  );
  root.add(wire);

  function addTorus(radius, tube, color, opacity, rx, ry, rz) {
    var torus = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 16, 180),
      new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    torus.rotation.set(rx, ry, rz);
    root.add(torus);
    return torus;
  }

  var rings = [
    addTorus(4.2, 0.018, 0x5267ff, 0.95, 1.2, 0.3, 0.1),
    addTorus(3.55, 0.012, 0x73d7ff, 0.68, 0.35, 1.1, 0.4),
    addTorus(5.15, 0.01, 0x5267ff, 0.42, 1.55, -0.45, 0.2),
  ];

  function makeArc(radius, start, len, color, opacity) {
    var pts = [];
    for (var i = 0; i < 80; i++) {
      var a = start + (len * i) / 79;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius * 0.34, Math.sin(a) * 0.9));
    }
    var line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    line.rotation.set(Math.random() * 1.6, Math.random() * 1.8, Math.random() * 1.2);
    root.add(line);
    return line;
  }

  var arcs = [];
  for (var a = 0; a < 10; a++) {
    arcs.push(makeArc(3.9 + Math.random() * 1.6, Math.random() * 6, 1.6 + Math.random() * 2.2, a % 2 ? 0x73d7ff : 0x5267ff, 0.28 + Math.random() * 0.36));
  }

  var particleCount = Math.max(180, Math.min(760, Math.floor(window.innerWidth / 2.2)));
  var positions = new Float32Array(particleCount * 3);
  var colors = new Float32Array(particleCount * 3);
  var c1 = new THREE.Color(0x5267ff);
  var c2 = new THREE.Color(0x73d7ff);
  for (var p = 0; p < particleCount; p++) {
    var r = 4.5 + Math.random() * 9;
    var theta = Math.random() * Math.PI * 2;
    var y = (Math.random() - 0.5) * 8;
    positions[p * 3] = Math.cos(theta) * r;
    positions[p * 3 + 1] = y;
    positions[p * 3 + 2] = Math.sin(theta) * r - Math.random() * 3;
    var c = p % 3 === 0 ? c2 : c1;
    colors[p * 3] = c.r;
    colors[p * 3 + 1] = c.g;
    colors[p * 3 + 2] = c.b;
  }
  var particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  particleGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  var particles = new THREE.Points(
    particleGeo,
    new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
  );
  root.add(particles);

  var pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener(
    "pointermove",
    function (event) {
      pointer.tx = event.clientX / window.innerWidth - 0.5;
      pointer.ty = event.clientY / window.innerHeight - 0.5;
    },
    { passive: true }
  );

  function placeForView() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    if (w < 760) {
      root.scale.setScalar(0.72);
      root.position.set(-1.3, 2.1, 0);
    } else if (document.getElementById("auth-view")?.style.display !== "none") {
      root.scale.setScalar(1.12);
      root.position.set(-4.3, -0.35, 0);
    } else {
      root.scale.setScalar(1.04);
      root.position.set(-5.3, -0.2, 0);
    }
  }

  window.addEventListener("resize", placeForView);
  placeForView();

  var start = performance.now();
  var running = true;

  function frame(now) {
    var t = (now - start) / 1000;
    pointer.x += (pointer.tx - pointer.x) * 0.035;
    pointer.y += (pointer.ty - pointer.y) * 0.035;

    root.rotation.y = pointer.x * 0.18;
    root.rotation.x = -pointer.y * 0.12;
    shell.rotation.y = t * 0.08;
    shell.rotation.x = Math.sin(t * 0.12) * 0.12;
    wire.rotation.y = -t * 0.055;
    wire.rotation.z = Math.sin(t * 0.09) * 0.05;

    for (var i = 0; i < rings.length; i++) {
      rings[i].rotation.z += 0.0016 * (i + 1);
      rings[i].rotation.y += 0.001 * (i % 2 ? -1 : 1);
    }
    for (var j = 0; j < arcs.length; j++) {
      arcs[j].rotation.z += 0.0009 + j * 0.00005;
    }
    particles.rotation.y = t * 0.014;
    particles.rotation.x = Math.sin(t * 0.07) * 0.04;

    camera.position.x += (pointer.x * 0.8 - camera.position.x) * 0.035;
    camera.position.y += (-pointer.y * 0.5 - camera.position.y) * 0.035;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

  function loop() {
    if (!running) return;
    placeForView();
    frame(performance.now());
    requestAnimationFrame(loop);
  }

  if (reduce) {
    frame(performance.now());
  } else {
    document.addEventListener("visibilitychange", function () {
      running = !document.hidden;
      if (running) loop();
    });
    loop();
  }
})();
