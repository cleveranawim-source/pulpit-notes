// 사용 설명서에 넣을 화면 조각: 헤드리스 크롬(아이패드 13인치 크기 1032×1376, 2배)으로 찍고,
// 번호를 찍을 자리(요소 위치)를 같은 이름의 .json 으로 남긴다 → build-guide.py 가 ①②③ 을 그려 넣는다.
// 개발 서버(5178)를 켠 상태에서 `node guide-shots.mjs` → ../guide/img/*.png(+.json)
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HERE = new URL('.', import.meta.url).pathname;
const DEMO = path.join(HERE, '../demo');
const OUT = path.join(HERE, '../guide/img');
const RICH = '260906 주일예배 설교 - 빈 그물에 다시 내리는 손.pdf';
const ink = JSON.parse(fs.readFileSync(path.join(HERE, 'cache/rich-ink.json'), 'utf8'));
fs.rmSync(OUT, { recursive: true, force: true });
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

// 요소 둘레를 잘라 찍고, marks([{sel, text?, n, at}])의 위치를 잘라 낸 그림 기준 좌표(2배)로 저장
// at: below · above · left · right · in(요소 안 왼쪽 위)
async function clip(name, sels, { pad = 16, l = 0, t = 0, r = 0, b = 0, maxH = 1376, marks = [] } = {}) {
  const info = await page.evaluate((sels, marks) => {
    const find = m => {
      const els = [...document.querySelectorAll(m.sel)];
      const el = m.text ? els.find(e => e.textContent.includes(m.text)) : els[m.i || 0];
      const r = el?.getBoundingClientRect();
      return r && { l: r.left, t: r.top, r: r.right, b: r.bottom, n: m.n, at: m.at || 'below' };
    };
    const rs = sels.map(s => document.querySelector(s)?.getBoundingClientRect()).filter(Boolean);
    return { box: { x: Math.min(...rs.map(r => r.left)), y: Math.min(...rs.map(r => r.top)), x2: Math.max(...rs.map(r => r.right)), y2: Math.max(...rs.map(r => r.bottom)) }, marks: marks.map(find).filter(Boolean) };
  }, sels, marks);
  const x = Math.max(0, info.box.x - pad - l), y = Math.max(0, info.box.y - pad - t);
  const w = Math.min(1032, info.box.x2 + pad + r) - x, h = Math.min(maxH, 1376, info.box.y2 + pad + b) - y;
  await sleep(250);
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x, y, width: w, height: h }, captureBeyondViewport: false });
  if (info.marks.length) fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify(info.marks.map(m => ({ ...m, l: (m.l - x) * 2, t: (m.t - y) * 2, r: (m.r - x) * 2, b: (m.b - y) * 2 }))));
  console.log('clip', name, Math.round(w), '×', Math.round(h), info.marks.length ? `(${info.marks.length}개 번호)` : '');
}
// 도구 막대 · 메뉴처럼 떠 있는 것만 찍을 때 뒤 원고를 가려 배경을 깨끗하게
const blank = on => page.evaluate(on => { document.getElementById('pages').style.visibility = on ? 'hidden' : ''; document.getElementById('guide').style.visibility = on ? 'hidden' : ''; }, on);
const full = (name, opts = {}) => clip(name, ['body'], { pad: 0, ...opts }); // 화면 전체(opts.maxH 로 위쪽만)
const settings = obj => page.evaluate(o => { const s = JSON.parse(localStorage.getItem('pn.settings') || '{}'); localStorage.setItem('pn.settings', JSON.stringify({ ...s, ...o })); }, obj);
const openRich = async () => {
  await page.evaluate(() => [...document.querySelectorAll('.card')].find(c => c.querySelector('h3').textContent.includes('빈 그물'))?.querySelector('.sheet').click());
  await page.waitForFunction(() => document.querySelectorAll('canvas.pdf').length > 0, { timeout: 30000 });
  await sleep(1200);
};
const setTimer = (secAgo, running = true, acc = 0) => page.evaluate((secAgo, running, acc) => {
  localStorage.setItem('pn.timer', JSON.stringify({ start: Date.now() - secAgo * 1000, acc: acc * 1000, running }));
}, secAgo, running, acc);

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
await page.evaluate(() => localStorage.setItem('pn.lastBackup', JSON.stringify(Date.now() - 2 * 86400e3)));
await setTimer(7 * 60 + 12);
await page.reload({ waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready); await sleep(700);

// ── 서재 ──
await full('library', { maxH: 820, marks: [
  { sel: '#sortSeg', n: 1, at: 'below' }, { sel: '#btnSelect', n: 2, at: 'below' }, { sel: '#btnImport', n: 3, at: 'below' },
  { sel: '#btnSettings', n: 4, at: 'below' }, { sel: '.card .more', n: 5, at: 'left' }, { sel: '.card .badge', n: 6, at: 'above' }] });
await page.click('#btnSelect'); await sleep(200);
await page.click('#lbPast'); await sleep(300);
await full('library-select', { marks: [
  { sel: '.card.picked .pick', n: 1, at: 'right' }, { sel: '#lbPast', n: 2, at: 'above' }, { sel: '#lbAll', n: 3, at: 'above' },
  { sel: '#lbDel', n: 4, at: 'above' }, { sel: '#lbDone', n: 5, at: 'above' }] });
await page.click('#lbDone'); await sleep(300);

// ── 준비 화면 ──
await openRich();
await page.evaluate(() => { document.getElementById('scroller').scrollTop = 200; }); await sleep(900);
await full('prep');
await blank(true);
await clip('bar-prep', ['#rbar'], { pad: 0, b: 44, marks: [
  { sel: '#btnBack', n: 1 }, { sel: '#btnThumbs', n: 2 }, { sel: '.rtitle', n: 3 }, { sel: '#modeSeg', n: 4 }, { sel: '#btnMenu', n: 5 }] });
await clip('palette', ['#palette'], { pad: 12, t: 38, marks: [
  { sel: '.tool[data-tool=select]', n: 1, at: 'above' }, { sel: '.tool[data-tool=pen]', n: 2, at: 'above' }, { sel: '.tool[data-tool=hl]', n: 3, at: 'above' },
  { sel: '.tool[data-tool=eraser]', n: 4, at: 'above' }, { sel: '#opts', n: 5, at: 'above' }, { sel: '#btnSize', n: 6, at: 'above' },
  { sel: '#btnUndo', n: 7, at: 'above' }, { sel: '#btnRedo', n: 8, at: 'above' }, { sel: '#btnFinger', n: 9, at: 'above' }] });
await page.click('#btnSize'); await sleep(300);
await clip('size', ['.menu'], { pad: 12, l: 44, marks: [
  { sel: '.sizepop .prev', n: 1, at: 'left' }, { sel: '.sizepop input', n: 2, at: 'above' }, { sel: '.szrow', n: 3, at: 'left' }] });
await page.keyboard.press('Escape'); await sleep(200);
// 지우개 모드 막대
await page.click('.tool[data-tool=eraser]'); await sleep(200);
await clip('eraser', ['#palette'], { pad: 12 });
await page.click('.tool[data-tool=pen]'); await sleep(200);
await page.click('#btnMenu'); await sleep(300);
await clip('menu', ['.menu'], { pad: 12, l: 44, marks: [
  { sel: '.menu .themes', n: 1, at: 'left' }, { sel: '.menu .zoomrow', n: 2, at: 'left' }, { sel: '.menu .mi', text: '여백', n: 3, at: 'left' },
  { sel: '.menu .mi', text: '미리보기', n: 4, at: 'left' }, { sel: '.menu .mi', text: '강단에서도', n: 5, at: 'left' }, { sel: '.menu .mi', text: '내보내기', n: 6, at: 'left' }] });
await page.keyboard.press('Escape'); await sleep(200);
await blank(false);

// ── 선택: 동그라미와 형광펜을 올가미로 ──
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
await clip('select', ['.selbox', '.selbar'], { pad: 20, t: 16, b: 40, l: 40, r: 40, marks: [
  { sel: '.selbar', n: 1, at: 'above' }, { sel: '.selhandle', n: 2, at: 'right' }, { sel: '.selrot', n: 3, at: 'left' }] });
await page.evaluate(() => { document.querySelector('.selbar [data-a=off]')?.click(); document.querySelector('.tool[data-tool=pen]').click(); });

// ── 쪽 미리보기 ──
await page.evaluate(() => { document.getElementById('scroller').scrollTop = 200; });
await page.click('#btnThumbs'); await sleep(1800);
await full('thumbs', { maxH: 1000, marks: [
  { sel: '#btnThumbs', n: 1, at: 'below' }, { sel: '.th.on .thc', n: 2, at: 'right' }, { sel: '.th .thc', i: 1, n: 3, at: 'right' }] });
await page.click('#btnThumbs'); await sleep(500);

// ── 강단 ──
await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; document.querySelector('#modeSeg [data-mode=pulpit]').click(); });
await sleep(900);
await page.keyboard.press('ArrowRight'); await sleep(750);
await full('pulpit');
await blank(true);
await clip('bar-pulpit', ['#rbar'], { pad: 0, b: 44, marks: [
  { sel: '#btnBack', n: 1 }, { sel: '#pPage', n: 2 }, { sel: '#pClock', n: 3 }, { sel: '#pTimer', n: 4 }, { sel: '#pTarget', n: 5 }, { sel: '#autoBtn', n: 6 },
  { sel: '#pTheme', n: 7 }, { sel: '#pWake', n: 8 }, { sel: '#modeSeg', n: 9 }, { sel: '#btnMenu', n: 10 }] });
await page.click('#pTarget'); await sleep(300);
await clip('timer', ['.menu', '#pTimer', '#pTarget'], { pad: 12, l: 46, r: 10, marks: [
  { sel: '.tpop .tmode', n: 1, at: 'left' }, { sel: '.tpop .dial', n: 2, at: 'left' }, { sel: '.tpop .chips', n: 3, at: 'left' },
  { sel: '.tpop [data-a=reset]', n: 4, at: 'left' }, { sel: '.tpop [data-a=go]', n: 5, at: 'right' }] });
await page.keyboard.press('Escape'); await sleep(200);
// 자동 스크롤 조절판(9장): 위쪽 '자동' → 막대 아래 조절판
await page.evaluate(() => document.getElementById('autoBtn').click()); await sleep(600);
await clip('autoscroll', ['#autoBtn', '#autoBox'], { pad: 12, l: 34, b: 40, marks: [
  { sel: '#autoBtn', n: 1, at: 'left' }, { sel: '#aPlay', n: 2, at: 'below' }, { sel: '#aSpd', n: 3, at: 'below' },
  { sel: '#aFit', n: 4, at: 'below' }, { sel: '#aOff', n: 5, at: 'below' }] });
await page.evaluate(() => document.getElementById('aOff').click()); await sleep(200);
await blank(false);
// 타이머 상태별 모습(대기 · 진행 · 막바지 · 넘김 · 멈춤) + 스톱워치
for (const [name, secAgo, running, acc, mode] of [['timer-idle', 0, false, 0], ['timer-run', 7 * 60 + 12, true, 0], ['timer-warn', 21 * 60 + 40, true, 0],
  ['timer-over', 26 * 60 + 5, true, 0], ['timer-paused', 0, false, 9 * 60 + 30], ['sw-idle', 0, false, 0, 'up'], ['sw-run', 12 * 60 + 40, true, 0, 'up'], ['sw-over', 26 * 60 + 5, true, 0, 'up']]) {
  await setTimer(secAgo, running, acc);
  await settings({ timerMode: mode || 'down' });
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(400);
  await openRich();
  await page.evaluate(() => document.querySelector('#modeSeg [data-mode=pulpit]').click()); await sleep(700);
  await clip(name, ['#pTimer'], { pad: 6 });
}
// 스톱워치로 바꾼 설정 창
await page.click('#pTarget'); await sleep(300);
await blank(true);
await clip('timer-sw', ['.menu'], { pad: 12 });
await blank(false);
await page.keyboard.press('Escape'); await sleep(200);
await settings({ timerMode: 'down' });
await page.evaluate(() => document.querySelector('#modeSeg [data-mode=prep]').click()); await sleep(300);

// ── 설정 ──
await page.evaluate(() => document.getElementById('btnBack').click()); await sleep(900);
await page.evaluate(() => document.getElementById('btnSettings').click()); await sleep(900);
await clip('settings', ['.sheet-card'], { pad: 0, l: 44, marks: [
  { sel: '.srow', text: '사용 설명서', n: 1, at: 'left' }, { sel: '.srow', text: '백업 만들기', n: 2, at: 'left' },
  { sel: '.srow', text: '백업에서 복원', n: 3, at: 'left' }, { sel: '.srow', text: '문의하기', n: 4, at: 'left' }] });
await browser.close();
