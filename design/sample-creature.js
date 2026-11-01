// 拼图小样用的小人：全部用矩形拼，便于保持像素感
const BODY = '#C2694B';
const EYE = '#241F1A';
const DARK = '#8C4A32';
const PROP = '#8A6A4C';
const LIGHT = '#E8DCC6';

const r = (x, y, w, h, fill, rx = 0) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;

function eyes(mode) {
  if (mode === 'closed') {
    return r(-5, -2, 3, 1.4, EYE) + r(2, -2, 3, 1.4, EYE);
  }
  return r(-5, -3, 3, 3, EYE) + r(2, -3, 3, 3, EYE);
}

function base(pose) {
  // 身体
  let s = r(-8, -6, 16, 12, BODY, 1);
  s += eyes(pose === 'sleep' ? 'closed' : 'open');
  return s;
}

function arms(pose) {
  switch (pose) {
    case 'wave':
      return r(-12, -5, 4, 7, BODY) + r(8, -12, 4, 10, BODY, 1);
    case 'eat':
      return r(-16, 0, 5, 4, BODY) + r(11, -1, 6, 4, BODY);
    case 'drink':
      return r(-12, -3, 4, 6, BODY) + r(9, -8, 4, 10, BODY, 1);
    case 'read':
      return r(-12, -1, 4, 5, BODY) + r(8, -1, 4, 5, BODY);
    case 'carry':
      return r(-11, -4, 4, 8, BODY) + r(7, -4, 4, 8, BODY);
    case 'jump':
      return r(-13, -8, 5, 6, BODY) + r(8, -8, 5, 6, BODY);
    case 'sit':
      return r(-12, 1, 4, 4, BODY) + r(8, 1, 4, 4, BODY);
    default:
      return r(-13, -2, 5, 4, BODY) + r(8, -2, 5, 4, BODY);
  }
}

function legs(pose) {
  switch (pose) {
    case 'walk':
      return r(-7, 6, 4, 7, BODY) + r(-2, 6, 4, 4, BODY) + r(3, 6, 4, 8, BODY);
    case 'jump':
      return r(-5, 6, 4, 3, BODY) + r(-1, 6, 4, 3, BODY) + r(3, 6, 4, 3, BODY);
    case 'sleep':
      return r(-6, 6, 4, 2, BODY) + r(1, 6, 5, 2, BODY);
    case 'sit':
      return r(-6, 5, 12, 3, BODY);
    default:
      return r(-6, 6, 4, 6, BODY) + r(-2, 6, 4, 6, BODY) + r(2, 6, 4, 6, BODY);
  }
}

function props(pose) {
  switch (pose) {
    case 'eat':
      // 碗：上宽下窄，加一道碗沿
      return `<path d="M 11 2 L 25 2 L 22 9 L 14 9 Z" fill="${PROP}"/>` +
             r(10, 1, 16, 2, DARK, 1) +
             r(16, -1, 2, 3, LIGHT);
    case 'drink':
      // 杯子 + 吸管
      return r(12, -2, 8, 11, PROP, 1) + r(13, -1, 6, 2, LIGHT) +
             `<path d="M 18 -3 L 23 -11" stroke="${DARK}" stroke-width="1.8" stroke-linecap="round"/>`;
    case 'read':
      // 摊开的书，捧在身前
      return `<path d="M 8 3 L 17 2 L 17 10 L 8 11 Z" fill="${PROP}"/>` +
             `<path d="M 17 2 L 26 3 L 26 11 L 17 10 Z" fill="${DARK}"/>` +
             r(10, 5, 5, 1, LIGHT) + r(19, 5, 5, 1, LIGHT);
    case 'carry':
      // 抱一个箱子
      return r(7, -8, 13, 9, PROP, 1) + r(7, -5, 13, 1.4, DARK);
    case 'sleep':
      return `<text x="11" y="-4" font-size="11" fill="${DARK}" font-family="Georgia, serif">z</text>` +
             `<text x="17" y="-11" font-size="8" fill="${DARK}" font-family="Georgia, serif">z</text>`;
    default:
      return '';
  }
}

// 让一块拼图里的小人：整块都朝内、居中，稍微错开避免机械对称
function creature(pose, cx, cy, s = 1, flip = 1) {
  return `<g transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${(s * flip).toFixed(3)} ${s.toFixed(3)})">
    ${arms(pose)}${legs(pose)}${base(pose)}${props(pose)}
  </g>`;
}

const POSES = ['stand', 'walk', 'sleep', 'eat'];

function buildPuzzleCreatures(el, opts = {}) {
  const W = 260, H = 462;
  const { pieces, cw, ch } = jigsaw(W, H, opts.cols || 4, opts.rows || 7, opts.seed || 11);
  const hole = opts.hole ? Math.floor(pieces.length / 2) : -1;
  const rand = rng((opts.seed || 11) * 7 + 3);

  let defs = '';
  let body = '';

  pieces.forEach((p, i) => {
    const id = 'clip' + i;
    defs += `<clipPath id="${id}"><path d="${p.d}"/></clipPath>`;
    if (i === hole) {
      body += `<path d="${p.d}" fill="#E7DECC"/>`;
      body += `<path d="${p.d}" fill="none" stroke="rgba(59,52,44,0.16)" stroke-width="5" filter="url(#soft)"/>`;
      return;
    }
    body += `<path d="${p.d}" fill="${p.tone}" stroke="rgba(59,52,44,0.08)" stroke-width="0.8"/>`;

    if (rand() < 0.18) return;   // 留些空块，画面才透气

    const pose = POSES[Math.floor(rand() * POSES.length)];
    const flip = rand() < 0.5 ? -1 : 1;
    const s = (opts.scale || 0.8) * (0.9 + rand() * 0.2);
    const ox = (rand() - 0.5) * cw * 0.2;
    const oy = (rand() - 0.5) * ch * 0.18;
    body += `<g clip-path="url(#${id})">${creature(pose, p.cx + ox, p.cy + oy + 2, s, flip)}</g>`;
  });

  const glow = hole >= 0
    ? `<circle cx="${pieces[hole].cx}" cy="${pieces[hole].cy}" r="88" fill="url(#g2)"/>`
    : '';

  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      ${defs}
      <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4"/>
      </filter>
      <radialGradient id="g2" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(232,163,61,0.22)"/>
        <stop offset="100%" stop-color="rgba(232,163,61,0)"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#F6F0E4"/>
    ${body}
    ${glow}
  </svg>`;
}

