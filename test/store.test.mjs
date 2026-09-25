import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.mjs';

const u = (id) => ({ id: String(id), username: `user${id}`, fullName: `User ${id}` });
const snap = (takenAt, followers, following = []) => ({
  takenAt, account: { id: '99', username: 'me' }, profileCounts: { followers: followers.length, following: following.length },
  followers: followers.map(u), following: following.map(u),
});

test('saves, loads and summarises snapshots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'igt-'));
  const store = openStore(path.join(dir, 'tracker.db'));
  store.saveSnapshot(snap('2026-09-24T09:00:00Z', [1, 2, 3], [1, 4]));
  store.saveSnapshot(snap('2026-09-25T09:00:00Z', [1, 3, 5], [1]));

  const [newest, older] = store.recentIds('me', 2);
  assert.deepEqual(store.loadSnapshot(older).followers.map((x) => x.id), ['1', '2', '3']);
  assert.deepEqual(store.loadSnapshot(newest).following, [u(1)]);
  assert.equal(store.lastUsername(), 'me');

  const h = store.history();
  assert.equal(h.length, 2);
  assert.equal(h[0].unfollowedYou, null);
  assert.equal(h[1].followers, 3);
  assert.equal(h[1].unfollowedYou, 1);
  assert.equal(h[1].newFollowers, 1);
  store.close();
});

test('imports existing JSON snapshots into an empty database once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'igt-'));
  fs.mkdirSync(path.join(dir, 'snapshots', 'me'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'snapshots', 'me', 'a.json'), JSON.stringify(snap('2026-09-24T09:00:00Z', [1, 2])));
  const open = () => openStore(path.join(dir, 'tracker.db'), { importDir: path.join(dir, 'snapshots') });
  let store = open();
  assert.equal(store.history().length, 1);
  store.close();
  store = open();
  assert.equal(store.history().length, 1);
  store.close();
});
