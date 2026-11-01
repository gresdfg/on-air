import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

dns.setDefaultResultOrder('ipv4first');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const CACHE = path.join(ROOT, 'cache');
const CONFIG_PATH = process.env.ONAIR_CONFIG
  ? path.resolve(process.env.ONAIR_CONFIG)
  : path.join(ROOT, 'config.json');
const EXAMPLE_PATH = path.join(ROOT, 'config.example.json');
const PORT = Number(process.env.PORT || 7788);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

let config = null;
let configError = null;

async function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      const example = await fsp.readFile(EXAMPLE_PATH, 'utf8');
      await fsp.writeFile(CONFIG_PATH, example, 'utf8');
    }
    config = JSON.parse(await fsp.readFile(CONFIG_PATH, 'utf8'));
    configError = null;
  } catch (err) {
    config = null;
    configError = `config.json 读不出来：${err.message}`;
  }
}

const voiceKey = () => config?.voice?.apiKey || process.env.BREEZE_API_KEY || '';

function status() {
  return {
    ok: Boolean(config),
    configError,
    configPath: CONFIG_PATH,
    brainReady: Boolean(config?.brain?.apiKey && config?.brain?.baseUrl && config?.brain?.model),
    voiceReady: Boolean(voiceKey() && config?.voice?.voiceId),
    show: config?.show || { slug: 'voice.synth', title: 'ON AIR · INTERVIEW Nº 01' },
    voiceName: config?.voice?.voiceName || null,
  };
}

function sendJson(res, code, obj) {  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(PUBLIC, decodeURIComponent(rel));
  if (!file.startsWith(PUBLIC)) return sendJson(res, 403, { error: 'forbidden' });
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

async function serveAudio(req, res, urlPath) {
  const name = path.basename(decodeURIComponent(urlPath));
  const file = path.join(CACHE, name);
  try {
    const stat = await fsp.stat(file);
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : stat.size - 1;
      res.writeHead(206, {
        'content-type': 'audio/mpeg',
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${stat.size}`,
        'content-length': end - start + 1,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': stat.size, 'accept-ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  } catch {
    sendJson(res, 404, { error: 'audio not found' });
  }
}

function extractText(payload) {
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload?.content)) {
    return payload.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  }
  if (payload?.choices?.[0]?.message?.content) return payload.choices[0].message.content;
  throw new Error('大脑返回的结构看不懂');
}

function parseSegments(raw) {
  const text = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let qEn = '';
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      qEn = String(obj?.q_en ?? obj?.question_en ?? '').trim();
      const list = Array.isArray(obj?.segments) ? obj.segments : Array.isArray(obj) ? obj : null;
      if (list) {
        const clean = list
          .map((s) => ({
            en: String(s?.en ?? s?.english ?? '').trim(),
            zh: String(s?.zh ?? s?.chinese ?? '').trim(),
          }))
          .filter((s) => s.en);
        if (clean.length) return { segments: clean, qEn };
      }
    } catch {
      /* 落到下面的兜底 */
    }
  }
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  if (!sentences.length) throw new Error('大脑没有给出可用回答');
  return { segments: sentences.map((en) => ({ en, zh: '' })), qEn };
}

async function askBrain(question, history) {
  const { baseUrl, apiKey, model, system, maxTokens } = config.brain;
  const messages = [
    ...(Array.isArray(history) ? history.slice(-8) : []),
    { role: 'user', content: question },
  ];
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 800,
      system,
      messages,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`大脑 ${res.status}：${body.slice(0, 300)}`);
  return parseSegments(extractText(JSON.parse(body)));
}

// 大陆 IP 访问 BreezeBlue 会被限流，语音请求单独走 CONNECT 代理，大脑直连不受影响
class ConnectAgent extends https.Agent {
  constructor(proxyUrl) {
    super({ keepAlive: false });
    this.proxy = new URL(proxyUrl);
  }
  createConnection(options, cb) {
    const target = `${options.host}:${options.port || 443}`;
    const req = http.request({
      host: this.proxy.hostname,
      port: this.proxy.port || 80,
      method: 'CONNECT',
      path: target,
      headers: { host: target },
    });
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        cb(new Error(`代理拒绝 HTTP ${res.statusCode}`));
        return;
      }
      const secure = tls.connect({ ...options, socket, servername: options.servername || options.host });
      secure.once('secureConnect', () => cb(null, secure));
      secure.once('error', cb);
    });
    req.once('error', cb);
    req.end();
  }
}

const agents = new Map();
function agentFor(proxyUrl) {
  if (!proxyUrl) return undefined;
  if (!agents.has(proxyUrl)) agents.set(proxyUrl, new ConnectAgent(proxyUrl));
  return agents.get(proxyUrl);
}

function postJson(urlStr, headers, body, agent) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const secure = u.protocol !== 'http:';
    const mod = secure ? https : http;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (secure ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(body) },
        agent: secure ? agent : undefined,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.setTimeout(120_000, () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end(body);
  });
}

async function synth(text, outFile) {
  const v = config.voice;
  const base = (v.apiUrl || 'https://api.breeze.blue').replace(/\/+$/, '');
  const url = `${base}/v1/text-to-speech/${encodeURIComponent(v.voiceId)}?output_format=mp3`;
  const payload = { text, language_code: v.languageCode || 'en' };
  if (v.modelId) payload.model_id = v.modelId;
  if (v.instructions) payload.instructions = v.instructions;
  if (v.voiceSettings && Object.keys(v.voiceSettings).length) payload.voice_settings = v.voiceSettings;

  let res;
  try {
    res = await postJson(
      url,
      { 'content-type': 'application/json', 'xi-api-key': voiceKey() },
      JSON.stringify(payload),
      agentFor(v.proxy),
    );
  } catch (err) {
    const e = new Error(`连不上 BreezeBlue（${err.code || err.message}）`);
    e.retryable = true;
    throw e;
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = res.body.toString('utf8').slice(0, 200);
    const e = new Error(`BreezeBlue ${res.status}：${detail}`);
    e.retryable = res.status === 429 || res.status >= 500;
    e.retryAfter = Number(res.headers['retry-after']) || 0;
    throw e;
  }
  const buf = res.body;
  if (buf.length < 512) throw new Error('BreezeBlue 返回的音频太小，可能失败了');
  await fsp.writeFile(outFile, buf);
  return buf.length;
}

async function synthWithRetry(text, outFile, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await synth(text, outFile);
    } catch (err) {
      if (!err.retryable || i >= tries) throw err;
      const wait = err.retryAfter ? err.retryAfter * 1000 : 1200 * i;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function handleAsk(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const emit = (obj) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  try {
    await loadConfig();
    const body = await readBody(req);
    const question = String(body.question || '').trim();
    if (!question) throw new Error('问题为空');
    if (!config) throw new Error(configError || 'config.json 不存在');
    if (!status().brainReady) throw new Error('config.json 里 brain.apiKey / model 还没填');
    if (!status().voiceReady) throw new Error('config.json 里 voice.apiKey / voiceId 还没填');

    emit({ type: 'stage', stage: 'thinking' });
    const { segments, qEn } = await askBrain(question, body.history);
    emit({ type: 'plan', qEn, segments });

    const batch = crypto.randomBytes(4).toString('hex');
    for (let i = 0; i < segments.length; i++) {
      const file = path.join(CACHE, `${batch}_${i}.mp3`);
      await synthWithRetry(segments[i].en, file);
      emit({ type: 'audio', index: i, url: `/audio/${batch}_${i}.mp3` });
    }
    emit({ type: 'done' });
  } catch (err) {
    console.error('[ask]', err.message);
    emit({ type: 'error', message: err.message });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

const pick = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

function mask(key) {
  if (!key) return '';
  return key.length <= 8 ? '••••' : `••••${key.slice(-4)}`;
}

function isLocal(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

async function handleConfig(req, res) {
  await loadConfig();
  if (req.method === 'GET') {
    return sendJson(res, 200, {
      configPath: CONFIG_PATH,
      brain: {
        baseUrl: config?.brain?.baseUrl || '',
        model: config?.brain?.model || '',
        maxTokens: config?.brain?.maxTokens || 2000,
        keyMask: mask(config?.brain?.apiKey),
      },
      voice: {
        apiUrl: config?.voice?.apiUrl || '',
        voiceId: config?.voice?.voiceId || '',
        proxy: config?.voice?.proxy || '',
        languageCode: config?.voice?.languageCode || 'en',
        instructions: config?.voice?.instructions || '',
        keyMask: mask(voiceKey()),
        keyFromEnv: Boolean(!config?.voice?.apiKey && process.env.BREEZE_API_KEY),
      },
      show: config?.show || {},
    });
  }

  const body = await readBody(req);
  const base = config || JSON.parse(await fsp.readFile(EXAMPLE_PATH, 'utf8'));
  const next = {
    ...base,
    brain: {
      ...base.brain,
      baseUrl: pick(body.brain?.baseUrl, base.brain?.baseUrl),
      model: pick(body.brain?.model, base.brain?.model),
      maxTokens: Number(body.brain?.maxTokens) || base.brain?.maxTokens || 2000,
      apiKey: pick(body.brain?.apiKey, base.brain?.apiKey),
    },
    voice: {
      ...base.voice,
      apiUrl: pick(body.voice?.apiUrl, base.voice?.apiUrl),
      voiceId: pick(body.voice?.voiceId, base.voice?.voiceId),
      proxy: typeof body.voice?.proxy === 'string' ? body.voice.proxy.trim() : base.voice?.proxy || '',
      instructions: pick(body.voice?.instructions, base.voice?.instructions),
      apiKey: pick(body.voice?.apiKey, base.voice?.apiKey),
    },
  };
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  await loadConfig();
  sendJson(res, 200, status());
}

async function handleTestVoice(req, res) {
  try {
    await loadConfig();
    if (!status().voiceReady) throw new Error('语音还没配好：需要 BreezeBlue key 和 voiceId');
    const file = path.join(CACHE, `test_${crypto.randomBytes(3).toString('hex')}.mp3`);
    await synthWithRetry('Mm. Take a breath. We are on the air.', file);
    sendJson(res, 200, { ok: true, url: `/audio/${path.basename(file)}` });
  } catch (err) {
    sendJson(res, 200, { ok: false, error: err.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/api/config') return handleConfig(req, res);
  if (req.method === 'POST' && p === '/api/test-voice') return handleTestVoice(req, res);
  if (req.method === 'POST' && p === '/api/shutdown') {
    if (!isLocal(req)) return sendJson(res, 403, { error: 'only local' });
    sendJson(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 120);
    return;
  }
  if (req.method === 'POST' && p === '/api/ask') return handleAsk(req, res);
  if (req.method === 'GET' && p === '/api/status') {
    await loadConfig();
    return sendJson(res, 200, status());
  }
  if (req.method === 'GET' && p.startsWith('/audio/')) return serveAudio(req, res, p);
  if (req.method === 'GET') return serveStatic(req, res, p);
  sendJson(res, 405, { error: 'method not allowed' });
});

await fsp.mkdir(CACHE, { recursive: true });
await loadConfig();
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address);
}

const HOST = process.env.HOST || '127.0.0.1';

server.listen(PORT, HOST, () => {
  const s = status();
  const url = `http://localhost:${PORT}`;
  console.log(`ON AIR  ${url}`);
  if (HOST === '0.0.0.0') {
    for (const ip of lanAddresses()) console.log(`手机访问  http://${ip}:${PORT}`);
  }
  console.log(`配置文件  ${CONFIG_PATH}`);
  console.log(`大脑 ${s.brainReady ? '已配置' : '未配置'} · 语音 ${s.voiceReady ? '已配置' : '未配置'}`);
  if (configError) console.log(configError);
  if (process.env.ONAIR_OPEN === '1') {
    setTimeout(() => {
      import('node:child_process').then(({ spawn }) =>
        spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref(),
      );
    }, 600);
  }
});
