/* Logic-analyzer strip under the hero oscilloscope.
   Cycles through bit-accurate UART, SPI and I2C frames, sweeping each capture in
   behind a trigger cursor while the decoded text fills in. Decorative only
   (aria-hidden); static UART frame when reduced motion is requested. */
(function () {
  'use strict';

  var svg = document.querySelector('.la-screen');
  if (!svg) return;
  var protoEl = document.querySelector('.la-proto');
  var msgEl = document.querySelector('.la-msg');
  var scope = svg.closest('.scope');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var NS = 'http://www.w3.org/2000/svg';
  var X0 = 38, X1 = 396;            // plot area (label column on the left)
  var ROWS = [6, 30, 54];           // lane tops
  var HI = 3, LO = 17;              // high / low offsets within a lane
  var ANN_Y = 80, ANN_H = 15;       // decode row
  var SWEEP = 2600, HOLD = 2800, FADE = 450;

  /* ---------- Bit-accurate frames (one array entry = one time step) ---------- */
  function uart(text) {
    var tx = [], ann = [];
    var put = function (v, n) { for (var i = 0; i < n; i++) tx.push(v); };
    put(1, 2);                                        // idle high
    for (var c = 0; c < text.length; c++) {
      var code = text.charCodeAt(c), s = tx.length;
      put(0, 1);                                      // start bit
      for (var b = 0; b < 8; b++) put((code >> b) & 1, 1);  // data, LSB first
      put(1, 1);                                      // stop bit
      ann.push({ a: s + 1, b: s + 9, ch: text[c], code: code });
      put(1, 1);                                      // inter-byte idle
    }
    put(1, 1);
    return {
      label: 'UART · 115200 8N1',
      lanes: [{ name: 'TX', lv: tx, kind: 'data' }, { name: 'RX', lv: tx.map(function () { return 1; }), kind: 'data' }],
      ann: ann
    };
  }

  function spi(text) {
    var cs = [], sck = [], mosi = [], ann = [];
    var put = function (c, k, m) { cs.push(c); sck.push(k); mosi.push(m); };
    put(1, 0, 0); put(1, 0, 0);                       // idle, CS high
    put(0, 0, 0);                                     // CS asserted
    for (var c = 0; c < text.length; c++) {
      var code = text.charCodeAt(c), s = cs.length;
      for (var b = 7; b >= 0; b--) {                  // mode 0, MSB first
        var bit = (code >> b) & 1;
        put(0, 0, bit);                               // data set while SCK low
        put(0, 1, bit);                               // sampled on rising edge
      }
      ann.push({ a: s, b: cs.length, ch: text[c], code: code });
      put(0, 0, 0);
    }
    put(1, 0, 0); put(1, 0, 0);                       // CS released
    return {
      label: 'SPI · mode 0 · MSB first',
      lanes: [{ name: 'CS', lv: cs, kind: 'ctrl' }, { name: 'SCK', lv: sck, kind: 'ctrl' }, { name: 'MOSI', lv: mosi, kind: 'data' }],
      ann: ann
    };
  }

  function i2c(addr, text) {
    var scl = [], sda = [], ann = [];
    var put = function (k, d) { scl.push(k); sda.push(d); };
    var bit = function (v) { put(0, v); put(1, v); };
    var byte = function (v) {
      var s = scl.length;
      for (var b = 7; b >= 0; b--) bit((v >> b) & 1);
      var e = scl.length;
      bit(0);                                         // ACK from the target
      return { a: s, b: e };
    };
    put(1, 1); put(1, 1);                             // idle
    put(1, 0);                                        // START: SDA falls while SCL high
    var a = byte((addr << 1) | 0);                    // 7-bit address + write
    a.addr = '0x' + addr.toString(16).toUpperCase() + ' W';
    ann.push(a);
    for (var c = 0; c < text.length; c++) {
      var f = byte(text.charCodeAt(c));
      f.ch = text[c]; f.code = text.charCodeAt(c);
      ann.push(f);
    }
    put(0, 0); put(1, 0); put(1, 1); put(1, 1);       // STOP: SDA rises while SCL high
    return {
      label: 'I²C · addr 0x' + addr.toString(16).toUpperCase(),
      lanes: [{ name: 'SCL', lv: scl, kind: 'ctrl' }, { name: 'SDA', lv: sda, kind: 'data' }],
      ann: ann
    };
  }

  var scenes = [uart('YUVRAJ'), spi('SANDHU'), i2c(0x29, '2026')];

  /* ---------- Rendering ---------- */
  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function lanePath(lv, top, dx) {
    var y = function (v) { return top + (v ? HI : LO); };
    var d = 'M' + X0 + ' ' + y(lv[0]);
    for (var i = 1; i < lv.length; i++) {
      if (lv[i] !== lv[i - 1]) d += 'H' + (X0 + i * dx).toFixed(2) + 'V' + y(lv[i]);
    }
    return d + 'H' + X1;
  }

  var revealRect, cursor, scene, annEnds = [];

  function render(sc) {
    scene = sc;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var defs = el('defs', {}, svg);
    var clip = el('clipPath', { id: 'la-clip' }, defs);
    revealRect = el('rect', { x: 0, y: 0, width: X0, height: 104 }, clip);

    var root = el('g', { class: 'la-root' }, svg);

    // faint vertical grid
    var grid = el('g', { class: 'la-grid' }, root);
    for (var gx = 1; gx < 8; gx++) {
      var x = X0 + (X1 - X0) * gx / 8;
      el('line', { x1: x, x2: x, y1: 2, y2: 98 }, grid);
    }

    var n = sc.lanes[0].lv.length;
    var dx = (X1 - X0) / n;

    sc.lanes.forEach(function (lane, i) {
      var t = el('text', { x: 3, y: ROWS[i] + 12, class: 'la-label' }, root);
      t.textContent = lane.name;
    });
    var dl = el('text', { x: 3, y: ANN_Y + ANN_H / 2 + 3, class: 'la-label la-label-dim' }, root);
    dl.textContent = 'DEC';

    var plot = el('g', { 'clip-path': 'url(#la-clip)' }, root);
    sc.lanes.forEach(function (lane, i) {
      el('path', { d: lanePath(lane.lv, ROWS[i], dx), class: 'la-sig la-sig-' + lane.kind }, plot);
    });

    annEnds = [];
    sc.ann.forEach(function (a) {
      var x = X0 + a.a * dx, w = (a.b - a.a) * dx;
      var g = el('g', { class: a.addr ? 'la-ann la-ann-addr' : 'la-ann' }, plot);
      el('rect', { x: x + 0.6, y: ANN_Y, width: Math.max(1, w - 1.2), height: ANN_H, rx: 3 }, g);
      var t = el('text', { x: x + w / 2, y: ANN_Y + ANN_H / 2 + 3 }, g);
      t.textContent = a.addr || (a.ch + ' ' + a.code.toString(16).toUpperCase());
      if (a.ch) annEnds.push({ x: x + w, ch: a.ch });
    });

    cursor = el('line', { class: 'la-cursor', x1: X0, x2: X0, y1: 2, y2: 98 }, root);
    if (protoEl) protoEl.textContent = sc.label;
  }

  function setReveal(p) {
    var x = X0 + p * (X1 - X0);
    revealRect.setAttribute('width', x);
    cursor.setAttribute('x1', x);
    cursor.setAttribute('x2', x);
    cursor.style.opacity = p > 0 && p < 1 ? 1 : 0;
    var text = '';
    for (var i = 0; i < annEnds.length; i++) if (annEnds[i].x <= x + 0.5) text += annEnds[i].ch;
    if (msgEl) msgEl.textContent = text ? '“' + text + '”' : '';
  }

  /* ---------- Sequencer ---------- */
  var idx = 0;
  render(scenes[idx]);

  if (reduceMotion) { setReveal(1); return; }
  setReveal(0);

  var phase = 'sweep', tPhase = 0, last = null;
  function frame(now) {
    if (last === null) last = now;
    var dt = Math.min(now - last, 100);
    last = now;
    var paused = document.hidden || (scope && scope.classList.contains('is-paused'));
    if (!paused) {
      tPhase += dt;
      if (phase === 'sweep') {
        var p = Math.min(1, tPhase / SWEEP);
        setReveal(p);
        if (p >= 1) { phase = 'hold'; tPhase = 0; }
      } else if (phase === 'hold' && tPhase > HOLD) {
        svg.classList.add('is-fading');
        phase = 'fade'; tPhase = 0;
      } else if (phase === 'fade' && tPhase > FADE) {
        idx = (idx + 1) % scenes.length;
        render(scenes[idx]);
        setReveal(0);
        svg.classList.remove('is-fading');
        phase = 'sweep'; tPhase = 0;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
