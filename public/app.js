const $ = (id) => document.getElementById(id);

const els = {
  slug: $('slug'),
  title: $('title'),
  chip: $('chip'),
  qtext: $('qtext'),
  qen: $('qen'),
  answer: $('answer'),
  stack: $('stack'),
  fill: $('fill'),
  bar: $('bar'),
  tLeft: $('t-left'),
  tRight: $('t-right'),
  state: $('state'),
  form: $('ask'),
  input: $('input'),
  notice: $('notice'),
};

const show = {
  phase: 'listening',
  waiting: false,
  items: [],
  nextIndex: 0,
  askId: 0,
  history: [],
  segments: [],
};

const audio = new Audio();
let audioCtx = null;
let analyser = null;
let freqData = null;

function ensureAudio() {
  if (audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  audioCtx = new Ctx();
  const source = audioCtx.createMediaElementSource(audio);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.58;
  source.connect(analyser);
  analyser.connect(audioCtx.destination);
  freqData = new Uint8Array(analyser.frequencyBinCount);
}

function setPhase(next) {
  show.phase = next;
  els.state.textContent = next;
}

function setNotice(msg) {
  els.notice.textContent = msg || '';
}

function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function clearAnswer() {
  clearTimeout(fadeTimer);
  els.stack.textContent = '';
  els.answer.scrollTop = 0;
  els.answer.classList.remove('overflowing');
}

function showAnswer(item) {
  clearTimeout(fadeTimer);
  const line = document.createElement('div');
  line.className = 'line';

  const en = document.createElement('div');
  en.className = 'en';
  en.textContent = item.en || '';

  const zh = document.createElement('div');
  zh.className = 'zh';
  zh.textContent = item.zh || '';

  line.append(en, zh);
  els.stack.append(line);
  requestAnimationFrame(() => line.classList.add('show'));

  els.answer.scrollTop = els.answer.scrollHeight;
  els.answer.classList.toggle('overflowing', els.answer.scrollHeight > els.answer.clientHeight + 6);
  while (els.stack.children.length > 12) els.stack.firstElementChild.remove();
}

function resetBar() {
  els.fill.style.width = '0%';
  els.tLeft.textContent = '0:00';
  els.tRight.textContent = '0:00';
}

let playToken = 0;
let fadeTimer = null;

function scheduleFade() {
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    els.stack.querySelectorAll('.line.show').forEach((l) => l.classList.remove('show'));
  }, 1800);
}

function setWaiting(on) {
  show.waiting = on;
  els.bar.classList.toggle('waiting', on);
  if (!on) els.fill.style.width = '0%';
}

function playFrom(index) {
  const item = show.items[index];
  show.nextIndex = index;
  if (!item) {
    setWaiting(true);
    if (show.phase !== 'speaking') setPhase('thinking');
    maybeFinish();
    return;
  }
  setWaiting(false);
  const token = ++playToken;
  setPhase('speaking');
  showAnswer(item);
  audio.src = item.url;
  audio.onended = () => {
    if (token !== playToken) return;
    playFrom(index + 1);
  };
  audio.play().catch((err) => {
    if (token !== playToken) return;
    setNotice(`播放失败：${err.message}`);
    playFrom(index + 1);
  });
}

function finish() {
  playToken += 1;
  show.nextIndex = show.items.length;
  setWaiting(false);
  setPhase('listening');
  resetBar();
  setTilesBlur(false);
  scheduleFade();
}

function maybeFinish() {
  const done = show.phase !== 'speaking' || (show.waiting && show.nextIndex >= show.items.length);
  if (show.done && done) finish();
}

function stopPlayback() {
  playToken += 1;
  audio.onended = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  show.items = [];
  show.nextIndex = 0;
  show.done = false;
  setWaiting(false);
  setTilesBlur(false);
  resetBar();
}

function setTilesBlur(on) {
  const el = document.getElementById('tiles');
  if (el) el.classList.toggle('blurred', on);
}

function glitchIn(el, ms = 460) {
  const t0 = performance.now();
  const step = () => {
    const p = (performance.now() - t0) / ms;
    if (p >= 1) {
      el.style.transform = '';
      el.style.textShadow = '';
      return;
    }
    const amp = (1 - p) * 10;
    el.style.transform = `translateX(${((Math.random() - 0.5) * amp).toFixed(2)}px)`;
    el.style.textShadow = `${((Math.random() - 0.5) * amp).toFixed(2)}px 0 rgba(162,78,58,0.4), ${((Math.random() - 0.5) * amp).toFixed(2)}px 0 rgba(60,130,145,0.28)`;
    requestAnimationFrame(step);
  };
  step();
}

async function ask(question) {
  ensureAudio();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  const askId = ++show.askId;
  els.qtext.textContent = question;
  glitchIn(els.qtext, 480);
  els.qen.textContent = '';
  els.qen.classList.remove('show');
  clearAnswer();
  setNotice('');
  stopPlayback();
  setPhase('thinking');
  setTilesBlur(true);

  let res;
  try {
    res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, history: show.history }),
    });
  } catch (err) {
    if (askId !== show.askId) return;
    setNotice(`连不上本地服务：${err.message}`);
    setPhase('listening');
    return;
  }
  if (!res.ok || !res.body) {
    if (askId !== show.askId) return;
    setNotice(`服务返回 ${res.status}`);
    setPhase('listening');
    return;
  }

  show.history.push({ role: 'user', content: question });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const answerEn = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      handle(ev, askId, answerEn);
    }
  }

  if (askId !== show.askId) return;
  if (answerEn.length) {
    show.history.push({ role: 'assistant', content: answerEn.join(' ') });
    if (show.history.length > 12) show.history = show.history.slice(-12);
  }
  show.done = true;
  maybeFinish();
}

function handle(ev, askId, answerEn) {
  if (askId !== show.askId) return;

  if (ev.type === 'stage') {
    if (show.phase !== 'speaking') setPhase('thinking');
    return;
  }
  if (ev.type === 'plan') {
    show.segments = ev.segments || [];
    if (ev.qEn) {
      els.qen.textContent = ev.qEn;
      els.qen.classList.add('show');
      glitchIn(els.qen, 360);
    }
    return;
  }
  if (ev.type === 'audio') {
    const seg = show.segments[ev.index] || { en: '', zh: '' };
    if (seg.en) answerEn.push(seg.en);
    show.items[ev.index] = { url: ev.url, en: seg.en, zh: seg.zh };
    if ((show.phase !== 'speaking' || show.waiting) && ev.index === show.nextIndex) playFrom(ev.index);
    return;
  }
  if (ev.type === 'error') {
    setNotice(ev.message);
    stopPlayback();
    setPhase('listening');
    return;
  }
  if (ev.type === 'done') {
    show.done = true;
    maybeFinish();
  }
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = els.input.value.trim();
  if (!q) return;
  els.input.value = '';
  ask(q);
});

function applyStatus(st) {
  if (st.show?.title) els.title.textContent = st.show.title;
  if (st.show?.slug) els.slug.textContent = `${st.show.slug} · claude · breeze.tts`;
  if (!st.brainReady || !st.voiceReady) {
    els.chip.hidden = false;
    els.chip.title = st.configPath || '';
    const missing = [];
    if (!st.brainReady) missing.push('大脑');
    if (!st.voiceReady) missing.push('语音');
    els.chip.textContent = `配置未填：${missing.join(' / ')}`;
  } else {
    els.chip.hidden = true;
  }
}

fetch('/api/status')
  .then((r) => r.json())
  .then((st) => {
    applyStatus(st);
    if (!st.brainReady || !st.voiceReady) {
      setNotice('点右上角的齿轮填配置，或者直接看着默认值先试。');
    }
  })
  .catch(() => {
    els.chip.hidden = false;
    els.chip.textContent = '服务未启动';
  });

const panel = {
  gear: $('gear'),
  sheet: $('sheet'),
  close: $('sheetclose'),
  form: $('settingsform'),
  msg: $('sheetmsg'),
  test: $('testvoice'),
  quit: $('quitapp'),
  baseUrl: $('cfgBaseUrl'),
  brainKey: $('cfgBrainKey'),
  model: $('cfgModel'),
  voiceKey: $('cfgVoiceKey'),
  voiceId: $('cfgVoiceId'),
  proxy: $('cfgProxy'),
};

async function openSheet() {
  panel.msg.textContent = '';
  panel.sheet.hidden = false;
  try {
    const c = await (await fetch('/api/config')).json();
    panel.baseUrl.value = c.brain.baseUrl || '';
    panel.model.value = c.brain.model || '';
    panel.voiceId.value = c.voice.voiceId || '';
    panel.proxy.value = c.voice.proxy || '';
    panel.brainKey.value = '';
    panel.voiceKey.value = '';
    panel.brainKey.placeholder = c.brain.keyMask ? `已设置 ${c.brain.keyMask}，留空不改` : '还没填';
    panel.voiceKey.placeholder = c.voice.keyFromEnv
      ? '来自环境变量 BREEZE_API_KEY'
      : c.voice.keyMask
        ? `已设置 ${c.voice.keyMask}，留空不改`
        : '还没填';
  } catch (err) {
    panel.msg.textContent = `读不到配置：${err.message}`;
  }
}

panel.gear.addEventListener('click', openSheet);
panel.close.addEventListener('click', () => { panel.sheet.hidden = true; });

panel.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  panel.msg.textContent = '保存中…';
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        brain: { baseUrl: panel.baseUrl.value, model: panel.model.value, apiKey: panel.brainKey.value },
        voice: { voiceId: panel.voiceId.value, proxy: panel.proxy.value, apiKey: panel.voiceKey.value },
      }),
    });
    const st = await res.json();
    applyStatus(st);
    if (st.brainReady && st.voiceReady) {
      panel.msg.textContent = '已保存，关掉面板就能开始说了。';
      setNotice('');
    } else {
      const missing = [!st.brainReady && '大脑', !st.voiceReady && '语音'].filter(Boolean).join('、');
      panel.msg.textContent = `已保存，但还差：${missing}`;
    }
    panel.brainKey.value = '';
    panel.voiceKey.value = '';
  } catch (err) {
    panel.msg.textContent = `保存失败：${err.message}`;
  }
});

panel.test.addEventListener('click', async () => {
  panel.test.disabled = true;
  panel.msg.textContent = '正在合成，等几秒…';
  try {
    const j = await (await fetch('/api/test-voice', { method: 'POST' })).json();
    if (!j.ok) {
      panel.msg.textContent = j.error;
      return;
    }
    await new Audio(j.url).play();
    panel.msg.textContent = '试听成功——这就是对话里用的声音。';
  } catch (err) {
    panel.msg.textContent = `试听失败：${err.message}`;
  } finally {
    panel.test.disabled = false;
  }
});

panel.quit.addEventListener('click', async () => {
  if (!window.confirm('退出后服务就停了，窗口里也不会再有回应。确定退出？')) return;
  panel.msg.textContent = '正在退出…';
  await fetch('/api/shutdown', { method: 'POST' }).catch(() => {});
  panel.msg.textContent = '服务已停止，可以关掉这个窗口了。';
});

const fsBtn = $('fsbtn');

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
    setNotice('');
  } catch (err) {
    setNotice(`这个窗口不能全屏（${err.message}），按 F11 试试`);
  }
}

fsBtn.addEventListener('click', toggleFullscreen);

document.addEventListener('fullscreenchange', () => {
  const on = Boolean(document.fullscreenElement);
  fsBtn.title = on ? '退出全屏（Esc）' : '全屏';
  fsBtn.setAttribute('aria-label', fsBtn.title);
  document.body.classList.toggle('fs-mode', on);
  wake();
});

let hideTimer = null;

function wake() {
  if (!document.fullscreenElement) return;
  document.body.classList.add('awake');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => document.body.classList.remove('awake'), 2500);
}

document.addEventListener('mousemove', wake);

const canvas = $('orb');
const ctx = canvas.getContext('2d');
let cw = 0;
let ch = 0;
let dust = [];
let clockAlpha = 0;
let lastFrame = 0;
let dprScale = 1;
let glitchUntil = 0;
let orbEnv = 0;
let prevEnv = 0;
const pulses = [];
let nextGlitch = 0;

function makeDust() {
  const R = Math.min(cw, ch) / 2;
  dust = Array.from({ length: 26 }, () => ({
    a: Math.random() * Math.PI * 2,
    r: 0.5 + Math.random() * 0.42,
    size: 0.6 + Math.random() * 0.9,
    alpha: 0.12 + Math.random() * 0.3,
    speed: (Math.random() - 0.5) * 0.05,
  }));
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  dprScale = dpr;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cw = rect.width;
  ch = rect.height;
  makeDust();
}

function clockHand(cx, cy, ang, len, w) {
  const tipX = cx + Math.sin(ang) * len;
  const tipY = cy - Math.cos(ang) * len;
  ctx.strokeStyle = 'rgba(200,134,58,0.72)';
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  const baseR = len * 0.74;
  const bx = cx + Math.sin(ang) * baseR;
  const by = cy - Math.cos(ang) * baseR;
  const px = Math.cos(ang);
  const py = Math.sin(ang);
  const bw = w * 2.1;
  ctx.fillStyle = 'rgba(200,134,58,0.72)';
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(bx + px * bw, by + py * bw);
  ctx.lineTo(bx - px * bw, by - py * bw);
  ctx.closePath();
  ctx.fill();
}

const SP_HALO = makeGlowSprite(256, [
  [0, 'rgba(246,196,118,0.50)'],
  [0.4, 'rgba(242,192,120,0.17)'],
  [1, 'rgba(242,192,120,0)'],
]);

const SP_CORE = makeGlowSprite(256, [
  [0, 'rgba(255,231,172,1)'],
  [0.42, 'rgba(233,162,59,0.9)'],
  [1, 'rgba(233,162,59,0)'],
]);

function makeGlowSprite(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [off, col] of stops) grad.addColorStop(off, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function drawCreature(cx, cy, s, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(s, s);

  ctx.fillStyle = 'rgba(120,90,60,0.14)';
  ctx.beginPath();
  ctx.ellipse(0, 13.2, 9, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#CE8A6D';
  ctx.beginPath();
  ctx.roundRect(-7.6, -6, 15.2, 12, 2.2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-11.6, -1.6, 4.4, 3.6, 1.4);
  ctx.roundRect(7.2, -1.6, 4.4, 3.6, 1.4);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-5.6, 6, 3.4, 6.4, 1.5);
  ctx.roundRect(-1.7, 6, 3.4, 6.4, 1.5);
  ctx.roundRect(2.2, 6, 3.4, 6.4, 1.5);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.roundRect(-6.4, -5.2, 12.8, 3.6, 1.8);
  ctx.fill();

  ctx.fillStyle = '#3E322B';
  ctx.beginPath();
  ctx.roundRect(-4.9, -2.6, 3, 3, 0.8);
  ctx.roundRect(1.9, -2.6, 3, 3, 0.8);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(-4.3, -2, 1, 1);
  ctx.fillRect(2.5, -2, 1, 1);

  ctx.restore();
}

const walker = { angle: Math.PI / 2 - 0.55, mode: 'rest', alpha: 0 };

function drawWalker(cx, cy, R, dt) {
  const restA = Math.PI / 2 - 0.55;
  const speed = (Math.PI * 2) / 22;
  const Rw = R * 0.86;
  const N = 28;

  walker.alpha = Math.min(1, walker.alpha + dt / 1.2);

  if (show.phase !== 'listening') {
    walker.mode = 'walk';
    walker.angle += dt * speed;
  } else if (walker.mode === 'walk') {
    walker.mode = 'return';
  }

  if (walker.mode === 'return') {
    let d = restA - walker.angle;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const step = dt * speed * 2.6;
    if (Math.abs(d) <= step) {
      walker.angle = restA;
      walker.mode = 'rest';
    } else {
      walker.angle += Math.sign(d) * step;
    }
  }

  const ang = walker.angle;
  const trail = walker.mode !== 'rest';

  const w = R * 0.026;
  const h = R * 0.012;

  const mark = (a, alpha, color) => {
    const x = cx + Math.cos(a) * Rw;
    const y = cy + Math.sin(a) * Rw;
    const rot = a + Math.PI / 2;
    const sx = x + Math.cos(rot) * (w / 2);
    const sy = y + Math.sin(rot) * (w / 2);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.ellipse(x, y, w / 2, h / 2, rot, 0, Math.PI * 2);
    ctx.fill();
  };

  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    let behind = (ang - a) % (Math.PI * 2);
    if (behind < 0) behind += Math.PI * 2;
    if (trail && behind < 0.62) continue;
    mark(a, 0.09 * walker.alpha, '#C9B99C');
  }

  if (trail) {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      let behind = (ang - a) % (Math.PI * 2);
      if (behind < 0) behind += Math.PI * 2;
      if (behind >= 0.62) continue;
      mark(a, (0.5 * (1 - behind / 0.62) + 0.18) * walker.alpha, '#D9A05C');
    }
  }
  ctx.globalAlpha = 1;

  if (walker.alpha <= 0.01) return;
  const wx = cx + Math.cos(ang) * Rw;
  const wy = cy + Math.sin(ang) * Rw;
  const s = R * 0.0062;
  drawCreature(wx, wy - 12.4 * s, s, walker.alpha);
}

function drawClock(cx, cy, R, t) {
  const rim = R * 0.62;
  const grow = 0.86 + 0.14 * clockAlpha;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(grow, grow);
  ctx.translate(-cx, -cy);
  ctx.strokeStyle = 'rgba(206,140,62,0.5)';
  ctx.lineWidth = Math.max(1, R * 0.004);
  ctx.beginPath();
  ctx.arc(cx, cy, rim, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineCap = 'butt';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const major = i % 5 === 0;
    const len = major ? R * 0.055 : R * 0.026;
    const outer = rim - R * 0.018;
    const inner = outer - len;
    ctx.strokeStyle = major ? 'rgba(206,140,62,0.55)' : 'rgba(206,140,62,0.3)';
    ctx.lineWidth = major ? Math.max(1, R * 0.005) : Math.max(0.7, R * 0.003);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    ctx.stroke();
  }

  const minuteA = (t * Math.PI * 2) / 3;
  const hourA = minuteA / 12;
  clockHand(cx, cy, hourA, rim * 0.52, Math.max(1.6, R * 0.014));
  clockHand(cx, cy, minuteA, rim * 0.8, Math.max(1.4, R * 0.011));

  ctx.fillStyle = 'rgba(200,134,58,0.8)';
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, R * 0.02), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

const RINGS = [
  { rx: 0.78, ry: 0.36, rot: -20, spin: 3.2, dash: 0, dots: 3 },
  { rx: 0.7, ry: 0.35, rot: 28, spin: -4.1, dash: 1, dots: 6 },
  { rx: 0.62, ry: 0.36, rot: 68, spin: 2.6, dash: 0, dots: 5 },
  { rx: 0.53, ry: 0.375, rot: -62, spin: -3.4, dash: 1, dots: 4 },
  { rx: 0.45, ry: 0.36, rot: 8, spin: 4.6, dash: 0, dots: 0 },
];

function drawOrbits(cx, cy, R, t, env) {
  // 声波：每个重音推一圈出去
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = (t - pulses[i]) / 1.4;
    if (p >= 1) { pulses.splice(i, 1); continue; }
    const a = Math.pow(1 - p, 1.4) * 0.55;
    const rr = R * (0.2 + p * 0.78);
    ctx.strokeStyle = `rgba(230,155,50,${a})`;
    ctx.lineWidth = Math.max(1, R * 0.0075 * (1 - p * 0.55));
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }

  RINGS.forEach((g, idx) => {
    const inner = idx === RINGS.length - 1;
    const rot = ((g.rot + t * g.spin) * Math.PI) / 180;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, R * g.rx, R * g.rx * g.ry, 0, 0, Math.PI * 2);
    if (g.dash) ctx.setLineDash([1.2, R * 0.022]);
    else ctx.setLineDash([]);
    ctx.strokeStyle = `rgba(214,146,66,${inner ? 0.28 + 0.34 * env : 0.3})`;
    ctx.lineWidth = Math.max(0.8, R * 0.0045);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < g.dots; i++) {
      const a = (i / g.dots) * Math.PI * 2 + t * g.spin * 0.12;
      const x = Math.cos(a) * R * g.rx;
      const y = Math.sin(a) * R * g.rx * g.ry;
      ctx.fillStyle = `rgba(217,160,92,${0.4 + 0.3 * env})`;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.1, R * 0.0068) * (inner ? 1 + 0.25 * env : 1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

let scanPattern = null;

function getScanPattern() {
  if (scanPattern) return scanPattern;
  const tile = document.createElement('canvas');
  tile.width = 4;
  tile.height = 3;
  const g = tile.getContext('2d');
  g.fillStyle = '#5d442a';
  g.fillRect(0, 0, 4, 1);
  scanPattern = ctx.createPattern(tile, 'repeat');
  return scanPattern;
}

function draw(now) {
  requestAnimationFrame(draw);
  const t = now / 1000;
  const R = Math.min(cw, ch) / 2;
  const cx = cw / 2;
  const cy = ch / 2;
  if (!R) return;

  ctx.clearRect(0, 0, cw, ch);

  let levels = null;
  let rms = 0;
  if (analyser && show.phase === 'speaking' && !show.waiting) {
    analyser.getByteFrequencyData(freqData);
    levels = freqData;
    for (let i = 0; i < 32; i++) rms += levels[i];
    rms = rms / 32 / 255;
  }

  ctx.drawImage(SP_HALO, cx - R * 0.5, cy - R * 0.5, R, R);

  for (const d of dust) {
    const ang = d.a + t * d.speed;
    const rr = R * d.r + Math.sin(t * 0.7 + d.a * 3) * 2;
    ctx.globalAlpha = d.alpha * (0.55 + 0.45 * Math.sin(t * 0.9 + d.a * 5));
    ctx.fillStyle = '#B79B7A';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, d.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const wantClock = show.phase === 'thinking' ? 1 : 0;
  const dt = Math.min(1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  const rate = wantClock ? 0.8 : 2.4;
  clockAlpha += (wantClock - clockAlpha) * (1 - Math.exp(-dt * rate));
  const burstAlpha = 1 - clockAlpha;

  const targetEnv = levels ? rms : 0;
  const tau = targetEnv > orbEnv ? 0.2 : 0.8;
  orbEnv += (targetEnv - orbEnv) * (1 - Math.exp(-dt / tau));

  if (levels && orbEnv > 0.17 && orbEnv > prevEnv + 0.035) {
    pulses.push(now / 1000);
    if (pulses.length > 7) pulses.shift();
  }
  prevEnv = orbEnv;

  ctx.globalAlpha = burstAlpha;
  drawOrbits(cx, cy, R, t, orbEnv);
  ctx.globalAlpha = 1;

  if (clockAlpha > 0.01) {
    ctx.globalAlpha = clockAlpha;
    drawClock(cx, cy, R, t);
    ctx.globalAlpha = 1;
  }

  drawWalker(cx, cy, R, dt);

  const coreR = R * 0.055 * (1 + rms * 0.35) + (levels ? 0 : R * 0.004 * Math.sin(t * 1.4));
  const coreGlowR = coreR * 2.2;
  ctx.drawImage(SP_CORE, cx - coreGlowR, cy - coreGlowR, coreGlowR * 2, coreGlowR * 2);

  ctx.fillStyle = '#E89E34';
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();

  // 待机：扫描线 + 偶发横向撕裂
  if (show.phase === 'listening') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.86, 0, Math.PI * 2);
    ctx.clip();

    const off = (t * 7) % 3;
    ctx.globalAlpha = 0.026;
    ctx.fillStyle = getScanPattern();
    ctx.save();
    ctx.translate(0, off);
    ctx.fillRect(0, -off - 3, cw, ch + off + 6);
    ctx.restore();
    ctx.globalAlpha = 1;

    if (t > nextGlitch) {
      glitchUntil = t + 0.14;
      nextGlitch = t + 2.6 + Math.random() * 3.2;
    }
    if (t < glitchUntil) {
      for (let i = 0; i < 3; i++) {
        const sy = cy + (Math.random() - 0.5) * R * 1.5;
        const h = 3 + Math.random() * 10;
        const dx = (Math.random() - 0.5) * 16;
        const srcY = Math.max(0, sy * dprScale);
        const srcH = Math.min(canvas.height - srcY, h * dprScale);
        if (srcH <= 0) continue;
        ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, dx, sy, cw, srcH / dprScale);
        ctx.fillStyle = i % 2 ? 'rgba(190,90,130,0.07)' : 'rgba(80,140,150,0.07)';
        ctx.fillRect(0, sy, cw, srcH / dprScale);
      }
    }
    ctx.restore();
  }

  if (show.phase === 'speaking' && !show.waiting && audio.duration) {
    const p = Math.min(1, audio.currentTime / audio.duration);
    els.fill.style.width = `${p * 100}%`;
    els.tLeft.textContent = fmt(audio.currentTime);
    els.tRight.textContent = fmt(audio.duration);
  }
}

new ResizeObserver(resize).observe(canvas);
resize();
requestAnimationFrame(draw);
els.input.focus();

const tilesEl = $('tiles');
const stageEl = document.querySelector('.stage');
let tilesTimer = null;

function paintTiles() {
  if (!tilesEl || !stageEl || typeof window.renderPuzzle !== 'function') return;
  window.renderPuzzle(tilesEl, Math.round(stageEl.clientWidth), Math.round(stageEl.clientHeight));
}

new ResizeObserver(() => {
  clearTimeout(tilesTimer);
  tilesTimer = setTimeout(paintTiles, 140);
}).observe(stageEl);

paintTiles();
