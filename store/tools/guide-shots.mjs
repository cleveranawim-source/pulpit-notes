// 사용 설명서에 넣을 화면 조각들: 헤드리스 크롬(아이패드 13인치 크기 1032×1376, 2배)으로 찍는다.
// 개발 서버(5178)를 켠 상태에서 `node guide-shots.mjs` → ../guide/img/*.png
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HERE = new URL('.', import.meta.url).pathname;
const DEMO = path.join(HERE, '../demo');
const OUT = path.join(HERE, '../guide/img');
const RICH = '260906 주일예배 설교 - 빈 그물에 다시 내리는 손.pdf';
const ink = JSON.parse(fs.readFileSync(path.join(HERE, 'cache/rich-ink.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pn-guide-')),
  args: ['--no-first-run', '--hide-scrollbars', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1032, height: 1376, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'standalone', { get: () => true });
  localStorage.setItem('pn.coached', 'true');
  localStorage.setItem('pn.guideVer', '99'); // 설명서 자동 넣기는 여기선 끔
  const Real = Date, delta = new Real(2026, 8, 27, 10, 52, 0).getTime() - Real.now();
  class FakeDate extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + delta); } static now() { return Real.now() + delta; } }
  window.Date = FakeDate;
});
// 요소 둘레를 잘라 찍기
async function clip(name, sels, pad = 16, extra = {}) {
  const r = await page.evaluate((sels) => {
    const rs = sels.map(s => document.querySelector(s)?.getBoundingClientRect()).filter(Boolean);
    return { x: Math.min(...rs.map(r => r.left)), y: Math.min(...rs.map(r => r.top)), x2: Math.max(...rs.map(r => r.right)), y2: Math.max(...rs.map(r => r.bottom)) };
  }, sels);
  const x = Math.max(0, r.x - pad - (extra.l || 0)), y = Math.max(0, r.y - pad - (extra.t || 0));
  const w = Math.min(1032, r.x2 + pad + (extra.r || 0)) - x, h = Math.min(1376, r.y2 + pad + (extra.b || 0)) - y;
  await sleep(250);
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x, y, width: w, height: h }, captureBeyondViewport: false });
  console.log('clip', name, Math.round(w), '×', Math.round(h));
}
// 잘라 찍을 때 화면 크기를 바꾸지 않게(captureBeyondViewport: false) — 바꾸면 원고 스크롤이 밀린다
const full = async (name, clipH = 1376) => { await sleep(350); await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 0, y: 0, width: 1032, height: clipH }, captureBeyondViewport: false }); console.log('full', name); };
const settings = obj => page.evaluate(o => { const s = JSON.parse(localStorage.getItem('pn.settings') || '{}'); localStorage.setItem('pn.settings', JSON.stringify({ ...s, ...o })); }, obj);
const openRich = async () => {
  await page.evaluate(() => [...document.querySelectorAll('.card')].find(c => c.querySelector('h3').textContent.includes('빈 그물'))?.querySelector('.sheet').click());
  await page.waitForFunction(() => document.querySelectorAll('canvas.pdf').length > 0, { timeout: 30000 });
  await sleep(1200);
};

await page.goto('http://localhost:5178/', { waitUntil: 'networkidle0' });
const pick = ['261011 주일예배 설교 - 겨자씨만 한 믿음', '261004 청년부 설교 - 길 위의 식탁', '260927 주일예배 설교 - 작은 자에게 한 것', '260920 주일예배 설교 - 기다림도 믿음입니다',
  '260913 수요예배 설교 - 광야에서 부르는 노래', RICH.replace('.pdf', ''), '260830 주일예배 설교 - 이름을 불러 주시는 분', '260823 주일예배 설교 - 돌아온 아들의 식탁'];
await (await page.$('#file')).uploadFile(...pick.map(n => `${DEMO}/${n}.pdf`));
await page.waitForFunction(n => document.querySelectorAll('.card').length === n, { timeout: 120000 }, pick.length);
await page.evaluate(async (inkPages, RICH) => {
  const db = await new Promise(res => { const q = indexedDB.open('pulpit-notes'); q.onsuccess = () => res(q.result); });
  const all = await new Promise(res => { const t = db.transaction('docs').objectStore('docs').getAll(); t.onsuccess = () => res(t.result); });
  const put = (st, v) => new Promise(res => { const t = db.transaction(st, 'readwrite'); t.objectStore(st).put(v); t.oncomplete = res; });
  for (const d of all) {
    let pages = null;
    if (d.name === RICH) pages = inkPages;
    else if (d.name.includes('겨자씨')) pages = { 0: [{ t: 'hl', c: '#A8E890', w: 0.028, p: [0.14, 0.36, 0.5, 0.7, 0.36, 0.5] }] };
    if (pages) { await put('ink', { id: d.id, pages, updated: Date.now() }); d.inkCount = Object.values(pages).reduce((n, l) => n + l.length, 0); d.inkPages = Object.keys(pages).length; }
    d.opened = d.name === RICH ? Date.now() - 20 * 60e3 : Date.now() - (5 + Math.random() * 200) * 3600e3;
    await put('docs', d);
  }
}, ink, RICH);
await settings({ sort: 'date', tool: 'pen', penColor: '#D23B2E', target: 25, zoom: 1, thumbs: false, themePrep: 'light', themePulpit: 'light' });
await page.evaluate(() => {
  localStorage.setItem('pn.lastBackup', JSON.stringify(Date.now() - 2 * 86400e3));
  localStorage.setItem('pn.timer', JSON.stringify({ start: Date.now() - (7 * 60 + 12) * 1000, acc: 0, running: true }));
});
await page.reload({ waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready); await sleep(700);

// 서재
await full('library', 1000);
await page.click('#btnSelect'); await sleep(200);
await page.click('#lbPast'); await sleep(300);
await full('library-select');
await page.click('#lbDone'); await sleep(300);

// 준비 화면
await openRich();
await page.evaluate(() => { document.getElementById('scroller').scrollTop = 200; }); await sleep(900);
await full('prep');
await clip('bar-prep', ['#rbar'], 0);
await clip('palette', ['#palette'], 14);
await page.click('#btnSize'); await sleep(300);
await clip('size', ['.menu', '#palette'], 14);
await page.keyboard.press('Escape'); await sleep(200);
await page.click('#btnMenu'); await sleep(300);
await clip('menu', ['.menu'], 12);
await page.keyboard.press('Escape'); await sleep(200);

// 선택: 동그라미와 형광펜을 올가미로
await page.evaluate(() => { document.querySelector('.tool[data-tool=select]').click(); document.getElementById('scroller').scrollTop = 380; });
await sleep(900);
await page.evaluate(async () => {
  const el = document.querySelector('.page canvas.ink'), r = el.getBoundingClientRect();
  const db = await new Promise(res => { const q = indexedDB.open('pulpit-notes'); q.onsuccess = () => res(q.result); });
  const docs = await new Promise(res => { const t = db.transaction('docs').objectStore('docs').getAll(); t.onsuccess = () => res(t.result); });
  const d = docs.find(x => x.name.includes('빈 그물'));
  const rec = await new Promise(res => { const t = db.transaction('ink').objectStore('ink').get(d.id); t.onsuccess = () => res(t.result); });
  const circle = rec.pages[0].find(s => s.t === 'pen' && s.p.length > 100), yellow = rec.pages[0].find(s => s.t === 'hl');
  const c = d.crop, xs = [], ys = [];
  for (const st of [circle, yellow]) for (let k = 0; k < st.p.length; k += 3) { xs.push(st.p[k]); ys.push(st.p[k + 1]); }
  const toX = nx => r.left + (nx - c.x0) / (c.x1 - c.x0) * r.width, toY = ny => r.top + (ny - c.y0) / (c.y1 - c.y0) * r.height;
  const x0 = toX(Math.min(...xs)) - 40, x1 = toX(Math.max(...xs)) + 40, y0 = toY(Math.min(...ys)) - 30, y1 = toY(Math.max(...ys)) + 30;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.min((x1 - x0) / 2 * 1.3, r.width / 2 - 8), ry = (y1 - y0) / 2 * 1.45;
  const ev = (t, x, y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'pen', clientX: x, clientY: y, pressure: 0.5, button: 0, buttons: t === 'pointerup' ? 0 : 1 }));
  ev('pointerdown', cx + rx, cy);
  for (let k = 1; k <= 60; k++) { const a = k / 60 * Math.PI * 2; ev('pointermove', cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
  ev('pointerup', cx + rx, cy);
});
await sleep(500);
await clip('select', ['.selbox', '.selbar'], 34);
await page.evaluate(() => { document.querySelector('.selbar [data-a=off]')?.click(); document.querySelector('.tool[data-tool=pen]').click(); });

// 쪽 미리보기
await page.evaluate(() => { document.getElementById('scroller').scrollTop = 200; });
await page.click('#btnThumbs'); await sleep(1800);
await full('thumbs', 1000);
await page.click('#btnThumbs'); await sleep(500);

// 강단
await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; document.querySelector('#modeSeg [data-mode=pulpit]').click(); });
await sleep(900);
await page.keyboard.press('ArrowRight'); await sleep(750);
await page.screenshot({ path: `${OUT}/pulpit.png` }); console.log('full pulpit');
await clip('bar-pulpit', ['#rbar'], 0);
await page.click('#pTarget'); await sleep(300);
await clip('timer', ['.menu', '#pTimer', '#pTarget'], 12);
await page.keyboard.press('Escape'); await sleep(200);
await page.evaluate(() => { document.querySelector('#modeSeg [data-mode=prep]').click(); });
await sleep(300);

// 설정
await page.evaluate(() => document.getElementById('btnBack').click()); await sleep(900);
await page.evaluate(() => document.getElementById('btnSettings').click()); await sleep(900);
await clip('settings', ['.sheet-card'], 0);
await browser.close();
