import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = process.env.IG_DATA_DIR || path.join(ROOT, 'data');
export const BIN = process.env.LIGHTPANDA_BIN || path.join(ROOT, 'bin', 'lightpanda');
export const COOKIES = process.env.IG_COOKIE_FILE || path.join(ROOT, 'cookies.json');
export const DB_FILE = process.env.IG_DB_FILE || path.join(DATA, 'tracker.db');

export const openDefaultStore = () => openStore(DB_FILE, { importDir: path.join(DATA, 'snapshots') });
