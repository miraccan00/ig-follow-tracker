#!/usr/bin/env node
// Usage:
//   node src/cli.mjs check [--user <username>]    take a snapshot, diff with the previous one
//   node src/cli.mjs diff  [<old.json> <new.json>] diff two JSON exports (default: last two snapshots in the db)
import fs from 'node:fs';
import path from 'node:path';
import { takeSnapshot } from './instagram.mjs';
import { diffSnapshots } from './diff.mjs';
import { resolveCookieFile } from './cookies.mjs';
import { BIN, COOKIES, DATA, DB_FILE, openDefaultStore } from './config.mjs';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const stamp = (iso) => iso.replace(/[:.]/g, '-');

function printReport(d) {
  const fmt = (u) => `    @${u.username}${u.fullName ? ` (${u.fullName})` : ''}`;
  const sign = (n) => (n > 0 ? `+${n}` : String(n));
  console.log(`\n${d.from}  ->  ${d.to}`);
  console.log(`followers: ${d.counts.followers.before} -> ${d.counts.followers.after} (${sign(d.counts.followers.delta)})`);
  console.log(`following: ${d.counts.following.before} -> ${d.counts.following.after} (${sign(d.counts.following.delta)})`);
  const section = (title, list) => { if (list.length) console.log(`\n  ${title} (${list.length}):\n${list.map(fmt).join('\n')}`); };
  section('Unfollowed you', d.unfollowedYou);
  section('New followers', d.newFollowers);
  section('You unfollowed', d.youUnfollowed);
  section('You started following', d.youStartedFollowing);
  if (!d.unfollowedYou.length && !d.newFollowers.length && !d.youUnfollowed.length && !d.youStartedFollowing.length) console.log('\n  no changes');
}

async function check(args) {
  const userIdx = args.indexOf('--user');
  const username = userIdx >= 0 ? args[userIdx + 1] : undefined;
  const cookieFile = resolveCookieFile(COOKIES);
  const store = openDefaultStore();

  const snap = await takeSnapshot({ bin: BIN, cookieFile, username });
  const u = snap.account.username;
  const [prevId] = store.recentIds(u, 1);
  store.saveSnapshot(snap);

  // JSON export next to the database, handy for jq / git / other tools.
  const exportFile = path.join(DATA, 'snapshots', u, `${stamp(snap.takenAt)}.json`);
  fs.mkdirSync(path.dirname(exportFile), { recursive: true });
  fs.writeFileSync(exportFile, JSON.stringify(snap, null, 2));
  console.log(`saved to ${path.basename(DB_FILE)} + ${path.relative(DATA, exportFile)}  (${snap.counts.followers} followers, ${snap.counts.following} following)`);

  if (snap.profileCounts.followers && snap.counts.followers < snap.profileCounts.followers * 0.95) {
    console.warn(`warning: fetched ${snap.counts.followers} of ${snap.profileCounts.followers} followers; the list may be incomplete (rate limit?)`);
  }
  if (prevId) printReport(diffSnapshots(store.loadSnapshot(prevId), snap));
  else console.log('first snapshot for this account; changes will show from the next run.');
  store.close();
}

function diff(args) {
  const [a, b] = args;
  if (a && b) return printReport(diffSnapshots(readJson(a), readJson(b)));
  const store = openDefaultStore();
  const username = store.lastUsername();
  const [newId, oldId] = username ? store.recentIds(username, 2) : [];
  if (!oldId) { console.error('need at least two snapshots'); process.exit(1); }
  printReport(diffSnapshots(store.loadSnapshot(oldId), store.loadSnapshot(newId)));
  store.close();
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'check') await check(rest);
  else if (cmd === 'diff') diff(rest);
  else { console.error('usage: cli.mjs check [--user <username>] | diff [old.json new.json]'); process.exit(1); }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
