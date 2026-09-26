// 강단노트 — 설교 원고 PDF 리더 + 애플펜슬 필기 + 강단 모드
import * as pdfjsLib from './vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
const PDF_OPTS = {
  cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
  isEvalSupported: false,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DPR = () => Math.min(window.devicePixelRatio || 1, 2);

// ─────────── 설정 ───────────
const PEN_COLORS = ['#1F1B16', '#D23B2E', '#2456C8', '#1F8A4C'];
const HL_COLORS = ['#FFE45C', '#A8E890', '#FFB3D1', '#A9DBFF'];
const PEN_SIZES = [0.0024, 0.0036, 0.0054]; // 페이지 폭 대비
const HL_SIZES = [0.018, 0.026, 0.036];
const TARGETS = [0, 5, 10, 15, 20, 25, 30, 40];
const THEMES = ['light', 'sepia', 'dark'];
const ERASE_PX = 12;

const settings = Object.assign({
  tool: 'pen', penColor: PEN_COLORS[1], hlColor: HL_COLORS[0], penSize: 1, hlSize: 1,
  finger: false, themePrep: 'light', themePulpit: 'light', target: 0,
}, readLS('pn.settings', {}));
function readLS(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
const saveSettings = () => writeLS('pn.settings', settings);

// ─────────── IndexedDB ───────────
let dbp;
function db() {
  return dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('pulpit-notes', 1);
    r.onupgradeneeded = () => {
      for (const s of ['docs', 'files', 'ink']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    let out;
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const idb = {
  get: (s, k) => tx(s, 'readonly', st => st.get(k)),
  all: s => tx(s, 'readonly', st => st.getAll()),
  put: (s, v) => tx(s, 'readwrite', st => st.put(v)),
  del: (s, k) => tx(s, 'readwrite', st => st.delete(k)),
};

// ─────────── 공통 UI ───────────
let toastTimer;
function toast(msg, ms = 2400) {
  $('.toast')?.remove();
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}
function busy(msg) {
  $('.busy')?.remove();
  if (!msg) return;
  const b = document.createElement('div');
  b.className = 'busy';
  b.innerHTML = '<div><span class="spin"></span><span></span></div>';
  b.querySelector('span:last-child').textContent = msg;
  document.body.append(b);
}
// buttons: [{label, cls, value, onClick}] — onClick 은 탭 이벤트 안에서 바로 실행된다(공유 시트용)
function dialog({ title, body, buttons }) {
  return new Promise(resolve => {
    const s = document.createElement('div');
    s.className = 'scrim';
    s.innerHTML = '<div class="dialog" role="dialog"><h3></h3><p></p><div class="row"></div></div>';
    s.querySelector('h3').textContent = title;
    s.querySelector('p').textContent = body || '';
    const close = v => { s.remove(); resolve(v); };
    for (const b of buttons) {
      const el = Object.assign(document.createElement('button'), { className: 'btn ' + (b.cls || ''), textContent: b.label });
      el.onclick = () => { b.onClick?.(); close(b.value); };
      s.querySelector('.row').append(el);
    }
    s.addEventListener('click', e => { if (e.target === s) close(undefined); });
    document.body.append(s);
  });
}
const ask = (title, body, ok, danger) => dialog({
  title, body,
  buttons: [{ label: '취소', value: false }, { label: ok, cls: danger ? 'danger' : 'primary', value: true }],
});

// ─────────── 파일 이름 해석 ───────────
// "260921 기도회 설교 - 무릎이 하는 노동 (윤문본).pdf" → 날짜·구분·제목·꼬리표
function parseName(name) {
  let rest = name.replace(/\.pdf$/i, '').replace(/_/g, ' ').trim();
  let date = '';
  const m = rest.match(/^(\d{2})(\d{2})(\d{2})\s+(.*)$/);
  if (m) { date = `20${m[1]}.${m[2]}.${m[3]}`; rest = m[4]; }
  let kind = '', title = rest;
  const i = rest.indexOf(' - ');
  if (i > 0) { kind = rest.slice(0, i).replace(/설교/g, '').replace(/\s+/g, ' ').trim(); title = rest.slice(i + 3).trim(); }
  let tag = '';
  const t = title.match(/\s*\(([^)]+)\)\s*$/);
  if (t && /본$|판$|수정|최종|^v\d/i.test(t[1])) { tag = t[1]; title = title.slice(0, t.index).trim(); }
  return { date, kind, title: title || name, tag };
}
const newId = () => crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);

// ═══════════════════ 서재 ═══════════════════
const lib = $('#library'), grid = $('#grid'), fileInput = $('#file');
let docsCache = [];

async function renderLibrary() {
  docsCache = (await idb.all('docs')).sort((a, b) => (b.opened || b.added) - (a.opened || a.added));
  const q = $('#q').value.trim();
  const list = q ? docsCache.filter(d => [d.title, d.kind, d.date, d.name].join(' ').includes(q)) : docsCache;
  $('#searchBox').hidden = docsCache.length < 7;
  $('#empty').hidden = docsCache.length > 0;
  grid.hidden = docsCache.length === 0;
  grid.replaceChildren(...list.map((d, n) => {
    const c = document.createElement('div');
    c.className = 'card';
    c.style.animationDelay = Math.min(n, 12) * 30 + 'ms';
    c.innerHTML = `
      <button class="sheet" aria-label="열기"><img alt=""></button>
      <button class="more" aria-label="더 보기"><svg class="i"><use href="#i-more"/></svg></button>
      <div class="meta"></div><h3></h3><div class="sub"></div>`;
    c.querySelector('img').src = d.thumb || '';
    if (d.inkCount) c.querySelector('.sheet').insertAdjacentHTML('beforeend', `<span class="badge"><svg class="i"><use href="#i-pen"/></svg>${d.inkCount}</span>`);
    const meta = c.querySelector('.meta');
    if (d.date) meta.append(Object.assign(document.createElement('b'), { textContent: d.date }));
    if (d.kind) meta.append(document.createTextNode((d.date ? '· ' : '') + d.kind));
    c.querySelector('h3').textContent = d.title;
    c.querySelector('.sub').textContent = [`${d.pages}쪽`, d.tag, d.opened ? '최근 ' + ago(d.opened) : '새 원고'].filter(Boolean).join(' · ');
    c.querySelector('.sheet').onclick = () => openDoc(d.id);
    c.querySelector('h3').onclick = () => openDoc(d.id);
    c.querySelector('.more').onclick = e => cardMenu(e.currentTarget, d);
    return c;
  }));
  renderFoot();
}
function ago(t) {
  const m = (Date.now() - t) / 60000;
  if (m < 1) return '방금';
  if (m < 60) return Math.floor(m) + '분 전';
  if (m < 1440) return Math.floor(m / 60) + '시간 전';
  if (m < 10080) return Math.floor(m / 1440) + '일 전';
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
async function renderFoot() {
  const foot = $('#libFoot');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let used = '';
  try { const e = await navigator.storage?.estimate?.(); if (e?.usage) used = ` 지금 ${(e.usage / 1048576).toFixed(1)}MB 쓰는 중.`; } catch {}
  foot.innerHTML = `
    <div><b>원고와 필기는 이 기기 안에만 저장돼요.</b>${used} 서버로 보내지 않아요.</div>
    ${standalone ? '' : '<div>아이패드 Safari에서 <b>공유 → 홈 화면에 추가</b>로 설치해 두세요. 인터넷이 없어도 열리고, 저장한 원고가 지워지지 않게 보관돼요.</div>'}
    <div><b>강단 모드</b> — 화면 오른쪽을 탭하면 다음, 왼쪽을 탭하면 이전으로 넘어가요. 블루투스 페이지 넘김 페달(방향키)도 돼요.</div>`;
}
function cardMenu(anchor, d) {
  openMenu(anchor, m => {
    m.append(menuItem('#i-trash', '서재에서 지우기', async () => {
      if (!await ask('원고를 지울까요?', `「${d.title}」와 여기에 한 필기가 모두 지워져요. 되돌릴 수 없어요.`, '지우기', true)) return;
      await Promise.all([idb.del('docs', d.id), idb.del('files', d.id), idb.del('ink', d.id)]);
      renderLibrary();
      toast('지웠어요');
    }, 'danger'));
  });
}

async function importFiles(files) {
  const list = [...files].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!list.length) { toast('PDF 파일만 불러올 수 있어요'); return; }
  navigator.storage?.persist?.().catch(() => {});
  const existing = await idb.all('docs');
  let added = 0, lastId = null;
  for (const f of list) {
    if (existing.some(d => d.name === f.name && d.size === f.size)) { toast(`이미 서재에 있어요 — ${f.name}`); continue; }
    busy(`불러오는 중… ${f.name}`);
    try {
      const buf = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ ...PDF_OPTS, data: new Uint8Array(buf.slice(0)) }).promise;
      const { crop, thumb } = await analyze(pdf);
      const id = newId();
      const doc = { id, name: f.name, size: f.size, ...parseName(f.name), pages: pdf.numPages, added: Date.now(), opened: 0, crop, cropOn: true, pos: null, thumb, inkCount: 0 };
      await pdf.destroy();
      await idb.put('files', { id, data: buf });
      await idb.put('docs', doc);
      added++; lastId = id;
    } catch (e) {
      console.error(e);
      toast(e?.name === 'PasswordException' ? `암호가 걸린 PDF는 열 수 없어요 — ${f.name}` : `열 수 없는 파일이에요 — ${f.name}`, 3200);
    }
  }
  busy();
  await renderLibrary();
  if (added === 1 && list.length === 1) openDoc(lastId);
  else if (added > 1) toast(`원고 ${added}개를 불러왔어요`);
}

// 여백 자동 측정(모든 쪽 글자 영역의 합집합) + 첫 쪽 썸네일
async function analyze(pdf) {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  let bb = null;
  for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
    const page = await pdf.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 240 / v1.width });
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
    let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const k = (y * cv.width + x) * 4;
      if (data[k] < 225 || data[k + 1] < 225 || data[k + 2] < 225) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 >= 0) {
      const b = { x0: x0 / cv.width, y0: y0 / cv.height, x1: (x1 + 1) / cv.width, y1: (y1 + 1) / cv.height };
      bb = bb ? { x0: Math.min(bb.x0, b.x0), y0: Math.min(bb.y0, b.y0), x1: Math.max(bb.x1, b.x1), y1: Math.max(bb.y1, b.y1) } : b;
    }
    page.cleanup();
  }
  const crop = bb ? { x0: clamp(bb.x0 - 0.03, 0, 1), y0: clamp(bb.y0 - 0.025, 0, 1), x1: clamp(bb.x1 + 0.03, 0, 1), y1: clamp(bb.y1 + 0.025, 0, 1) } : null;

  // 썸네일: 여백을 뺀 첫 쪽 윗부분
  const c = crop || { x0: 0, y0: 0, x1: 1, y1: 1 };
  const page = await pdf.getPage(1);
  const v1 = page.getViewport({ scale: 1 });
  const TW = 420, TH = 504;
  const sc = TW / ((c.x1 - c.x0) * v1.width);
  cv.width = TW; cv.height = TH;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, TW, TH);
  await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: sc }), transform: [1, 0, 0, 1, -c.x0 * v1.width * sc, -c.y0 * v1.height * sc] }).promise;
  const thumb = cv.toDataURL('image/jpeg', 0.82);
  cv.width = cv.height = 0;
  return { crop, thumb };
}

$('#btnImport').onclick = () => fileInput.click();
$('#empty [data-act=import]').onclick = () => fileInput.click();
fileInput.onchange = () => { const f = [...fileInput.files]; fileInput.value = ''; if (f.length) importFiles(f); };
$('#q').oninput = () => renderLibrary();

// 끌어다 놓기(맥·아이패드 멀티태스킹)
let dragDepth = 0;
lib.addEventListener('dragenter', e => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault();
  if (dragDepth++ === 0) lib.append(Object.assign(document.createElement('div'), { className: 'dropzone', textContent: '여기에 놓으면 서재에 담겨요' }));
});
lib.addEventListener('dragover', e => e.preventDefault());
lib.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('.dropzone')?.remove(); } });
lib.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('.dropzone')?.remove();
  if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files);
});

// ═══════════════════ 리더 ═══════════════════
const reader = $('#reader'), scroller = $('#scroller'), pagesEl = $('#pages');
let R = null; // 열린 원고 상태

async function openDoc(id) {
  busy('원고를 펼치는 중…');
  try {
    const [doc, file, ink] = await Promise.all([idb.get('docs', id), idb.get('files', id), idb.get('ink', id)]);
    if (!doc || !file) { toast('원고를 찾을 수 없어요'); return; }
    const pdf = await pdfjsLib.getDocument({ ...PDF_OPTS, data: new Uint8Array(file.data.slice(0)) }).promise;
    R = { doc, pdf, ink: ink || { id, pages: {} }, pages: [], undo: [], redo: [], mode: 'prep' };
    pagesEl.replaceChildren();
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.i = i;
      const inkCv = document.createElement('canvas');
      inkCv.className = 'ink';
      el.append(inkCv, Object.assign(document.createElement('span'), { className: 'pno', textContent: i + 1 }));
      pagesEl.append(el);
      R.pages.push({ i, page, w: vp.width, h: vp.height, el, ink: inkCv, cv: null, ictx: null, key: null, task: null, top: 0, s: 1, dw: 0, dh: 0 });
    }
    $('#rTitle').textContent = doc.title;
    updateSub();
    lib.hidden = true;
    reader.hidden = false;
    setMode('prep', false);
    layout(doc.pos || { i: 0, f: 0 });
    refreshPalette();
    updateUndoUI();
    doc.opened = Date.now();
    idb.put('docs', doc);
  } catch (e) {
    console.error(e);
    toast('원고를 여는 중 문제가 생겼어요');
  } finally { busy(); }
}
function updateSub() {
  if (!R) return;
  const d = R.doc;
  $('#rSub').textContent = [d.date, d.kind, `${curPage() + 1} / ${d.pages}쪽`].filter(Boolean).join(' · ');
  $('#pPageTxt').textContent = `${curPage() + 1} / ${d.pages}`;
}
async function closeDoc() {
  if (!R) return;
  flushSave(); savePos();
  setMode('prep', false);
  for (const P of R.pages) releasePage(P);
  const pdf = R.pdf;
  R = null;
  pagesEl.replaceChildren();
  reader.hidden = true;
  lib.hidden = false;
  pdf.destroy();
  renderLibrary();
}
$('#btnBack').onclick = closeDoc;

// ── 배치·렌더 ──
const cropBox = () => (R.doc.cropOn && R.doc.crop) ? R.doc.crop : { x0: 0, y0: 0, x1: 1, y1: 1 };
function getAnchor() {
  const top = scroller.scrollTop;
  for (const P of R.pages) if (P.top + P.dh > top) return { i: P.i, f: Math.max(0, (top - P.top) / P.dh) };
  return { i: R.pages.length - 1, f: 1 };
}
function layout(anchor) {
  if (!R) return;
  anchor ??= getAnchor();
  const cs = getComputedStyle(pagesEl);
  const avail = Math.floor(Math.min(1200, scroller.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
  const c = cropBox();
  for (const P of R.pages) {
    P.s = avail / ((c.x1 - c.x0) * P.w);
    P.dw = avail;
    P.dh = Math.round((c.y1 - c.y0) * P.h * P.s);
    P.el.style.width = P.dw + 'px';
    P.el.style.height = P.dh + 'px';
    P.key = null;
  }
  for (const P of R.pages) P.top = P.el.offsetTop;
  R.width = scroller.clientWidth;
  const A = R.pages[clamp(anchor.i, 0, R.pages.length - 1)];
  scroller.scrollTop = A.top + anchor.f * A.dh;
  updateVisible();
}
function updateVisible() {
  if (!R) return;
  const top = scroller.scrollTop, H = scroller.clientHeight;
  for (const P of R.pages) {
    const b = P.top + P.dh;
    if (b > top - H * 0.5 && P.top < top + H * 1.6) ensurePage(P);
    else if (b < top - H * 2 || P.top > top + H * 3) releasePage(P);
  }
}
function ensurePage(P) {
  const dpr = DPR(), c = cropBox();
  const key = `${P.dw}x${P.dh}@${dpr}`;
  if (P.key === key) return;
  P.key = key;
  const k = P.s * dpr;
  P.ink.width = Math.round(P.dw * dpr);
  P.ink.height = Math.round(P.dh * dpr);
  P.ictx = P.ink.getContext('2d');
  P.ictx.setTransform(k, 0, 0, k, -c.x0 * P.w * k, -c.y0 * P.h * k);
  redrawInk(P);
  renderPdf(P, key, k, c);
}
async function renderPdf(P, key, k, c) {
  P.task?.cancel();
  const cv = document.createElement('canvas');
  cv.className = 'pdf';
  cv.width = Math.round(P.dw * DPR());
  cv.height = Math.round(P.dh * DPR());
  const task = P.page.render({
    canvasContext: cv.getContext('2d', { alpha: false }),
    viewport: P.page.getViewport({ scale: k }),
    transform: [1, 0, 0, 1, -c.x0 * P.w * k, -c.y0 * P.h * k],
    background: '#ffffff',
  });
  P.task = task;
  try { await task.promise; } catch (e) { if (e?.name !== 'RenderingCancelledException') console.error(e); cv.width = cv.height = 0; return; }
  finally { if (P.task === task) P.task = null; }
  if (P.key !== key || !R) { cv.width = cv.height = 0; return; }
  if (P.cv) { P.cv.width = P.cv.height = 0; P.cv.replaceWith(cv); } else P.el.prepend(cv);
  P.cv = cv;
}
function releasePage(P) {
  if (P.key == null && !P.cv) return;
  P.key = null;
  P.task?.cancel(); P.task = null;
  if (P.cv) { P.cv.width = P.cv.height = 0; P.cv.remove(); P.cv = null; }
  P.ink.width = P.ink.height = 0;
  P.ictx = null;
}
function curPage() {
  if (!R?.pages.length) return 0;
  const y = scroller.scrollTop + scroller.clientHeight * 0.35;
  let cur = 0;
  for (const P of R.pages) if (P.top <= y) cur = P.i;
  return cur;
}

let scrollRaf = 0, posTimer = 0;
scroller.addEventListener('scroll', () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    updateVisible();
    updateSub();
    clearTimeout(posTimer);
    posTimer = setTimeout(savePos, 700);
  });
}, { passive: true });
function savePos() {
  if (!R) return;
  R.doc.pos = getAnchor();
  idb.put('docs', R.doc);
}
new ResizeObserver(() => {
  if (!R) return;
  if (scroller.clientWidth !== R.width) layout();
  else updateVisible();
}).observe(scroller);

// ═══════════════════ 필기 ═══════════════════
function strokeStyle(ctx, S) {
  ctx.strokeStyle = ctx.fillStyle = S.c;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}
const ptAt = (S, P, k) => [S.p[k * 3] * P.w, S.p[k * 3 + 1] * P.h, S.p[k * 3 + 2]];
const widthAt = (S, P, pr) => S.w * P.w * (S.t === 'pen' ? clamp(0.45 + 1.1 * pr, 0.4, 1.6) : 1);
function segStart(S, P, k) {
  if (k === 1) return ptAt(S, P, 0);
  const a = ptAt(S, P, k - 1), b = ptAt(S, P, k);
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
// 점 k 를 조절점으로, 앞뒤 중점을 잇는 곡선 조각
function drawQuad(ctx, S, P, k) {
  const A = segStart(S, P, k), C = ptAt(S, P, k), N = ptAt(S, P, k + 1);
  ctx.lineWidth = widthAt(S, P, C[2]);
  ctx.beginPath();
  ctx.moveTo(A[0], A[1]);
  ctx.quadraticCurveTo(C[0], C[1], (C[0] + N[0]) / 2, (C[1] + N[1]) / 2);
  ctx.stroke();
}
function drawTail(ctx, S, P) {
  const n = S.p.length / 3;
  if (n === 1) { drawDot(ctx, S, P); return; }
  const A = segStart(S, P, n - 1), L = ptAt(S, P, n - 1);
  ctx.lineWidth = widthAt(S, P, L[2]);
  ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(L[0], L[1]); ctx.stroke();
}
function drawDot(ctx, S, P) {
  const [x, y, pr] = ptAt(S, P, 0);
  ctx.beginPath(); ctx.arc(x, y, widthAt(S, P, pr) / 2, 0, Math.PI * 2); ctx.fill();
}
function drawStroke(ctx, S, P) {
  strokeStyle(ctx, S);
  const n = S.p.length / 3;
  for (let k = 1; k <= n - 2; k++) drawQuad(ctx, S, P, k);
  drawTail(ctx, S, P);
}
function redrawInk(P) {
  const ctx = P.ictx;
  if (!ctx) return;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, P.ink.width, P.ink.height); ctx.restore();
  const list = R.ink.pages[P.i];
  if (!list?.length) return;
  for (const S of list) if (S.t === 'hl') drawStroke(ctx, S, P); // 형광펜은 늘 펜 아래
  for (const S of list) if (S.t !== 'hl') drawStroke(ctx, S, P);
}

let live = null;           // 진행 중인 획/지우기
let penSeen = 0;
const pan = { y: null };   // 손가락 쓰기 모드의 두 손가락 스크롤
let tap = null;            // 강단 모드 탭 넘기기

function pointerRole(e) {
  if (!R) return null;
  if (e.pointerType === 'pen') return 'draw';
  if (R.mode === 'pulpit') return 'tap';
  if (e.pointerType === 'mouse') return e.button === 0 ? 'draw' : null;
  return settings.finger ? 'draw' : null;
}
pagesEl.addEventListener('pointerdown', e => {
  const role = pointerRole(e);
  if (e.pointerType === 'pen' && settings.finger) {
    settings.finger = false; saveSettings(); refreshPalette();
    toast('애플펜슬이 감지돼 손가락 쓰기를 껐어요. 손가락은 넘기기용이에요.', 3200);
  }
  if (e.pointerType === 'pen') penSeen = Date.now();
  if (live && live.pt === 'touch' && e.pointerType === 'touch') { cancelLive(); return; } // 두 번째 손가락 → 스크롤
  if (role === 'tap') { tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), st: scroller.scrollTop }; return; }
  if (role !== 'draw' || live) return;
  const el = e.target.closest('.page');
  if (!el) return;
  const P = R.pages[+el.dataset.i];
  if (!P.ictx) return;
  e.preventDefault();
  try { e.target.setPointerCapture(e.pointerId); } catch {}
  const r = el.getBoundingClientRect(), c = cropBox();
  live = { id: e.pointerId, pt: e.pointerType, P, rect: r, ox: c.x0 * P.w, oy: c.y0 * P.h, lastPr: null };
  if (settings.tool === 'eraser') {
    Object.assign(live, { kind: 'erase', removed: [], last: null });
    eraseMove(e);
  } else {
    const hl = settings.tool === 'hl';
    live.kind = 'draw';
    live.S = { t: hl ? 'hl' : 'pen', c: hl ? settings.hlColor : settings.penColor, w: (hl ? HL_SIZES[settings.hlSize] : PEN_SIZES[settings.penSize]), p: [] };
    addPoint(e);
    strokeStyle(P.ictx, live.S);
    drawDot(P.ictx, live.S, P);
  }
});
pagesEl.addEventListener('pointermove', e => {
  if (!live || e.pointerId !== live.id) return;
  const evs = e.getCoalescedEvents?.() || [e];
  for (const ev of (evs.length ? evs : [e])) live.kind === 'erase' ? eraseMove(ev) : addPoint(ev, true);
});
pagesEl.addEventListener('pointerup', e => {
  if (tap && e.pointerId === tap.id) {
    const t = tap; tap = null;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) < 12 && performance.now() - t.t < 450 && Math.abs(scroller.scrollTop - t.st) < 4) {
      const r = scroller.getBoundingClientRect();
      turn((e.clientX - r.left) / r.width < 0.3 ? -1 : 1);
      if (!wakeLock) requestWake();
    }
    return;
  }
  if (live && e.pointerId === live.id) finishLive();
});
pagesEl.addEventListener('pointercancel', e => {
  if (tap && e.pointerId === tap.id) tap = null;
  if (live && e.pointerId === live.id) (live.pt === 'pen' ? finishLive() : cancelLive());
});

// 펜슬이 닿으면 스크롤을 막고, 쓰는 동안 손바닥이 화면을 밀지 않게 한다
scroller.addEventListener('touchstart', e => {
  const stylus = [...e.changedTouches].some(t => t.touchType === 'stylus');
  if (stylus && R?.pages.length) { e.preventDefault(); return; }
  if (live) { e.preventDefault(); return; }
  if (settings.finger && R?.mode === 'prep' && e.touches.length === 1 && e.target.closest?.('.page')) e.preventDefault();
}, { passive: false });
scroller.addEventListener('touchmove', e => {
  if (settings.finger && R?.mode === 'prep' && e.touches.length >= 2) {
    e.preventDefault();
    const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    if (pan.y != null) scroller.scrollTop -= y - pan.y;
    pan.y = y;
    return;
  }
  if (live) e.preventDefault();
}, { passive: false });
scroller.addEventListener('touchend', e => { if (e.touches.length < 2) pan.y = null; });

function addPoint(ev, draw) {
  const L = live, P = L.P, S = L.S;
  const x = (ev.clientX - L.rect.left) / P.s + L.ox;
  const y = (ev.clientY - L.rect.top) / P.s + L.oy;
  let pr = L.pt === 'pen' ? (ev.pressure || 0.5) : 0.5;
  if (L.lastPr != null) pr = L.lastPr * 0.6 + pr * 0.4;
  const n = S.p.length / 3;
  if (n) {
    const dx = x - S.p[(n - 1) * 3] * P.w, dy = y - S.p[(n - 1) * 3 + 1] * P.h;
    if (dx * dx + dy * dy < (0.7 / P.s) ** 2) return;
  }
  L.lastPr = pr;
  S.p.push(x / P.w, y / P.h, pr);
  const m = n + 1;
  if (draw && m >= 3) { strokeStyle(P.ictx, S); drawQuad(P.ictx, S, P, m - 2); }
}
function finishLive() {
  const L = live; live = null;
  if (!L) return;
  if (L.kind === 'erase') {
    if (L.removed.length) pushHist({ t: 'erase', items: L.removed });
    return;
  }
  const { P, S } = L;
  if (!S.p.length) return;
  if (S.t === 'hl') straighten(S, P);
  S.p = S.p.map((v, i) => i % 3 === 2 ? Math.round(v * 100) / 100 : Math.round(v * 1e5) / 1e5);
  (R.ink.pages[P.i] ||= []).push(S);
  pushHist({ t: 'add', page: P.i, stroke: S });
  redrawInk(P);
}
function cancelLive() {
  const L = live; live = null;
  if (!L) return;
  if (L.kind === 'erase') { if (L.removed.length) pushHist({ t: 'erase', items: L.removed }); return; }
  redrawInk(L.P);
}
// 형광펜을 거의 곧게 그었다면 반듯한 직선으로(글줄에 맞춰 수평이면 수평으로)
function straighten(S, P) {
  const n = S.p.length / 3;
  if (n < 3) return;
  const A = ptAt(S, P, 0), B = ptAt(S, P, n - 1);
  const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy), w = S.w * P.w;
  if (len < w * 2.5) return;
  let dev = 0;
  for (let k = 1; k < n - 1; k++) {
    const p = ptAt(S, P, k);
    dev = Math.max(dev, Math.abs((p[0] - A[0]) * dy - (p[1] - A[1]) * dx) / len);
  }
  if (dev > w * 0.45) return;
  let ay = A[1], by = B[1];
  if (Math.abs(dy) < Math.abs(dx) * 0.1) ay = by = (A[1] + B[1]) / 2;
  S.p = [A[0] / P.w, ay / P.h, 0.5, B[0] / P.w, by / P.h, 0.5];
}

// 지우개: 닿은 획을 통째로 지운다
const bbCache = new WeakMap();
function strokeBB(S, P) {
  let b = bbCache.get(S);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k < S.p.length; k += 3) {
      b[0] = Math.min(b[0], S.p[k]); b[1] = Math.min(b[1], S.p[k + 1]);
      b[2] = Math.max(b[2], S.p[k]); b[3] = Math.max(b[3], S.p[k + 1]);
    }
    bbCache.set(S, b);
  }
  return [b[0] * P.w, b[1] * P.h, b[2] * P.w, b[3] * P.h];
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function strokeHit(S, P, x, y, r) {
  const rr = r + S.w * P.w * (S.t === 'pen' ? 0.8 : 0.5);
  const b = strokeBB(S, P);
  if (x < b[0] - rr || x > b[2] + rr || y < b[1] - rr || y > b[3] + rr) return false;
  const n = S.p.length / 3;
  if (n === 1) return Math.hypot(x - S.p[0] * P.w, y - S.p[1] * P.h) <= rr;
  for (let k = 0; k < n - 1; k++) {
    if (segDist(x, y, S.p[k * 3] * P.w, S.p[k * 3 + 1] * P.h, S.p[k * 3 + 3] * P.w, S.p[k * 3 + 4] * P.h) <= rr) return true;
  }
  return false;
}
function eraseMove(ev) {
  const L = live, P = L.P;
  const x = (ev.clientX - L.rect.left) / P.s + L.ox, y = (ev.clientY - L.rect.top) / P.s + L.oy;
  const r = ERASE_PX / P.s;
  const pts = [[x, y]];
  if (L.last) {
    const d = Math.hypot(x - L.last[0], y - L.last[1]), steps = Math.floor(d / (r * 0.5));
    for (let s = 1; s < steps; s++) pts.push([L.last[0] + (x - L.last[0]) * s / steps, L.last[1] + (y - L.last[1]) * s / steps]);
  }
  L.last = [x, y];
  const list = R.ink.pages[P.i];
  if (!list?.length) return;
  let hit = false;
  for (let j = list.length - 1; j >= 0; j--) {
    if (pts.some(([px, py]) => strokeHit(list[j], P, px, py, r))) {
      L.removed.push({ page: P.i, index: j, stroke: list[j] });
      list.splice(j, 1);
      hit = true;
    }
  }
  if (hit) redrawInk(P);
}

// ── 되돌리기 ──
function pushHist(h) {
  R.undo.push(h);
  if (R.undo.length > 300) R.undo.shift();
  R.redo.length = 0;
  afterInkChange();
}
function applyHist(h, reverse) {
  const pages = R.ink.pages, touched = new Set();
  const list = i => (pages[i] ||= []);
  if (h.t === 'add') {
    touched.add(h.page);
    if (reverse) { const l = list(h.page), j = l.lastIndexOf(h.stroke); if (j >= 0) l.splice(j, 1); }
    else list(h.page).push(h.stroke);
  } else if (h.t === 'erase') {
    if (reverse) for (const it of [...h.items].reverse()) { list(it.page).splice(it.index, 0, it.stroke); touched.add(it.page); }
    else for (const it of h.items) { const l = list(it.page), j = l.indexOf(it.stroke); if (j >= 0) l.splice(j, 1); touched.add(it.page); }
  } else if (h.t === 'clear') {
    for (const it of h.items) { pages[it.page] = reverse ? [...it.strokes] : []; touched.add(it.page); }
  }
  for (const i of touched) redrawInk(R.pages[i]);
}
function undo() { const h = R?.undo.pop(); if (!h) return; applyHist(h, true); R.redo.push(h); afterInkChange(); }
function redo() { const h = R?.redo.pop(); if (!h) return; applyHist(h, false); R.undo.push(h); afterInkChange(); }
function afterInkChange() { updateUndoUI(); scheduleSave(); }
function updateUndoUI() {
  $('#btnUndo').disabled = !R?.undo.length;
  $('#btnRedo').disabled = !R?.redo.length;
}
let saveTimer = 0;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 500); }
function flushSave() {
  if (!saveTimer || !R) return;
  clearTimeout(saveTimer); saveTimer = 0;
  const pages = {};
  let count = 0;
  for (const [k, v] of Object.entries(R.ink.pages)) if (v.length) { pages[k] = v; count += v.length; }
  R.ink = { id: R.doc.id, pages, updated: Date.now() };
  R.doc.inkCount = count;
  idb.put('ink', R.ink).catch(e => { console.error(e); toast('필기를 저장하지 못했어요. 저장 공간을 확인해 주세요.', 3500); });
  idb.put('docs', R.doc);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushSave(); savePos(); } });
addEventListener('pagehide', () => { flushSave(); savePos(); });

// ── 도구 팔레트 ──
const palette = $('#palette');
function refreshPalette() {
  const t = settings.tool;
  $$('.tool[data-tool]', palette).forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  $('.tool[data-tool=pen] .tip', palette).style.setProperty('--c', settings.penColor);
  $('.tool[data-tool=hl] .tip', palette).style.setProperty('--c', settings.hlColor);
  const sw = $('#swatches'), hl = t === 'hl';
  sw.hidden = $('#btnSize').hidden = t === 'eraser';
  const colors = hl ? HL_COLORS : PEN_COLORS, cur = hl ? settings.hlColor : settings.penColor;
  sw.replaceChildren(...colors.map(c => {
    const b = document.createElement('button');
    b.className = 'sw' + (c === cur ? ' on' : '');
    b.innerHTML = '<i></i>';
    b.style.setProperty('--c', c);
    b.setAttribute('aria-label', '색');
    b.onclick = () => { settings[hl ? 'hlColor' : 'penColor'] = c; saveSettings(); refreshPalette(); };
    return b;
  }));
  const size = hl ? settings.hlSize : settings.penSize;
  const dot = $('#btnSize i');
  const px = hl ? [8, 12, 16][size] : [4, 7, 10][size];
  Object.assign(dot.style, { width: px + 'px', height: px + 'px', background: hl ? settings.hlColor : 'var(--ink-2)', borderRadius: hl ? '3px' : '50%' });
  $('#btnFinger').classList.toggle('on', settings.finger);
}
$$('.tool[data-tool]', palette).forEach(b => b.onclick = () => { settings.tool = b.dataset.tool; saveSettings(); refreshPalette(); });
$('#btnSize').onclick = () => {
  const k = settings.tool === 'hl' ? 'hlSize' : 'penSize';
  settings[k] = (settings[k] + 1) % 3; saveSettings(); refreshPalette();
};
$('#btnUndo').onclick = undo;
$('#btnRedo').onclick = redo;
$('#btnFinger').onclick = () => {
  settings.finger = !settings.finger; saveSettings(); refreshPalette();
  toast(settings.finger ? '손가락으로 쓸 수 있어요. 스크롤은 두 손가락으로 하세요.' : '손가락은 스크롤, 필기는 애플펜슬로 해요.', 2800);
};

// ── 메뉴 ──
function openMenu(anchor, build) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  build(m);
  document.body.append(m);
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = clamp(r.right - mw, 10, innerWidth - mw - 10) + 'px';
  m.style.top = (r.bottom + 6 + mh > innerHeight - 10 ? Math.max(10, r.top - mh - 6) : r.bottom + 6) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  function outside(e) { if (!m.contains(e.target)) { e.stopPropagation(); closeMenu(); } }
  m._off = () => document.removeEventListener('pointerdown', outside, true);
}
function closeMenu() { const m = $('.menu'); if (m) { m._off?.(); m.remove(); } }
function menuItem(icon, label, fn, cls = '', right) {
  const b = document.createElement('button');
  b.className = 'mi ' + cls;
  b.innerHTML = `<svg class="i"><use href="${icon}"/></svg><span></span>`;
  b.querySelector('span').textContent = label;
  if (right) b.append(right);
  b.onclick = () => { closeMenu(); fn(); };
  return b;
}
$('#btnMenu').onclick = e => openMenu(e.currentTarget, m => {
  m.append(Object.assign(document.createElement('div'), { className: 'lbl', textContent: '화면' }));
  const th = document.createElement('div');
  th.className = 'themes';
  const key = R.mode === 'pulpit' ? 'themePulpit' : 'themePrep';
  for (const [v, label] of [['light', '밝게'], ['sepia', '종이'], ['dark', '어둡게']]) {
    const b = Object.assign(document.createElement('button'), { textContent: label, className: settings[key] === v ? 'on' : '' });
    b.onclick = () => { setTheme(v); $$('button', th).forEach(x => x.classList.toggle('on', x === b)); };
    th.append(b);
  }
  m.append(th);
  if (R.doc.crop) {
    const tg = Object.assign(document.createElement('span'), { className: 'toggle' + (R.doc.cropOn ? ' on' : '') });
    m.append(menuItem('#i-crop', '여백 줄여 크게 보기', toggleCrop, '', tg));
  }
  m.append(menuItem('#i-pages', '쪽으로 이동', () => pagesPop($('#btnMenu'))));
  m.append(document.createElement('hr'));
  m.append(menuItem('#i-share', '필기 포함 PDF 내보내기', exportPdf));
  m.append(menuItem('#i-eraser', '이 쪽 필기 지우기', () => clearInk([curPage()])));
  m.append(menuItem('#i-trash', '모든 필기 지우기', () => clearInk(R.pages.map(P => P.i)), 'danger'));
});
function toggleCrop() {
  const a = getAnchor();
  R.doc.cropOn = !R.doc.cropOn;
  idb.put('docs', R.doc);
  layout(a);
  toast(R.doc.cropOn ? '여백을 줄여 글씨를 크게 보여 줘요' : '원본 여백 그대로 보여 줘요');
}
function pagesPop(anchor) {
  openMenu(anchor, m => {
    const g = document.createElement('div');
    g.className = 'pages-pop';
    const cur = curPage();
    for (const P of R.pages) {
      const b = Object.assign(document.createElement('button'), { textContent: P.i + 1, className: P.i === cur ? 'on' : '' });
      b.onclick = () => { closeMenu(); scroller.scrollTo({ top: P.top - 8, behavior: 'smooth' }); };
      g.append(b);
    }
    m.append(g);
  });
}
async function clearInk(idx) {
  const items = idx.filter(i => R.ink.pages[i]?.length).map(i => ({ page: i, strokes: [...R.ink.pages[i]] }));
  if (!items.length) { toast('지울 필기가 없어요'); return; }
  const all = idx.length > 1;
  if (all && !await ask('모든 필기를 지울까요?', '이 원고의 펜·형광펜 표시가 모두 지워져요. 바로 다음에 되돌리기로 살릴 수 있어요.', '모두 지우기', true)) return;
  const h = { t: 'clear', items };
  applyHist(h, false);
  pushHist(h);
  toast(all ? '모든 필기를 지웠어요' : `${idx[0] + 1}쪽 필기를 지웠어요`);
}

// ═══════════════════ 준비 ↔ 강단 ═══════════════════
function setMode(mode, keep = true) {
  if (!R) return;
  const a = keep ? getAnchor() : null;
  R.mode = mode;
  reader.dataset.mode = mode;
  $$('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  applyTheme();
  closeMenu();
  if (mode === 'pulpit') { requestWake(); startTick(); }
  else { releaseWake(); stopTick(); }
  if (a) requestAnimationFrame(() => { if (!R) return; for (const P of R.pages) P.top = P.el.offsetTop; const A = R.pages[a.i]; scroller.scrollTop = A.top + a.f * A.dh; });
}
$$('.seg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('#pExit').onclick = () => setMode('prep');
$('#pPage').onclick = e => pagesPop(e.currentTarget);

function applyTheme() {
  const t = settings[R?.mode === 'pulpit' ? 'themePulpit' : 'themePrep'];
  reader.dataset.theme = t;
  $('#pTheme use').setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#1C1A18' : '#F4EFE6';
}
function setTheme(t) {
  settings[R.mode === 'pulpit' ? 'themePulpit' : 'themePrep'] = t;
  saveSettings(); applyTheme();
}
$('#pTheme').onclick = () => {
  const cur = settings.themePulpit;
  setTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
  toast({ light: '밝게', sepia: '종이 색', dark: '어둡게' }[settings.themePulpit], 1200);
};

// 한 화면씩 넘기기 — 앞 화면의 마지막 몇 줄을 남겨 두고, 이어 읽을 자리에 금색 표시
function turn(dir) {
  if (!R) return;
  const H = scroller.clientHeight, overlap = Math.max(56, H * 0.14);
  const cur = scroller.scrollTop, max = scroller.scrollHeight - H;
  const target = clamp(cur + dir * (H - overlap), 0, max);
  if (Math.abs(target - cur) < 2) { toast(dir > 0 ? '원고의 끝이에요' : '원고의 처음이에요', 1200); return; }
  const g = $('#guide');
  g.classList.remove('show');
  g.style.top = (dir > 0 ? cur + H : cur) + 'px';
  void g.offsetWidth;
  g.classList.add('show');
  scroller.scrollTo({ top: target, behavior: 'smooth' });
}

// ── 시계·타이머 ──
const T = Object.assign({ start: 0, acc: 0, running: false }, readLS('pn.timer', {}));
let tickTimer = 0;
const saveTimerState = () => writeLS('pn.timer', { start: T.start, acc: T.acc, running: T.running });
const elapsed = () => T.acc + (T.running ? Date.now() - T.start : 0);
const mmss = ms => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function startTick() { stopTick(); tick(); tickTimer = setInterval(tick, 500); }
function stopTick() { clearInterval(tickTimer); tickTimer = 0; }
function tick() {
  const now = new Date();
  $('#pClock').textContent = `${now.getHours() < 12 ? '오전' : '오후'} ${(now.getHours() % 12) || 12}:${String(now.getMinutes()).padStart(2, '0')}`;
  const e = elapsed();
  $('#pTimerTxt').textContent = e === 0 && !T.running ? '타이머 시작' : mmss(e);
  $('#pTimer').classList.toggle('run', T.running);
  const tgt = settings.target * 60000, prog = $('#tprog'), rem = $('#pRemain');
  $('#pTarget').textContent = settings.target ? `목표 ${settings.target}분` : '목표 없음';
  if (!tgt) { prog.style.width = '0'; rem.textContent = ''; return; }
  const f = e / tgt;
  prog.style.width = Math.min(100, f * 100) + '%';
  prog.className = 'tprog' + (f >= 1 ? ' over' : f >= 0.8 ? ' warn' : '');
  rem.className = 'remain' + (f >= 1 ? ' over' : '');
  rem.textContent = e === 0 ? '' : f >= 1 ? `+${mmss(e - tgt)} 넘음` : `${mmss(tgt - e)} 남음`;
}
$('#pTimer').onclick = () => {
  if (T.running) { T.acc += Date.now() - T.start; T.running = false; }
  else { T.start = Date.now(); T.running = true; }
  saveTimerState(); tick();
};
$('#pReset').onclick = () => { T.acc = 0; T.running = false; T.start = 0; saveTimerState(); tick(); toast('타이머를 0으로 돌렸어요', 1200); };
$('#pTarget').onclick = () => { settings.target = TARGETS[(TARGETS.indexOf(settings.target) + 1) % TARGETS.length]; saveSettings(); tick(); };

// ── 화면 꺼짐 방지 ──
let wakeLock = null;
async function requestWake() {
  if (!('wakeLock' in navigator) || wakeLock || R?.mode !== 'pulpit') return updateWake();
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; updateWake(); });
  } catch { wakeLock = null; }
  updateWake();
}
function releaseWake() { wakeLock?.release().catch(() => {}); wakeLock = null; updateWake(); }
function updateWake() {
  const w = $('#pWake');
  w.classList.toggle('off', !wakeLock);
  w.title = wakeLock ? '화면이 꺼지지 않아요' : '화면 꺼짐 방지가 꺼져 있어요 (설정 › 디스플레이 › 자동 잠금 확인)';
}
$('#pWake').onclick = () => wakeLock ? toast('화면이 꺼지지 않게 잡아 두었어요', 1600) : (requestWake(), toast('화면 꺼짐 방지를 다시 켰어요. 안 되면 설정 › 디스플레이 › 자동 잠금을 ‘안 함’으로 두세요.', 3600));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && R?.mode === 'pulpit') requestWake(); });

// ═══════════════════ 필기 포함 PDF ═══════════════════
async function exportPdf() {
  if (!R) return;
  flushSave();
  const total = Object.values(R.ink.pages).reduce((n, l) => n + l.length, 0);
  if (!total) { toast('아직 필기가 없어요. 원본 PDF는 파일 앱에 그대로 있어요.', 2800); return; }
  busy('필기를 PDF에 옮기는 중…');
  try {
    const { PDFDocument, rgb, LineCapStyle, BlendMode } = await import('./vendor/pdf-lib.esm.min.js');
    const file = await idb.get('files', R.doc.id);
    const out = await PDFDocument.load(file.data, { ignoreEncryption: true });
    const outPages = out.getPages();
    const col = hex => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
    const f = n => n.toFixed(2);
    for (const P of R.pages) {
      const list = R.ink.pages[P.i];
      if (!list?.length) continue;
      const pg = outPages[P.i];
      const vp = P.page.getViewport({ scale: 1 });
      // 화면 좌표(pt) → PDF 좌표. drawSvgPath 는 y 를 뒤집으므로 -Y 로 넘긴다
      const map = (x, y) => { const [X, Y] = vp.convertToPdfPoint(x, y); return `${f(X)} ${f(-Y)}`; };
      const ordered = [...list.filter(s => s.t === 'hl'), ...list.filter(s => s.t !== 'hl')];
      for (const S of ordered) {
        const n = S.p.length / 3;
        const opts = { x: 0, y: 0, borderColor: col(S.c), borderLineCap: LineCapStyle.Round };
        if (S.t === 'hl') opts.blendMode = BlendMode.Multiply;
        if (n === 1) {
          const [x, y, pr] = ptAt(S, P, 0);
          pg.drawSvgPath(`M ${map(x, y)} L ${map(x + 0.01, y)}`, { ...opts, borderWidth: widthAt(S, P, pr) });
          continue;
        }
        // 굵기가 같은 조각끼리 묶어서 하나의 경로로
        let d = '', w = -1;
        const flush = () => { if (d) pg.drawSvgPath(d, { ...opts, borderWidth: w }); d = ''; };
        const seg = (A, wd, piece) => {
          const q = Math.round(wd * 20) / 20;
          if (q !== w) { flush(); w = q; d = `M ${map(A[0], A[1])}`; }
          d += piece;
        };
        for (let k = 1; k <= n - 2; k++) {
          const A = segStart(S, P, k), C = ptAt(S, P, k), N = ptAt(S, P, k + 1);
          seg(A, widthAt(S, P, C[2]), ` Q ${map(C[0], C[1])} ${map((C[0] + N[0]) / 2, (C[1] + N[1]) / 2)}`);
        }
        const A = segStart(S, P, n - 1), L = ptAt(S, P, n - 1);
        seg(A, widthAt(S, P, L[2]), ` L ${map(L[0], L[1])}`);
        flush();
      }
    }
    const bytes = await out.save();
    busy();
    const name = R.doc.name.replace(/\.pdf$/i, '') + ' (필기).pdf';
    offerFile(bytes, name);
  } catch (e) {
    console.error(e);
    busy();
    toast('PDF를 만들지 못했어요', 3000);
  }
}
function offerFile(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const file = new File([blob], name, { type: 'application/pdf' });
  const canShare = !!navigator.canShare?.({ files: [file] });
  const download = () => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  };
  const buttons = [{ label: '닫기', value: 0 }];
  if (canShare) buttons.push({ label: '다운로드', value: 0, onClick: download }, { label: '공유 · 파일에 저장', cls: 'primary', onClick: () => navigator.share({ files: [file], title: name }).catch(() => {}) });
  else buttons.push({ label: '다운로드', cls: 'primary', onClick: download });
  dialog({ title: '필기 포함 PDF가 준비됐어요', body: `${name} · ${(bytes.length / 1024).toFixed(0)}KB\n구글 드라이브나 파일 앱에 저장해 두면 다른 기기에서도 볼 수 있어요.`, buttons });
}

// ═══════════════════ 키보드·페달 ═══════════════════
addEventListener('keydown', e => {
  if (!R || $('.scrim') || e.target.matches?.('input,textarea')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod) return;
  const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'], prev = ['ArrowLeft', 'ArrowUp', 'PageUp'];
  if (next.includes(e.key)) { e.preventDefault(); turn(1); }
  else if (prev.includes(e.key)) { e.preventDefault(); turn(-1); }
  else if (e.key === 'Escape') { closeMenu(); if (R.mode === 'pulpit') setMode('prep'); }
  else if (R.mode === 'prep' && 'peh'.includes(e.key.toLowerCase())) {
    settings.tool = { p: 'pen', h: 'hl', e: 'eraser' }[e.key.toLowerCase()]; saveSettings(); refreshPalette();
  }
});
// 아이패드에서 화면 전체가 확대되는 것을 막는다(원고 크기는 여백 줄이기·가로 보기로)
document.addEventListener('gesturestart', e => e.preventDefault());

// ═══════════════════ 시작 ═══════════════════
renderLibrary();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
}
