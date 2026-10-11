// 자동 스크롤 엔진: 켜기·빠르기·깨움 수·조절판·속도 단계·탭 구역·원고 끝·강단을 나가면 꺼짐
// + 1.0.5 발열: 타이머 글자를 원고 밀 때 함께 그리기, 흐르는 동안 읽던 자리 저장은 10초에 한 번
import { open, sleep, expectV } from './autolib.mjs';
const t = await open();
const { page } = t;
const measure = async (label, secs, tol) => {
  const a = await t.st(), w0 = await t.wakes(); await sleep(secs * 1000); const b = await t.st(), w1 = await t.wakes();
  const W = await t.pageW(), spd = +b.spd.replace('속도 ', ''), v = (b.top - a.top) / secs, ev = expectV(W, spd);
  t.log(`${label}: 빠르기 식과 ±${tol * 100}%`, Math.abs(v / ev - 1) <= tol, { spd, v: +v.toFixed(2), expect: +ev.toFixed(2), wakesPerSec: +((w1 - w0) / secs).toFixed(1) });
  return (w1 - w0) / secs;
};
await t.mode('pulpit'); await sleep(500);
await t.setTop(0); await t.click('#autoBtn'); await sleep(400);
let s = await t.st();
t.log('버튼 → 켜짐 · 흐름 · 조절판 열림', s.on && s.run && s.panel && s.spd === '속도 9', s);
const wps = await measure('속도 9', 8, 0.06);
t.log('속도 9: 1초 깨움 1~8번(2px 칸)', wps >= 1 && wps <= 8, wps);
await sleep(500); s = await t.st();
t.log('5초 뒤 조절판 접힘 · 계속 흐름', !s.panel && s.run, s);
await t.click('#autoBtn'); await sleep(200); s = await t.st();
t.log('켜진 채 버튼 → 조절판만 열림', s.panel && s.run, s);
for (let i = 0; i < 3; i++) await t.click('#aFast');
t.log('+ 세 번 → 속도 12', (await t.st()).spd === '속도 12', (await t.st()).spd);
for (let i = 0; i < 20; i++) await t.click('#aFast');
t.log('끝까지 + → 속도 20', (await t.st()).spd === '속도 20', (await t.st()).spd);
await measure('속도 20', 4, 0.06);
for (let i = 0; i < 25; i++) await t.click('#aSlow');
t.log('끝까지 − → 속도 1', (await t.st()).spd === '속도 1', (await t.st()).spd);
// 느린 속도: 1px 칸 · 읽던 자리 저장 횟수
const p0 = await t.docPuts();
await measure('속도 1', 12, 0.12);
const puts = (await t.docPuts()) - p0;
t.log('흐르는 동안 읽던 자리 저장 ≤ 2번/12초', puts <= 2, { puts });
for (let i = 0; i < 8; i++) await t.click('#aFast');
t.log('속도 9로 되돌림 · 기억', (await t.st()).spd === '속도 9' && (await page.evaluate(() => JSON.parse(localStorage.getItem('pn.settings')).autoSpeed)) === 9, (await t.st()).spd);
// 타이머 글자를 원고 밀 때 함께 그리는지: 타이머를 흐르게 하고 글자 바뀜과 스크롤 바뀜의 시각을 맞춰 본다
if (!(await page.evaluate(() => document.getElementById('pTimer').classList.contains('run') || document.getElementById('pTimer').classList.contains('over') || document.getElementById('pTimer').classList.contains('warn')))) await t.click('#pTimer');
await page.evaluate(() => {
  window.__tl = []; window.__sl = [];
  new MutationObserver(() => window.__tl.push(performance.now())).observe(document.getElementById('pTimerTxt'), { childList: true, characterData: true, subtree: true });
  const s = document.getElementById('scroller'); let y = s.scrollTop;
  (function poll() { if (s.scrollTop !== y) { y = s.scrollTop; window.__sl.push(performance.now()); } requestAnimationFrame(poll); })();
});
await sleep(10000);
const { tl, sl } = await page.evaluate(() => ({ tl: window.__tl, sl: window.__sl }));
const together = tl.filter(x => sl.some(y => Math.abs(y - x) < 20)).length;
t.log('타이머 글자 바뀜 대부분이 원고 밀기와 같은 화면', tl.length >= 8 && together / tl.length >= 0.8, { timerChanges: tl.length, together, scrolls: sl.length });
await t.click('#pTimer'); // 타이머 멈춤(원래대로)
// 탭 구역
const box = await page.evaluate(() => { const r = document.getElementById('scroller').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
await page.touchscreen.tap(box.x + box.w / 2, box.y + box.h / 2); await sleep(300);
s = await t.st(); const top0 = s.top, w0 = await t.wakes(); await sleep(2500);
const s2 = await t.st(), w1 = await t.wakes();
t.log('가운데 탭 → 멈춤 · 이동 0 · 깨움 거의 0', !s2.run && s2.on && Math.abs(s2.top - top0) < 0.5 && w1 - w0 <= 2, { moved: s2.top - top0, wakes: w1 - w0 });
await page.touchscreen.tap(box.x + box.w * 0.9, box.y + box.h / 2); await sleep(900);
const s3 = await t.st();
t.log('오른쪽 탭 → 화면 1/5 앞으로', Math.abs(s3.top - s2.top - box.h / 5) < 6, { moved: s3.top - s2.top, want: box.h / 5 });
await page.touchscreen.tap(box.x + box.w * 0.1, box.y + box.h / 2); await sleep(900);
const s4 = await t.st();
t.log('왼쪽 탭 → 화면 1/5 뒤로', Math.abs(s3.top - s4.top - box.h / 5) < 6, { moved: s4.top - s3.top });
await page.touchscreen.tap(box.x + box.w / 2, box.y + box.h / 2); await sleep(300);
t.log('가운데 탭 → 다시 흐름', (await t.st()).run, await t.st());
// 원고 끝
await t.setTop((await t.maxTop()) - 3);
for (let i = 0; i < 40 && (await t.st()).run; i++) await sleep(100); // 멈추는 순간을 기다려 알림을 본다(알림은 1.6초)
s = await t.st();
t.log('원고 끝 → 멈춤 · 알림', !s.run && s.toast.includes('원고의 끝'), s);
await t.mode('prep'); await sleep(300); s = await t.st();
t.log('준비 화면으로 → 꺼짐', !s.on && !s.run, s);
await t.done();
