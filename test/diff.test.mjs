import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots, notFollowingBack } from '../src/diff.mjs';

const u = (id) => ({ id: String(id), username: `user${id}`, fullName: '' });
const prev = { takenAt: 'd1', followers: [u(1), u(2), u(3)], following: [u(1), u(4)] };
const curr = { takenAt: 'd2', followers: [u(1), u(3), u(5)], following: [u(1), u(6)] };

test('detects unfollowers and new followers', () => {
  const d = diffSnapshots(prev, curr);
  assert.deepEqual(d.unfollowedYou.map((x) => x.id), ['2']);
  assert.deepEqual(d.newFollowers.map((x) => x.id), ['5']);
  assert.deepEqual(d.youUnfollowed.map((x) => x.id), ['4']);
  assert.deepEqual(d.youStartedFollowing.map((x) => x.id), ['6']);
  assert.equal(d.counts.followers.delta, 0);
});

test('a username change is not an unfollow (matched by id)', () => {
  const renamed = { ...curr, followers: [{ ...u(1), username: 'renamed' }, u(2), u(3)] };
  assert.equal(diffSnapshots(prev, renamed).unfollowedYou.length, 0);
});

test('not following back', () => {
  assert.deepEqual(notFollowingBack(curr).map((x) => x.id), ['6']);
});

test('simple cookie object is converted for lightpanda', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { resolveCookieFile } = await import('../src/cookies.mjs');
  const f = path.join(os.tmpdir(), `ck-${process.pid}.json`);
  fs.writeFileSync(f, JSON.stringify({ sessionid: 'a%3Ab', csrftoken: 'c', ds_user_id: '1' }));
  const cdp = JSON.parse(fs.readFileSync(resolveCookieFile(f), 'utf8'));
  assert.equal(cdp.find((c) => c.name === 'sessionid').value, 'a:b');
  assert.equal(cdp.find((c) => c.name === 'sessionid').httpOnly, true);
  fs.writeFileSync(f, JSON.stringify({ sessionid: 'x' }));
  assert.throws(() => resolveCookieFile(f), /csrftoken, ds_user_id/);
});
