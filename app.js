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

// 아이패드 앱(Capacitor)으로 실행 중인지. 웹판과 같은 코드를 쓰고, 기기 기능만 갈라 쓴다
const Cap = window.Capacitor;
const NATIVE = !!Cap?.isNativePlatform?.();
const plugin = name => Cap?.Plugins?.[name];
if (NATIVE) document.documentElement.classList.add('native');

// ─────────── 설정 ───────────
const PEN_COLORS = ['#1F1B16', '#D23B2E', '#2456C8', '#1F8A4C'];
const HL_COLORS = ['#FFE45C', '#A8E890', '#FFB3D1', '#A9DBFF'];
const THEMES = ['light', 'sepia', 'dark'];
const APP_VERSION = '1.0.1';
const SUPPORT_EMAIL = 'lovewords10@gmail.com';

const savedSettings = readLS('pn.settings', {});
// 예전 3단계 굵기(penSize·hlSize) → 슬라이더 값(쪽 폭 대비)
if (savedSettings.penW == null && savedSettings.penSize != null) savedSettings.penW = [0.0024, 0.0036, 0.0054][savedSettings.penSize];
if (savedSettings.hlW == null && savedSettings.hlSize != null) savedSettings.hlW = [0.018, 0.026, 0.036][savedSettings.hlSize];
delete savedSettings.penSize; delete savedSettings.hlSize;
const settings = Object.assign({
  tool: 'pen', penColor: PEN_COLORS[1], hlColor: HL_COLORS[0], penW: 0.0036, hlW: 0.026, eraseR: 0.012, eraseMode: 'part',
  finger: false, themePrep: 'light', themePulpit: 'light', target: 25, timerMode: 'down', sort: 'recent',
  zoom: 1, thumbs: false, pulpitInk: false,
}, savedSettings);
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
// input 을 주면 입력 칸이 생기고, value 가 'input' 인 버튼은 입력한 글을 돌려준다
function dialog({ title, body, buttons, input }) {
  return new Promise(resolve => {
    const s = document.createElement('div');
    s.className = 'scrim';
    s.innerHTML = '<div class="dialog" role="dialog"><h3></h3><p></p><div class="row"></div></div>';
    s.querySelector('h3').textContent = title;
    s.querySelector('p').textContent = body || '';
    if (!body) s.querySelector('p').remove();
    let field = null;
    if (input != null) {
      field = Object.assign(document.createElement('input'), { className: 'field', value: input, enterKeyHint: 'done' });
      s.querySelector('.row').before(field);
    }
    const close = v => { s.remove(); resolve(v === 'input' ? field.value.trim() : v); };
    for (const b of buttons) {
      const el = Object.assign(document.createElement('button'), { className: 'btn ' + (b.cls || ''), textContent: b.label });
      el.onclick = () => { b.onClick?.(); close(b.value); };
      s.querySelector('.row').append(el);
    }
    field?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); close('input'); } });
    s.addEventListener('click', e => { if (e.target === s) close(undefined); });
    document.body.append(s);
    field?.focus();
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
  const recent = (a, b) => (b.opened || b.added) - (a.opened || a.added);
  docsCache = (await idb.all('docs')).sort(settings.sort === 'date'
    ? (a, b) => (b.date || '').localeCompare(a.date || '') || recent(a, b) // 설교 날짜 최신 순, 날짜 없으면 뒤로
    : recent);
  const q = $('#q').value.trim();
  const list = q ? docsCache.filter(d => [d.title, d.kind, d.date, d.name].join(' ').includes(q)) : docsCache;
  $('#searchBox').hidden = docsCache.length < 7;
  $('#sortSeg').hidden = docsCache.length < 2;
  $$('#sortSeg button').forEach(b => b.classList.toggle('on', b.dataset.sort === settings.sort));
  $('#empty').hidden = docsCache.length > 0;
  grid.hidden = docsCache.length === 0;
  grid.replaceChildren(...list.map((d, n) => {
    const c = document.createElement('div');
    c.className = 'card';
    c.style.animationDelay = Math.min(n, 12) * 30 + 'ms';
    c.innerHTML = `
      <button class="sheet" aria-label="열기"><img alt="" draggable="false"><span class="pick"><svg class="i"><use href="#i-check"/></svg></span></button>
      <button class="more" aria-label="더 보기"><svg class="i"><use href="#i-more"/></svg></button>
      <div class="meta"></div><h3></h3><div class="sub"></div>`;
    c.dataset.id = d.id;
    c.classList.toggle('picked', !!libSel?.has(d.id));
    c.querySelector('img').src = d.thumb || '';
    if (d.inkCount) c.querySelector('.sheet').insertAdjacentHTML('beforeend', `<span class="badge" title="필기가 있는 쪽"><svg class="i"><use href="#i-pen"/></svg>필기${d.inkPages ? ` ${d.inkPages}쪽` : ''}</span>`);
    const meta = c.querySelector('.meta');
    if (d.date) meta.append(Object.assign(document.createElement('b'), { textContent: d.date }));
    if (d.kind) meta.append(document.createTextNode((d.date ? '· ' : '') + d.kind));
    c.querySelector('h3').textContent = d.title;
    c.querySelector('.sub').textContent = [`${d.pages}쪽`, d.tag, d.opened ? '최근 ' + ago(d.opened) : '새 원고'].filter(Boolean).join(' · ');
    const tapCard = () => {
      if (longPressed) { longPressed = false; return; } // 길게 누른 뒤 따라오는 탭은 무시
      if (libSel) togglePick(c, d.id); else openDoc(d.id);
    };
    c.querySelector('.sheet').onclick = tapCard;
    c.querySelector('h3').onclick = tapCard;
    c.querySelector('.more').onclick = e => cardMenu(e.currentTarget, d);
    watchLongPress(c, d.id);
    return c;
  }));
  $('#btnSelect').hidden = !docsCache.length || !!libSel;
  updateLibBar();
  renderFoot();
}

// ── 여러 원고 골라서 지우기 ──
let libSel = null; // 고르기 중일 때 고른 원고 id
// 길게 누르면 서재를 다시 그리므로 카드가 바뀐다 → '방금 길게 눌렀음'은 카드가 아니라 여기에 둔다
let longPressed = false;
function setLibSelect(on, firstId) {
  libSel = on ? new Set(firstId ? [firstId] : []) : null;
  if (!on) longPressed = false;
  lib.classList.toggle('selecting', !!libSel);
  $('#libBar').hidden = !libSel;
  renderLibrary();
}
function togglePick(card, id) {
  libSel.has(id) ? libSel.delete(id) : libSel.add(id);
  card.classList.toggle('picked', libSel.has(id));
  updateLibBar();
}
// 설교 날짜(파일 이름의 260921)가 오늘보다 앞선 원고
const todayStr = () => { const t = new Date(); return `${t.getFullYear()}.${String(t.getMonth() + 1).padStart(2, '0')}.${String(t.getDate()).padStart(2, '0')}`; };
const pastDocs = () => docsCache.filter(d => d.date && d.date < todayStr());
function visibleIds() { return $$('.card', grid).map(c => c.dataset.id); }
function updateLibBar() {
  if (!libSel) return;
  const n = libSel.size, vis = visibleIds();
  $('#lbCnt').textContent = n ? `${n}편 선택됨` : '지울 원고를 선택하세요';
  $('#lbDel').disabled = !n;
  $('#lbDel').textContent = n ? `${n}편 지우기` : '지우기';
  $('#lbAll').textContent = vis.length && vis.every(id => libSel.has(id)) ? '모두 해제' : '모두 선택';
  const past = pastDocs();
  $('#lbPast').hidden = !past.length;
  $('#lbPast').textContent = `지난 설교 ${past.length}편`;
}
function watchLongPress(card, id) {
  let timer = 0, x = 0, y = 0;
  const stop = () => { clearTimeout(timer); timer = 0; };
  card.addEventListener('pointerdown', e => {
    if (e.target.closest('.more')) return;
    x = e.clientX; y = e.clientY; stop();
    longPressed = false;
    timer = setTimeout(() => {
      timer = 0; longPressed = true;
      if (!libSel) setLibSelect(true, id);
      else { const c = $(`.card[data-id="${id}"]`, grid); if (c && !libSel.has(id)) togglePick(c, id); }
      navigator.vibrate?.(10);
    }, 480);
  });
  card.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 10) stop(); });
  card.addEventListener('pointerup', () => { stop(); if (longPressed) setTimeout(() => { longPressed = false; }, 400); });
  card.addEventListener('pointercancel', stop);
  card.addEventListener('contextmenu', e => e.preventDefault());
}
async function deleteSelected() {
  const ids = [...(libSel || [])];
  if (!ids.length) return;
  const titles = docsCache.filter(d => libSel.has(d.id)).map(d => d.title);
  const list = titles.slice(0, 3).map(t => `「${t}」`).join(', ') + (titles.length > 3 ? ` 외 ${titles.length - 3}편` : '');
  const noBackup = !readLS('pn.lastBackup', 0);
  if (!await ask(`원고 ${ids.length}편을 지울까요?`,
    `${list}\n원고와 거기에 한 필기가 모두 지워지고, 되돌릴 수 없어요.${noBackup ? '\n필요하면 먼저 설정 → 백업 만들기로 보관해 두세요.' : ''}`,
    `${ids.length}편 지우기`, true)) return;
  busy(`원고 ${ids.length}편을 지우는 중…`);
  try {
    for (const id of ids) await Promise.all([idb.del('docs', id), idb.del('files', id), idb.del('ink', id)]);
  } finally { busy(); }
  setLibSelect(false);
  toast(`원고 ${ids.length}편을 지웠어요`);
}
$('#btnSelect').onclick = () => setLibSelect(true);
$('#lbDone').onclick = () => setLibSelect(false);
$('#lbDel').onclick = deleteSelected;
$('#lbAll').onclick = () => {
  const vis = visibleIds(), all = vis.every(id => libSel.has(id));
  vis.forEach(id => all ? libSel.delete(id) : libSel.add(id));
  renderLibrary();
};
$('#lbPast').onclick = () => { pastDocs().forEach(d => libSel.add(d.id)); renderLibrary(); };
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
  const standalone = NATIVE || matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let used = '';
  try { const e = await navigator.storage?.estimate?.(); if (e?.usage) used = ` 지금 ${(e.usage / 1048576).toFixed(1)}MB 쓰는 중.`; } catch {}
  const last = readLS('pn.lastBackup', 0);
  foot.innerHTML = `
    <div><b>원고와 필기는 이 기기 안에만 저장돼요.</b>${used} 서버로 보내지 않아요.
      ${docsCache.length ? `<button class="linkbtn" data-act="backup">${last ? `마지막 백업 ${ago(last)} · 다시 백업하기` : '아직 백업하지 않았어요 · 백업하기'}</button>` : ''}</div>
    ${standalone ? '' : '<div>아이패드 Safari에서 <b>공유 → 홈 화면에 추가</b>로 설치해 두세요. 인터넷이 없어도 열리고, 저장한 원고가 지워지지 않게 보관돼요.</div>'}`;
  foot.querySelector('[data-act=backup]')?.addEventListener('click', makeBackup);
}
function cardMenu(anchor, d) {
  openMenu(anchor, m => {
    m.append(menuItem('#i-pen', '제목 바꾸기', async () => {
      const t = await dialog({ title: '제목 바꾸기', input: d.title, buttons: [{ label: '취소', value: null }, { label: '저장', cls: 'primary', value: 'input' }] });
      if (!t || t === d.title) return;
      await idb.put('docs', { ...d, title: t });
      renderLibrary();
    }));
    m.append(menuItem('#i-trash', '서재에서 지우기', async () => {
      if (!await ask('원고를 지울까요?', `「${d.title}」와 여기에 한 필기가 모두 지워져요. 되돌릴 수 없어요.`, '지우기', true)) return;
      await Promise.all([idb.del('docs', d.id), idb.del('files', d.id), idb.del('ink', d.id)]);
      renderLibrary();
      toast('지웠어요');
    }, 'danger'));
  });
}

async function importFiles(files, { open = true } = {}) {
  const list = [...files].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const nfc = f => f.name.normalize('NFC'); // 맥·iOS에서 온 한글 이름은 자모가 풀린(NFD) 채로 온다
  if (!list.length) { toast('PDF 파일만 불러올 수 있어요'); return; }
  navigator.storage?.persist?.().catch(() => {});
  const existing = await idb.all('docs');
  let added = 0, lastId = null;
  for (const f of list) {
    const dup = existing.find(d => d.name === nfc(f) && d.size === f.size);
    if (dup) {
      if (list.length === 1) { busy(); await renderLibrary(); return openDoc(dup.id); }
      toast(`이미 서재에 있어요 — ${f.name}`); continue;
    }
    busy(`불러오는 중… ${f.name}`);
    try {
      const buf = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ ...PDF_OPTS, data: new Uint8Array(buf.slice(0)) }).promise;
      const { crop, thumb } = await analyze(pdf, (i, n) => busy(`불러오는 중… ${f.name} (${i}/${n}쪽)`));
      const id = newId();
      const doc = { id, name: nfc(f), size: f.size, ...parseName(nfc(f)), pages: pdf.numPages, added: Date.now(), opened: 0, crop, cropOn: true, pos: null, thumb, inkCount: 0 };
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
  if (added === 1 && list.length === 1 && open) openDoc(lastId);
  else if (added > 1) toast(`원고 ${added}개를 불러왔어요`);
}

// 여백 자동 측정(모든 쪽 글자 영역의 합집합) + 첫 쪽 썸네일
async function analyze(pdf, onPage) {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  let bb = null;
  for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
    onPage?.(i, pdf.numPages);
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

// 앱에서는 파일 앱 선택 창을 직접 띄워 마지막으로 고른 폴더에서 열리게 한다(ios/App/App/FolderPicker.swift).
// 웹의 파일 입력 창은 시작 폴더를 정할 수 없어서, 웹판과 플러그인이 없을 때만 쓴다.
async function pickFiles(kind) {
  const P = plugin('FolderPicker');
  const { files = [] } = await P.pick({ kind, multiple: kind === 'pdf' });
  if (!files.length) return [];
  busy(kind === 'zip' ? '백업 파일을 읽는 중…' : '원고를 읽는 중…');
  const out = [];
  try {
    for (const f of files) {
      try {
        const blob = await fetch(Cap.convertFileSrc(f.path)).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
          .catch(async () => new Blob([base64ToBytes((await plugin('Filesystem').readFile({ path: f.path })).data)]));
        out.push(new File([blob], (f.name || '원고.pdf').normalize('NFC'), { type: kind === 'zip' ? 'application/zip' : 'application/pdf' }));
      } finally { plugin('Filesystem')?.deleteFile({ path: f.path }).catch(() => {}); }
    }
  } finally { busy(); }
  return out;
}
async function startImport() {
  if (!(NATIVE && plugin('FolderPicker'))) return fileInput.click();
  try {
    const files = await pickFiles('pdf');
    if (files.length) await importFiles(files);
  } catch (e) { console.error(e); busy(); toast('원고를 불러오지 못했어요', 2800); }
}
async function startRestore() {
  if (!(NATIVE && plugin('FolderPicker'))) return $('#restoreFile').click();
  try {
    const [f] = await pickFiles('zip');
    if (f) await restoreBackup(f);
  } catch (e) { console.error(e); busy(); toast('백업 파일을 열지 못했어요', 2800); }
}
$('#btnImport').onclick = startImport;
$('#empty [data-act=import]').onclick = startImport;
$('#empty [data-act=sample]').onclick = () => openGuide();
$('#empty [data-act=howto]').onclick = () => openPdfHowto();
$('#btnSettings').onclick = () => openSettings();
$$('#sortSeg button').forEach(b => b.onclick = () => { settings.sort = b.dataset.sort; saveSettings(); renderLibrary(); });
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
    R = { doc, pdf, ink: ink || { id, pages: {} }, pages: [], undo: [], redo: [], mode: 'prep', sel: null };
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
    showThumbs();
    refreshPalette();
    updateUndoUI();
    maybeCoach();
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
  markThumb();
}
async function closeDoc() {
  if (!R) return;
  flushSave(); savePos();
  setMode('prep', false);
  for (const P of R.pages) releasePage(P);
  const pdf = R.pdf;
  R = null;
  thumbToken++;
  $('#thumbsList').replaceChildren(); $('#thumbsList').dataset.sig = ''; $('#thumbs').hidden = true;
  pagesEl.replaceChildren();
  $('.coach')?.remove();
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
  // 옆으로 보던 자리(화면 가운데가 원고 폭의 몇 %였는지, 스크롤할 때마다 기억) — 돌리거나 미리보기를 여닫아도 그대로
  const cxf = R.hx ?? 0.5;
  const cs = getComputedStyle(pagesEl), padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const zoom = settings.zoom || 1;
  // 맞춤(100%) = 화면 폭에 딱. 상한 1600은 큰 모니터의 웹판용이라 아이패드(가로 13인치 1376)는 늘 폭을 꽉 채운다
  const avail = Math.round(Math.floor(Math.min(1600, scroller.clientWidth - padX)) * zoom);
  // 100%보다 크게 보면 옆으로도 움직일 수 있게
  pagesEl.style.width = zoom > 1 ? avail + padX + 'px' : '';
  scroller.classList.toggle('zoomed', zoom > 1);
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
  scroller.scrollLeft = zoom > 1 ? cxf * scroller.scrollWidth - scroller.clientWidth / 2 : 0;
  R.hx = cxf;
  renderSel();
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
  // 크게 확대하면 캔버스가 아이패드 한도(약 1,600만 화소)를 넘지 않게 해상도를 낮춘다
  let dpr = DPR();
  if (P.dw * P.dh * dpr * dpr > 14e6) dpr = Math.sqrt(14e6 / (P.dw * P.dh));
  P.dpr = dpr;
  const c = cropBox();
  const key = `${P.dw}x${P.dh}@${dpr.toFixed(3)}`;
  if (P.key === key) return;
  P.key = key;
  const k = P.s * dpr;
  P.ink.width = Math.round(P.dw * dpr);
  P.ink.height = Math.round(P.dh * dpr);
  P.ictx = P.ink.getContext('2d');
  P.ictx.setTransform(...inkTransform(P));
  redrawInk(P);
  renderPdf(P, key, k, c);
}
async function renderPdf(P, key, k, c) {
  P.task?.cancel();
  const cv = document.createElement('canvas');
  cv.className = 'pdf';
  cv.width = Math.round(P.dw * P.dpr);
  cv.height = Math.round(P.dh * P.dpr);
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
  if (R && scroller.scrollWidth > scroller.clientWidth + 1 && scroller.clientWidth === R.width) R.hx = (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth;
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
const thumbDirty = new Set();
function redrawInk(P, skip) {
  if (P.thumb && !skip) { thumbDirty.add(P); requestAnimationFrame(() => { for (const Q of thumbDirty) thumbInk(Q); thumbDirty.clear(); }); }
  const ctx = P.ictx;
  if (!ctx) return;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, P.ink.width, P.ink.height); ctx.restore();
  const list = R.ink.pages[P.i];
  if (!list?.length) return;
  for (const S of list) if (S.t === 'hl' && !skip?.has(S)) drawStroke(ctx, S, P); // 형광펜은 늘 펜 아래
  for (const S of list) if (S.t !== 'hl' && !skip?.has(S)) drawStroke(ctx, S, P);
}
// 필기 캔버스 좌표계: 쪽 단위(pt)로 그리면 여백 자르기·배율이 알아서 맞는다
function inkTransform(P) {
  const k = P.s * (P.dpr || DPR()), c = cropBox();
  return [k, 0, 0, k, -c.x0 * P.w * k, -c.y0 * P.h * k];
}
const r5 = v => Math.round(v * 1e5) / 1e5;
const r2 = v => Math.round(v * 100) / 100;

let live = null;           // 진행 중인 획·지우기·올가미·옮기기
let penSeen = 0;
const pan = { y: null };   // 손가락 쓰기 모드의 두 손가락 스크롤
let tap = null;            // 강단 모드 탭 넘기기 / 손가락 탭으로 선택 해제

function pointerRole(e) {
  if (!R) return null;
  if (R.mode === 'pulpit') return e.pointerType === 'pen' && settings.pulpitInk ? 'draw' : 'tap';
  if (e.pointerType === 'pen') return 'draw';
  if (e.pointerType === 'mouse') return e.button === 0 ? 'draw' : null;
  return settings.finger ? 'draw' : null;
}
const pagePt = (L, ev) => [(ev.clientX - L.rect.left) / L.P.s + L.ox, (ev.clientY - L.rect.top) / L.P.s + L.oy];
function inSelBox(x, y, pad = 26) {
  const b = R?.sel?.el?.getBoundingClientRect();
  return !!b && x >= b.left - pad && x <= b.right + pad && y >= b.top - pad && y <= b.bottom + pad;
}

pagesEl.addEventListener('pointerdown', e => {
  if (e.target.closest('.selbar')) return;
  if (e.target.closest('.selhandle') && R?.sel && !live) { startScale(e); return; }
  if (e.target.closest('.selrot') && R?.sel && !live) { startRotate(e); return; }
  const role = pointerRole(e);
  if (e.pointerType === 'pen' && settings.finger) {
    settings.finger = false; saveSettings(); refreshPalette();
    toast('애플펜슬이 감지돼 손가락 쓰기를 껐어요. 손가락은 넘기기용이에요.', 3200);
  }
  if (e.pointerType === 'pen') penSeen = Date.now();
  if (live && live.pt === 'touch' && e.pointerType === 'touch') { cancelLive(); return; } // 두 번째 손가락 → 스크롤
  if (role === 'tap') { tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), st: scroller.scrollTop }; return; }
  const onSel = R.mode === 'prep' && inSelBox(e.clientX, e.clientY);
  const touchMove = onSel && e.pointerType === 'touch'; // 고른 필기는 손가락으로도 옮길 수 있다
  if (role !== 'draw' && !touchMove) {
    if (R.sel && e.pointerType === 'touch') tap = { kind: 'desel', id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), st: scroller.scrollTop };
    return;
  }
  if (live) return;
  const el = e.target.closest('.page');
  if (!el) return;
  const P = R.pages[+el.dataset.i];
  if (!P.ictx) return;
  e.preventDefault();
  try { e.target.setPointerCapture(e.pointerId); } catch {}
  const r = el.getBoundingClientRect(), c = cropBox();
  live = { id: e.pointerId, pt: e.pointerType, P, rect: r, ox: c.x0 * P.w, oy: c.y0 * P.h, lastPr: null };
  const tool = settings.tool;
  if (onSel && R.sel.page === P.i && (tool === 'select' || touchMove)) startMove(e);
  else if (tool === 'select') { clearSel(); startLasso(e); }
  else if (tool === 'eraser') startErase(e);
  else startDraw(e, tool === 'hl');
});
pagesEl.addEventListener('pointermove', e => {
  if (!live) { hoverCursor(e); return; }
  if (e.pointerId !== live.id) return;
  if (live.kind === 'move') { moveMove(e); return; }
  if (live.kind === 'scale') { scaleMove(e); return; }
  if (live.kind === 'rotate') { rotateMove(e); return; }
  const evs = e.getCoalescedEvents?.();
  for (const ev of (evs?.length ? evs : [e])) {
    if (live.kind === 'erase') eraseMove(ev);
    else if (live.kind === 'lasso') lassoMove(ev);
    else addPoint(ev, true);
  }
});
pagesEl.addEventListener('pointerup', e => {
  if (tap && e.pointerId === tap.id) {
    const t = tap; tap = null;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) < 12 && performance.now() - t.t < 450 && Math.abs(scroller.scrollTop - t.st) < 4) {
      if (t.kind === 'desel') { clearSel(); return; }
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
pagesEl.addEventListener('pointerleave', () => { if (!live) hideECur(); });

// 펜슬이 닿으면 스크롤을 막고, 쓰는 동안 손바닥이 화면을 밀지 않게 한다
const pinch = { st: null };
const tDist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const tMid = t => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
scroller.addEventListener('touchstart', e => {
  if (e.target.closest?.('.selbar')) return;
  const stylus = [...e.changedTouches].some(t => t.touchType === 'stylus');
  if (R && e.touches.length === 2 && ![...e.touches].some(t => t.touchType === 'stylus')) {
    e.preventDefault();
    if (live?.pt === 'touch') cancelLive();
    tap = null;
    const [mx, my] = tMid(e.touches);
    pinch.st = { mode: 'wait', d0: tDist(e.touches), mx, my, fx: mx, fy: my, z0: settings.zoom || 1, z: settings.zoom || 1 };
    return;
  }
  if (stylus && R?.pages.length) { e.preventDefault(); return; }
  if (live) { e.preventDefault(); return; }
  if (R?.mode === 'prep' && e.touches.length === 1 && inSelBox(e.touches[0].clientX, e.touches[0].clientY)) { e.preventDefault(); return; }
  if (settings.finger && R?.mode === 'prep' && e.touches.length === 1 && e.target.closest?.('.page')) e.preventDefault();
}, { passive: false });
scroller.addEventListener('touchmove', e => {
  const st = pinch.st;
  if (st && e.touches.length >= 2) {
    e.preventDefault();
    const d = tDist(e.touches), [mx, my] = tMid(e.touches);
    if (st.mode === 'wait') {
      if (Math.abs(d / st.d0 - 1) > 0.08) { st.mode = 'pinch'; zoomPreviewStart(st.fx, st.fy); }
      else if (Math.hypot(mx - st.mx, my - st.my) > 10) st.mode = 'pan';
    }
    if (st.mode === 'pinch') { st.z = clamp(st.z0 * d / st.d0, ZMIN, ZMAX); pagesEl.style.transform = `scale(${st.z / st.z0})`; }
    else if (st.mode === 'pan') { scroller.scrollTop -= my - st.my; scroller.scrollLeft -= mx - st.mx; st.mx = mx; st.my = my; }
    return;
  }
  if (live) e.preventDefault();
}, { passive: false });
const endPinch = e => {
  const st = pinch.st;
  if (!st || e.touches.length >= 2) return;
  pinch.st = null;
  if (st.mode === 'pinch') { zoomPreviewEnd(); setZoom(st.z, st.fx, st.fy); }
};
scroller.addEventListener('touchend', endPinch);
scroller.addEventListener('touchcancel', endPinch);

// ── 확대·축소 (쪽 폭에 맞춘 크기 = 100%) ──
const ZMIN = 0.6, ZMAX = 2.5, ZSTEPS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5];
function zoomPreviewStart(fx, fy) {
  const r = scroller.getBoundingClientRect();
  pagesEl.style.transformOrigin = `${scroller.scrollLeft + fx - r.left - pagesEl.offsetLeft}px ${scroller.scrollTop + fy - r.top - pagesEl.offsetTop}px`;
}
function zoomPreviewEnd() { pagesEl.style.transform = ''; pagesEl.style.transformOrigin = ''; }
// fx, fy(화면 좌표)에 있던 글자가 확대 뒤에도 같은 자리에 오도록
function setZoom(z, fx, fy) {
  if (!R) return;
  z = clamp(Math.round(z * 100) / 100, ZMIN, ZMAX);
  const r = scroller.getBoundingClientRect();
  fx ??= r.left + r.width / 2; fy ??= r.top + r.height / 3;
  const cy = scroller.scrollTop + fy - r.top, cx = scroller.scrollLeft + fx - r.left;
  let P = R.pages[0];
  for (const Q of R.pages) if (Q.top <= cy) P = Q;
  const py = (cy - P.top) / P.dh, px = (cx - P.el.offsetLeft) / P.dw;
  settings.zoom = z; saveSettings();
  layout({ i: P.i, f: 0 });
  scroller.scrollTop = P.top + py * P.dh - (fy - r.top);
  scroller.scrollLeft = P.el.offsetLeft + px * P.dw - (fx - r.left);
  updateVisible();
  toast(`${Math.round(z * 100)}%`, 900);
}
function stepZoom(dir) {
  const z = settings.zoom || 1;
  if (!dir) return setZoom(1);
  const next = dir > 0 ? ZSTEPS.find(v => v > z + 0.001) : [...ZSTEPS].reverse().find(v => v < z - 0.001);
  if (next) setZoom(next);
}
// 맥: 트랙패드 두 손가락 벌리기(ctrl+휠) · 사파리 제스처
let wheelZ = null;
scroller.addEventListener('wheel', e => {
  if (!R || !e.ctrlKey) return;
  e.preventDefault();
  if (!wheelZ) { wheelZ = { z0: settings.zoom || 1, z: settings.zoom || 1, fx: e.clientX, fy: e.clientY, t: 0 }; zoomPreviewStart(e.clientX, e.clientY); }
  wheelZ.z = clamp(wheelZ.z * Math.exp(-e.deltaY * 0.01), ZMIN, ZMAX);
  pagesEl.style.transform = `scale(${wheelZ.z / wheelZ.z0})`;
  clearTimeout(wheelZ.t);
  wheelZ.t = setTimeout(() => { const w = wheelZ; wheelZ = null; zoomPreviewEnd(); setZoom(w.z, w.fx, w.fy); }, 160);
}, { passive: false });

// ── 쪽 미리보기(왼쪽 목록) ──
let thumbToken = 0;
function toggleThumbs(on = !settings.thumbs) {
  settings.thumbs = on; saveSettings();
  showThumbs();
  $('#btnThumbs').classList.toggle('on', on);
}
function showThumbs() {
  const box = $('#thumbs'), list = $('#thumbsList');
  box.hidden = !(settings.thumbs && R);
  $('#btnThumbs').classList.toggle('on', !box.hidden);
  if (box.hidden) return;
  const sig = `${R.doc.id}|${R.doc.cropOn}`;
  if (list.dataset.sig !== sig) {
    list.dataset.sig = sig;
    list.replaceChildren(...R.pages.map(P => {
      const b = document.createElement('button');
      b.className = 'th';
      b.innerHTML = '<span class="thc"><canvas class="tp"></canvas><canvas class="ti"></canvas></span><small></small>';
      b.querySelector('small').textContent = P.i + 1;
      b.onclick = () => scroller.scrollTo({ top: P.top - 8, behavior: 'smooth' });
      P.thumb = b;
      return b;
    }));
    renderThumbs(++thumbToken);
  }
  markThumb();
}
async function renderThumbs(token) {
  for (const P of R?.pages || []) {
    if (token !== thumbToken || !R) return;
    const c = cropBox(), TW = 104, dpr = 2, k = TW * dpr / ((c.x1 - c.x0) * P.w);
    const H = Math.round((c.y1 - c.y0) * P.h * k);
    const cv = P.thumb.querySelector('.tp'), ic = P.thumb.querySelector('.ti');
    cv.width = ic.width = TW * dpr; cv.height = ic.height = H;
    P.thumb.querySelector('.thc').style.aspectRatio = `${TW * dpr} / ${H}`;
    try {
      await P.page.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: P.page.getViewport({ scale: k }), transform: [1, 0, 0, 1, -c.x0 * P.w * k, -c.y0 * P.h * k], background: '#ffffff' }).promise;
    } catch {}
    P.thumbK = k;
    thumbInk(P);
  }
}
function thumbInk(P) {
  const ic = P.thumb?.querySelector('.ti');
  if (!ic || !P.thumbK || $('#thumbs').hidden) return;
  const ctx = ic.getContext('2d'), c = cropBox(), k = P.thumbK;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ic.width, ic.height);
  ctx.setTransform(k, 0, 0, k, -c.x0 * P.w * k, -c.y0 * P.h * k);
  const list = R.ink.pages[P.i] || [];
  for (const S of list) if (S.t === 'hl') drawStroke(ctx, S, P);
  for (const S of list) if (S.t !== 'hl') drawStroke(ctx, S, P);
}
function markThumb() {
  if ($('#thumbs').hidden || !R) return;
  const cur = curPage();
  R.pages.forEach(P => P.thumb?.classList.toggle('on', P.i === cur));
  const el = R.pages[cur]?.thumb, box = $('#thumbs');
  if (el && (el.offsetTop < box.scrollTop || el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight)) box.scrollTo({ top: el.offsetTop - 40, behavior: 'smooth' });
}

function finishLive() {
  const L = live; live = null;
  if (!L) return;
  if (L.kind === 'erase') return finishErase(L);
  if (L.kind === 'lasso') return finishLasso(L);
  if (L.kind === 'move') return finishMove(L, true);
  if (L.kind === 'scale') return finishScale(L, true);
  if (L.kind === 'rotate') return finishRotate(L, true);
  const { P, S } = L;
  if (!S.p.length) return;
  if (S.t === 'hl') straighten(S, P);
  S.p = S.p.map((v, i) => i % 3 === 2 ? r2(v) : r5(v));
  (R.ink.pages[P.i] ||= []).push(S);
  pushHist({ t: 'add', page: P.i, stroke: S });
  redrawInk(P);
}
function cancelLive() {
  const L = live; live = null;
  if (!L) return;
  if (L.kind === 'erase') return finishErase(L);
  if (L.kind === 'lasso') { L.svg.remove(); return; }
  if (L.kind === 'move') return finishMove(L, false);
  if (L.kind === 'scale') return finishScale(L, false);
  if (L.kind === 'rotate') return finishRotate(L, false);
  redrawInk(L.P);
}

// ── 펜·형광펜 ──
function startDraw(e, hl) {
  const P = live.P;
  live.kind = 'draw';
  live.S = { t: hl ? 'hl' : 'pen', c: hl ? settings.hlColor : settings.penColor, w: hl ? settings.hlW : settings.penW, p: [] };
  addPoint(e);
  strokeStyle(P.ictx, live.S);
  drawDot(P.ictx, live.S, P);
}
function addPoint(ev, draw) {
  const L = live, P = L.P, S = L.S;
  const [x, y] = pagePt(L, ev);
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
// 형광펜을 대충 곧게 그었다면 반듯한 직선으로(거의 수평이면 수평으로). 너그럽게 본다:
// - 펜을 대고 뗄 때 생기는 양 끝 삐침은 판단에서 뺀다(굵기 1.5배와 쪽 폭 2.5%≈5mm 중 큰 값, 전체 길이 15%까지)
// - 시작·끝점을 잇는 대신 가운데 부분 전체에 가장 잘 맞는 직선(주축)으로 흔들림을 잰다
// - 허용 흔들림 = 굵기의 70% · 길이의 3% · 쪽 폭의 1% 가운데 큰 값(가는 형광펜도 너무 빡빡하지 않게)
// 그대로 두는 것: 짧은 획 · 왕복 칠하기 · 동그라미 · 굵기의 80% 넘게 휜 곡선 · 크게 출렁이는 물결
function straighten(S, P) {
  const n = S.p.length / 3;
  if (n < 3) return;
  const pts = Array.from({ length: n }, (_, k) => ptAt(S, P, k)), w = S.w * P.w;
  const acc = [0];
  for (let k = 1; k < n; k++) acc.push(acc[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const arc = acc[n - 1], trim = Math.min(arc * 0.15, Math.max(w * 1.5, P.w * 0.025));
  let core = pts.filter((_, k) => acc[k] >= trim && acc[k] <= arc - trim);
  if (core.length < 3) core = pts;
  let mx = 0, my = 0;
  for (const [x, y] of core) { mx += x; my += y; }
  mx /= core.length; my /= core.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of core) { const dx = x - mx, dy = y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
  const along = ([x, y]) => (x - mx) * ux + (y - my) * uy, across = ([x, y]) => (y - my) * ux - (x - mx) * uy;
  let t0 = Infinity, t1 = -Infinity;
  for (const p of pts) { const t = along(p); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  const len = t1 - t0;
  if (len < w * 2) return;                                   // 너무 짧은 획
  // 왕복 칠하기 · 동그라미: 그은 방향을 거슬러 되돌아간 거리가 크다
  const dir = Math.sign(along(core[core.length - 1]) - along(core[0])) || 1;
  let back = 0;
  for (let k = 1; k < core.length; k++) back += Math.max(0, -dir * (along(core[k]) - along(core[k - 1])));
  if (back > len * 0.2 + w * 0.5) return;
  // 흔들림: 가장 잘 맞는 직선에서 너무 멀리 벗어난 곳이 없어야
  const tol = Math.max(w * 0.7, len * 0.03, P.w * 0.01);
  for (const p of core) if (Math.abs(across(p)) > tol) return;
  // 휜 정도: 가운데 부분에 포물선을 맞춰 전체 길이에서 얼마나 볼록한지 잰다
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, v0 = 0, v1 = 0, v2 = 0;
  for (const p of core) { const u = along(p), v = across(p), u2 = u * u; s1 += u; s2 += u2; s3 += u2 * u; s4 += u2 * u2; v0 += v; v1 += u * v; v2 += u2 * v; }
  const s0 = core.length, det3 = (a, b, c, d, e, f, g, h, i) => a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const D = det3(s4, s3, s2, s3, s2, s1, s2, s1, s0);
  if (Math.abs(D) > 1e-9) {
    const a = det3(v2, s3, s2, v1, s2, s1, v0, s1, s0) / D;
    if (Math.abs(a) * (len / 2) ** 2 > Math.max(w * 0.8, len * 0.03)) return;
  }
  if (along(pts[0]) > along(pts[n - 1])) [t0, t1] = [t1, t0]; // 그은 방향 유지
  const A = [mx + ux * t0, my + uy * t0], B = [mx + ux * t1, my + uy * t1];
  if (Math.abs(uy) < 0.14) A[1] = B[1] = my;                 // 약 8° 안쪽이면 수평으로
  S.p = [A[0] / P.w, A[1] / P.h, 0.5, B[0] / P.w, B[1] / P.h, 0.5];
}

// ── 획 기하 ──
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
const halfW = (S, P) => S.w * P.w * (S.t === 'pen' ? 0.8 : 0.5); // 필압으로 굵어진 펜까지 덮는 반폭
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function strokeHit(S, P, x, y, r) {
  const rr = r + halfW(S, P);
  const b = strokeBB(S, P);
  if (x < b[0] - rr || x > b[2] + rr || y < b[1] - rr || y > b[3] + rr) return false;
  const n = S.p.length / 3;
  if (n === 1) return Math.hypot(x - S.p[0] * P.w, y - S.p[1] * P.h) <= rr;
  for (let k = 0; k < n - 1; k++) {
    if (segDist(x, y, S.p[k * 3] * P.w, S.p[k * 3 + 1] * P.h, S.p[k * 3 + 3] * P.w, S.p[k * 3 + 4] * P.h) <= rr) return true;
  }
  return false;
}
// 선분 a→b 가 원 안에 드는 구간 [t0, t1] (0~1), 없으면 null
function segCircle(a, b, cx, cy, R2) {
  const dx = b[0] - a[0], dy = b[1] - a[1], fx = a[0] - cx, fy = a[1] - cy;
  const A = dx * dx + dy * dy, C = fx * fx + fy * fy - R2 * R2;
  if (A < 1e-12) return C <= 0 ? [0, 1] : null;
  const B = 2 * (fx * dx + fy * dy), disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc), t0 = (-B - sq) / (2 * A), t1 = (-B + sq) / (2 * A);
  if (t1 < 0 || t0 > 1) return null;
  return [Math.max(0, t0), Math.min(1, t1)];
}
// 연필 지우개: 원이 닿은 구간만 잘라 내고 남은 조각을 새 획으로 돌려준다(안 닿으면 null)
function cutStroke(S, P, cx, cy, r) {
  const R2 = r + halfW(S, P), b = strokeBB(S, P);
  if (cx < b[0] - R2 || cx > b[2] + R2 || cy < b[1] - R2 || cy > b[3] + R2) return null;
  const n = S.p.length / 3;
  const pt = k => [S.p[k * 3] * P.w, S.p[k * 3 + 1] * P.h, S.p[k * 3 + 2]];
  if (n === 1) { const [x, y] = pt(0); return (x - cx) ** 2 + (y - cy) ** 2 <= R2 * R2 ? [] : null; }
  const lerp = (a, c, t) => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
  const pieces = [];
  let cur = [], cut = false, a = pt(0);
  if ((a[0] - cx) ** 2 + (a[1] - cy) ** 2 > R2 * R2) cur.push(a);
  for (let k = 0; k < n - 1; k++) {
    const c = pt(k + 1), iv = segCircle(a, c, cx, cy, R2);
    if (!iv) cur.push(c);
    else {
      cut = true;
      if (iv[0] > 0) cur.push(lerp(a, c, iv[0]));
      if (cur.length) pieces.push(cur);
      cur = iv[1] < 1 ? [lerp(a, c, iv[1]), c] : [];
    }
    a = c;
  }
  if (!cut) return null;
  if (cur.length) pieces.push(cur);
  const minLen = 0.4;
  return pieces
    .filter(pc => pc.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pc[i][0], q[1] - pc[i][1]), 0) >= minLen)
    .map(pc => ({ ...S, p: pc.flatMap(([x, y, pr]) => [r5(x / P.w), r5(y / P.h), r2(pr)]) }));
}

// ── 지우개 ──
const ecur = Object.assign(document.createElement('div'), { className: 'ecur', hidden: true });
function showECur(P, dx, dy) {
  const rad = settings.eraseR * P.w * P.s;
  if (ecur.parentNode !== P.el) P.el.append(ecur);
  Object.assign(ecur.style, { left: dx - rad + 'px', top: dy - rad + 'px', width: rad * 2 + 'px', height: rad * 2 + 'px' });
  ecur.hidden = false;
}
function hideECur() { ecur.hidden = true; }
function hoverCursor(e) {
  if (!R || R.mode !== 'prep' || settings.tool !== 'eraser' || e.buttons || !(e.pointerType === 'pen' || e.pointerType === 'mouse')) return hideECur();
  const el = e.target.closest?.('.page');
  if (!el) return hideECur();
  const r = el.getBoundingClientRect();
  showECur(R.pages[+el.dataset.i], e.clientX - r.left, e.clientY - r.top);
}
function startErase(e) {
  const P = live.P;
  Object.assign(live, { kind: 'erase', before: [...(R.ink.pages[P.i] || [])], last: null, changed: false });
  eraseMove(e);
}
function eraseMove(ev) {
  const L = live, P = L.P;
  const [x, y] = pagePt(L, ev);
  const r = settings.eraseR * P.w;
  showECur(P, (x - L.ox) * P.s, (y - L.oy) * P.s);
  const pts = [[x, y]];
  if (L.last) {
    const d = Math.hypot(x - L.last[0], y - L.last[1]), steps = Math.floor(d / (r * 0.5));
    for (let s = 1; s < steps; s++) pts.push([L.last[0] + (x - L.last[0]) * s / steps, L.last[1] + (y - L.last[1]) * s / steps]);
  }
  L.last = [x, y];
  const list = R.ink.pages[P.i];
  if (!list?.length) return;
  let hit = false;
  if (settings.eraseMode === 'stroke') {
    for (let j = list.length - 1; j >= 0; j--) {
      if (pts.some(([px, py]) => strokeHit(list[j], P, px, py, r))) { list.splice(j, 1); hit = true; }
    }
  } else {
    for (const [px, py] of pts) for (let j = list.length - 1; j >= 0; j--) {
      const pieces = cutStroke(list[j], P, px, py, r);
      if (pieces) { list.splice(j, 1, ...pieces); hit = true; }
    }
  }
  if (hit) { L.changed = true; redrawInk(P); }
}
function finishErase(L) {
  hideECur();
  if (L.changed) pushHist({ t: 'snap', page: L.P.i, before: L.before, after: [...(R.ink.pages[L.P.i] || [])] });
}

// ── 올가미로 고르기 ──
const SVGNS = 'http://www.w3.org/2000/svg';
function startLasso(e) {
  const L = live;
  L.kind = 'lasso';
  L.pts = [pagePt(L, e)];
  L.svg = document.createElementNS(SVGNS, 'svg');
  L.svg.setAttribute('class', 'lasso');
  L.poly = document.createElementNS(SVGNS, 'polygon');
  L.svg.append(L.poly);
  L.P.el.append(L.svg);
}
function lassoMove(ev) {
  const L = live, P = L.P, [x, y] = pagePt(L, ev), last = L.pts[L.pts.length - 1];
  if (Math.hypot(x - last[0], y - last[1]) < 2 / P.s) return;
  L.pts.push([x, y]);
  L.poly.setAttribute('points', L.pts.map(([px, py]) => `${((px - L.ox) * P.s).toFixed(1)},${((py - L.oy) * P.s).toFixed(1)}`).join(' '));
}
function pointInPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function insideRatio(S, P, poly) {
  const n = S.p.length / 3;
  let inn = 0, tot = 0;
  for (let k = 0; k < n; k++) {
    const x = S.p[k * 3] * P.w, y = S.p[k * 3 + 1] * P.h;
    tot++; if (pointInPoly(x, y, poly)) inn++;
    if (k < n - 1) { // 점이 성긴 획(곧게 편 형광펜)도 고르게 세도록 중간점까지
      tot++; if (pointInPoly((x + S.p[k * 3 + 3] * P.w) / 2, (y + S.p[k * 3 + 4] * P.h) / 2, poly)) inn++;
    }
  }
  return inn / tot;
}
function finishLasso(L) {
  L.svg.remove();
  const P = L.P, list = R.ink.pages[P.i] || [];
  let len = 0;
  for (let k = 1; k < L.pts.length; k++) len += Math.hypot(L.pts[k][0] - L.pts[k - 1][0], L.pts[k][1] - L.pts[k - 1][1]);
  const set = new Set();
  if (len * P.s < 12) { // 톡 누르면 그 자리의 획 하나
    const [x, y] = L.pts[0];
    for (let j = list.length - 1; j >= 0; j--) if (strokeHit(list[j], P, x, y, 8 / P.s)) { set.add(list[j]); break; }
  } else {
    for (const S of list) if (insideRatio(S, P, L.pts) >= 0.5) set.add(S);
  }
  if (!set.size) { if (len * P.s >= 12) toast('둘러싼 곳에 선택할 필기가 없어요', 1400); return; }
  R.sel = { page: P.i, set };
  renderSel();
}
function selBounds(P, set) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const S of set) {
    const s = strokeBB(S, P), h = halfW(S, P);
    b[0] = Math.min(b[0], s[0] - h); b[1] = Math.min(b[1], s[1] - h);
    b[2] = Math.max(b[2], s[2] + h); b[3] = Math.max(b[3], s[3] + h);
  }
  return b;
}
function renderSel() {
  R?.sel?.el?.remove();
  if (!R?.sel) return;
  const P = R.pages[R.sel.page], c = cropBox(), b = selBounds(P, R.sel.set), pad = 6;
  const el = document.createElement('div');
  el.className = 'selbox';
  const top = (b[1] - c.y0 * P.h) * P.s - pad;
  Object.assign(el.style, {
    left: (b[0] - c.x0 * P.w) * P.s - pad + 'px', top: top + 'px',
    width: (b[2] - b[0]) * P.s + pad * 2 + 'px', height: (b[3] - b[1]) * P.s + pad * 2 + 'px',
  });
  if (top < 56) el.classList.add('below');
  el.innerHTML = `<div class="selbar"><span class="cnt"></span>
    <button data-a="del"><svg class="i"><use href="#i-trash"/></svg>지우기</button>
    <button data-a="off" aria-label="선택 해제"><svg class="i"><use href="#i-x"/></svg></button></div>
    <span class="selhandle" aria-label="크기 조절"></span>
    <span class="selrot" aria-label="회전"><svg class="i"><use href="#i-rotate"/></svg></span>`;
  el.querySelector('.cnt').textContent = `${R.sel.set.size}획 선택 · 끌면 이동 · ◢ 크기 · ↻ 회전`;
  el.querySelector('[data-a=del]').onclick = deleteSel;
  el.querySelector('[data-a=off]').onclick = clearSel;
  P.el.append(el);
  R.sel.el = el;
  // 선택 상자가 쪽 가장자리에 붙어 있으면 도구 막대가 화면 밖으로 나가지 않게 민다
  const bar = el.querySelector('.selbar'), pr = P.el.getBoundingClientRect(), br = bar.getBoundingClientRect();
  const shift = Math.max(0, pr.left + 4 - br.left) - Math.max(0, br.right - (pr.right - 4));
  if (shift) bar.style.marginLeft = shift + 'px';
}
function clearSel() {
  if (!R?.sel) return;
  R.sel.el?.remove();
  R.sel = null;
}
function deleteSel() {
  if (!R?.sel) return;
  const P = R.pages[R.sel.page], list = R.ink.pages[P.i] || [];
  const after = list.filter(S => !R.sel.set.has(S));
  R.ink.pages[P.i] = after;
  pushHist({ t: 'snap', page: P.i, before: [...list], after: [...after] });
  const n = list.length - after.length;
  clearSel();
  redrawInk(P);
  toast(`${n}획을 지웠어요`, 1400);
}

// ── 고른 필기 옮기기: 끄는 동안은 따로 뜬 캔버스만 움직이고, 놓을 때 좌표를 고친다 ──
function startMove(e) {
  const L = live, P = L.P, set = R.sel.set;
  Object.assign(L, { kind: 'move', sx: e.clientX, sy: e.clientY, dx: 0, dy: 0 });
  const f = document.createElement('canvas');
  f.className = 'ink float';
  f.width = P.ink.width; f.height = P.ink.height;
  const fc = f.getContext('2d');
  fc.setTransform(...inkTransform(P));
  for (const S of set) if (S.t === 'hl') drawStroke(fc, S, P);
  for (const S of set) if (S.t !== 'hl') drawStroke(fc, S, P);
  R.sel.el.before(f);
  L.float = f;
  redrawInk(P, set);
  const b = selBounds(P, set), c = cropBox();
  L.lim = [
    Math.min(0, (c.x0 * P.w - b[0]) * P.s), Math.max(0, (c.x1 * P.w - b[2]) * P.s),
    Math.min(0, (c.y0 * P.h - b[1]) * P.s), Math.max(0, (c.y1 * P.h - b[3]) * P.s),
  ];
}
function moveMove(ev) {
  const L = live;
  L.dx = clamp(ev.clientX - L.sx, L.lim[0], L.lim[1]);
  L.dy = clamp(ev.clientY - L.sy, L.lim[2], L.lim[3]);
  L.float.style.transform = R.sel.el.style.transform = `translate(${L.dx}px, ${L.dy}px)`;
}
function finishMove(L, commit) {
  const P = L.P;
  L.float.remove();
  if (R.sel?.el) R.sel.el.style.transform = '';
  if (!commit || (Math.abs(L.dx) < 1 && Math.abs(L.dy) < 1)) { redrawInk(P); return; }
  const ddx = L.dx / P.s / P.w, ddy = L.dy / P.s / P.h;
  const list = R.ink.pages[P.i], before = [...list], set = new Set();
  for (let j = 0; j < list.length; j++) {
    const S = list[j];
    if (!R.sel.set.has(S)) continue;
    list[j] = { ...S, p: S.p.map((v, k) => k % 3 === 0 ? r5(v + ddx) : k % 3 === 1 ? r5(v + ddy) : v) };
    set.add(list[j]);
  }
  R.sel.set = set;
  pushHist({ t: 'snap', page: P.i, before, after: [...list] });
  redrawInk(P);
  renderSel();
}

// ── 고른 필기 크기 조절: 왼쪽 위 모서리를 고정하고 오른쪽 아래 손잡이로 늘리고 줄인다 ──
function startScale(e) {
  const el = e.target.closest('.page'), P = R.pages[R.sel.page];
  if (!el || +el.dataset.i !== P.i || !P.ictx) return;
  e.preventDefault();
  try { e.target.setPointerCapture(e.pointerId); } catch {}
  const r = el.getBoundingClientRect(), c = cropBox(), set = R.sel.set, b = selBounds(P, set);
  live = { id: e.pointerId, pt: e.pointerType, P, rect: r, ox: c.x0 * P.w, oy: c.y0 * P.h, kind: 'scale', s: 1, b };
  const f = document.createElement('canvas');
  f.className = 'ink float';
  f.width = P.ink.width; f.height = P.ink.height;
  const fc = f.getContext('2d');
  fc.setTransform(...inkTransform(P));
  for (const S of set) if (S.t === 'hl') drawStroke(fc, S, P);
  for (const S of set) if (S.t !== 'hl') drawStroke(fc, S, P);
  f.style.transformOrigin = `${(b[0] - live.ox) * P.s}px ${(b[1] - live.oy) * P.s}px`;
  R.sel.el.before(f);
  R.sel.el.classList.add('sel-active');
  live.float = f;
  redrawInk(P, set);
  // 쪽(보이는 영역) 밖으로 나가지 않는 최대 배율
  live.sMax = Math.min(4, (c.x1 * P.w - b[0]) / (b[2] - b[0] || 1), (c.y1 * P.h - b[1]) / (b[3] - b[1] || 1));
}
function scaleMove(ev) {
  const L = live, P = L.P, b = L.b, [x, y] = pagePt(L, ev);
  const dx = b[2] - b[0], dy = b[3] - b[1];
  const s = ((x - b[0]) * dx + (y - b[1]) * dy) / (dx * dx + dy * dy || 1);
  L.s = clamp(s, 0.25, Math.max(1, L.sMax));
  L.float.style.transform = `scale(${L.s})`;
  const pad = 6;
  Object.assign(R.sel.el.style, { width: dx * L.s * P.s + pad * 2 + 'px', height: dy * L.s * P.s + pad * 2 + 'px' });
}
function finishScale(L, commit) {
  const P = L.P, b = L.b, s = L.s;
  L.float.remove();
  if (!commit || Math.abs(s - 1) < 0.01) { redrawInk(P); renderSel(); return; }
  const list = R.ink.pages[P.i], before = [...list], set = new Set();
  for (let j = 0; j < list.length; j++) {
    const S = list[j];
    if (!R.sel.set.has(S)) continue;
    const p = S.p.map((v, k) => k % 3 === 0 ? r5((b[0] + (v * P.w - b[0]) * s) / P.w) : k % 3 === 1 ? r5((b[1] + (v * P.h - b[1]) * s) / P.h) : v);
    list[j] = { ...S, w: r5(Math.max(0.0005, S.w * s)), p };
    set.add(list[j]);
  }
  R.sel.set = set;
  pushHist({ t: 'snap', page: P.i, before, after: [...list] });
  redrawInk(P);
  renderSel();
}

// ── 고른 필기 회전: 선택 상자 가운데를 축으로, 왼쪽 아래 ↻ 손잡이를 돌린다(0·90·180°에 달라붙음) ──
function startRotate(e) {
  const el = e.target.closest('.page'), P = R.pages[R.sel.page];
  if (!el || +el.dataset.i !== P.i || !P.ictx) return;
  e.preventDefault();
  try { e.target.setPointerCapture(e.pointerId); } catch {}
  const r = el.getBoundingClientRect(), c = cropBox(), set = R.sel.set, b = selBounds(P, set);
  live = { id: e.pointerId, pt: e.pointerType, P, rect: r, ox: c.x0 * P.w, oy: c.y0 * P.h, kind: 'rotate', deg: 0, cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2 };
  const [x, y] = pagePt(live, e);
  live.a0 = Math.atan2(y - live.cy, x - live.cx);
  const f = document.createElement('canvas');
  f.className = 'ink float';
  f.width = P.ink.width; f.height = P.ink.height;
  const fc = f.getContext('2d');
  fc.setTransform(...inkTransform(P));
  for (const S of set) if (S.t === 'hl') drawStroke(fc, S, P);
  for (const S of set) if (S.t !== 'hl') drawStroke(fc, S, P);
  f.style.transformOrigin = `${(live.cx - live.ox) * P.s}px ${(live.cy - live.oy) * P.s}px`;
  R.sel.el.before(f);
  R.sel.el.classList.add('sel-active');
  live.lab = Object.assign(document.createElement('span'), { className: 'selangle', textContent: '0°' });
  R.sel.el.append(live.lab);
  live.float = f;
  redrawInk(P, set);
}
function rotateMove(ev) {
  const L = live, [x, y] = pagePt(L, ev);
  let deg = (Math.atan2(y - L.cy, x - L.cx) - L.a0) * 180 / Math.PI;
  deg = ((deg + 540) % 360) - 180; // -180 ~ 180
  for (const m of [-180, -90, 0, 90, 180]) if (Math.abs(deg - m) < 4) deg = m;
  L.deg = deg;
  L.float.style.transform = R.sel.el.style.transform = `rotate(${deg}deg)`;
  L.lab.textContent = `${Math.round(deg)}°`;
  L.lab.style.transform = `translate(-50%, -50%) rotate(${-deg}deg)`;
}
function finishRotate(L, commit) {
  const P = L.P;
  L.float.remove();
  if (!commit || Math.abs(L.deg) < 0.5) { redrawInk(P); renderSel(); return; }
  const t = L.deg * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t);
  const list = R.ink.pages[P.i], before = [...list], set = new Set();
  for (let j = 0; j < list.length; j++) {
    const S = list[j];
    if (!R.sel.set.has(S)) continue;
    const p = S.p.slice();
    for (let k = 0; k < p.length; k += 3) {
      const X = p[k] * P.w - L.cx, Y = p[k + 1] * P.h - L.cy;
      p[k] = r5((L.cx + X * cos - Y * sin) / P.w);
      p[k + 1] = r5((L.cy + X * sin + Y * cos) / P.h);
    }
    list[j] = { ...S, p };
    set.add(list[j]);
  }
  R.sel.set = set;
  pushHist({ t: 'snap', page: P.i, before, after: [...list] });
  redrawInk(P);
  renderSel();
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
  if (h.t === 'add') {
    touched.add(h.page);
    const l = (pages[h.page] ||= []);
    if (reverse) { const j = l.lastIndexOf(h.stroke); if (j >= 0) l.splice(j, 1); }
    else l.push(h.stroke);
  } else if (h.t === 'snap') {
    pages[h.page] = [...(reverse ? h.before : h.after)];
    touched.add(h.page);
  } else if (h.t === 'clear') {
    for (const it of h.items) { pages[it.page] = reverse ? [...it.strokes] : []; touched.add(it.page); }
  }
  for (const i of touched) redrawInk(R.pages[i]);
}
function undo() { const h = R?.undo.pop(); if (!h) return; clearSel(); applyHist(h, true); R.redo.push(h); afterInkChange(); }
function redo() { const h = R?.redo.pop(); if (!h) return; clearSel(); applyHist(h, false); R.undo.push(h); afterInkChange(); }
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
  R.doc.inkPages = Object.keys(pages).length; // 서재 카드에 '필기 N쪽'
  idb.put('ink', R.ink).catch(e => { console.error(e); toast('필기를 저장하지 못했어요. 저장 공간을 확인해 주세요.', 3500); });
  idb.put('docs', R.doc);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushSave(); savePos(); } });
addEventListener('pagehide', () => { flushSave(); savePos(); });

// ── 도구 팔레트 ──
const palette = $('#palette');
const SIZE_KEY = { pen: 'penW', hl: 'hlW', eraser: 'eraseR' };
const SIZE_RANGE = { pen: [0.0012, 0.012], hl: [0.008, 0.05], eraser: [0.004, 0.05] }; // 쪽 폭 대비(지우개는 반지름)
const sizeToF = (t, v) => { const [lo, hi] = SIZE_RANGE[t]; return 100 * Math.log(v / lo) / Math.log(hi / lo); };
const fToSize = (t, f) => { const [lo, hi] = SIZE_RANGE[t]; return lo * (hi / lo) ** (f / 100); };
// 굵기를 pt(1/72인치)로: 원고 쪽 폭(pt) × 비율. 지우개는 지름
const refPageW = () => (R && R.pages[curPage()]?.w) || 595.3;
const sizePt = (t, v) => (t === 'eraser' ? 2 : 1) * v * refPageW();
const ptToSize = (t, pt) => pt / ((t === 'eraser' ? 2 : 1) * refPageW());
const fmtPt = pt => (pt < 10 ? pt.toFixed(1) : String(Math.round(pt)));
const PT_STEP = { pen: 0.1, hl: 1, eraser: 2 };

function setTool(t) {
  settings.tool = t; saveSettings();
  if (t !== 'select') clearSel();
  hideECur();
  refreshPalette();
}
function refreshPalette() {
  const t = settings.tool;
  $$('.tool[data-tool]', palette).forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  $('.tool[data-tool=pen] .tip', palette).style.setProperty('--c', settings.penColor);
  $('.tool[data-tool=hl] .tip', palette).style.setProperty('--c', settings.hlColor);
  const opts = $('#opts');
  if (t === 'pen' || t === 'hl') {
    const hl = t === 'hl', colors = hl ? HL_COLORS : PEN_COLORS, cur = hl ? settings.hlColor : settings.penColor;
    const sw = document.createElement('div');
    sw.className = 'swatches';
    sw.append(...colors.map(c => {
      const b = document.createElement('button');
      b.className = 'sw' + (c === cur ? ' on' : '');
      b.innerHTML = '<i></i>';
      b.style.setProperty('--c', c);
      b.setAttribute('aria-label', '색');
      b.onclick = () => { settings[hl ? 'hlColor' : 'penColor'] = c; saveSettings(); refreshPalette(); };
      return b;
    }));
    opts.replaceChildren(sw);
  } else if (t === 'eraser') {
    const seg = document.createElement('div');
    seg.className = 'emode';
    for (const [v, label] of [['part', '부분'], ['stroke', '획 전체']]) {
      const b = Object.assign(document.createElement('button'), { textContent: label, className: settings.eraseMode === v ? 'on' : '' });
      b.onclick = () => {
        settings.eraseMode = v; saveSettings(); refreshPalette();
        toast(v === 'part' ? '닿은 부분만 지워요 (연필 지우개처럼)' : '닿은 획을 통째로 지워요', 1600);
      };
      seg.append(b);
    }
    opts.replaceChildren(seg);
  } else {
    opts.replaceChildren(Object.assign(document.createElement('span'), { className: 'hint', textContent: '펜슬로 둘러싸서 선택' }));
  }
  const k = SIZE_KEY[t];
  $('#btnSize').hidden = !k;
  if (k) {
    $('#btnSize em').textContent = fmtPt(sizePt(t, settings[k]));
    const px = 4 + sizeToF(t, settings[k]) / 100 * 14;
    Object.assign($('#btnSize i').style, {
      width: (t === 'hl' ? px * 1.5 : px) + 'px', height: px + 'px',
      background: t === 'pen' ? settings.penColor : t === 'hl' ? settings.hlColor : 'transparent',
      border: t === 'eraser' ? '1.5px solid var(--ink-2)' : '0',
      borderRadius: t === 'hl' ? '3px' : '50%',
    });
  }
  $('#btnFinger').classList.toggle('on', settings.finger);
}
$$('.tool[data-tool]', palette).forEach(b => b.onclick = () => setTool(b.dataset.tool));
// 굵기 슬라이더 — 미리보기 점은 지금 화면에서 실제로 그려질 크기
$('#btnSize').onclick = e => {
  const t = settings.tool, k = SIZE_KEY[t];
  if (!k || !R) return;
  openMenu(e.currentTarget, m => {
    m.append(Object.assign(document.createElement('div'), { className: 'lbl', textContent: { pen: '펜 굵기', hl: '형광펜 굵기', eraser: '지우개 크기' }[t] }));
    const row = document.createElement('div');
    row.className = 'sizepop';
    row.innerHTML = `<span class="prev"><i></i></span><div class="szcol">
      <input type="range" min="0" max="100" step="1" aria-label="크기">
      <div class="szrow"><button data-d="-1" aria-label="가늘게">−</button><b class="pt"></b><button data-d="1" aria-label="굵게">+</button></div></div>`;
    const inp = row.querySelector('input'), dot = row.querySelector('.prev i'), ptEl = row.querySelector('.pt');
    const P = R.pages[curPage()];
    const [lo, hi] = SIZE_RANGE[t];
    row.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
      const step = PT_STEP[t], cur = Math.round(sizePt(t, settings[k]) / step) * step;
      settings[k] = r5(clamp(ptToSize(t, cur + step * +b.dataset.d), lo, hi));
      inp.value = sizeToF(t, settings[k]);
      saveSettings(); show(); refreshPalette();
    });
    const show = () => {
      ptEl.textContent = `${t === 'eraser' ? '지름 ' : ''}${fmtPt(sizePt(t, settings[k]))} pt`;
      const d = Math.max(2, (t === 'eraser' ? 2 : 1) * settings[k] * P.w * P.s);
      Object.assign(dot.style, {
        width: (t === 'hl' ? Math.max(d * 1.6, 36) : d) + 'px', height: d + 'px',
        background: t === 'pen' ? settings.penColor : t === 'hl' ? settings.hlColor : 'rgba(255,255,255,.6)',
        border: t === 'eraser' ? '1.5px solid var(--ink-2)' : '0',
        borderRadius: t === 'hl' ? '3px' : '50%',
      });
    };
    inp.value = sizeToF(t, settings[k]);
    inp.oninput = () => { settings[k] = r5(fToSize(t, +inp.value)); saveSettings(); show(); refreshPalette(); };
    show();
    m.append(row);
  });
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
  // 강단 화면에는 위쪽 막대에 서재 버튼을 두지 않는다(설교 중 잘못 눌러 원고가 닫히지 않게) — 메뉴 안에서만
  if (R.mode === 'pulpit') {
    m.append(menuItem('#i-back', '서재로 돌아가기', closeDoc));
    m.append(document.createElement('hr'));
  }
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
  const zr = h('div', 'zoomrow');
  zr.innerHTML = `<svg class="i"><use href="#i-zoom"/></svg><span>확대 · 축소</span>
    <button data-z="-1" aria-label="작게">−</button><b></b><button data-z="1" aria-label="크게">+</button><button data-z="0" class="fit">맞춤</button>`;
  const zlabel = () => { zr.querySelector('b').textContent = Math.round((settings.zoom || 1) * 100) + '%'; };
  zr.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { stepZoom(+b.dataset.z); zlabel(); });
  zlabel();
  m.append(zr);
  m.append(menuItem('#i-side', '쪽 미리보기', () => toggleThumbs(), '', Object.assign(document.createElement('span'), { className: 'toggle' + (settings.thumbs ? ' on' : '') })));
  m.append(menuItem('#i-pen', '강단에서도 펜슬로 필기', () => {
    settings.pulpitInk = !settings.pulpitInk; saveSettings();
    toast(settings.pulpitInk ? '강단 화면에서도 펜슬로 쓸 수 있어요' : '강단 화면에서는 펜슬도 탭하면 넘어가요', 2400);
  }, '', Object.assign(document.createElement('span'), { className: 'toggle' + (settings.pulpitInk ? ' on' : '') })));
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
  showThumbs();
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
  clearSel();
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
  clearSel();
  hideECur();
  $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  applyTheme();
  closeMenu();
  if (mode === 'pulpit') { requestWake(); startTick(); }
  else { releaseWake(); stopTick(); }
  if (a) requestAnimationFrame(() => { if (!R) return; for (const P of R.pages) P.top = P.el.offsetTop; const A = R.pages[a.i]; scroller.scrollTop = A.top + a.f * A.dh; });
}
$$('#modeSeg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('#pPage').onclick = () => toggleThumbs();
$('#btnThumbs').onclick = () => toggleThumbs();

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

// ── 시계·설교 타이머 ──
// 두 가지 방식: 'down' 타이머(정한 시간에서 거꾸로) · 'up' 스톱워치(0부터 흘러감).
// 어느 쪽이든 정한 시간의 80%에 주황, 넘으면 빨강으로 알린다.
const T = Object.assign({ start: 0, acc: 0, running: false }, readLS('pn.timer', {}));
if (!(settings.target >= 1)) settings.target = 25;
let tickTimer = 0;
const saveTimerState = () => writeLS('pn.timer', { start: T.start, acc: T.acc, running: T.running });
const elapsed = () => T.acc + (T.running ? Date.now() - T.start : 0);
const mmss = ms => { const s = Math.floor(Math.max(0, ms) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function startTick() { stopTick(); tick(); tickTimer = setInterval(tick, 500); }
function stopTick() { clearInterval(tickTimer); tickTimer = 0; }
function tick() {
  const now = new Date();
  $('#pClock').textContent = `${now.getHours() < 12 ? '오전' : '오후'} ${(now.getHours() % 12) || 12}:${String(now.getMinutes()).padStart(2, '0')}`;
  const e = elapsed(), tgt = settings.target * 60000, prog = $('#tprog'), idle = !T.running && e === 0;
  $('#pTargetTxt').textContent = `${settings.target}분`;
  const left = tgt - e, f = e / tgt, up = settings.timerMode === 'up';
  const txt = up ? mmss(e) : left >= 0 ? mmss(left + 999) : '+' + mmss(-left); // 남은 시간은 올림으로(25:00부터)
  const sub = idle ? '시작' : !T.running ? '멈춤' : left < 0 ? '넘음' : up ? '지남' : '남음';
  const state = idle ? '' : !T.running ? 'paused' : f >= 1 ? 'over' : f >= 0.8 ? 'warn' : 'run';
  prog.style.width = Math.min(100, f * 100) + '%';
  prog.className = 'tprog pulpit-only' + (f >= 1 ? ' over' : f >= 0.8 ? ' warn' : '');
  $('#pTimerTxt').textContent = txt;
  $('#pTimerSub').textContent = sub;
  $('#pTimer').className = 'pill timer' + (state ? ' ' + state : '');
}
function toggleTimer() {
  if (T.running) { T.acc += Date.now() - T.start; T.running = false; }
  else { T.start = Date.now(); T.running = true; }
  saveTimerState(); tick();
}
function resetTimer() { T.acc = 0; T.running = false; T.start = 0; saveTimerState(); tick(); }
$('#pTimer').onclick = toggleTimer;
$('#pTarget').onclick = e => openMenu(e.currentTarget, m => {
  const lbl = h('div', 'lbl');
  m.append(lbl);
  const box = h('div', 'tpop');
  box.innerHTML = `<div class="tmode"><button data-m="down"><b>타이머</b><small>거꾸로 세기</small></button><button data-m="up"><b>스톱워치</b><small>흘러간 시간</small></button></div>
    <p class="cap"></p><div class="dial"><button data-d="-5">−5</button><button data-d="-1">−1</button><b></b><button data-d="1">+1</button><button data-d="5">+5</button></div>
    <div class="chips"></div><div class="row"><button class="btn" data-a="reset"><svg class="i"><use href="#i-reset"/></svg>리셋</button><button class="btn primary" data-a="go"></button></div><p class="note"></p>`;
  const chips = box.querySelector('.chips');
  for (const v of [10, 15, 20, 25, 30, 35, 40, 45, 50, 60]) {
    const c = Object.assign(document.createElement('button'), { textContent: `${v}분` });
    c.dataset.v = v;
    c.onclick = () => { settings.target = v; saveSettings(); show(); tick(); };
    chips.append(c);
  }
  const show = () => {
    const up = settings.timerMode === 'up';
    lbl.textContent = up ? '스톱워치 — 0부터 흘러간 시간을 세어요' : '타이머 — 정한 시간에서 거꾸로 세어요';
    box.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === (up ? 'up' : 'down')));
    box.querySelector('.cap').textContent = up ? '알려 줄 시간 — 이 시간이 지나면 빨간색' : '설교 시간 — 여기서부터 거꾸로';
    box.querySelector('.dial b').innerHTML = `${settings.target}<small>분</small>`;
    chips.querySelectorAll('button').forEach(c => c.classList.toggle('on', +c.dataset.v === settings.target));
    box.querySelector('[data-a=go]').textContent = T.running ? '멈춤' : elapsed() ? '이어서' : '시작';
    box.querySelector('.note').textContent = up
      ? '위쪽 시간을 탭해도 시작 · 멈춤이 돼요. 리셋은 00:00으로 되돌려요. 정한 시간의 80%가 되면 주황, 넘으면 빨간색으로 알려 줘요.'
      : '위쪽 시간을 탭해도 시작 · 멈춤이 돼요. 리셋은 정한 시간으로 되돌려요. 시간이 지나면 빨간색으로 넘은 시간을 보여 줘요.';
  };
  box.querySelectorAll('[data-d]').forEach(bt => bt.onclick = () => { settings.target = clamp(settings.target + +bt.dataset.d, 1, 180); saveSettings(); show(); tick(); });
  box.querySelectorAll('[data-m]').forEach(bt => bt.onclick = () => { settings.timerMode = bt.dataset.m; saveSettings(); show(); tick(); });
  box.querySelector('[data-a=reset]').onclick = () => { resetTimer(); show(); };
  box.querySelector('[data-a=go]').onclick = () => { toggleTimer(); show(); };
  show();
  m.append(box);
});

// ── 화면 꺼짐 방지 ──
let wakeLock = null;
async function requestWake() {
  if (wakeLock || R?.mode !== 'pulpit') return updateWake();
  const keep = NATIVE && plugin('KeepAwake');
  if (keep) {
    try { await keep.keepAwake(); wakeLock = { release: () => keep.allowSleep() }; } catch { wakeLock = null; }
    return updateWake();
  }
  if (!('wakeLock' in navigator)) return updateWake();
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; updateWake(); });
  } catch { wakeLock = null; }
  updateWake();
}
function releaseWake() { Promise.resolve(wakeLock?.release()).catch(() => {}); wakeLock = null; updateWake(); }
function updateWake() {
  const w = $('#pWake');
  w.classList.toggle('off', !wakeLock);
  w.title = wakeLock ? '화면이 꺼지지 않아요' : '화면 꺼짐 방지가 꺼져 있어요 (설정 › 디스플레이 › 자동 잠금 확인)';
}
$('#pWake').onclick = () => wakeLock ? toast('화면이 꺼지지 않게 잡아 두었어요', 1600) : (requestWake(), toast('화면 꺼짐 방지를 다시 켰어요. 안 되면 설정 › 디스플레이 › 자동 잠금을 ‘안 함’으로 두세요.', 3600));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || R?.mode !== 'pulpit') return;
  if (!NATIVE) wakeLock = null; // 웹의 잠금은 화면을 벗어나면 풀린다
  requestWake();
});

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
    offerFile(new Blob([bytes], { type: 'application/pdf' }), name, {
      title: '필기 포함 PDF가 준비됐어요',
      body: `${name} · ${(bytes.length / 1024).toFixed(0)}KB\n구글 드라이브나 파일 앱에 저장해 두면 다른 기기에서도 볼 수 있어요.`,
    });
  } catch (e) {
    console.error(e);
    busy();
    toast('PDF를 만들지 못했어요', 3000);
  }
}
const blobToBase64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
function base64ToBytes(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// 앱: 임시 폴더에 파일을 쓰고 iOS 공유 시트(파일에 저장 · 메일 · 드라이브 등)로 넘긴다
async function nativeShare(blob, name, onSaved) {
  try {
    const { uri } = await plugin('Filesystem').writeFile({ path: name, data: await blobToBase64(blob), directory: 'CACHE' });
    await plugin('Share').share({ title: name, files: [uri] });
    onSaved?.();
  } catch (e) {
    if (!/cancel/i.test(e?.message || '')) { console.error(e); toast('파일을 내보내지 못했어요', 2800); }
  }
}

// 만든 파일을 공유 시트(파일에 저장)나 다운로드로 내보낸다
function offerFile(blob, name, { title, body, onSaved }) {
  if (NATIVE) {
    dialog({ title, body, buttons: [{ label: '닫기', value: 0 }, { label: '공유 · 파일에 저장', cls: 'primary', onClick: () => nativeShare(blob, name, onSaved) }] });
    return;
  }
  const file = new File([blob], name, { type: blob.type });
  const canShare = !!navigator.canShare?.({ files: [file] });
  const download = () => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    onSaved?.();
  };
  const share = () => navigator.share({ files: [file], title: name }).then(() => onSaved?.(), () => {});
  const buttons = [{ label: '닫기', value: 0 }];
  if (canShare) buttons.push({ label: '다운로드', value: 0, onClick: download }, { label: '공유 · 파일에 저장', cls: 'primary', onClick: share });
  else buttons.push({ label: '다운로드', cls: 'primary', onClick: download });
  dialog({ title, body, buttons });
}

// ═══════════════════ 설정·도움말·백업 ═══════════════════
// 큰 안내 창(설정·도움말). body 는 DOM 조각을 만들어 넣는 함수
function openSheet(title, body) {
  closeSheet();
  const s = document.createElement('div');
  s.className = 'scrim sheet-scrim';
  s.innerHTML = `<section class="sheet-card" role="dialog" aria-label="${title}">
    <header><h3></h3><button class="icon-btn" aria-label="닫기"><svg class="i"><use href="#i-x"/></svg></button></header>
    <div class="sheet-body"></div></section>`;
  s.querySelector('h3').textContent = title;
  s.querySelector('header button').onclick = closeSheet;
  s.addEventListener('click', e => { if (e.target === s) closeSheet(); });
  body(s.querySelector('.sheet-body'));
  document.body.append(s);
}
function closeSheet() { $('.sheet-scrim')?.remove(); }
function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}
function row(icon, label, sub, fn, cls = '') {
  const b = h('button', 'srow ' + cls);
  b.innerHTML = `<svg class="i"><use href="${icon}"/></svg><span class="t"><b></b><small></small></span><svg class="i chev"><use href="#i-chev"/></svg>`;
  b.querySelector('b').textContent = label;
  b.querySelector('small').textContent = sub || '';
  b.onclick = fn;
  return b;
}

function openSettings() {
  openSheet('설정', async body => {
    const last = readLS('pn.lastBackup', 0);
    body.append(
      h('div', 'sgroup-t', '처음이라면'),
      row('#i-book', '사용 설명서 보기', '쓰는 법을 한눈에 — 연습장처럼 써 봐도 돼요', () => { closeSheet(); openGuide(); }),
      row('#i-help', '원고를 PDF로 만드는 법', '한글 · 워드 · Pages · 구글 문서', () => openPdfHowto()),
      h('div', 'sgroup-t', '백업'),
      row('#i-backup', '백업 만들기', last ? `마지막 백업 ${ago(last)}` : '아직 백업한 적이 없어요', () => { closeSheet(); makeBackup(); }),
      row('#i-restore', '백업에서 복원', '새 기기로 옮기거나 되살릴 때', () => { closeSheet(); startRestore(); }),
      h('p', 'snote', '원고와 필기는 이 기기 안에만 저장돼요. 기기를 바꾸거나 앱을 지우기 전에 백업 파일을 iCloud Drive나 구글 드라이브에 보관해 두세요.'),
      h('div', 'sgroup-t', '정보'),
      row('#i-lock', '개인정보 처리방침', '모으는 정보가 없어요 — 모두 기기 안에', () => openPrivacy()),
      row('#i-info', '오픈소스 라이선스', 'pdf.js · pdf-lib · 글꼴', () => openLicenses()),
      row('#i-mail', '문의하기', SUPPORT_EMAIL, () => { location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`강단노트 문의 (${APP_VERSION})`)}`; }),
    );
    const ver = h('p', 'sver', `강단노트 ${APP_VERSION} · © 2026 Yeol Studio`);
    try { const e = await navigator.storage?.estimate?.(); if (e?.usage) ver.textContent += ` · 저장 공간 ${(e.usage / 1048576).toFixed(1)}MB 사용`; } catch {}
    body.append(ver);
  });
}
function openPdfHowto() {
  openSheet('원고를 PDF로 만드는 법', body => {
    body.append(h('p', 'slead', 'PDF에는 원고를 쓸 때 고른 글꼴이 그대로 담겨요. 그래서 어느 기기에서 열어도 쓰신 모양 그대로 보여요.'));
    for (const [app, how] of [
      ['한글', '파일 메뉴 → ‘PDF로 저장하기’'],
      ['워드', '파일 → 다른 이름으로 저장 → 파일 형식 ‘PDF’'],
      ['Pages', '파일 → 내보내기 → PDF'],
      ['구글 문서', '파일 → 다운로드 → PDF 문서'],
    ]) {
      const r = h('div', 'howto');
      r.append(h('b', '', app), h('span', '', how));
      body.append(r);
    }
    body.append(
      h('p', 'slead', '만든 PDF를 iCloud Drive나 구글 드라이브에 저장한 뒤, 서재에서 ‘원고 불러오기’를 누르고 고르면 돼요. 여러 개를 한 번에 골라도 돼요.'),
      h('p', 'snote', '파일 이름을 ‘260921 주일예배 설교 - 제목’처럼 지으면 서재에 날짜 · 예배 · 제목이 나뉘어 정리돼요.'),
      h('b', 'ptitle', '구글 드라이브가 계속 ‘불러오는 중’일 때'),
      h('p', 'slead', '파일을 고르는 창의 구글 드라이브는 ‘Google 드라이브’ 앱이 연결해 줘요. 드라이브 앱을 한 번 열어 로그인돼 있는지 확인한 뒤 다시 해 보세요. 그래도 안 되면 드라이브 앱에서 PDF를 열고 ⋯ → ‘다음에서 열기’ → 강단노트를 고르면 바로 들어와요.'),
    );
  });
}
function openLicenses() {
  openSheet('오픈소스 라이선스', body => {
    for (const [name, lic, note] of [
      ['PDF.js', 'Apache License 2.0', 'Mozilla Foundation — PDF를 화면에 그립니다.'],
      ['pdf-lib', 'MIT License', 'Andrew Dillon — 필기를 PDF에 담습니다.'],
      ['고운바탕 (Gowun Batang)', 'SIL Open Font License 1.1', 'The Gowun Batang Project Authors — 서재 제목 글꼴'],
      ['Pretendard', 'SIL Open Font License 1.1', 'Kil Hyung-jin — 사용 설명서 글꼴'],
    ]) {
      const r = h('div', 'lic');
      r.append(h('b', '', name), h('span', '', lic), h('small', '', note));
      body.append(r);
    }
    body.append(h('p', 'snote', '각 라이선스 전문은 앱과 함께 배포되는 vendor/ · fonts/ 폴더에 들어 있어요.'));
  });
}

function openPrivacy() {
  openSheet('개인정보 처리방침', body => {
    for (const [t, d] of [
      ['모으는 정보', '강단노트는 이름 · 이메일 · 기기 정보 · 사용 기록을 비롯해 어떤 개인정보도 모으지 않아요. 회원 가입과 로그인이 없어요.'],
      ['원고와 필기', '불러온 원고 PDF와 필기는 이 기기의 앱 저장 공간에만 저장돼요. 서버로 보내지 않고, 개발자도 볼 수 없어요.'],
      ['내보내기와 백업', '‘필기 포함 PDF 내보내기’와 ‘백업 만들기’는 사용자가 직접 고른 곳(파일 앱 · iCloud Drive · 구글 드라이브 등)에만 파일을 저장해요.'],
      ['광고와 분석', '광고와 사용 분석 도구를 넣지 않았어요.'],
      ['지우기', '서재에서 원고를 지우거나 앱을 삭제하면 그 기기에 저장된 원고와 필기가 함께 지워져요.'],
    ]) body.append(h('b', 'ptitle', t), h('p', 'slead', d));
  });
}

// ── 사용 설명서(앱에 들어 있는 PDF) ──
// 처음 설치하면 서재에 한 번 넣어 둔다. 설명서를 새로 고치면 GUIDE_VER 을 올린다(지운 사람에게 다시 억지로 넣지는 않음 — 판이 바뀔 때 한 번뿐)
const GUIDE_NAME = '강단노트 사용 설명서.pdf', GUIDE_VER = 3;
async function addGuide(open) {
  busy('사용 설명서를 준비하는 중…');
  try {
    const blob = await fetch('sample/guide.pdf').then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); });
    await importFiles([new File([blob], GUIDE_NAME, { type: 'application/pdf' })], { open });
  } catch (e) {
    console.error(e);
    busy();
    if (open) toast('사용 설명서를 불러오지 못했어요');
  }
}
async function openGuide() {
  const have = (await idb.all('docs')).find(d => d.name === GUIDE_NAME);
  if (have) return openDoc(have.id);
  await addGuide(true);
}
// 처음 설치하면 한 번 넣는다. 판이 오르면 서재의 옛 설명서를 새 판으로 바꾼다(연습 필기는 쪽 배치가 달라 함께 비움).
// 스스로 지운 사람에게는 다시 넣지 않는다 — 설정 › 사용 설명서 보기로 언제든 열 수 있다.
async function seedGuide() {
  const seen = readLS('pn.guideVer', 0);
  if (seen >= GUIDE_VER) return;
  writeLS('pn.guideVer', GUIDE_VER);
  const old = (await idb.all('docs')).filter(d => d.name === GUIDE_NAME);
  if (seen && !old.length) return;
  for (const d of old) await Promise.all([idb.del('docs', d.id), idb.del('files', d.id), idb.del('ink', d.id)]);
  await addGuide(false);
  if (old.length) toast('사용 설명서가 새 판으로 바뀌었어요', 2600);
}

// ── 첫 사용 안내(원고를 처음 열었을 때 한 번) ──
function maybeCoach() {
  if (readLS('pn.coached', false)) return;
  const c = h('div', 'coach');
  c.innerHTML = `<div><b>애플펜슬로 쓰고, 손가락으로 넘겨요.</b>
    <span>오른쪽 위 ‘강단’을 누르면 화면을 탭해서 넘기는 설교용 화면이 돼요.</span></div>
    <button class="btn primary">알겠어요</button>`;
  c.querySelector('button').onclick = () => { writeLS('pn.coached', true); c.remove(); };
  reader.append(c);
}

// ── 백업: 원고 PDF · 필기 · 목록을 zip 하나로(압축 없이 담아서 풀면 PDF가 그대로 보인다) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); // UTF-8 이름
    lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), dec = new TextDecoder(), out = new Map();
  let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not-zip');
  let p = dv.getUint32(e + 16, true);
  for (let i = dv.getUint16(e + 10, true); i > 0; i--) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('not-zip');
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    let data = u8.slice(start, start + size);
    // 사용자가 풀었다가 다시 묶은 zip(압축됨)도 받아 준다
    if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else if (method !== 0) throw new Error('zip-method');
    out.set(name, data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
async function makeBackup() {
  busy('백업 파일을 만드는 중…');
  try {
    const [docs, inks] = await Promise.all([idb.all('docs'), idb.all('ink')]);
    if (!docs.length) { busy(); toast('백업할 원고가 아직 없어요'); return; }
    const enc = new TextEncoder();
    const files = [{ name: 'manifest.json', data: enc.encode(JSON.stringify({ app: 'pulpit-notes', format: 1, version: APP_VERSION, created: Date.now(), docs })) }];
    for (const d of docs) {
      const f = await idb.get('files', d.id);
      if (f) files.push({ name: `pdf/${d.id}.pdf`, data: new Uint8Array(f.data) });
    }
    for (const k of inks) files.push({ name: `ink/${k.id}.json`, data: enc.encode(JSON.stringify(k)) });
    const blob = zipStore(files);
    const t = new Date(), stamp = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`;
    busy();
    offerFile(blob, `강단노트 백업 ${stamp}.zip`, {
      title: '백업 파일이 준비됐어요',
      body: `원고 ${docs.length}개 · ${(blob.size / 1048576).toFixed(1)}MB\niCloud Drive나 구글 드라이브에 저장해 두세요. 새 기기에서는 설정 → 백업에서 복원으로 되살릴 수 있어요.`,
      onSaved: () => { writeLS('pn.lastBackup', Date.now()); renderFoot(); },
    });
  } catch (e) {
    console.error(e);
    busy();
    toast('백업 파일을 만들지 못했어요', 3000);
  }
}
async function restoreBackup(file) {
  busy('백업을 되살리는 중…');
  try {
    const entries = await unzip(await file.arrayBuffer());
    const raw = entries.get('manifest.json');
    const man = raw && JSON.parse(new TextDecoder().decode(raw));
    if (man?.app !== 'pulpit-notes') throw new Error('not-backup');
    let added = 0, updated = 0, kept = 0;
    for (const d of man.docs) {
      const pdf = entries.get(`pdf/${d.id}.pdf`);
      if (!pdf) continue;
      const inkRaw = entries.get(`ink/${d.id}.json`);
      const ink = inkRaw ? JSON.parse(new TextDecoder().decode(inkRaw)) : null;
      const cur = await idb.get('docs', d.id);
      if (!cur) {
        await idb.put('files', { id: d.id, data: pdf.buffer });
        if (ink) await idb.put('ink', ink);
        await idb.put('docs', d);
        added++;
        continue;
      }
      // 같은 원고가 이미 있으면 필기가 더 최근인 쪽을 남긴다
      const curInk = await idb.get('ink', d.id);
      if (ink && (ink.updated || 0) > (curInk?.updated || 0)) {
        await idb.put('ink', ink);
        await idb.put('docs', { ...cur, inkCount: d.inkCount });
        updated++;
      } else kept++;
    }
    busy();
    await renderLibrary();
    const msg = [added && `새 원고 ${added}개`, updated && `필기 ${updated}개 갱신`, kept && `그대로 ${kept}개`].filter(Boolean).join(' · ');
    toast(msg ? `복원했어요 — ${msg}` : '복원할 원고가 없었어요', 3200);
  } catch (e) {
    console.error(e);
    busy();
    toast(e?.message === 'not-backup' || e?.message === 'not-zip' ? '강단노트 백업 파일이 아니에요' : '백업을 되살리지 못했어요', 3200);
  }
}
$('#restoreFile').onchange = () => { const f = $('#restoreFile').files[0]; $('#restoreFile').value = ''; if (f) restoreBackup(f); };

// ═══════════════════ 키보드·페달 ═══════════════════
addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('.sheet-scrim')) { closeSheet(); return; }
  if (e.key === 'Escape' && libSel && !R && !$('.scrim')) { setLibSelect(false); return; }
  if (!R || $('.scrim') || e.target.matches?.('input,textarea')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) { e.preventDefault(); stepZoom(e.key === '0' ? 0 : e.key === '-' ? -1 : 1); return; }
  if (mod) return;
  const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'], prev = ['ArrowLeft', 'ArrowUp', 'PageUp'];
  if (next.includes(e.key)) { e.preventDefault(); turn(1); }
  else if (prev.includes(e.key)) { e.preventDefault(); turn(-1); }
  else if (e.key === 'Escape') { if ($('.menu')) closeMenu(); else if (R.sel) clearSel(); else if (R.mode === 'pulpit') setMode('prep'); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && R.sel) { e.preventDefault(); deleteSel(); }
  else if (R.mode === 'prep' && 'pehs'.includes(e.key.toLowerCase())) {
    setTool({ p: 'pen', h: 'hl', e: 'eraser', s: 'select' }[e.key.toLowerCase()]);
  }
});
// 아이패드에서 화면 전체가 확대되는 것을 막는다(원고 크기는 여백 줄이기·가로 보기로)
document.addEventListener('gesturestart', e => e.preventDefault());
let gestZ = null;
scroller.addEventListener('gesturestart', e => { if (!R || pinch.st) return; gestZ = { z0: settings.zoom || 1, z: settings.zoom || 1, fx: e.clientX, fy: e.clientY }; zoomPreviewStart(e.clientX, e.clientY); });
scroller.addEventListener('gesturechange', e => { if (!gestZ) return; e.preventDefault(); gestZ.z = clamp(gestZ.z0 * e.scale, ZMIN, ZMAX); pagesEl.style.transform = `scale(${gestZ.z / gestZ.z0})`; });
scroller.addEventListener('gestureend', () => { if (!gestZ) return; const g = gestZ; gestZ = null; zoomPreviewEnd(); setZoom(g.z, g.fx, g.fy); });

// ═══════════════════ 다른 앱에서 받은 파일 ═══════════════════
// 파일 앱 · 한글 · 워드 · 메일 등에서 공유 → 강단노트. iOS가 앱의 Inbox 에 복사해 준 파일을 읽는다
async function handleOpenedFile(url) {
  if (!/^file:/i.test(url || '')) return;
  const FS = plugin('Filesystem');
  const name = decodeURIComponent(url.split('/').pop() || '원고.pdf').normalize('NFC');
  try {
    const { data } = await FS.readFile({ path: url });
    const bytes = base64ToBytes(data);
    closeSheet();
    if (/\.zip$/i.test(name)) {
      if (R) await closeDoc();
      if (await ask('백업에서 복원할까요?', `「${name}」의 원고와 필기를 서재에 합쳐요. 이미 있는 원고는 필기가 더 최근인 쪽을 남겨요.`, '복원하기')) {
        await restoreBackup(new File([bytes], name, { type: 'application/zip' }));
      }
    } else {
      if (R) await closeDoc();
      await importFiles([new File([bytes], name, { type: 'application/pdf' })]);
    }
  } catch (e) {
    console.error(e);
    toast('받은 파일을 열지 못했어요', 2800);
  } finally {
    FS.deleteFile({ path: url }).catch(() => {});
  }
}
if (NATIVE) {
  plugin('App')?.addListener('appUrlOpen', e => handleOpenedFile(e.url));
  plugin('App')?.getLaunchUrl?.().then(r => r?.url && handleOpenedFile(r.url)).catch(() => {});
}

// ═══════════════════ 시작 ═══════════════════
renderLibrary().then(seedGuide);
if (!NATIVE && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
}
