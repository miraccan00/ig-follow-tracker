import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const IG_APP_ID = '936619743392459';
const PAGE_SIZE = 50;

export async function startLightpanda({ bin, cookieFile, port = 9333 }) {
  const args = ['serve', '--host', '127.0.0.1', '--port', String(port)];
  if (cookieFile) args.push('--cookie', cookieFile);
  const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d));

  const wsEndpoint = `ws://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    if (proc.exitCode !== null) throw new Error(`lightpanda exited: ${stderr.trim()}`);
    try {
      const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
      return { browser, stop: async () => { await browser.disconnect().catch(() => {}); proc.kill(); } };
    } catch {
      await sleep(100);
    }
  }
  proc.kill();
  throw new Error(`could not connect to lightpanda on ${wsEndpoint}: ${stderr.trim()}`);
}

// Runs a GET against Instagram's web API from inside the page, so the browser's
// cookies and origin are used exactly like the real site does.
async function igGet(page, path) {
  const res = await page.evaluate(async (path, appId) => {
    const csrf = (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || '';
    const r = await fetch(path, {
      credentials: 'include',
      headers: { 'X-IG-App-ID': appId, 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
    });
    return { status: r.status, body: await r.text() };
  }, path, IG_APP_ID);

  let json;
  try { json = JSON.parse(res.body); } catch { /* HTML login page etc. */ }
  if (res.status !== 200 || !json) {
    const hint = json?.message || (res.body.trimStart().startsWith('<') ? 'got an HTML page instead of JSON (rate limit or expired cookie)' : res.body.slice(0, 200));
    const err = new Error(`GET ${path} -> HTTP ${res.status}: ${hint}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const pickUser = (u) => ({ id: String(u.pk ?? u.id), username: u.username, fullName: u.full_name || '' });

async function paginate(page, userId, kind, { delayMs, log }) {
  const out = [];
  let maxId = '';
  for (;;) {
    const qs = new URLSearchParams({ count: String(PAGE_SIZE) });
    if (maxId) qs.set('max_id', maxId);
    const json = await igGet(page, `/api/v1/friendships/${userId}/${kind}/?${qs}`);
    out.push(...(json.users || []).map(pickUser));
    log(`  ${kind}: ${out.length}`);
    if (!json.next_max_id) break;
    maxId = String(json.next_max_id);
    await sleep(delayMs + Math.random() * delayMs); // be gentle, avoid rate limits
  }
  // The API can return the same user twice across pages.
  return [...new Map(out.map((u) => [u.id, u])).values()];
}

// Instagram's profile-info JSON endpoints reject Lightpanda's User-Agent (429 /
// "useragent mismatch"), so the id, username and counts are read from HTML pages.
function usernameForId(html, id) {
  for (let i = html.indexOf(`"${id}"`); i >= 0; i = html.indexOf(`"${id}"`, i + 1)) {
    const m = html.slice(Math.max(0, i - 400), i + 400).match(/"username":"([\w.]+)"/);
    if (m) return m[1];
  }
  return null;
}

async function readProfile(page, username) {
  await page.goto(`https://www.instagram.com/${encodeURIComponent(username)}/`, { waitUntil: 'load', timeout: 60_000 });
  const html = await page.content();
  const id = (html.match(/"profile_id":"(\d+)"/) || html.match(/"profilePage_(\d+)"/) || [])[1];
  if (!id) throw new Error(`could not find the id of @${username} (private, missing, or not logged in?)`);
  // <meta name="description" content="1,234 Followers, 567 Following, 89 Posts - ...">
  const num = (re) => { const m = html.match(re); return m ? Number(m[1].replace(/[.,]/g, '')) : null; };
  return { id, followers: num(/content="([\d.,]+) Followers/), following: num(/, ([\d.,]+) Following/) };
}

export async function takeSnapshot({ bin, cookieFile, username, delayMs = 1500, log = console.error }) {
  const { browser, stop } = await startLightpanda({ bin, cookieFile });
  try {
    const page = await browser.newPage();
    await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 60_000 });
    const myId = await page.evaluate(() => (document.cookie.match(/(?:^|; )ds_user_id=([^;]+)/) || [])[1]);
    if (!myId) throw new Error('not logged in: ds_user_id cookie missing, update the cookie');
    if (!username) {
      username = usernameForId(await page.content(), myId);
      if (!username) throw new Error('could not detect your username; enter it in the username field');
    }

    const profile = await readProfile(page, username);
    const userId = profile.id;
    log(`account: @${username} (${userId}) - profile says ${profile.followers ?? '?'} followers / ${profile.following ?? '?'} following`);
    await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 60_000 });

    const followers = await paginate(page, userId, 'followers', { delayMs, log });
    const following = await paginate(page, userId, 'following', { delayMs, log });

    return {
      takenAt: new Date().toISOString(),
      account: { id: userId, username },
      profileCounts: { followers: profile.followers, following: profile.following },
      counts: { followers: followers.length, following: following.length },
      followers,
      following,
    };
  } finally {
    await stop();
  }
}
