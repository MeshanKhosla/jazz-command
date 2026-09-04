#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const HOST = process.env.JAZZ_HOST || '0.0.0.0';
const PORT = Number(process.env.JAZZ_PORT || 8787);
const ROOT = __dirname;
const STATIC_DIR = path.join(ROOT, 'dist');
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const MUSIC_DIR = path.join(process.env.HOME || os.homedir(), 'Music');
const SPEAKER = process.env.JAZZ_SPEAKER || '';
const SPEAKER_NAME = process.env.JAZZ_SPEAKER_NAME || 'Bluetooth speaker';
const SPEAKER_AUDIO = process.env.JAZZ_AUDIO_DEVICE || `pipewire/bluez_output.${SPEAKER.replaceAll(':', '_')}.1`;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const radio = {
  id: 'radio-swiss-jazz',
  title: 'Radio Swiss Jazz',
  artist: 'Live radio · jazz, soul & blues',
  kind: 'radio',
  source: 'https://stream.srg-ssr.ch/m/rsj/mp3_128'
};

const defaults = {
  volume: 45,
  schedules: [{
    id: 'weekday-morning-jazz',
    name: 'Weekday Morning Jazz',
    sourceId: radio.id,
    time: '08:00',
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    enabled: true,
    lastRun: null
  }]
};

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2) + '\n');
}

let player = null;
let playQueue = Promise.resolve();
let playback = { state: 'stopped', sourceId: null, title: null, detail: null, startedAt: null, error: null };

function readConfig() {
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
  catch { return structuredClone(defaults); }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

function run(file, args, timeout = 12000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout || '', stderr: stderr || '', error: error?.message || null });
    });
  });
}

async function speakerStatus() {
  if (!SPEAKER) return { name: SPEAKER_NAME, address: '', paired: false, trusted: false, connected: false };
  const result = await run('bluetoothctl', ['info', SPEAKER], 5000);
  const text = result.stdout + result.stderr;
  return {
    name: SPEAKER_NAME,
    address: SPEAKER,
    paired: /Paired:\s+yes/.test(text),
    trusted: /Trusted:\s+yes/.test(text),
    connected: /Connected:\s+yes/.test(text)
  };
}

function walkMusic(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walkMusic(full, out);
    else if (/\.(mp3|flac|m4a|ogg|opus|wav)$/i.test(item.name)) {
      out.push({
        id: `file:${full}`,
        title: path.basename(item.name, path.extname(item.name)),
        artist: path.relative(MUSIC_DIR, path.dirname(full)) || 'Local music',
        kind: 'file',
        source: full
      });
    }
  }
  return out;
}

function library() {
  return [radio, ...walkMusic(MUSIC_DIR)].sort((a, b) => a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === 'radio' ? -1 : 1);
}

function stopPlayback() {
  if (player && !player.killed) terminatePlayer(player);
  player = null;
  playback = { state: 'stopped', sourceId: null, title: null, detail: null, startedAt: null, error: null };
}

function terminatePlayer(child) {
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 2000);
  timer.unref();
}

async function play(sourceId) {
  const source = library().find((item) => item.id === sourceId);
  if (!source) throw new Error('That music source is no longer available.');
  if (!SPEAKER) throw new Error('Set JAZZ_SPEAKER before starting playback.');

  stopPlayback();
  playback = { state: 'connecting', sourceId, title: source.title, detail: source.artist, startedAt: null, error: null };
  const status = await speakerStatus();
  if (!status.connected) {
    const connection = await run('bluetoothctl', ['connect', SPEAKER], 18000);
    if (!connection.ok && !/Connection successful/.test(connection.stdout)) {
      throw new Error('Could not connect to Tune Table. Make sure it is powered on.');
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  const config = readConfig();
  const child = spawn('mpv', [
    '--no-video', source.kind === 'radio' ? '--cache=no' : '--cache=yes',
    '--msg-level=all=info',
    `--volume=${config.volume}`, `--audio-device=${SPEAKER_AUDIO}`,
    '--audio-client-name=jazz-command', source.source
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  player = child;
  playback = { state: 'buffering', sourceId, title: source.title, detail: source.artist, startedAt: null, error: null };
  child.stderr.setEncoding('utf8');
  child.stdout.setEncoding('utf8');
  const inspectOutput = (chunk) => {
    const line = chunk.trim();
    if (line) console.log(`[mpv] ${line}`);
    const match = chunk.match(/icy-title:\s*(.+)/i);
    if (match) playback.detail = match[1].trim();
  };
  child.stdout.on('data', inspectOutput);
  child.stderr.on('data', inspectOutput);
  child.once('exit', (code, signal) => {
    const expected = signal === 'SIGTERM' || player !== child;
    if (player !== child) return;
    player = null;
    playback = { ...playback, state: expected ? 'stopped' : 'error', error: expected ? null : `Player exited (${code ?? signal})` };
  });

  const audioReady = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 15000);
    const check = (chunk) => {
      if (/\bAO:\s*\[pipewire\]/.test(chunk)) {
        clearTimeout(timeout);
        child.stdout.off('data', check);
        child.stderr.off('data', check);
        resolve(true);
      }
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    child.once('exit', () => { clearTimeout(timeout); resolve(false); });
  });
  if (!audioReady) {
    if (player === child) player = null;
    terminatePlayer(child);
    throw new Error('The radio stream did not open an audio output. Try Play again.');
  }
  playback = { ...playback, state: 'playing', startedAt: new Date().toISOString(), error: null };
}

function queuePlay(sourceId) {
  const job = playQueue.then(() => play(sourceId));
  playQueue = job.catch(() => {});
  return job;
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100000) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, { playback, speaker: await speakerStatus(), config: readConfig(), library: library() });
  }

  if (req.method === 'POST' && url.pathname === '/api/play') {
    try {
      const body = await readBody(req);
      await queuePlay(body.sourceId);
      return sendJson(res, 200, { ok: true, playback });
    } catch (error) {
      playback = { ...playback, state: 'error', error: error.message };
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/stop') {
    stopPlayback();
    return sendJson(res, 200, { ok: true, playback });
  }

  if (req.method === 'POST' && url.pathname === '/api/volume') {
    const body = await readBody(req);
    const volume = Math.max(0, Math.min(100, Number(body.volume)));
    if (!Number.isFinite(volume)) return sendJson(res, 400, { error: 'Invalid volume' });
    const config = readConfig();
    config.volume = Math.round(volume);
    writeConfig(config);
    await run('wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', `${config.volume}%`]);
    return sendJson(res, 200, { ok: true, volume: config.volume });
  }

  if (req.method === 'POST' && url.pathname === '/api/schedules') {
    const body = await readBody(req);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) || !Array.isArray(body.days) || !body.days.every((day) => DAYS.includes(day))) {
      return sendJson(res, 400, { error: 'Invalid schedule' });
    }
    if (!library().some((item) => item.id === body.sourceId)) return sendJson(res, 400, { error: 'Unknown music source' });
    const config = readConfig();
    const schedule = {
      id: body.id || `schedule-${Date.now()}`,
      name: String(body.name || 'Jazz Session').slice(0, 80),
      sourceId: body.sourceId,
      time: body.time,
      days: [...new Set(body.days)],
      enabled: body.enabled !== false,
      lastRun: null
    };
    const index = config.schedules.findIndex((item) => item.id === schedule.id);
    if (index >= 0) config.schedules[index] = { ...config.schedules[index], ...schedule };
    else config.schedules.push(schedule);
    writeConfig(config);
    return sendJson(res, 200, { ok: true, schedule });
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/schedules/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/schedules/'.length));
    const config = readConfig();
    config.schedules = config.schedules.filter((item) => item.id !== id);
    writeConfig(config);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url);

  const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  let file = path.resolve(STATIC_DIR, requested);
  if (!file.startsWith(STATIC_DIR + path.sep) && file !== path.join(STATIC_DIR, 'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC_DIR, 'index.html');
  fs.readFile(file, (error, content) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

async function checkSchedules() {
  const now = new Date();
  const config = readConfig();
  const day = DAYS[now.getDay()];
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const date = now.toISOString().slice(0, 10);
  let changed = false;
  for (const schedule of config.schedules) {
    if (schedule.enabled && schedule.days.includes(day) && schedule.time === time && schedule.lastRun !== date) {
      schedule.lastRun = date;
      changed = true;
      queuePlay(schedule.sourceId).catch((error) => {
        playback = { ...playback, state: 'error', error: error.message };
      });
    }
  }
  if (changed) writeConfig(config);
}

server.listen(PORT, HOST, () => console.log(`Jazz Command listening on http://${HOST}:${PORT}`));
setInterval(checkSchedules, 15000);
checkSchedules();

process.on('SIGTERM', () => { stopPlayback(); server.close(() => process.exit(0)); });
