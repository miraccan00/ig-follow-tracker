#!/usr/bin/env node
// Writes cookies.json from values copied out of Chrome DevTools > Application > Cookies > https://www.instagram.com
//   node scripts/make-cookies.mjs <sessionid> <csrftoken> <ds_user_id>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCookies } from '../src/cookies.mjs';

const [sessionid, csrftoken, ds_user_id] = process.argv.slice(2);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cookies.json');
try {
  writeCookies(out, { sessionid, csrftoken, ds_user_id });
  console.log(`wrote ${out}`);
} catch (e) {
  console.error(`${e.message}\nusage: node scripts/make-cookies.mjs <sessionid> <csrftoken> <ds_user_id>`);
  process.exit(1);
}
