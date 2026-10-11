// 자동 스크롤 시험 공통 — 서재에 들어 있는 사용 설명서(14쪽)를 열어 둔 헤드리스 크롬(아이패드 13인치 세로 크기)
// 쓰는 법: cd store/tools/bench && node srv.mjs node tauto.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const expectV = (w, s) => 0.0058 * w * 1.17 ** (s - 9); // 설계의 빠르기 식(CSS px/초)
export async function open({ width = 1032, height = 1376 } = {}) {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pn-auto-')), args: ['--no-first-run', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    localStorage.setItem('pn.coached', 'true');
    // 깨움 세기 + Date 앞당기기(꺼짐 방지·타이머 시험용, performance.now 는 그대로)
    window.__wakes = 0; window.__skew = 0; window.__docPuts = 0;
    const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(() => { window.__wakes++; typeof f === 'function' && f(...a); }, ms);
    const RD = Date;
    class D extends RD { constructor(...a) { if (a.length) super(...a); else super(RD.now() + window.__skew); } static now() { return RD.now() + window.__skew; } }
    window.Date = D;
    // 서재 기록(docs) 저장 횟수 세기 — 읽던 자리 저장이 얼마나 자주 일어나는지
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...a) { if (this.name === 'docs') window.__docPuts++; return put.apply(this, a); };
  });
  await page.goto('http://localhost:5178/', { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('.card h3')].some(h => h.textContent.includes('사용 설명서')), { timeout: 30000 });
  await page.evaluate(() => [...document.querySelectorAll('.card')].find(c => c.querySelector('h3').textContent.includes('사용 설명서')).querySelector('.sheet').click());
  await page.waitForFunction(() => document.querySelectorAll('.page canvas.pdf').length >= 1, { timeout: 30000 });
  await sleep(800);
  let pass = 0, fail = 0;
  const t = {
    page, errors,
    mode: m => page.evaluate(m => document.querySelector(`#modeSeg [data-mode="${m}"]`).click(), m),
    click: sel => page.evaluate(s => document.querySelector(s).click(), sel),
    setTop: y => page.evaluate(y => { document.getElementById('scroller').scrollTop = y; }, y),
    maxTop: () => page.evaluate(() => { const s = document.getElementById('scroller'); return s.scrollHeight - s.clientHeight; }),
    skew: ms => page.evaluate(ms => { window.__skew += ms; }, ms),
    wakes: () => page.evaluate(() => window.__wakes),
    docPuts: () => page.evaluate(() => window.__docPuts),
    pageW: () => page.evaluate(() => document.querySelector('.page').offsetWidth),
    st: () => page.evaluate(() => ({
      top: Math.round(document.getElementById('scroller').scrollTop * 10) / 10,
      on: document.getElementById('autoBtn').classList.contains('on'),
      run: document.getElementById('autoBtn').classList.contains('run'),
      panel: !document.getElementById('autoPanel').hidden,
      spd: document.getElementById('aSpd').textContent,
      toast: document.querySelector('.toast')?.textContent || '',
      mode: document.getElementById('reader').dataset.mode,
    })),
    log(name, ok, data) { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${name.padEnd(36)} ${JSON.stringify(data ?? '')}`); },
    async done() { console.log(`통과 ${pass} · 실패 ${fail} · 오류 ${JSON.stringify(errors)}`); await browser.close(); process.exit(fail || errors.length ? 1 : 0); },
  };
  return t;
}
