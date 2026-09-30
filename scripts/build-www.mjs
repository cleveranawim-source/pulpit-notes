// 앱(Capacitor)에 넣을 웹 파일만 www/ 로 모은다. 웹판(GitHub Pages)은 저장소 루트를 그대로 쓴다.
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const FILES = ['index.html', 'app.js', 'manifest.webmanifest', 'privacy.html', 'support.html'];
const DIRS = ['icons', 'vendor', 'fonts'];

rmSync('www', { recursive: true, force: true });
mkdirSync('www/sample', { recursive: true });
for (const f of FILES) cpSync(f, `www/${f}`);
for (const d of DIRS) cpSync(d, `www/${d}`, { recursive: true });
cpSync('sample/guide.pdf', 'www/sample/guide.pdf');
console.log('www/ ready');
