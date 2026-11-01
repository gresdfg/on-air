// 拼图背景：整张舞台由一块块拼图组成，每块里一个小人，正中缺一块
(function () {
  const BODY = '#CE8A6D';
  const EYE = '#4A3A30';
  const DARK = '#A8785E';
  const PROP = '#B09070';
  const LIGHT = '#E8DCC6';
  const TONES = ['#F8F3E8', '#F4EEE1', '#F0E9DA', '#EDE4D3', '#F7F1E4', '#EFE7D6'];

  const rect = (x, y, w, h, fill, rx) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ''} fill="${fill}"/>`;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function edgePath(x0, y0, x1, y1, sign) {
    const dx = x1 - x0, dy = y1 - y0;
    const L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L;
    const nx = -uy, ny = ux;
    const amp = 0.155 * L * sign;
    const at = (t, off) => [x0 + ux * L * t + nx * off, y0 + uy * L * t + ny * off];
    const [ax, ay] = at(0.38, 0);
    const [c1x, c1y] = at(0.44, amp);
    const [c2x, c2y] = at(0.56, amp);
    const [bx, by] = at(0.62, 0);
    const f = (n) => n.toFixed(2);
    return `L ${f(ax)} ${f(ay)} C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(bx)} ${f(by)} L ${f(x1)} ${f(y1)}`;
  }

  function jigsaw(w, h, cols, rows, seed) {
    const rand = rng(seed);
    const cw = w / cols, ch = h / rows;
    const vEdge = {}, hEdge = {};
    const pieces = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = c * cw, y0 = r * ch, x1 = x0 + cw, y1 = y0 + ch;
        let d = `M ${x0.toFixed(2)} ${y0.toFixed(2)}`;
        if (r === 0) d += ` L ${x1} ${y0}`;
        else {
          const k = `h${r}-${c}`;
          if (!(k in hEdge)) hEdge[k] = (rand() < 0.5 ? 1 : -1) * -1;
          d += ' ' + edgePath(x0, y0, x1, y0, hEdge[k]);
        }
        if (c === cols - 1) d += ` L ${x1} ${y1}`;
        else {
          const k = `v${r}-${c}`;
          if (!(k in vEdge)) vEdge[k] = rand() < 0.5 ? 1 : -1;
          d += ' ' + edgePath(x1, y0, x1, y1, vEdge[k]);
        }
        if (r === rows - 1) d += ` L ${x0} ${y1}`;
        else {
          const k = `h${r + 1}-${c}`;
          if (!(k in hEdge)) hEdge[k] = (rand() < 0.5 ? 1 : -1) * -1;
          d += ' ' + edgePath(x1, y1, x0, y1, hEdge[k] * -1);
        }
        if (c === 0) d += ` L ${x0} ${y0}`;
        else {
          const k = `v${r}-${c - 1}`;
          if (!(k in vEdge)) vEdge[k] = rand() < 0.5 ? 1 : -1;
          d += ' ' + edgePath(x0, y1, x0, y0, vEdge[k] * -1);
        }
        pieces.push({ d: d + ' Z', cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, c, r, tone: TONES[Math.floor(rand() * TONES.length)] });
      }
    }
    return { pieces, cw, ch };
  }

  function base(pose) {
    let s = rect(-8, -6, 16, 12, BODY, 1);
    s += pose === 'sleep'
      ? rect(-5, -2, 3, 1.4, EYE) + rect(2, -2, 3, 1.4, EYE)
      : rect(-5, -3, 3, 3, EYE) + rect(2, -3, 3, 3, EYE);
    return s;
  }

  function arms(pose) {
    if (pose === 'eat') return rect(-16, 0, 5, 4, BODY) + rect(11, -1, 6, 4, BODY);
    if (pose === 'sleep') return rect(-11, -3, 4, 5, BODY) + rect(7, -3, 4, 5, BODY);
    return rect(-13, -2, 5, 4, BODY) + rect(8, -2, 5, 4, BODY);
  }

  function legs(pose) {
    if (pose === 'walk') return rect(-7, 6, 4, 7, BODY) + rect(-2, 6, 4, 4, BODY) + rect(3, 6, 4, 8, BODY);
    if (pose === 'sleep') return rect(-6, 6, 4, 2, BODY) + rect(1, 6, 5, 2, BODY);
    return rect(-6, 6, 4, 6, BODY) + rect(-2, 6, 4, 6, BODY) + rect(2, 6, 4, 6, BODY);
  }

  function props(pose) {
    if (pose === 'eat') {
      return `<path d="M 11 2 L 25 2 L 22 9 L 14 9 Z" fill="${PROP}"/>` + rect(10, 1, 16, 2, DARK, 1);
    }
    if (pose === 'sleep') {
      return `<text x="11" y="-4" font-size="11" fill="${DARK}" font-family="Georgia, serif">z</text>`;
    }
    return '';
  }

  function creature(pose, cx, cy, s, flip) {
    return `<g transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${(s * flip).toFixed(3)} ${s.toFixed(3)})">${arms(pose)}${legs(pose)}${base(pose)}${props(pose)}</g>`;
  }

  const POSES = ['stand', 'walk', 'sleep', 'eat'];

  window.renderPuzzle = function (el, W, H) {
    if (!W || !H) return;
    const aspect = W / H;
    const target = 96;
    const cols = Math.min(16, Math.max(3, Math.round(W / target)));
    const rows = Math.min(12, Math.max(3, Math.round(H / target)));
    const rand = rng(20261101);
    const { pieces, cw, ch } = jigsaw(W, H, cols, rows, 11);

    let hole = 0, best = Infinity;
    pieces.forEach((p, i) => {
      const d = Math.hypot(p.cx - W / 2, p.cy - H / 2);
      if (d < best) { best = d; hole = i; }
    });

    const scale = Math.min(cw, ch) / 88;
    let defs = '';
    let body = '';

    pieces.forEach((p, i) => {
      const id = `pz${i}`;
      defs += `<clipPath id="${id}"><path d="${p.d}"/></clipPath>`;
      if (i === hole) {
        body += `<path d="${p.d}" fill="rgba(232,222,204,0.55)"/>`;
        body += `<path d="${p.d}" fill="none" stroke="rgba(59,52,44,0.10)" stroke-width="${Math.max(3, cw * 0.05)}" filter="url(#pzsoft)"/>`;
        return;
      }
      body += `<path d="${p.d}" fill="${p.tone}" stroke="rgba(59,52,44,0.05)" stroke-width="0.7"/>`;
      if (rand() < 0.38) return;
      const pose = POSES[Math.floor(rand() * POSES.length)];
      const flip = rand() < 0.5 ? -1 : 1;
      const s = scale * (0.9 + rand() * 0.2);
      const ox = (rand() - 0.5) * cw * 0.2;
      const oy = (rand() - 0.5) * ch * 0.18;
      body += `<g clip-path="url(#${id})">${creature(pose, p.cx + ox, p.cy + oy, s, flip)}</g>`;
    });

    el.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        ${defs}
        <filter id="pzsoft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${Math.max(2, cw * 0.04)}"/></filter>
        <radialGradient id="pzvig" cx="50%" cy="44%" r="66%">
          <stop offset="45%" stop-color="rgba(255,255,255,0)"/>
          <stop offset="100%" stop-color="rgba(120,98,64,0.18)"/>
        </radialGradient>
      </defs>
      ${body}
      <rect width="${W}" height="${H}" fill="url(#pzvig)"/>
    </svg>`;
  };
})();
