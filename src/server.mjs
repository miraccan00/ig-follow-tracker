#!/usr/bin/env node
// Local web UI: node src/server.mjs  ->  http://127.0.0.1:3100
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cookieFileStatus, writeCookies } from './cookies.mjs';
import { diffSnapshots, notFollowingBack } from './diff.mjs';
import { COOKIES, ROOT, openDefaultStore } from './config.mjs';

const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '127.0.0.1';
// Optional daily check without cron/launchd, e.g. CHECK_AT=09:00 (container local time, set TZ).
const CHECK_AT = process.env.CHECK_AT;

const store = openDefaultStore();

let job = { running: false, log: '', exitCode: null, startedAt: null };

function state() {
  const username = store.lastUsername();
  const [lastId, prevId] = username ? store.recentIds(username, 2) : [];
  const snap = lastId ? store.loadSnapshot(lastId) : null;
  return {
    hasCookie: cookieFileStatus(COOKIES) === 'ok',
    job,
    history: store.history(),
    account: snap?.account ?? null,
    snapshot: snap && { ...snap, notFollowingBack: notFollowingBack(snap) },
    report: prevId ? diffSnapshots(store.loadSnapshot(prevId), snap) : null,
  };
}

function startCheck(user) {
  if (job.running) return false;
  const args = [path.join(ROOT, 'src', 'cli.mjs'), 'check'];
  if (user) args.push('--user', user);
  job = { running: true, log: '', exitCode: null, startedAt: new Date().toISOString() };
  const p = spawn(process.execPath, [...process.execArgv, ...args], { cwd: ROOT, env: process.env });
  const append = (d) => { job.log += d; };
  p.stdout.on('data', append);
  p.stderr.on('data', append);
  p.on('close', (code) => Object.assign(job, { running: false, exitCode: code }));
  return true;
}

async function body(req) {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(ROOT, 'public', 'index.html')));
    }
    if (req.method === 'GET' && req.url === '/api/state') return send(res, 200, state());

    // Only JSON POSTs are accepted: a cross-site form can't send that without a CORS preflight.
    if (req.method === 'POST' && !String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'json only' });
    if (req.method === 'POST' && req.url === '/api/cookies') {
      try {
        writeCookies(COOKIES, await body(req));
      } catch (e) {
        if (e.code === 'EROFS' || e.code === 'EACCES' || e.code === 'EISDIR') throw new Error(`can't write ${COOKIES} (${e.code}); it is probably mounted read-only, edit the file on the host instead`);
        throw e;
      }
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/api/check') {
      const { user } = await body(req);
      return startCheck(user?.trim() || undefined) ? send(res, 202, { ok: true }) : send(res, 409, { error: 'a check is already running' });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
}).listen(PORT, HOST, () => console.log(`IG Follow Tracker: http://${HOST}:${PORT}`));

if (CHECK_AT) {
  if (!/^\d{2}:\d{2}$/.test(CHECK_AT)) throw new Error(`CHECK_AT must be HH:MM, got "${CHECK_AT}"`);
  let lastRunDay = null;
  setInterval(() => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const day = now.toDateString();
    if (hhmm === CHECK_AT && lastRunDay !== day && cookieFileStatus(COOKIES) === 'ok') {
      lastRunDay = day;
      console.log(`daily check started at ${now.toISOString()}`);
      startCheck();
    }
  }, 20_000);
  console.log(`daily check scheduled at ${CHECK_AT}`);
}
