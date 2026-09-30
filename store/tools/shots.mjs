// 앱스토어 스크린숏: 아이패드 13인치(2064×2752) = 1032×1376 CSS px × 2
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = os.homedir();
const ROOT = `${HOME}/Claude/pulpit-notes`;
const OUT = `${ROOT}/store/screenshots/raw`;
const SP = new URL('.', import.meta.url).pathname.replace(/\/$/, '') + '/cache'; // rich-ink.json · 임시 크롬 프로필
const DEMO = `${ROOT}/store/demo`;
const RICH = '260906 주일예배 설교 - 빈 그물에 다시 내리는 손.pdf';
const ink = JSON.parse(fs.readFileSync(`${SP}/rich-ink.json`, 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SP, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  userDataDir: fs.mkdtempSync(path.join(SP, 'chrome-')),
  args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1032, height: 1376, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'standalone', { get: () => true }); // '홈 화면에 추가' 안내 숨김(앱과 같게)
  localStorage.setItem('pn.coached', 'true');
  // 시계를 주일 오전 10:52 로
  const Real = Date, delta = new Real(2026, 8, 27, 10, 52, 0).getTime() - Real.now();
  class FakeDate extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + delta); } static now() { return Real.now() + delta; } }
  window.Date = FakeDate;
});
const shot = async name => { await sleep(350); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); };
const settings = obj => page.evaluate(o => { const s = JSON.parse(localStorage.getItem('pn.settings') || '{}'); localStorage.setItem('pn.settings', JSON.stringify({ ...s, ...o })); }, obj);

await page.goto('http://localhost:5178/', { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);

// 1) 원고 6편 불러오기
const input = await page.$('#file');
await input.uploadFile(...fs.readdirSync(DEMO).filter(f => f.endsWith('.pdf')).map(f => `${DEMO}/${f}`));
await page.waitForFunction(() => document.querySelectorAll('.card').length === 16, { timeout: 120000 });
await sleep(800);

// 2) 필기 넣기(예시 설교에 준비해 둔 표시 + 다른 두 편에 몇 획)
await page.evaluate(async (inkPages, RICH) => {
  const db = await new Promise(res => { const q = indexedDB.open('pulpit-notes'); q.onsuccess = () => res(q.result); });
  const all = await new Promise(res => { const t = db.transaction('docs').objectStore('docs').getAll(); t.onsuccess = () => res(t.result); });
  const put = (st, v) => new Promise(res => { const t = db.transaction(st, 'readwrite'); t.objectStore(st).put(v); t.oncomplete = res; });
  const now = Date.now();
  for (const d of all) {
    let pages = null;
    if (d.name === RICH) pages = inkPages;
    else if (d.name.includes('겨자씨')) pages = { 0: [{ t: 'hl', c: '#A8E890', w: 0.028, p: [0.14, 0.36, 0.5, 0.7, 0.36, 0.5] }, { t: 'pen', c: '#2456C8', w: 0.0034, p: [0.14, 0.47, 0.5, 0.4, 0.472, 0.5, 0.66, 0.47, 0.5] }, { t: 'pen', c: '#D23B2E', w: 0.0034, p: [0.14, 0.52, 0.5, 0.5, 0.522, 0.5] }] };
    else if (d.name.includes('작은 자에게')) pages = { 0: [{ t: 'pen', c: '#D23B2E', w: 0.0034, p: [0.12, 0.40, 0.5, 0.6, 0.402, 0.5] }, { t: 'hl', c: '#FFE45C', w: 0.028, p: [0.12, 0.30, 0.5, 0.52, 0.30, 0.5] }] };
    else if (d.name.includes('광야에서')) pages = { 0: [{ t: 'hl', c: '#FFE45C', w: 0.028, p: [0.12, 0.33, 0.5, 0.62, 0.33, 0.5] }, { t: 'pen', c: '#D23B2E', w: 0.0034, p: [0.12, 0.45, 0.5, 0.4, 0.452, 0.5, 0.7, 0.451, 0.5] }] };
    else if (d.name.includes('기다림도')) pages = { 0: [{ t: 'pen', c: '#2456C8', w: 0.0034, p: [0.12, 0.40, 0.5, 0.5, 0.402, 0.5, 0.8, 0.401, 0.5] }] };
    if (pages) {
      await put('ink', { id: d.id, pages, updated: now });
      d.inkCount = Object.values(pages).reduce((n, l) => n + l.length, 0);
    }
    // 최근 연 시각: 앞으로 할 설교는 요 며칠, 지난 설교는 몇 주 전
    const ago = { '261018': 26, '261011': 3, '261007': 50, '261004': 5, '260927': 0.4, '260923': 90, '260920': 170 }[d.name.slice(0, 6)];
    d.opened = ago != null ? now - ago * 3600e3 : now - (200 + Math.random() * 300) * 3600e3;
    if (d.name === RICH) d.opened = now - 20 * 60e3;
    await put('docs', d);
  }
}, ink, RICH);
await settings({ sort: 'date', tool: 'pen', penColor: '#D23B2E', finger: false, themePrep: 'light', themePulpit: 'light', target: 25 });
await page.evaluate(() => localStorage.setItem('pn.lastBackup', JSON.stringify(Date.now() - 2 * 86400e3)));
await page.reload({ waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
await sleep(600);
await shot('1-library');

// 3) 준비 화면(필기가 보이는 원고)
await page.evaluate(RICH => { [...document.querySelectorAll('.card')].find(c => c.querySelector('h3').textContent.includes('빈 그물'))?.querySelector('.sheet').click(); }, RICH);
await page.waitForFunction(() => !document.getElementById('reader').hidden && document.querySelectorAll('canvas.pdf').length > 0, { timeout: 30000 });
await sleep(1500);
await page.evaluate(() => { document.getElementById('scroller').scrollTop = 200; });
await sleep(1200);
await shot('2-prep');

// 5) 올가미로 고르기(동그라미·밑줄 둘레)
await page.evaluate(() => { document.querySelector('.tool[data-tool=select]').click(); document.getElementById('scroller').scrollTop = 380; });
await sleep(900);
await page.evaluate(() => {
  const el = document.querySelector('.page canvas.ink'), r = el.getBoundingClientRect();
  // '경험보다 말씀을' 동그라미를 찾아 그 둘레로 올가미
  const W = r.width, cx = r.left + W * 0.40, cy = r.top + r.height * 0.70;
  const ev = (t, x, y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'pen', clientX: x, clientY: y, pressure: 0.5, button: 0, buttons: t === 'pointerup' ? 0 : 1 }));
  window.__lasso = { cx, cy };
}, );
// 동그라미 획의 실제 위치로 올가미 중심을 잡는다
await page.evaluate(async () => {
  const el = document.querySelector('.page canvas.ink'), r = el.getBoundingClientRect();
  const db = await new Promise(res => { const q = indexedDB.open('pulpit-notes'); q.onsuccess = () => res(q.result); });
  const docs = await new Promise(res => { const t = db.transaction('docs').objectStore('docs').getAll(); t.onsuccess = () => res(t.result); });
  const d = docs.find(x => x.name.includes('빈 그물'));
  const inkRec = await new Promise(res => { const t = db.transaction('ink').objectStore('ink').get(d.id); t.onsuccess = () => res(t.result); });
  const circle = inkRec.pages[0].find(s => s.t === 'pen' && s.p.length > 100);
  const green = inkRec.pages[0].find(s => s.t === 'hl' && s.c === '#FFE45C');
  const c = d.crop, xs = [], ys = [];
  for (const st of [circle, green]) for (let k = 0; k < st.p.length; k += 3) { xs.push(st.p[k]); ys.push(st.p[k + 1]); }
  const toX = nx => r.left + (nx - c.x0) / (c.x1 - c.x0) * r.width;
  const toY = ny => r.top + (ny - c.y0) / (c.y1 - c.y0) * r.height;
  const x0 = toX(Math.min(...xs)) - 40, x1 = toX(Math.max(...xs)) + 40, y0 = toY(Math.min(...ys)) - 30, y1 = toY(Math.max(...ys)) + 30;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.min((x1 - x0) / 2 * 1.3, r.width / 2 - 8), ry = (y1 - y0) / 2 * 1.45; // 상자 모서리까지 품도록
  const ev = (t, x, y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'pen', clientX: x, clientY: y, pressure: 0.5, button: 0, buttons: t === 'pointerup' ? 0 : 1 }));
  ev('pointerdown', cx + rx, cy);
  for (let k = 1; k <= 60; k++) { const a = k / 60 * Math.PI * 2; ev('pointermove', cx + rx * Math.cos(a) * (1 + 0.03 * Math.sin(a * 5)), cy + ry * Math.sin(a)); }
  ev('pointerup', cx + rx, cy);
});
await sleep(500);
await shot('5-select');
await page.evaluate(() => { document.querySelector('.selbar [data-a=off]')?.click(); document.querySelector('.tool[data-tool=pen]').click(); });

// 4) 강단 화면: 타이머 11:32 진행 중, 목표 25분, 한 화면 넘긴 직후(금색 이어 읽기 표시)
await page.evaluate(() => {
  localStorage.setItem('pn.timer', JSON.stringify({ start: Date.now() - 692000, acc: 0, running: true }));
  document.getElementById('scroller').scrollTop = 0;
});
await page.reload({ waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => [...document.querySelectorAll('.card')].find(c => c.querySelector('h3').textContent.includes('빈 그물'))?.querySelector('.sheet').click());
await page.waitForFunction(() => document.querySelectorAll('canvas.pdf').length > 0, { timeout: 30000 });
await sleep(1200);
await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; document.querySelector('.rbar .seg [data-mode=pulpit]').click(); });
await sleep(900);
await page.keyboard.press('ArrowRight');
await sleep(750);
await page.screenshot({ path: `${OUT}/3-pulpit.png` }); console.log('shot 3-pulpit');

// 6) 강단 · 어둡게
await page.evaluate(() => { document.getElementById('pTheme').click(); document.getElementById('pTheme').click(); });
await sleep(2600);
await page.keyboard.press('ArrowLeft');
await sleep(2800);
await shot('4-pulpit-dark');
await page.evaluate(() => { document.getElementById('pTheme').click(); document.querySelector('#modeSeg [data-mode=prep]').click(); });
await sleep(400);

// 7) 설정(백업 · 개인정보)
await page.evaluate(() => document.getElementById('btnBack').click());
await sleep(900);
await page.evaluate(() => document.getElementById('btnSettings').click());
await sleep(900);
await shot('6-settings');

await browser.close();
