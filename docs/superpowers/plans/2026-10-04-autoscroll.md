# 자동 스크롤 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** 강단 화면에서 원고가 일정한 빠르기로 흐르는 자동 스크롤. 버튼·조절판, 탭 영역, 속도 1~20, 시간에 맞추기를 넣는다.

**구조:**
- `app.js`의 강단 코드 옆에 `// ── 자동 스크롤 ──` 구역 하나를 둔다. 상태는 `A`, 함수는 `auto*`다.
- 이동은 `setTimeout` 사슬로 한다. 한 번에 화면 점 하나를 밀고, 필요한 만큼만 깨운다(33ms 하한).
- 탭 처리는 기존 강단 `pointerup` 분기에서 `A.on`이면 새 영역 규칙을 따른다.
- 화면은 `index.html`에 버튼·조절판 마크업과 CSS를 넣는다.

**기술:** 바닐라 JS(ES 모듈), CSS, puppeteer-core 헤드리스 시험(시스템 Chrome).

**설계 문서:** `docs/superpowers/specs/2026-10-04-autoscroll-design.md`

**시험 실행 규칙:**
- 개발 서버 대신 `scratchpad/shots/srv.mjs`로 시험 동안만 5178을 연다. 형식은 `node srv.mjs node <시험>.mjs`다.
- 아래에서 `$SH`는 `/private/tmp/claude-501/-Users-yeolstudio-Claude/feea1deb-4da4-4fae-8fc2-7fa782739b5d/scratchpad/shots`다.
- `$SH/node_modules`에 puppeteer-core가 있다.

---

## 파일 구성

| 파일 | 할 일 |
|---|---|
| `index.html` | 아이콘 `i-minus`·`i-scroll`, `#autoBox`(버튼 + 조절판) 마크업, 자동 스크롤 CSS |
| `app.js` | 기본 설정 `autoSpeed: 9`; 자동 스크롤 구역(상태 · 이동 · 버튼 연결 · 시간에 맞추기 · 손가락 쉼); `setMode`/`turn`/탭 처리/`tick`/`visibilitychange`에 연결 |
| `sw.js` | VERSION 올림 |
| `sample/guide-source.html`, `sample/guide.pdf` | 7장에 자동 스크롤 문단 |
| `store/listing.md`, `README.md` | 새 기능 문구 · 설계 요약 |
| `$SH/autolib.mjs` | 자동 스크롤 시험 공통(브라우저 열기 · 탭 · 끌기 · 기록) |
| `$SH/tautoui.mjs`, `$SH/tauto.mjs`, `$SH/tautotap.mjs`, `$SH/tautofit.mjs`, `$SH/tautowake.mjs` | 과제별 시험 |

---

### Task 1: 버튼·조절판 마크업과 모양, 시험 공통

**Files:**
- Create: `$SH/autolib.mjs`, `$SH/tautoui.mjs`
- Modify: `index.html` (아이콘: `i-x` 줄 다음 / 마크업: 팔레트 `</nav>` 다음 / CSS: `@media (max-width:800px){ #reader[data-mode="pulpit"] .rbar …}` 줄 다음)
- Modify: `app.js:36-38` (기본 설정)

- [ ] **Step 1: 시험 공통 파일 작성**

`$SH/autolib.mjs`:
```js
// 자동 스크롤 시험 공통 — 13쪽 사용 설명서를 열어 둔 헤드리스 크롬
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
export const ROOT = `${os.homedir()}/Claude/pulpit-notes`;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const expectV = (w, s) => 0.0045 * w * 1.17 ** (s - 9); // 설계의 빠르기 식(CSS px/초)
export async function open({ width = 1032, height = 1376 } = {}) {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pn-')), args: ['--no-first-run'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('pn.coached', 'true'); localStorage.setItem('pn.guideVer', '99');
    // 깨움 세기 + Date 앞당기기(꺼짐 방지·타이머 시험용, performance.now 는 그대로)
    window.__wakes = 0; window.__skew = 0;
    const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(() => { window.__wakes++; typeof f === 'function' && f(...a); }, ms);
    const Real = Date, now0 = Real.now;
    class D extends Real { constructor(...a) { if (a.length) super(...a); else super(now0() + window.__skew); } static now() { return now0() + window.__skew; } }
    window.Date = D;
    Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { window.__wake = 'on'; return { _h: [], addEventListener(t, f) { this._h.push(f); }, release: async function () { window.__wake = 'off'; this._h.forEach(f => f()); } }; } } });
  });
  await page.goto('http://localhost:5178/', { waitUntil: 'networkidle0' });
  await (await page.$('#file')).uploadFile(`${ROOT}/sample/guide.pdf`);
  await page.waitForFunction(() => !document.getElementById('reader').hidden && document.querySelectorAll('canvas.pdf').length, { timeout: 60000 });
  await sleep(1000);
  const cdp = await page.target().createCDPSession();
  let pass = 0, fail = 0;
  const box = () => page.evaluate(() => { const b = document.getElementById('scroller').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  return {
    browser, page, cdp, errs,
    log(label, ok, v) { ok ? pass++ : fail++; console.log(ok ? '✓' : '✗', label.padEnd(38), JSON.stringify(v)); },
    st: () => page.evaluate(() => { const b = document.getElementById('autoBox'); return { top: document.getElementById('scroller').scrollTop, on: b.classList.contains('on'), run: b.classList.contains('run'), panel: !document.getElementById('autoPanel').hidden, spd: document.getElementById('aSpd').textContent, toast: document.querySelector('.toast')?.textContent || '', wake: window.__wake }; }),
    mode: m => page.evaluate(m => document.querySelector(`#modeSeg [data-mode=${m}]`).click(), m),
    click: sel => page.evaluate(sel => document.querySelector(sel).click(), sel),
    setTop: y => page.evaluate(y => { document.getElementById('scroller').scrollTop = y; }, y),
    maxTop: () => page.evaluate(() => { const s = document.getElementById('scroller'); return s.scrollHeight - s.clientHeight; }),
    W: () => page.evaluate(() => document.querySelector('.page').offsetWidth),
    H: () => page.evaluate(() => document.getElementById('scroller').clientHeight),
    wakes: () => page.evaluate(() => window.__wakes),
    skew: ms => page.evaluate(ms => { window.__skew += ms; }, ms),
    async tap(fx, fy = 0.5, r = 10) { const b = await box(); await touch('touchStart', [{ x: b.x + b.w * fx, y: b.y + b.h * fy, radiusX: r, radiusY: r, id: 1 }]); await sleep(60); await touch('touchEnd', []); await sleep(300); },
    async drag(fx, fy0, fy1, steps = 14) { const b = await box(), x = b.x + b.w * fx; await touch('touchStart', [{ x, y: b.y + b.h * fy0, radiusX: 10, radiusY: 10, id: 2 }]); for (let i = 1; i <= steps; i++) { await touch('touchMove', [{ x, y: b.y + b.h * (fy0 + (fy1 - fy0) * i / steps), radiusX: 10, radiusY: 10, id: 2 }]); await sleep(16); } await touch('touchEnd', []); },
    async done() { console.log(`통과 ${pass} · 실패 ${fail} · 오류`, errs); await browser.close(); process.exit(fail || errs.length ? 1 : 0); },
  };
}
```

- [ ] **Step 2: 화면 시험 작성**

`$SH/tautoui.mjs`:
```js
// 자동 스크롤 버튼·조절판: 강단에서만 보이고, 오른쪽 아래, 폭마다 화면 안에 들어오는지
import { open, sleep } from './autolib.mjs';
const t = await open();
const rect = () => t.page.evaluate(() => { const b = document.getElementById('autoBox').getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: innerWidth, h: innerHeight, shown: b.width > 0 }; });
let r = await rect(); t.log('준비 화면: 버튼 안 보임', !r.shown, r);
await t.mode('pulpit'); await sleep(500);
r = await rect(); t.log('강단: 오른쪽 아래에 보임', r.shown && r.w - r.r <= 40 && r.h - r.b <= 40, r);
let s = await t.st(); t.log('처음: 조절판 닫힘 · 꺼짐 · 속도 9', !s.panel && !s.on && s.spd === '속도 9', s);
await t.page.evaluate(() => { document.getElementById('autoPanel').hidden = false; }); // 모양만 보려고 펼침
for (const [w, h] of [[744, 1133], [820, 1180], [1032, 1376], [1180, 820]]) {
  await t.page.setViewport({ width: w, height: h, deviceScaleFactor: 2, hasTouch: true, isMobile: true }); await sleep(400);
  r = await rect(); t.log(`폭 ${w}: 조절판까지 화면 안`, r.l >= 8 && r.r <= w && r.b <= h, r);
}
await t.done();
```

- [ ] **Step 3: 시험이 실패하는지 확인**

Run: `cd $SH && node srv.mjs node tautoui.mjs`
Expected: FAIL. `#autoBox`가 없어 `Cannot read properties of null` 오류로 끝난다.

- [ ] **Step 4: 아이콘 추가**

`index.html`의 `<symbol id="i-x" …></symbol>` 줄 바로 다음:
```html
    <symbol id="i-minus" viewBox="0 0 24 24"><path d="M5 12h14"/></symbol>
    <symbol id="i-scroll" viewBox="0 0 24 24"><path d="M5 5h14M5 9h14M5 13h8"/><path d="M17.5 13v7"/><path d="M15 17.5l2.5 2.5 2.5-2.5"/></symbol>
```

- [ ] **Step 5: 마크업 추가**

`index.html`의 팔레트 `  </nav>` 바로 다음(같은 `#reader` 안):
```html
  <div class="autobox pulpit-only" id="autoBox">
    <div class="autopanel" id="autoPanel" hidden>
      <button class="ab" id="aPlay" aria-label="멈춤"><svg class="i"><use href="#i-pause"/></svg></button>
      <button class="ab" id="aSlow" aria-label="느리게"><svg class="i"><use href="#i-minus"/></svg></button>
      <span class="aspd" id="aSpd">속도 9</span>
      <button class="ab" id="aFast" aria-label="빠르게"><svg class="i"><use href="#i-plus"/></svg></button>
      <button class="ab afit" id="aFit"><svg class="i"><use href="#i-timer"/></svg>시간에 맞추기</button>
      <button class="ab" id="aOff" aria-label="자동 스크롤 끄기"><svg class="i"><use href="#i-x"/></svg></button>
    </div>
    <button class="autobtn" id="autoBtn" aria-label="자동 스크롤"><svg class="i"><use href="#i-scroll"/></svg><span class="adot"></span></button>
  </div>
```

- [ ] **Step 6: CSS 추가**

`index.html`의 `@media (max-width:800px){ #reader[data-mode="pulpit"] .rbar{gap:6px} …}` 줄 바로 다음:
```css
/* 자동 스크롤(강단): 오른쪽 아래 버튼 → 누르면 왼쪽으로 조절판. 흐림 없이 불투명 */
.autobox{position:absolute;right:calc(16px + var(--safe-r));bottom:calc(16px + var(--safe-b));z-index:6;display:flex;align-items:center;gap:8px}
.autobtn{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;position:relative;color:var(--ink-2);background:var(--bar-solid);
  box-shadow:0 10px 26px -12px rgba(40,30,20,.55),0 0 0 1px rgba(0,0,0,.06)}
.autobtn .adot{position:absolute;right:8px;top:8px;width:9px;height:9px;border-radius:50%;background:var(--ink-3);display:none}
.autobox.on .autobtn{color:var(--accent)}
.autobox.on .adot{display:block}
.autobox.run .adot{background:var(--ok)}
.autopanel{display:flex;align-items:center;gap:2px;padding:5px;border-radius:16px;background:var(--bar-solid);color:var(--ink);
  box-shadow:0 14px 34px -14px rgba(40,30,20,.5),0 0 0 1px rgba(0,0,0,.05)}
.autopanel[hidden]{display:none}
.ab{height:40px;min-width:40px;padding:0 8px;border-radius:11px;display:flex;align-items:center;justify-content:center;gap:5px;font-size:14px;color:inherit}
.ab:active{background:rgba(0,0,0,.06)}
.ab svg.i{width:19px;height:19px}
.aspd{min-width:66px;text-align:center;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
.afit{color:var(--ink-2);font-size:13.5px}
#reader[data-theme="dark"] .autobtn,#reader[data-theme="dark"] .autopanel{color:#E9E3D8;box-shadow:0 0 0 1px rgba(255,255,255,.08)}
#reader[data-theme="dark"] .autobox.on .autobtn{color:#E8909E}
```

- [ ] **Step 7: 기본 설정**

`app.js` 기본 설정의 `zoom: 1, thumbs: false, pulpitInk: false,` 줄을 다음으로 바꾼다.
```js
  zoom: 1, thumbs: false, pulpitInk: false, autoSpeed: 9,
```

- [ ] **Step 8: 시험 통과 확인**

Run: `cd $SH && node srv.mjs node tautoui.mjs`
Expected: `통과 7 · 실패 0 · 오류 []`

- [ ] **Step 9: 커밋**

```bash
cd ~/Claude/pulpit-notes && git add index.html app.js && git commit -m "자동 스크롤: 버튼·조절판 모양(강단 오른쪽 아래)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 자동 이동 엔진과 버튼·조절판 동작

**Files:**
- Create: `$SH/tauto.mjs`
- Modify: `app.js`
  - 자동 스크롤 구역: 강단 `visibilitychange` 리스너(`if (document.visibilityState !== 'visible' || R?.mode !== 'pulpit') return;`로 시작) 바로 위
  - `setMode`의 `else { releaseWake(); stopTick(); }`
  - `tick`의 `if (wakeLock && stale) releaseWake();`
  - 그 `visibilitychange` 리스너

- [ ] **Step 1: 시험 작성**

`$SH/tauto.mjs`:
```js
// 자동 스크롤 엔진: 켜기·빠르기·깨움 수·조절판 접힘·속도 단계·원고 끝·강단을 나가면 꺼짐
import { open, sleep, expectV } from './autolib.mjs';
const t = await open();
await t.mode('pulpit'); await sleep(500);
await t.click('#autoBtn'); await sleep(300);
let s = await t.st(); t.log('버튼 → 켜짐 · 흐름 · 조절판 열림', s.on && s.run && s.panel, s);
const W = await t.W();
async function speedCheck(label, secs, tol) {
  const a = await t.st(), w0 = await t.wakes(); await sleep(secs * 1000); const b = await t.st(), w1 = await t.wakes();
  const spd = +a.spd.replace('속도 ', ''), v = (b.top - a.top) / secs, ev = expectV(W, spd);
  t.log(`${label}: 빠르기 식과 ±${tol * 100}%`, Math.abs(v / ev - 1) <= tol, { spd, v: +v.toFixed(2), expect: +ev.toFixed(2), wakesPerSec: +((w1 - w0) / secs).toFixed(1) });
  return (w1 - w0) / secs;
}
const wps = await speedCheck('속도 9', 6, 0.06);
t.log('속도 9: 1초 깨움 2~31번', wps >= 2 && wps <= 31, wps);
s = await t.st(); t.log('5초 뒤 조절판 접힘 · 계속 흐름', !s.panel && s.run, s);
await t.click('#autoBtn'); await sleep(200);
s = await t.st(); t.log('켜진 채 버튼 → 조절판만 열림', s.panel && s.run, s);
for (let i = 0; i < 3; i++) await t.click('#aFast');
s = await t.st(); t.log('+ 세 번 → 속도 12', s.spd === '속도 12', s.spd);
await t.click('#aSlow'); s = await t.st(); t.log('− → 속도 11', s.spd === '속도 11', s.spd);
for (let i = 0; i < 12; i++) await t.click('#aFast');
s = await t.st(); t.log('끝까지 + → 속도 20', s.spd === '속도 20', s.spd);
await speedCheck('속도 20', 3, 0.06);
const stored = await t.page.evaluate(() => JSON.parse(localStorage.getItem('pn.settings')).autoSpeed);
t.log('속도 기억(settings.autoSpeed)', stored === 20, stored);
for (let i = 0; i < 25; i++) await t.click('#aSlow');
s = await t.st(); t.log('끝까지 − → 속도 1', s.spd === '속도 1', s.spd);
await speedCheck('속도 1', 8, 0.1);
await t.click('#aPlay'); await sleep(200);
s = await t.st(); const top0 = s.top, w0 = await t.wakes(); await sleep(3000);
const s2 = await t.st(), w1 = await t.wakes();
t.log('멈춤 버튼 → 멈춤 · 이동 0 · 깨움 거의 0', !s2.run && s2.on && Math.abs(s2.top - top0) < 0.5 && w1 - w0 <= 1, { moved: s2.top - top0, wakes: w1 - w0 });
for (let i = 0; i < 25; i++) await t.click('#aFast'); // 속도 20으로 끝까지
const max = await t.maxTop(); await t.setTop(max - 40); await sleep(200);
await t.click('#aPlay'); await sleep(3500);
s = await t.st(); t.log('원고 끝 → 스스로 멈춤 · 알림', !s.run && s.on && s.toast.includes('원고의 끝'), s);
await t.click('#aOff'); await sleep(200);
s = await t.st(); t.log('끄기 → 꺼짐 · 조절판 닫힘', !s.on && !s.run && !s.panel, s);
await t.setTop(0); await t.click('#autoBtn'); await sleep(300);
await t.mode('prep'); await sleep(300);
s = await t.st(); t.log('준비 화면으로 → 꺼짐', !s.on && !s.run, s);
await t.mode('pulpit'); await sleep(300); await t.click('#autoBtn'); await sleep(300);
await t.click('#btnBack'); await sleep(800);
await t.page.evaluate(() => document.querySelector('.card .sheet').click()); await sleep(1500);
await t.mode('pulpit'); await sleep(300);
s = await t.st(); t.log('서재로 갔다 오면 → 꺼짐', !s.on && !s.run, s);
await t.done();
```

- [ ] **Step 2: 시험이 실패하는지 확인**

Run: `cd $SH && node srv.mjs node tauto.mjs`
Expected: FAIL. 첫 줄 `✗ 버튼 → 켜짐 · 흐름 · 조절판 열림`이다(버튼에 동작이 없음).

- [ ] **Step 3: 자동 스크롤 구역 작성**

`app.js`에서 아래 리스너 바로 위에 넣는다.
```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || R?.mode !== 'pulpit') return;
```
넣을 코드:
```js
// ── 자동 스크롤(강단) ──
// 원고를 화면 점 하나(아이패드 0.5px)씩, 필요한 만큼만 깨어 민다(1초 최대 30번, 멈춤이면 0번).
// 빠르기는 쪽 표시 폭에 비례 — 가로로 돌리거나 확대해도 글자 기준 빠르기가 같다. 속도 9 ≈ A4 한 쪽 4~5분.
// 설계: docs/superpowers/specs/2026-10-04-autoscroll-design.md
const AUTO_K = 0.0045, AUTO_R = 1.17;
const A = { on: false, running: false, speed: clamp(+settings.autoSpeed || 9, 1, 20), pos: 0, last: 0, lastSet: null, quantum: 1, timer: 0, hideT: 0, holdUntil: 0, touching: false, moved: 0 };
const autoBox = $('#autoBox'), autoPanel = $('#autoPanel');
const pageW = () => R?.pages[curPage()]?.dw || scroller.clientWidth;
const autoVel = () => AUTO_K * pageW() * AUTO_R ** (A.speed - 9); // CSS px/초
const fmtSpeed = s => String(Math.round(s * 10) / 10);
function renderAuto() {
  autoBox.classList.toggle('on', A.on);
  autoBox.classList.toggle('run', A.running);
  const p = $('#aPlay');
  p.innerHTML = `<svg class="i"><use href="#i-${A.running ? 'pause' : 'play'}"/></svg>`;
  p.setAttribute('aria-label', A.running ? '멈춤' : '흐르기');
  $('#aSpd').textContent = `속도 ${fmtSpeed(A.speed)}`;
}
function autoPanelShow(on) {
  clearTimeout(A.hideT);
  autoPanel.hidden = !on;
  if (on) A.hideT = setTimeout(() => { autoPanel.hidden = true; }, 5000); // 5초 손대지 않으면 접는다(원고는 계속 흐름)
}
function autoSchedule() {
  clearTimeout(A.timer);
  const wait = A.touching || performance.now() < A.holdUntil ? 200 : Math.max(33, 1000 * A.quantum / autoVel());
  A.timer = setTimeout(autoStep, wait);
}
function autoStep() {
  A.timer = 0;
  if (!R || !A.running) return;
  const now = performance.now();
  if (A.touching || now < A.holdUntil) { A.last = now; A.lastSet = null; return autoSchedule(); } // 손가락·넘기기 동안은 쉬고, 끝나면 그 자리부터
  const cur = scroller.scrollTop, max = scroller.scrollHeight - scroller.clientHeight;
  if (A.lastSet == null || Math.abs(cur - A.lastSet) > 1.5) A.pos = cur; // 누가 움직였으면(페달·탭·확대) 그 자리부터
  const dt = Math.min(250, now - A.last) / 1000; // 화면이 꺼졌다 켜지는 등 오래 쉰 뒤에도 한꺼번에 뛰지 않게
  A.last = now;
  const before = A.pos;
  A.pos = Math.min(max, A.pos + autoVel() * dt);
  A.moved += A.pos - before;
  scroller.scrollTop = A.pos;
  A.lastSet = scroller.scrollTop;
  if (A.pos >= max - 0.5) { autoPause(); toast('원고의 끝이에요', 1600); return; }
  autoSchedule();
}
function autoPlay() {
  if (!R) return;
  if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 0.5) { toast('원고의 끝이에요', 1600); return; }
  A.running = true; A.last = performance.now(); A.lastSet = null;
  renderAuto(); autoSchedule();
}
function autoPause() { A.running = false; clearTimeout(A.timer); A.timer = 0; renderAuto(); }
function autoToggle() { A.running ? autoPause() : autoPlay(); }
function autoOn() {
  if (!R || R.mode !== 'pulpit') return;
  if (!A.on) {
    const t0 = scroller.scrollTop; // 소수 스크롤이 되면 기기 화소 하나씩, 아니면 1px씩
    scroller.scrollTop = t0 + 0.5;
    A.quantum = Math.abs(scroller.scrollTop - t0 - 0.5) < 0.02 ? 1 / (devicePixelRatio || 1) : 1;
    scroller.scrollTop = t0;
    A.on = true;
    autoPlay();
  }
  autoPanelShow(true);
  renderAuto();
}
function autoOff() {
  autoPause();
  A.on = false; A.touching = false;
  autoPanelShow(false);
  renderAuto();
}
function autoSetSpeed(s) {
  A.speed = clamp(Math.round(s * 10) / 10, 1, 20);
  settings.autoSpeed = A.speed; saveSettings();
  renderAuto();
  if (A.running) autoSchedule();
}
$('#autoBtn').onclick = () => autoOn();
$('#aPlay').onclick = () => autoToggle();
$('#aSlow').onclick = () => autoSetSpeed(Number.isInteger(A.speed) ? A.speed - 1 : Math.floor(A.speed));
$('#aFast').onclick = () => autoSetSpeed(Number.isInteger(A.speed) ? A.speed + 1 : Math.ceil(A.speed));
$('#aOff').onclick = () => autoOff();
autoPanel.addEventListener('pointerdown', () => autoPanelShow(true)); // 조절판을 만지는 동안은 접지 않는다
renderAuto();
```

- [ ] **Step 4: 준비 화면·서재로 가면 끄기**

`setMode`에서 다음 줄을
```js
  else { releaseWake(); stopTick(); }
```
이렇게 바꾼다.
```js
  else { releaseWake(); stopTick(); autoOff(); }
```
(`closeDoc`은 `setMode('prep', false)`를 부르므로 함께 꺼진다.)

- [ ] **Step 5: 흐르는 동안은 꺼짐 방지를 풀지 않기**

`tick`에서 다음 줄을
```js
  if (wakeLock && stale) releaseWake();
```
이렇게 바꾼다.
```js
  if (wakeLock && stale && !A.running) releaseWake(); // 자동 스크롤이 흐르는 동안은 손대지 않아도 켜 둔다
```

- [ ] **Step 6: 화면이 다시 보일 때 이어서**

강단 `visibilitychange` 리스너의 첫 줄 앞에 넣는다.
```js
document.addEventListener('visibilitychange', () => {
  if (A.running) { A.last = performance.now(); A.lastSet = null; if (document.visibilityState === 'visible') autoSchedule(); }
  if (document.visibilityState !== 'visible' || R?.mode !== 'pulpit') return;
```

- [ ] **Step 7: 시험 통과 확인**

Run: `cd $SH && node srv.mjs node tauto.mjs`
Expected: `통과 18 · 실패 0 · 오류 []`
- 속도 9의 `wakesPerSec`는 약 9(헤드리스 DPR 2, 소수 스크롤 가능)다.
- 소수 스크롤이 안 되는 환경이면 약 4.5다. 둘 다 2~31 안이다.

- [ ] **Step 8: 커밋**

```bash
cd ~/Claude/pulpit-notes && git add app.js && git commit -m "자동 스크롤: 이동 엔진·조절판(멈춤·속도·끄기)·강단을 나가면 끔·흐르는 동안 꺼짐 방지 유지

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 탭 영역(가운데 멈춤 · 양 끝 조금씩), 넘기기·손가락 쉼

**Files:**
- Create: `$SH/tautotap.mjs`
- Modify: `app.js`
  - `pagesEl` `pointerdown`의 `tap = { id: e.pointerId, … }` 두 곳
  - `pointerup` 강단 탭 분기
  - `turn` 첫 줄
  - 자동 스크롤 구역 끝

- [ ] **Step 1: 시험 작성**

`$SH/tautotap.mjs`:
```js
// 자동 스크롤 탭: 가운데 멈춤↔흐름, 양 끝 화면 1/5, 빠를 때도 탭 인정, 손바닥 무시, 손가락 끌기 동안 쉼, 페달
import { open, sleep } from './autolib.mjs';
const t = await open();
await t.mode('pulpit'); await sleep(500);
await t.click('#autoBtn'); await sleep(400);
const H = await t.H();
await t.tap(0.5); let s = await t.st(); t.log('가운데 탭 → 멈춤', s.on && !s.run, s);
await t.tap(0.5); s = await t.st(); t.log('가운데 탭 → 다시 흐름', s.on && s.run, s);
await t.tap(0.5); await sleep(200);
let a = await t.st(); await t.tap(0.9); await sleep(700); let b = await t.st();
t.log('오른쪽 끝 → 화면 1/5 앞으로', Math.abs(b.top - a.top - H / 5) <= 3 && !b.run, { d: b.top - a.top, want: H / 5 });
a = b; await t.tap(0.1); await sleep(700); b = await t.st();
t.log('왼쪽 끝 → 화면 1/5 뒤로', Math.abs(a.top - b.top - H / 5) <= 3, { d: a.top - b.top, want: H / 5 });
await t.page.evaluate(() => { for (let i = 0; i < 25; i++) document.getElementById('aFast').click(); });
await t.tap(0.5); await sleep(1500);
await t.tap(0.5); s = await t.st(); t.log('속도 20 흐르는 중 가운데 탭 → 멈춤', !s.run, s);
await t.tap(0.5, 0.5, 70); s = await t.st(); t.log('손바닥(넓은 면적) 탭 → 그대로 멈춤', !s.run, s);
await t.page.evaluate(() => { for (let i = 0; i < 25; i++) document.getElementById('aSlow').click(); for (let i = 0; i < 8; i++) document.getElementById('aFast').click(); }); // 속도 9
await t.setTop(0); await sleep(300); await t.tap(0.5); await sleep(600);
a = await t.st(); await t.drag(0.5, 0.75, 0.45); await sleep(1200); b = await t.st();
t.log('흐르는 중 손가락으로 끌기 → 끈 만큼 + 계속 흐름', b.top - a.top >= H * 0.25 && b.run, { d: b.top - a.top, want: H * 0.3 });
a = await t.st(); await t.page.keyboard.press('ArrowRight'); await sleep(1500); b = await t.st();
t.log('페달(→) → 한 화면 넘기고 계속 흐름', b.top - a.top >= H * 0.8 && b.run, { d: b.top - a.top, H });
await t.click('#aOff'); await sleep(200);
a = await t.st(); await t.tap(0.9); await sleep(900); b = await t.st();
t.log('끈 뒤 오른쪽 탭 → 원래대로 다음 화면', b.top - a.top >= H * 0.8, { d: b.top - a.top, H });
await t.done();
```

- [ ] **Step 2: 시험이 실패하는지 확인**

Run: `cd $SH && node srv.mjs node tautotap.mjs`
Expected: FAIL. `✗ 가운데 탭 → 멈춤`이다(지금은 탭하면 다음 화면으로 넘어감).

- [ ] **Step 3: 탭에 자동 이동량 기록**

`pointerdown`의 다음 두 줄을
```js
  if (role === 'tap') { tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), st: scroller.scrollTop }; return; }
```
```js
    if (R.sel && e.pointerType === 'touch') tap = { kind: 'desel', id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), st: scroller.scrollTop };
```
각각 이렇게 바꾼다.
```js
  if (role === 'tap') { tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), st: scroller.scrollTop, am: A.moved }; return; }
```
```js
    if (R.sel && e.pointerType === 'touch') tap = { kind: 'desel', id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), st: scroller.scrollTop, am: A.moved };
```

- [ ] **Step 4: 강단 탭 분기 바꾸기**

`pointerup`에서 다음 부분을
```js
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) < 12 && performance.now() - t.t < 450 && Math.abs(scroller.scrollTop - t.st) < 4) {
      if (t.kind === 'desel') { clearSel(); return; }
      const r = scroller.getBoundingClientRect();
      turn((e.clientX - r.left) / r.width < 0.3 ? -1 : 1);
      if (!wakeLock) requestWake();
    }
```
이렇게 바꾼다.
```js
    // 자동 스크롤이 민 만큼은 '손으로 움직임'에서 뺀다(빠르게 흐를 때도 탭으로 인정)
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) < 12 && performance.now() - t.t < 450 && Math.abs(scroller.scrollTop - t.st - (A.moved - t.am)) < 4) {
      if (t.kind === 'desel') { clearSel(); return; }
      const r = scroller.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width;
      if (A.on) { if (fx < 0.25) autoNudge(-1); else if (fx > 0.75) autoNudge(1); else autoToggle(); } // 자동 스크롤: 가운데 멈춤↔흐름, 양 끝 조금씩
      else turn(fx < 0.3 ? -1 : 1);
      if (!wakeLock) requestWake();
    }
```

- [ ] **Step 5: 넘기는 동안 자동 이동 쉬기**

`turn`의 첫 줄 `if (!R) return;` 다음에 넣는다.
```js
  if (A.on) { A.holdUntil = performance.now() + 700; A.lastSet = null; } // 부드럽게 넘기는 동안 자동 이동이 끼어들지 않게
```

- [ ] **Step 6: 조금씩 이동·손가락 쉼**

자동 스크롤 구역의 `renderAuto();` 마지막 줄 바로 위에 넣는다.
```js
function autoNudge(dir) {
  const H = scroller.clientHeight, max = scroller.scrollHeight - H;
  A.holdUntil = performance.now() + 450; A.lastSet = null;
  scroller.scrollTo({ top: clamp(scroller.scrollTop + dir * H / 5, 0, max), behavior: 'smooth' });
  if (A.running) autoSchedule();
}
// 흐르는 중 손가락으로 끌면 그동안은 쉬고, 뗀 자리부터 다시 흐른다(손바닥·펜슬은 빼고)
scroller.addEventListener('touchstart', e => {
  if (A.on && [...e.changedTouches].some(t => t.touchType !== 'stylus' && !palmIds.has(t.identifier))) { A.touching = true; A.lastSet = null; }
}, { passive: true });
for (const ev of ['touchend', 'touchcancel']) scroller.addEventListener(ev, e => {
  if (A.touching && !e.touches.length) { A.touching = false; A.holdUntil = performance.now() + 350; }
}, { passive: true });
```

- [ ] **Step 7: 시험 통과 확인**

Run: `cd $SH && node srv.mjs node tautotap.mjs`
Expected: `통과 9 · 실패 0 · 오류 []`

- [ ] **Step 8: 커밋**

```bash
cd ~/Claude/pulpit-notes && git add app.js && git commit -m "자동 스크롤: 탭 영역(가운데 멈춤·양 끝 1/5)·넘기기와 손가락 끌기 동안 쉼

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 시간에 맞추기

**Files:**
- Create: `$SH/tautofit.mjs`
- Modify: `app.js` (자동 스크롤 구역 끝 — `autoNudge` 정의 다음)

- [ ] **Step 1: 시험 작성**

`$SH/tautofit.mjs`:
```js
// 시간에 맞추기: 남은 분량 ÷ 남은 시간 → 속도(소수 한 자리), 알림, 멈춰 있으면 흐르기 시작, 시간 넘김·원고 끝
import { open, sleep } from './autolib.mjs';
const t = await open();
await t.mode('pulpit'); await sleep(500);
await t.click('#autoBtn'); await sleep(300); await t.click('#aPlay'); await t.setTop(0); await sleep(300);
const want = await t.page.evaluate(() => { const s = document.getElementById('scroller'), W = document.querySelector('.page').offsetWidth;
  const v = (s.scrollHeight - s.clientHeight - s.scrollTop) / (25 * 60); const sp = 9 + Math.log(v / (0.0045 * W)) / Math.log(1.17);
  return Math.round(Math.min(20, Math.max(1, sp)) * 10) / 10; });
await t.click('#aFit'); await sleep(300);
let s = await t.st();
t.log('25분 · 처음부터 → 계산한 속도', s.spd === `속도 ${want}`, { got: s.spd, want });
t.log('알림 · 흐르기 시작', s.toast.includes('25분 안에 끝나도록') && s.run, s);
await t.click('#aPlay');
await t.click('#pTimer'); await sleep(200); await t.skew(26 * 60e3); await sleep(1200);
const before = (await t.st()).spd;
await t.click('#aFit'); await sleep(300); s = await t.st();
t.log('시간이 지났으면 → 알림 · 속도 그대로', s.toast.includes('남은 설교 시간이 없어요') && s.spd === before, s);
await t.click('#pTimer'); await t.page.evaluate(() => document.querySelector('#pTarget').click()); await sleep(300);
await t.page.evaluate(() => document.querySelector('.tpop [data-a=reset]')?.click()); await t.page.keyboard.press('Escape'); await sleep(300);
const max = await t.maxTop(); await t.setTop(max); await sleep(300);
await t.click('#aFit'); await sleep(300); s = await t.st();
t.log('원고 끝에서 → 원고의 끝 알림', s.toast.includes('원고의 끝'), s);
await t.done();
```

- [ ] **Step 2: 시험이 실패하는지 확인**

Run: `cd $SH && node srv.mjs node tautofit.mjs`
Expected: FAIL. `✗ 25분 · 처음부터 → 계산한 속도`다(버튼에 동작이 없음).

- [ ] **Step 3: 시간에 맞추기 구현**

`autoNudge` 함수 정의 바로 다음에 넣는다.
```js
// ⏱ 시간에 맞추기: 지금 자리에서 원고 끝까지 남은 분량을, 타이머의 남은 시간(시작 전이면 정한 시간 전체,
// 스톱워치면 '알려 줄 시간'까지) 안에 끝내는 속도로. 멈춰 있었다면 흐르기 시작한다
function autoFit() {
  if (!R) return;
  const left = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
  const remain = settings.target * 60000 - elapsed();
  if (left <= 1) { toast('원고의 끝이에요', 1600); return; }
  if (remain <= 0) { toast('남은 설교 시간이 없어요', 2200); return; }
  const s = 9 + Math.log(left / (remain / 1000) / (AUTO_K * pageW())) / Math.log(AUTO_R);
  autoSetSpeed(s);
  if (s < 1) toast('가장 느린 속도로 맞췄어요 · 속도 1', 2400);
  else if (s > 20) toast('가장 빠른 속도로 맞췄어요 · 속도 20', 2400);
  else toast(`${Math.max(1, Math.round(remain / 60000))}분 안에 끝나도록 맞췄어요 · 속도 ${fmtSpeed(A.speed)}`, 2600);
  if (!A.running) autoPlay();
}
$('#aFit').onclick = () => autoFit();
```

- [ ] **Step 4: 시험 통과 확인**

Run: `cd $SH && node srv.mjs node tautofit.mjs`
Expected: `통과 4 · 실패 0 · 오류 []`

- [ ] **Step 5: 커밋**

```bash
cd ~/Claude/pulpit-notes && git add app.js && git commit -m "자동 스크롤: 시간에 맞추기(남은 분량·남은 설교 시간 → 속도)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 꺼짐 방지 유지 확인(느린 시험)

**Files:**
- Create: `$SH/tautowake.mjs`

- [ ] **Step 1: 시험 작성**

`$SH/tautowake.mjs`:
```js
// 자동 스크롤이 흐르는 동안은 타이머가 멈춰 있고 오래 손대지 않아도 꺼짐 방지를 풀지 않는다(1분마다 깨는 tick 기다림)
import { open, sleep } from './autolib.mjs';
const t = await open();
await t.mode('pulpit'); await sleep(500);
await t.click('#pTimer'); await sleep(1200); await t.click('#pTimer'); // 멈춤(흐른 시간 > 0)
await t.click('#autoBtn'); await sleep(300); await t.click('#aPlay'); await sleep(200); await t.click('#aPlay'); // 흐름
await t.skew(16 * 60e3); await sleep(61500);
let s = await t.st(); t.log('흐르는 중 · 멈춘 타이머 · 16분 → 꺼짐 방지 유지', s.wake === 'on' && s.run, s);
await t.click('#aPlay'); await t.skew(16 * 60e3); await sleep(61500);
s = await t.st(); t.log('자동 스크롤도 멈추면 → 16분 뒤 풀림', s.wake === 'off', s);
await t.done();
```

- [ ] **Step 2: 시험 통과 확인**

Task 2 Step 5에서 이미 구현했다.

Run: `cd $SH && node srv.mjs node tautowake.mjs`
Expected: `통과 2 · 실패 0 · 오류 []` (약 2분 30초)

---

### Task 6: 설명서·문구·버전, 전체 회귀, 시뮬레이터 확인

**Files:**
- Modify: `sample/guide-source.html` (7장 `<h3>서재로 돌아가기</h3>` 위), `store/listing.md`, `README.md`, `sw.js:3`
- Regenerate: `sample/guide.pdf`, `store/guide/*`, `store/screenshots/*`

- [ ] **Step 1: 설명서 7장 문단**

`sample/guide-source.html`의 `    <h3>서재로 돌아가기</h3>` 줄 바로 위에 넣는다.
```html
    <h3>자동 스크롤</h3>
    <p>오른쪽 아래 버튼을 누르면 원고가 천천히 흘러요. <b class="k">가운데</b>를 톡 치면 멈춤 · 다시, 왼쪽 · 오른쪽 끝은 조금 뒤로 · 앞으로 가요. 속도(1~20)는 조절판의 −/+로, <b class="k">시간에 맞추기</b>를 누르면 남은 설교 시간 안에 원고가 끝나도록 맞춰요.</p>
```

- [ ] **Step 2: 설명서·스크린숏 다시 만들기**

```bash
cd $SH && node srv.mjs node ~/Claude/pulpit-notes/store/tools/guide-shots.mjs | tail -2
cd ~/Claude/pulpit-notes/store/tools && python3 build-guide.py | tail -1 && python3 -c "import re;d=open('../../sample/guide.pdf','rb').read();print('pages',len(re.findall(rb'/Type\s*/Page[^s]',d)))"
cd $SH && node srv.mjs node ~/Claude/pulpit-notes/store/tools/shots.mjs | tail -1 && cd ~/Claude/pulpit-notes/store/tools && python3 compose.py | tail -1
```
Expected: `pages 13`. 14쪽이 되면 7장 문단의 둘째 문장을 줄이거나, 7장 `화면이 꺼지지 않아요` 문단(10장 질문과 겹침)을 빼고 다시 만든다.

- [ ] **Step 3: 스토어 문구·README·버전**

- `store/listing.md`
  - 1.0.2 "이 버전의 새로운 기능"의 `■ 강단에서` 바로 다음 줄에 넣는다.
    ```
    • 자동 스크롤: 강단 화면 오른쪽 아래 버튼을 누르면 원고가 천천히 흘러갑니다. 가운데를 누르면 멈추고 다시 흐르며, 양 끝을 누르면 조금 뒤로 · 앞으로 갑니다. 속도는 1~20단계로 정하고, ‘시간에 맞추기’를 누르면 남은 설교 시간 안에 원고가 끝나도록 맞춰 줍니다.
    ```
  - 설명의 `■ 강단에서 — 탭 한 번으로 넘기기` 목록 끝에 넣는다.
    ```
    • 자동 스크롤로 원고를 천천히 흘려 보낼 수 있습니다. 속도는 1~20단계로 정하고, ‘시간에 맞추기’로 남은 설교 시간에 딱 끝나게 맞출 수 있습니다.
    ```
  - 두 블록의 글자 수 표시를 고친다.
- `README.md`: 강단 모드 설명 다음에 넣는다.
  ```
  - 자동 스크롤(강단): 오른쪽 아래 버튼 → 조절판(멈춤·속도 1~20·시간에 맞추기·끄기, 5초 뒤 접힘). 켜져 있으면 탭 = 가운데 멈춤↔흐름·양 끝 화면 1/5. 빠르기 = 0.0045 × 쪽 폭 × 1.17^(속도−9) px/초, 기기 화소 하나씩 필요한 만큼만 깨움(최소 33ms), 손가락 끌기·넘기기 동안 쉼, 흐르는 동안 꺼짐 방지 유지. 설계 docs/superpowers/specs/2026-10-04-autoscroll-design.md
  ```
- `sw.js`: `const VERSION = 'pn-v19';` → `const VERSION = 'pn-v20';`

- [ ] **Step 4: 전체 회귀**

```bash
cd $SH && for t in tautoui tauto tautotap tautofit thl thl2 thl3 tpalm tink t11 trot tsw tlib tzoom trot2 tguide3 tbar tpow; do printf "== %-9s " $t; node srv.mjs node $t.mjs out > out-$t.txt 2>&1; echo "exit=$? $(grep -c '^✓' out-$t.txt)✓ $(grep -c '^✗' out-$t.txt)✗ $(grep -m1 '오류' out-$t.txt | cut -c1-30)"; done
```
Expected:
- 자동 스크롤 시험 4벌은 `exit=0`이다.
- 기존 시험은 `✗` 0개, `오류 []`이다.
- `tink`는 꺼짐 방지 시험 때문에 약 4분 걸린다.

- [ ] **Step 5: iOS 반영·시뮬레이터 확인**

```bash
cd ~/Claude/pulpit-notes && npm run ios >/dev/null 2>&1 && cd ios/App && xcodebuild -project App.xcodeproj -scheme App -configuration Debug -destination 'id=49B4AF7D-EF58-41E6-813B-109A9A392F07' -derivedDataPath /private/tmp/claude-501/-Users-yeolstudio-Claude/feea1deb-4da4-4fae-8fc2-7fa782739b5d/scratchpad/dd build 2>&1 | grep -E "error|BUILD"
```
Expected: `** BUILD SUCCEEDED **`

이어서 설치·실행하고 다음을 확인한다.
- 원고 → 강단 → 오른쪽 아래 버튼 → 흐르는지 확인하고 스크린숏을 찍는다.
- 가운데 탭으로 멈추는지 확인한다.
- 시뮬레이터 CPU를 잰다(`cpu.sh` — 속도 9에서 웹 엔진 수 % 이하).

- [ ] **Step 6: 커밋·푸시**

```bash
cd ~/Claude/pulpit-notes && git add -A app.js index.html sw.js README.md sample store && git commit -m "자동 스크롤: 설명서 7장·스토어 문구·스크린숏, sw pn-v20

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -q origin main
```
