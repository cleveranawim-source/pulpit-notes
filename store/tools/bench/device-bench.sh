#!/bin/zsh
# 실제 아이패드에서 자동 스크롤 발열 재기 — 앱 사본에 시험 조각을 넣어 깔고, 5분 동안 상황을 바꿔 가며 Instruments 로 기록한다
# 쓰는 법: device-bench.sh <기기 UDID>   (결과: ./out/device-*.trace, 단계 시각은 ./out/phases.txt)
# 단계(각 60초): A 자동 꺼짐 · B 이번 방식(2px+타이머 묶음) · C 예전 방식(1px·타이머 따로) · D 어둡게+이번 방식 · E 어둡게+자동 꺼짐
set -e
DEV=$1; B=${0:A:h}; R=~/Claude/pulpit-notes; OUT=$B/out; mkdir -p $OUT
cd $R && npm run -s ios >/dev/null 2>&1
P=$R/ios/App/App/public
# 시험용 손잡이(사본에만): 칸 크기·타이머 묶음을 실행 중에 바꿀 수 있게
sed -i '' 's/const autoStepPx = v => v < 3 ? 1 : 2;/const autoStepPx = v => window.__step || (v < 3 ? 1 : 2);/' $P/app.js
sed -i '' 's/if (tickTimer) tick(); }/if (tickTimer \&\& !window.__noCoalesce) tick(); }/' $P/app.js
sed -i '' 's/(A.running ? Math.min(900, A.wait + 150) : 15)/(A.running \&\& !window.__noCoalesce ? Math.min(900, A.wait + 150) : 15)/' $P/app.js
[ "$(grep -c '__noCoalesce' $P/app.js)" = 2 ] && grep -q 'window.__step' $P/app.js || { echo '시험 손잡이를 못 넣음(app.js 가 바뀜)'; exit 1; }
cat > $P/bench.js <<'JS'
const w = ms => new Promise(r => setTimeout(r, ms)), q = s => document.querySelector(s);
const label = t => { let el = q('#benchLbl'); if (!el) { el = document.createElement('div'); el.id = 'benchLbl'; el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;font:600 13px system-ui;background:#000a;color:#fff;padding:4px 8px;border-radius:6px'; document.body.append(el); } el.textContent = t; };
const theme = async t => { for (let i = 0; i < 3 && q('#reader').dataset.theme !== t; i++) { q('#pTheme').click(); await w(200); } };
const speed9 = async () => { for (let i = 0; i < 25 && q('#aSpd').textContent !== '속도 9'; i++) { q(+q('#aSpd').textContent.replace('속도 ', '') > 9 ? '#aSlow' : '#aFast').click(); await w(30); } };
(async () => {
  await w(3000);
  const keep = { s: localStorage.getItem('pn.settings'), t: localStorage.getItem('pn.timer') }; // 끝나면 사용자 설정을 되돌린다
  const cards = [...document.querySelectorAll('.card')];
  (cards.find(c => c.querySelector('h3').textContent.normalize('NFC').includes('사용 설명서')) || cards[0]).querySelector('.sheet').click(); await w(3000);
  q('#modeSeg [data-mode="pulpit"]').click(); await w(1500);
  await theme('light');
  const tm = q('#pTimer'); if (!/run|warn|over/.test(tm.className)) tm.click();
  q('#scroller').scrollTop = 0;
  const t0 = Date.now(), at = s => w(Math.max(0, t0 + s * 1000 - Date.now()));
  label('A 자동 꺼짐'); await at(60);
  label('B 이번 방식'); q('#autoBtn').click(); await w(300); await speed9(); await at(120);
  label('C 예전 방식'); window.__step = 1; window.__noCoalesce = 1; await at(180);
  label('D 어둡게+이번'); window.__step = 0; window.__noCoalesce = 0; await theme('dark'); await at(240);
  label('E 어둡게+꺼짐'); q('#aOff').click(); await at(300);
  label('끝 — 설정 되돌리는 중'); q('#modeSeg [data-mode="prep"]').click(); await w(500);
  if (keep.s) localStorage.setItem('pn.settings', keep.s); if (keep.t) localStorage.setItem('pn.timer', keep.t); else localStorage.removeItem('pn.timer');
  location.reload();
})();
JS
sed -i '' 's#<script type="module" src="app.js"></script>#<script type="module" src="app.js"></script><script src="bench.js"></script>#' $P/index.html
cd $R && xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination "id=$DEV" -derivedDataPath $OUT/dd -allowProvisioningUpdates -allowProvisioningDeviceRegistration build -quiet 2>&1 | grep -E "error|warning: .*sign" | head -5
APP=$OUT/dd/Build/Products/Release-iphoneos/App.app
grep -c benchLbl $APP/public/bench.js
xcrun devicectl device install app --device $DEV $APP | tail -2
npm run -s ios >/dev/null 2>&1   # 원본 public 되돌림
echo "준비 끝 — 이제 기록: xcrun xctrace record --device $DEV --template 'Power Profiler' --time-limit 330s --all-processes --output $OUT/device-power.trace"
