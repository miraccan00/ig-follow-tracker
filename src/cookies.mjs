import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REQUIRED = ['sessionid', 'csrftoken', 'ds_user_id'];

// { sessionid, csrftoken, ds_user_id } -> the CDP cookie array `lightpanda --cookie` reads.
function toCdp(values) {
  const missing = REQUIRED.filter((k) => !String(values[k] ?? '').trim());
  if (missing.length) throw new Error(`missing cookie value(s): ${missing.join(', ')}`);
  const expires = Math.floor(Date.now() / 1000) + 180 * 86400;
  const c = (name, httpOnly) => ({ name, value: decodeURIComponent(String(values[name]).trim()), domain: '.instagram.com', path: '/', expires, httpOnly, secure: true, sameSite: 'Lax' });
  return [c('sessionid', true), c('csrftoken', false), c('ds_user_id', false)];
}

export function writeCookies(file, values) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(toCdp(values), null, 2), { mode: 0o600 });
}

// The cookie file may be the CDP array or the simple object from cookies.example.json.
// Returns a path Lightpanda can load.
export function cookieFileStatus(file) {
  if (!fs.existsSync(file)) return 'missing';
  // `docker run -v ./cookies.json:...` creates a directory when the host file doesn't exist.
  return fs.statSync(file).isDirectory() ? 'directory' : 'ok';
}

export function resolveCookieFile(file) {
  const status = cookieFileStatus(file);
  if (status === 'directory') throw new Error(`${file} is a directory. With Docker this means cookies.json did not exist on the host when you ran the container; create it and use an absolute path ("$PWD/cookies.json").`);
  if (status === 'missing') throw new Error(`cookie file not found: ${file}`);
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file} is not valid JSON: ${e.message}`); }
  if (Array.isArray(parsed)) return file;
  const out = path.join(os.tmpdir(), `ig-cookies-${process.pid}.json`);
  fs.writeFileSync(out, JSON.stringify(toCdp(parsed)), { mode: 0o600 });
  return out;
}
