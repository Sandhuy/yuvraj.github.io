/* Hero bus demo: a circuit board where real UART / SPI / I2C bit streams travel
   along the traces from U1 (MCU) to U2 (peripheral), plus a logic analyzer that
   probes U1's pins and decodes the same frames. One sequencer drives both, so the
   bit under the analyzer cursor is the bit leaving U1 at that moment.
   Decorative only (aria-hidden); static frame when reduced motion is requested. */
(function () {
  'use strict';

  var board = document.querySelector('.board');
  var la = document.querySelector('.la-screen');
  if (!board || !la) return;

  var scope = board.closest('.scope');
  var routeEl = document.querySelector('.bus-route');
  var protoShortEl = document.querySelector('.bus-proto');
  var protoEl = document.querySelector('.la-proto');
  var msgEl = document.querySelector('.la-msg');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var NS = 'http://www.w3.org/2000/svg';
  var SWEEP = 2600, HOLD = 2800, FADE = 450;

  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(parent, attrs, s) { var t = el('text', attrs, parent); t.textContent = s; return t; }

  /* ---------- Bit-accurate frames (one array entry = one time step) ---------- */
  function uart(text) {
    var tx = [], ann = [];
    var put = function (v, n) { for (var i = 0; i < n; i++) tx.push(v); };
    put(1, 2);                                              // idle high
    for (var c = 0; c < text.length; c++) {
      var code = text.charCodeAt(c), s = tx.length;
      put(0, 1);                                            // start bit
      for (var b = 0; b < 8; b++) put((code >> b) & 1, 1);  // data, LSB first
      put(1, 1);                                            // stop bit
      ann.push({ a: s + 1, b: s + 9, ch: text[c], code: code });
      put(1, 1);
    }
    put(1, 1);
    return {
      short: 'UART', label: 'UART · 115200 8N1', u2: 'USB-UART', u2sub: 'to PC', route: 'USB-UART',
      lanes: [
        { name: 'TX', far: 'RX', lv: tx, kind: 'data' },
        { name: 'RX', far: 'TX', lv: tx.map(function () { return 1; }), kind: 'data' }
      ],
      ann: ann
    };
  }

  function spi(text) {
    var cs = [], sck = [], mosi = [], ann = [];
    var put = function (c, k, m) { cs.push(c); sck.push(k); mosi.push(m); };
    put(1, 0, 0); put(1, 0, 0);
    put(0, 0, 0);                                           // CS asserted
    for (var c = 0; c < text.length; c++) {
      var code = text.charCodeAt(c), s = cs.length;
      for (var b = 7; b >= 0; b--) {                        // mode 0, MSB first
        var bit = (code >> b) & 1;
        put(0, 0, bit);
        put(0, 1, bit);                                     // sampled on rising edge
      }
      ann.push({ a: s, b: cs.length, ch: text[c], code: code });
      put(0, 0, 0);
    }
    put(1, 0, 0); put(1, 0, 0);                             // CS released
    return {
      short: 'SPI', label: 'SPI · mode 0 · MSB first', u2: 'FLASH', u2sub: 'SPI memory', route: 'SPI flash',
      lanes: [
        { name: 'CS', far: 'CS', lv: cs, kind: 'ctrl' },
        { name: 'SCK', far: 'SCK', lv: sck, kind: 'ctrl' },
        { name: 'MOSI', far: 'MOSI', lv: mosi, kind: 'data' }
      ],
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
      bit(0);                                               // ACK from the target
      return { a: s, b: e };
    };
    put(1, 1); put(1, 1);
    put(1, 0);                                              // START
    var a = byte((addr << 1) | 0);
    a.addr = '0x' + addr.toString(16).toUpperCase() + ' W';
    ann.push(a);
    for (var c = 0; c < text.length; c++) {
      var f = byte(text.charCodeAt(c));
      f.ch = text[c]; f.code = text.charCodeAt(c);
      ann.push(f);
    }
    put(0, 0); put(1, 0); put(1, 1); put(1, 1);             // STOP
    var hex = '0x' + addr.toString(16).toUpperCase();
    return {
      short: 'I²C', label: 'I²C · addr ' + hex, u2: 'ToF', u2sub: 'sensor ' + hex, route: 'ToF sensor',
      lanes: [
        { name: 'SCL', far: 'SCL', lv: scl, kind: 'ctrl' },
        { name: 'SDA', far: 'SDA', lv: sda, kind: 'data' }
      ],
      ann: ann
    };
  }

  var scenes = [uart('YUVRAJ'), spi('SANDHU'), i2c(0x29, '2026')];

  /* ---------- Board ---------- */
  var U1 = { x: 26, y: 62, w: 92, h: 116 };
  var U2 = { x: 282, y: 62, w: 92, h: 116 };
  var UNIT = 3.5;            // trace length per time step
  var boardLanes = [];       // { sig, glow, lv, len }

  var PINS = 7;
  function pinY(c, i) { return c.y + 12 + i * ((c.h - 24) / (PINS - 1)); }
  // lanes sit exactly on chip pins, spread symmetrically
  function laneYs(n) {
    var idx = n === 1 ? [3] : n === 2 ? [2, 4] : [1, 3, 5];
    return idx.map(function (i) { return pinY(U1, i); });
  }

  function chip(g, c, ref, name, sub, activeYs, side) {
    var grp = el('g', { class: 'bd-chip' }, g);
    // decorative pins on both edges; the ones carrying a lane light up
    for (var i = 0; i < PINS; i++) {
      var py = pinY(c, i);
      ['l', 'r'].forEach(function (e) {
        var px = e === 'l' ? c.x - 6 : c.x + c.w;
        var on = e === side && activeYs.some(function (y) { return Math.abs(y - py) < 0.5; });
        el('rect', { x: px, y: py - 2, width: 6, height: 4, rx: 0.8, class: on ? 'bd-pin on' : 'bd-pin' }, grp);
      });
    }
    el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 4, class: 'bd-body' }, grp);
    el('circle', { cx: c.x + 8, cy: c.y + 8, r: 2.2, class: 'bd-dot' }, grp);
    txt(grp, { x: c.x + c.w / 2, y: c.y + c.h / 2 - 2, class: 'bd-name' }, name);
    txt(grp, { x: c.x + c.w / 2, y: c.y + c.h / 2 + 11, class: 'bd-sub' }, sub);
    txt(grp, { x: c.x + c.w / 2, y: c.y - 7, class: 'bd-ref' }, ref);
  }

  function renderBoard(sc) {
    while (board.firstChild) board.removeChild(board.firstChild);
    var root = el('g', { class: 'bd-root' }, board);

    // dotted PCB grid
    var defs = el('defs', {}, board);
    var pat = el('pattern', { id: 'bd-dots', width: 10, height: 10, patternUnits: 'userSpaceOnUse' }, defs);
    el('circle', { cx: 5, cy: 5, r: 0.7, class: 'bd-grid' }, pat);
    el('rect', { width: 400, height: 240, fill: 'url(#bd-dots)' }, root);

    // a little silkscreen
    txt(root, { x: 10, y: 228, class: 'bd-silk' }, 'YS-BUS rev A');
    txt(root, { x: 390, y: 228, class: 'bd-silk bd-silk-end' }, sc.short + ' demo');

    var ys = laneYs(sc.lanes.length);
    var n = sc.lanes.length;
    var traceG = el('g', {}, root);
    boardLanes = [];

    // chips first, so the pin names drawn below sit on top of the chip bodies
    chip(root, U1, 'U1', 'MCU', 'controller', ys, 'r');
    chip(root, U2, 'U2', sc.u2, sc.u2sub, ys, 'l');

    sc.lanes.forEach(function (lane, i) {
      var y = ys[i];
      // route with 45° jogs; outer lanes bow away from the centre
      var bow = (i - (n - 1) / 2) * 34;
      var x1 = U1.x + U1.w + 6, x2 = U2.x - 6;
      var j = Math.abs(bow);
      var pts = bow === 0
        ? [[x1, y], [x2, y]]
        : [[x1, y], [x1 + 18, y], [x1 + 18 + j, y + bow], [x2 - 18 - j, y + bow], [x2 - 18, y], [x2, y]];
      var fwd = 'M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join('L');
      var rev = 'M' + pts.slice().reverse().map(function (p) { return p[0] + ' ' + p[1]; }).join('L');

      el('path', { d: fwd, class: 'bd-trace' }, traceG);
      var glow = el('path', { d: rev, class: 'bd-glow bd-' + lane.kind }, traceG);
      var sig = el('path', { d: rev, class: 'bd-sig bd-' + lane.kind }, traceG);
      // pads at both ends
      el('circle', { cx: x1, cy: y, r: 2.6, class: 'bd-pad' }, traceG);
      el('circle', { cx: x2, cy: y, r: 2.6, class: 'bd-pad' }, traceG);
      if (bow !== 0) el('circle', { cx: (x1 + x2) / 2, cy: y + bow, r: 3.2, class: 'bd-via' }, traceG);

      var len = sig.getTotalLength();
      var dash = dashFor(lane.lv, len);
      sig.setAttribute('stroke-dasharray', dash);
      glow.setAttribute('stroke-dasharray', dash);
      boardLanes.push({ sig: sig, glow: glow, n: lane.lv.length, len: len });

      // pin names inside the chips
      txt(root, { x: U1.x + U1.w - 6, y: y + 3, class: 'bd-pinname bd-pinname-r' }, lane.name);
      txt(root, { x: U2.x + 6, y: y + 3, class: 'bd-pinname' }, lane.far);
    });

    // probe marker showing where the logic analyzer is clipped on
    var px = U1.x + U1.w + 14;
    el('path', { d: 'M' + px + ' ' + (ys[ys.length - 1] + 8) + 'V' + 214, class: 'bd-probe' }, root);
    txt(root, { x: px + 4, y: 214, class: 'bd-probe-label' }, 'LA probe');

    if (routeEl) routeEl.textContent = 'MCU → ' + sc.route;
    if (protoShortEl) protoShortEl.textContent = sc.short;
  }

  // Encode a lane's levels as a dash pattern: lit dashes where the line is high.
  // Padded with the idle level on both sides so the pattern never wraps on screen.
  function dashFor(lv, len) {
    var runs = [];
    var add = function (v, l) {
      if (runs.length && runs[runs.length - 1][0] === v) runs[runs.length - 1][1] += l;
      else runs.push([v, l]);
    };
    add(lv[0], len + 4);
    for (var i = 0; i < lv.length; i++) add(lv[i], UNIT);
    add(lv[lv.length - 1], len + 4);
    var arr = runs[0][0] === 0 ? [0] : [];
    runs.forEach(function (r) { arr.push(+r[1].toFixed(2)); });
    if (arr.length % 2) arr.push(0);
    return arr.join(' ');
  }

  // p = 0..1 through the capture (and beyond, while the last bits drain into U2).
  // The path is drawn U2→U1, so a growing dash offset carries every bit from U1
  // toward U2; the newest bit sits at U1's pin.
  function setBoard(p) {
    boardLanes.forEach(function (l) {
      var off = Math.min(p * l.n * UNIT, l.n * UNIT + l.len).toFixed(2);
      l.sig.setAttribute('stroke-dashoffset', off);
      l.glow.setAttribute('stroke-dashoffset', off);
    });
  }

  /* ---------- Logic analyzer ---------- */
  var X0 = 38, X1 = 396, ROWS = [6, 30, 54], HI = 3, LO = 17, ANN_Y = 80, ANN_H = 15;
  var revealRect, cursor, annEnds = [];

  function lanePath(lv, top, dx) {
    var y = function (v) { return top + (v ? HI : LO); };
    var d = 'M' + X0 + ' ' + y(lv[0]);
    for (var i = 1; i < lv.length; i++) {
      if (lv[i] !== lv[i - 1]) d += 'H' + (X0 + i * dx).toFixed(2) + 'V' + y(lv[i]);
    }
    return d + 'H' + X1;
  }

  function renderLA(sc) {
    while (la.firstChild) la.removeChild(la.firstChild);
    var defs = el('defs', {}, la);
    var clip = el('clipPath', { id: 'la-clip' }, defs);
    revealRect = el('rect', { x: 0, y: 0, width: X0, height: 104 }, clip);
    var root = el('g', { class: 'la-root' }, la);

    var grid = el('g', { class: 'la-grid' }, root);
    for (var gx = 1; gx < 8; gx++) {
      var x = X0 + (X1 - X0) * gx / 8;
      el('line', { x1: x, x2: x, y1: 2, y2: 98 }, grid);
    }

    var dx = (X1 - X0) / sc.lanes[0].lv.length;
    sc.lanes.forEach(function (lane, i) { txt(root, { x: 3, y: ROWS[i] + 12, class: 'la-label' }, lane.name); });
    txt(root, { x: 3, y: ANN_Y + ANN_H / 2 + 3, class: 'la-label la-label-dim' }, 'DEC');

    var plot = el('g', { 'clip-path': 'url(#la-clip)' }, root);
    sc.lanes.forEach(function (lane, i) {
      el('path', { d: lanePath(lane.lv, ROWS[i], dx), class: 'la-sig la-sig-' + lane.kind }, plot);
    });

    annEnds = [];
    sc.ann.forEach(function (a) {
      var ax = X0 + a.a * dx, w = (a.b - a.a) * dx;
      var g = el('g', { class: a.addr ? 'la-ann la-ann-addr' : 'la-ann' }, plot);
      el('rect', { x: ax + 0.6, y: ANN_Y, width: Math.max(1, w - 1.2), height: ANN_H, rx: 3 }, g);
      txt(g, { x: ax + w / 2, y: ANN_Y + ANN_H / 2 + 3 }, a.addr || (a.ch + ' ' + a.code.toString(16).toUpperCase()));
      if (a.ch) annEnds.push({ x: ax + w, ch: a.ch });
    });

    cursor = el('line', { class: 'la-cursor', x1: X0, x2: X0, y1: 2, y2: 98 }, root);
    if (protoEl) protoEl.textContent = sc.label;
  }

  function setLA(p) {
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
  function show(i) { renderBoard(scenes[i]); renderLA(scenes[i]); }
  function at(p) { setBoard(p); setLA(p); }

  show(idx);

  if (reduceMotion) {
    // a still frame: bits mid-flight on the board, fully decoded capture below
    setBoard(0.55);
    setLA(1);
    return;
  }
  at(0);

  var phase = 'sweep', tPhase = 0, last = null;
  function frame(now) {
    if (last === null) last = now;
    var dt = Math.min(now - last, 100);   // avoid a jump after the tab was in the background
    last = now;
    var paused = document.hidden || (scope && scope.classList.contains('is-paused'));
    if (!paused) {
      tPhase += dt;
      if (phase === 'sweep') {
        var p = Math.min(1, tPhase / SWEEP);
        at(p);
        if (p >= 1) { phase = 'hold'; tPhase = 0; }
      } else if (phase === 'hold') {
        setBoard(1 + tPhase / SWEEP);       // keep the last bits flowing into U2
        if (tPhase > HOLD) {
          scope.classList.add('is-fading');
          phase = 'fade'; tPhase = 0;
        }
      } else if (phase === 'fade' && tPhase > FADE) {
        idx = (idx + 1) % scenes.length;
        show(idx);
        at(0);
        scope.classList.remove('is-fading');
        phase = 'sweep'; tPhase = 0;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
