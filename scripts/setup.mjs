#!/usr/bin/env node
// Downloads the Lightpanda nightly binary for this OS/CPU into bin/lightpanda.
// Runs automatically on `npm install`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lightpanda');
const ASSETS = {
  'darwin-arm64': 'lightpanda-aarch64-macos',
  'darwin-x64': 'lightpanda-x86_64-macos',
  'linux-x64': 'lightpanda-x86_64-linux',
  'linux-arm64': 'lightpanda-aarch64-linux',
};

if (fs.existsSync(BIN) && !process.argv.includes('--force')) {
  console.log(`lightpanda already at ${path.relative(process.cwd(), BIN)} (use --force to update)`);
  process.exit(0);
}
const asset = ASSETS[`${process.platform}-${process.arch}`];
if (!asset) {
  console.error(`no Lightpanda build for ${process.platform}-${process.arch}. On Windows use WSL.`);
  process.exit(1);
}
const url = `https://github.com/lightpanda-io/browser/releases/download/nightly/${asset}`;
console.log(`downloading ${url}`);
const res = await fetch(url);
if (!res.ok) { console.error(`download failed: HTTP ${res.status}`); process.exit(1); }
fs.mkdirSync(path.dirname(BIN), { recursive: true });
fs.writeFileSync(BIN, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
console.log('lightpanda ready');
