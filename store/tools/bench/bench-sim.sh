#!/bin/zsh
# 시뮬레이터 앱 사본에만 시험 조각을 넣어 상황을 저절로 만든 뒤 처리량을 잰다(원본 코드는 그대로)
# 쓰는 법: bench-sim.sh <상황> [잴 초]   상황: idle(타이머만) | pause(자동 켜고 멈춤) | s1 | s9 | s20 (그 속도로 흐름)
SC=$1; SEC=${2:-30}; TH=${3:-light}; DOC=${4:-사용 설명서}; SP=${0:A:h}
APP=$(xcrun simctl get_app_container 49B4AF7D-EF58-41E6-813B-109A9A392F07 com.yeolstudio.pulpitnotes app) || exit 1
cd ~/Claude/pulpit-notes && rsync -a --delete ios/App/App/public/ "$APP/public/"
cat > "$APP/public/bench.js" <<JS
const w = ms => new Promise(r => setTimeout(r, ms)), q = s => document.querySelector(s);
(async () => {
  await w(2500); [...document.querySelectorAll('.card')].find(c => c.querySelector('h3').textContent.normalize('NFC').includes('$DOC'.normalize('NFC'))).querySelector('.sheet').click(); await w(3000);
  q('#modeSeg [data-mode="pulpit"]').click(); await w(1500);
  for (let i = 0; i < 3 && q('#reader').dataset.theme !== '$TH'; i++) { q('#pTheme').click(); await w(200); }
  const sc = '$SC';
  if (sc === 'still') { q('#pTimer').click(); return; } // 타이머까지 멈춘 완전히 가만한 화면(타이머가 흐르고 있었다면)
  if (sc === 'idle') return;
  if (sc.startsWith('raw')) { // raw-scroll-<횟수> | raw-tf-<횟수>: 앱 코드 없이 1px 씩 밀기만(방식 비교)
    const [, how, n] = sc.split('-'), sc2 = q('#scroller'), pg = q('#pages'); let y = 0;
    if (how === 'tf') pg.style.willChange = 'transform';
    setInterval(() => { y += 1; if (how === 'tf') pg.style.transform = 'translateY(' + (-y) + 'px)'; else sc2.scrollTop += 1; }, 1000 / +n);
    return;
  }
  q('#autoBtn').click(); await w(300);
  const want = sc === 'pause' ? 9 : +sc.slice(1);
  for (let i = 0; i < 25; i++) q(want < 9 ? '#aSlow' : '#aFast').click(), await w(30);
  if (want !== 20) for (let i = 0; i < 25; i++) { if (q('#aSpd').textContent === '속도 ' + want) break; q(want < 9 ? '#aFast' : '#aSlow').click(); await w(30); }
  if (want === 1) { for (let i = 0; i < 25; i++) q('#aSlow').click(); }
  if (sc === 'pause') q('#aPlay').click();
  document.title = 'bench:' + sc + ':' + q('#aSpd').textContent;
})();
JS
sed -i '' 's#<script type="module" src="app.js"></script>#<script type="module" src="app.js"></script><script src="bench.js"></script>#' "$APP/public/index.html"
xcrun simctl terminate 49B4AF7D-EF58-41E6-813B-109A9A392F07 com.yeolstudio.pulpitnotes 2>/dev/null
PID=$(xcrun simctl launch 49B4AF7D-EF58-41E6-813B-109A9A392F07 com.yeolstudio.pulpitnotes | awk '{print $2}')
sleep 15   # 원고 열기·강단·조절판 접힘(5초)까지
W=$(ps -axo pid,command | awk -v p=$PID '$1>p && $1<p+12 {print $1, $NF}' | while read a c; do echo "$a $(echo $c | base64 -d 2>/dev/null)"; done)
WEB=$(echo "$W" | grep WebContent | awk '{print $1}'); GPU=$(echo "$W" | grep '\.GPU' | awk '{print $1}')
echo "== $SC $TH $DOC (앱 $PID 웹 $WEB GPU $GPU)"
python3 $SP/gpu.py $SEC > /tmp/pn-gpu.txt &
python3 $SP/cpu.py $SEC 앱=$PID 웹=$WEB GPU=$GPU backboardd=8190 렌더=8161
wait; cat /tmp/pn-gpu.txt
