/* 3D point-cloud viewer for the 2DX4 spatial-mapping scan.
   Vanilla canvas, no dependencies. Reads x,y,z points (one per line,
   separated by commas, spaces or tabs) from the figure's data-scan-src. */
(function () {
  'use strict';

  var fig = document.querySelector('.scan-viewer');
  if (!fig) return;

  var canvas = fig.querySelector('.scan-canvas');
  var status = fig.querySelector('.scan-status');
  var spinBtn = fig.querySelector('[data-scan="spin"]');
  var ctx = canvas.getContext('2d');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var pts = null;          // Float32Array [x, y, z, t, ...] — t in 0..1 for colour
  var count = 0;
  var DEFAULT = { yaw: -0.55, pitch: 0.25, zoom: 1.1 };
  var view = { yaw: DEFAULT.yaw, pitch: DEFAULT.pitch, zoom: DEFAULT.zoom };
  var spinning = !reduceMotion;
  var visible = false;
  var lastInteract = 0;
  var raf = 0;
  var dpr = 1, W = 0, H = 0;

  function setStatus(text, isEmpty) {
    status.textContent = text;
    status.hidden = !text;
    fig.classList.toggle('is-empty', !!isEmpty);
  }

  if (spinBtn) spinBtn.setAttribute('aria-pressed', String(spinning));

  /* ---------- Data ---------- */
  function parse(text) {
    var out = [];
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var nums = lines[i].match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi);
      if (!nums || nums.length < 3) continue;   // skip headers and blank lines
      var x = +nums[0], y = +nums[1], z = +nums[2];
      if (isFinite(x) && isFinite(y) && isFinite(z)) out.push(x, y, z);
    }
    return out;
  }

  // Input rows are (x, y, z): x = distance moved between sweeps, (y, z) = one
  // cross-section. On screen, the cross-section faces the viewer and x runs into the
  // screen. Consecutive rows with the same x form one sweep (a ring).
  var slices = [];
  function prepare(raw) {
    count = raw.length / 3;
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < raw.length; i += 3) {
      for (var a = 0; a < 3; a++) {
        if (raw[i + a] < min[a]) min[a] = raw[i + a];
        if (raw[i + a] > max[a]) max[a] = raw[i + a];
      }
    }
    var c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    var span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
    var xr = (max[0] - min[0]) || 1;
    pts = new Float32Array(count * 4);
    slices = [];
    var current = null, lastX = NaN;
    for (var j = 0, k = 0, n = 0; j < raw.length; j += 3, k += 4, n++) {
      pts[k] = (raw[j + 1] - c[1]) / span;      // screen x  ← data y
      pts[k + 1] = (raw[j + 2] - c[2]) / span;  // screen y  ← data z
      pts[k + 2] = (raw[j] - c[0]) / span;      // depth     ← data x
      pts[k + 3] = (raw[j] - min[0]) / xr;      // colour by sweep position
      if (raw[j] !== lastX) { current = []; slices.push(current); lastX = raw[j]; }
      current.push(n);
    }
  }

  function load() {
    var src = fig.getAttribute('data-scan-src');
    fetch(src, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (text) {
        var raw = parse(text);
        if (raw.length < 30) throw new Error('too few points');
        prepare(raw);
        setStatus('');
        canvas.setAttribute('aria-label', 'Interactive 3D point cloud of ' + count + ' points in ' + slices.length + ' sweeps from the device\'s scan. Use arrow keys to rotate, plus and minus to zoom, and 0 to reset.');
        resize();
        loop();
      })
      .catch(function () {
        // also hit when the page is opened from disk (file://), where fetch is blocked
        setStatus(location.protocol === 'file:'
          ? 'Scan viewer needs a web server: run "python -m http.server" in the site folder.'
          : 'Couldn’t load the scan data.', true);
      });
  }

  /* ---------- Rendering ---------- */
  function resize() {
    var rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(rect.width * dpr));
    H = Math.max(1, Math.round(rect.height * dpr));
    canvas.width = W;
    canvas.height = H;
    draw();
  }

  // gold (#FDBF57) → rose (#F28CB5) → light maroon (#C2185B), readable on the dark stage
  var STOPS = [[253, 191, 87], [242, 140, 181], [194, 24, 91]];
  function colour(t) {
    var s = t < 0.5 ? 0 : 1, f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    var a = STOPS[s], b = STOPS[s + 1];
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }

  var order = [], proj = null;
  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!pts) return;
    if (!proj || proj.length !== count * 4) {
      proj = new Float32Array(count * 4);
      order = new Array(count);
    }
    var cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
    var cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    var scale = Math.min(W, H) * 0.9 * view.zoom;
    var cam = 2.2;
    for (var i = 0, k = 0; i < count; i++, k += 4) {
      var x = pts[k], y = pts[k + 1], z = pts[k + 2];
      // yaw about the vertical axis, then pitch
      var x1 = x * cy - z * sy;
      var z1 = x * sy + z * cy;
      var y1 = y * cp - z1 * sp;
      var z2 = y * sp + z1 * cp;
      var p = cam / (cam + z2);
      proj[k] = W / 2 + x1 * scale * p;
      proj[k + 1] = H / 2 - y1 * scale * p;
      proj[k + 2] = z2;
      proj[k + 3] = p;
      order[i] = i;
    }
    order.sort(function (a, b) { return proj[b * 4 + 2] - proj[a * 4 + 2]; }); // far → near

    // wireframe: close each sweep into a ring, and join matching readings between sweeps
    ctx.lineWidth = 1 * dpr;
    for (var s = 0; s < slices.length; s++) {
      var ring = slices[s], next = slices[s + 1];
      ctx.strokeStyle = colour(pts[ring[0] * 4 + 3]);
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (var r = 0; r < ring.length; r++) {
        var q = ring[r] * 4;
        if (r === 0) ctx.moveTo(proj[q], proj[q + 1]); else ctx.lineTo(proj[q], proj[q + 1]);
      }
      if (ring.length > 2) ctx.closePath();
      ctx.stroke();
      if (next && next.length === ring.length) {
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        for (var m = 0; m < ring.length; m++) {
          var a0 = ring[m] * 4, b0 = next[m] * 4;
          ctx.moveTo(proj[a0], proj[a0 + 1]);
          ctx.lineTo(proj[b0], proj[b0 + 1]);
        }
        ctx.stroke();
      }
    }

    var base = (count < 2000 ? 5 : 2.2) * dpr;   // bigger dots for sparse scans
    for (var n = 0; n < count; n++) {
      var j = order[n] * 4;
      var size = base * proj[j + 3];
      ctx.globalAlpha = Math.min(1, 0.45 + 0.55 * proj[j + 3]);
      ctx.fillStyle = colour(pts[j + 3]);
      ctx.fillRect(proj[j] - size / 2, proj[j + 1] - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  function loop() {
    cancelAnimationFrame(raf);
    var tick = function () {
      if (spinning && visible && Date.now() - lastInteract > 2500) {
        view.yaw += 0.004;
        draw();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  /* ---------- Interaction ---------- */
  function touched() { lastInteract = Date.now(); }
  function clampPitch() { view.pitch = Math.max(-1.45, Math.min(1.45, view.pitch)); }
  function zoomBy(f) { view.zoom = Math.max(0.4, Math.min(4, view.zoom * f)); touched(); draw(); }

  var drag = null;
  canvas.addEventListener('pointerdown', function (e) {
    if (!pts) return;
    drag = { x: e.clientX, y: e.clientY, type: e.pointerType };
    canvas.setPointerCapture(e.pointerId);
    touched();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    view.yaw += (e.clientX - drag.x) * 0.01;
    // on touch, vertical swipes scroll the page (touch-action: pan-y), so only mouse/pen tilt
    if (drag.type !== 'touch') { view.pitch += (e.clientY - drag.y) * 0.01; clampPitch(); }
    drag.x = e.clientX; drag.y = e.clientY;
    touched();
    draw();
  });
  ['pointerup', 'pointercancel'].forEach(function (t) {
    canvas.addEventListener(t, function () { drag = null; });
  });

  canvas.addEventListener('keydown', function (e) {
    if (!pts) return;
    var handled = true;
    switch (e.key) {
      case 'ArrowLeft': view.yaw -= 0.1; break;
      case 'ArrowRight': view.yaw += 0.1; break;
      case 'ArrowUp': view.pitch -= 0.1; clampPitch(); break;
      case 'ArrowDown': view.pitch += 0.1; clampPitch(); break;
      case '+': case '=': zoomBy(1.2); return e.preventDefault();
      case '-': case '_': zoomBy(1 / 1.2); return e.preventDefault();
      case '0': view.yaw = DEFAULT.yaw; view.pitch = DEFAULT.pitch; view.zoom = DEFAULT.zoom; break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); touched(); draw(); }
  });

  fig.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-scan]');
    if (!btn) return;
    var action = btn.getAttribute('data-scan');
    if (action === 'zoom-in') zoomBy(1.25);
    else if (action === 'zoom-out') zoomBy(1 / 1.25);
    else if (action === 'reset') { view.yaw = DEFAULT.yaw; view.pitch = DEFAULT.pitch; view.zoom = DEFAULT.zoom; draw(); }
    else if (action === 'spin') {
      spinning = !spinning;
      btn.setAttribute('aria-pressed', String(spinning));
      lastInteract = 0;
    }
  });

  /* ---------- Lifecycle: load only when near the viewport ---------- */
  if ('ResizeObserver' in window) new ResizeObserver(function () { if (pts) resize(); }).observe(canvas);
  else window.addEventListener('resize', function () { if (pts) resize(); });

  if ('IntersectionObserver' in window) {
    var started = false;
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible && !started) { started = true; load(); }
    }, { rootMargin: '200px 0px' }).observe(fig);
  } else {
    visible = true;
    load();
  }
})();
