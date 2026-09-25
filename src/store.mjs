// SQLite storage (node:sqlite, built into Node >= 22.5). One row per snapshot,
// one row per account in each list.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshots (
  id                INTEGER PRIMARY KEY,
  username          TEXT NOT NULL,
  account_id        TEXT NOT NULL,
  taken_at          TEXT NOT NULL UNIQUE,
  profile_followers INTEGER,
  profile_following INTEGER
);
CREATE INDEX IF NOT EXISTS snapshots_user ON snapshots (username, taken_at);
CREATE TABLE IF NOT EXISTS snapshot_users (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('followers', 'following')),
  user_id     TEXT NOT NULL,
  username    TEXT NOT NULL,
  full_name   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (snapshot_id, kind, user_id)
);
`;

// Counts plus how many followers left / arrived compared with the previous snapshot of the same account.
const HISTORY = `
WITH s AS (
  SELECT id, username, taken_at, LAG(id) OVER (PARTITION BY username ORDER BY taken_at) AS prev
  FROM snapshots
)
SELECT s.id, s.username, s.taken_at AS takenAt,
  (SELECT count(*) FROM snapshot_users WHERE snapshot_id = s.id AND kind = 'followers') AS followers,
  (SELECT count(*) FROM snapshot_users WHERE snapshot_id = s.id AND kind = 'following') AS following,
  CASE WHEN s.prev IS NULL THEN NULL ELSE (
    SELECT count(*) FROM snapshot_users p WHERE p.snapshot_id = s.prev AND p.kind = 'followers'
      AND p.user_id NOT IN (SELECT user_id FROM snapshot_users WHERE snapshot_id = s.id AND kind = 'followers')
  ) END AS unfollowedYou,
  CASE WHEN s.prev IS NULL THEN NULL ELSE (
    SELECT count(*) FROM snapshot_users c WHERE c.snapshot_id = s.id AND c.kind = 'followers'
      AND c.user_id NOT IN (SELECT user_id FROM snapshot_users WHERE snapshot_id = s.prev AND kind = 'followers')
  ) END AS newFollowers
FROM s ORDER BY s.taken_at
`;

export function openStore(file, { importDir } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const insertSnap = db.prepare('INSERT INTO snapshots (username, account_id, taken_at, profile_followers, profile_following) VALUES (?, ?, ?, ?, ?)');
  const insertUser = db.prepare('INSERT OR IGNORE INTO snapshot_users (snapshot_id, kind, user_id, username, full_name) VALUES (?, ?, ?, ?, ?)');

  function saveSnapshot(snap) {
    db.exec('BEGIN');
    try {
      const { lastInsertRowid } = insertSnap.run(snap.account.username, snap.account.id, snap.takenAt,
        snap.profileCounts?.followers ?? null, snap.profileCounts?.following ?? null);
      for (const kind of ['followers', 'following']) {
        for (const u of snap[kind]) insertUser.run(lastInsertRowid, kind, u.id, u.username, u.fullName || '');
      }
      db.exec('COMMIT');
      return Number(lastInsertRowid);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  function loadSnapshot(id) {
    const row = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id);
    if (!row) return null;
    const users = (kind) => db.prepare('SELECT user_id AS id, username, full_name AS fullName FROM snapshot_users WHERE snapshot_id = ? AND kind = ? ORDER BY username')
      .all(id, kind).map((u) => ({ ...u }));
    return {
      takenAt: row.taken_at,
      account: { id: row.account_id, username: row.username },
      profileCounts: { followers: row.profile_followers, following: row.profile_following },
      followers: users('followers'),
      following: users('following'),
    };
  }

  // Newest first.
  const recentIds = (username, limit = 2) =>
    db.prepare('SELECT id FROM snapshots WHERE username = ? ORDER BY taken_at DESC LIMIT ?').all(username, limit).map((r) => r.id);
  const lastUsername = () => db.prepare('SELECT username FROM snapshots ORDER BY taken_at DESC LIMIT 1').get()?.username ?? null;
  const history = () => db.prepare(HISTORY).all().map((r) => ({ ...r }));

  // One-time import of the JSON snapshots written before the database existed.
  if (importDir && fs.existsSync(importDir) && !db.prepare('SELECT 1 FROM snapshots LIMIT 1').get()) {
    const files = fs.readdirSync(importDir).flatMap((u) => {
      const dir = path.join(importDir, u);
      return fs.statSync(dir).isDirectory() ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)) : [];
    });
    const snaps = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))).filter((s) => s.account && s.followers);
    snaps.sort((a, b) => a.takenAt.localeCompare(b.takenAt)).forEach(saveSnapshot);
    if (snaps.length) console.error(`imported ${snaps.length} JSON snapshot(s) into ${path.basename(file)}`);
  }

  return { db, saveSnapshot, loadSnapshot, recentIds, lastUsername, history, close: () => db.close() };
}
