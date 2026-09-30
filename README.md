# 강단노트 — 설교 원고 리더

설교 원고 PDF를 아이패드에서 읽고, 애플펜슬로 표시하고, 강단에서 넘겨 보는 웹앱.
설치형 PWA이고 서버가 없다. 원고와 필기는 그 기기의 IndexedDB에만 저장된다.

## 쓰는 법

1. 아이패드 Safari로 열고 **공유 → 홈 화면에 추가**로 설치한다(오프라인 동작 + 저장소 보존).
2. **원고 불러오기** → 파일 앱 → Google Drive에서 설교 PDF를 고른다(여러 개 가능).
   파일 이름이 `260921 기도회 설교 - 제목 (윤문본).pdf` 꼴이면 날짜·구분·제목을 알아서 나눈다.
3. **준비 모드**: 애플펜슬로 고르기·펜·형광펜·지우개. 손가락은 스크롤 전용이라 손바닥 오작동이 없다.
   - 형광펜을 거의 곧게 그으면 반듯한 직선으로 정리된다(글줄과 수평이면 수평으로).
   - 지우개 두 가지: **부분**(연필 지우개처럼 닿은 곳만) / **획 전체**. 되돌리기/다시하기 지원.
   - **선택(올가미)**: 펜슬로 둘러싸면 그 안 필기가 선택되고, 펜슬이나 손가락으로 끌어 옮긴다. 오른쪽 아래 손잡이로 크기 조절(선 굵기도 함께), 왼쪽 아래 ↻ 손잡이로 회전(0·90·180°에 달라붙음). 톡 누르면 그 획 하나. 도구 막대에서 지우기.
   - 굵기 버튼 → 슬라이더와 −/+ (펜 0.1pt · 형광펜 1pt · 지우개 2pt 단위), **pt 숫자로 표시**(원고 쪽 폭 기준, 지우개는 지름). 미리보기 점은 지금 화면에서의 실제 크기.
   - 펜슬이 없으면 손 모양 버튼으로 손가락 쓰기(스크롤은 두 손가락).
4. **강단 모드**: 화면 오른쪽 탭 = 다음 화면, 왼쪽 30% 탭 = 이전 화면. 펜슬로 탭해도 넘어간다(필기는 메뉴의 ‘강단에서도 펜슬로 필기’를 켤 때만).
   앞 화면 마지막 몇 줄을 남기고 넘기며, 이어 읽을 자리에 금색 표시가 잠깐 뜬다.
   **설교 타이머**: 설정 창에서 방식을 고른다(`settings.timerMode`) — **타이머**(분 단위 1~180분에서 거꾸로) · **스톱워치**(00:00부터 흘러감, 정한 시간은 ‘알려 줄 시간’).
   색은 두 방식 모두 대기 검정 → 진행 버건디 → 80% 주황 → 넘으면 빨강(타이머는 ‘+분:초 넘음’). ‘리셋’은 처음으로(타이머=정한 시간, 스톱워치=00:00). 현재 시각은 타이머 바로 왼쪽.
   시계·화면 꺼짐 방지·밝게/종이/어둡게. 블루투스 페이지 넘김 페달(방향키·PageDown) 지원.
   준비·강단 버튼과 메뉴는 두 모드에서 같은 자리(한 줄 막대).
   - **확대·축소**: 두 손가락 벌리기·오므리기, 메뉴의 −/+/맞춤, 맥은 ⌘+ ⌘− ⌘0·트랙패드. 60~250%(쪽 폭 맞춤=100%), 100%보다 크면 옆으로도 움직인다.
   - **쪽 미리보기**: 왼쪽 목록을 열고 닫는다(준비 막대의 목록 버튼 · 강단의 쪽 번호 · 메뉴). 필기도 함께 보이고, 누르면 그 쪽으로 간다.
5. 메뉴 ⋯ → **필기 포함 PDF 내보내기**: 원본 PDF 위에 벡터로 필기를 얹어 공유 시트(파일에 저장)로 보낸다.

6. 서재 오른쪽 위 **설정**: 사용 설명서 · PDF 만드는 법 · **백업 만들기 / 백업에서 복원** · 개인정보 처리방침 · 오픈소스 라이선스.
   서재 카드 ⋯ → 제목 바꾸기 · 지우기. 정렬은 최근 연 순 / 설교 날짜 순.
   카드의 ‘필기 N쪽’은 필기가 있는 쪽 수. **여러 원고 지우기**: 서재의 ‘원고 선택’(또는 카드를 길게 누르기) → 탭으로 고르고 아래 막대에서 지우기. ‘지난 설교 N편’은 파일 이름 날짜가 오늘보다 앞선 원고를 한 번에 고른다.

**여백 줄여 크게 보기**(기본 켬): 불러올 때 모든 쪽의 글자 영역을 재서 바깥 여백을 잘라 낸다 → 같은 화면에서 글씨가 약 1.3배 커진다.

## 구조

| 파일 | 내용 |
|------|------|
| `index.html` | 화면·스타일·아이콘 심볼 |
| `app.js` | 서재·리더·필기·강단 모드·내보내기 전부(ES 모듈) |
| `sw.js` | 오프라인 캐시. **앱 파일을 고치면 `VERSION`을 올릴 것** |
| `vendor/` | pdf.js 4.10.38(legacy 빌드)·pdf-lib 1.17.1 — CDN 없이 동작하도록 동봉 |
| `fonts/` | 고운바탕 400·700 woff2(한글 11,172자 서브셋, SIL OFL) + 라이선스 전문. 외부 글꼴 요청 없음 |
| `sample/` | **사용 설명서** `guide.pdf`(13쪽, Pretendard·고운바탕)와 원본 `guide-source.html`. 처음 설치하면 서재에 한 번 자동으로 들어간다. `GUIDE_VER` 를 올리면 서재의 옛 설명서를 새 판으로 바꾼다(연습 필기는 비움). 스스로 지운 사람에겐 다시 넣지 않는다 |
| `privacy.html` · `support.html` | 개인정보 처리방침 · 지원 페이지 원본. **앱스토어에 적은 주소는 레브랩 사이트 사본**(`~/Claude/levlab/public/gangdannote/{support,privacy}/index.html`, www.levlab.co.kr/gangdannote/…) — 고치면 두 곳 다 반영(사본은 경로를 `/gangdannote/…` 절대 경로로) |

- 사용 설명서 다시 만들기(화면이나 내용이 바뀌었을 때, 개발 서버 5178 켠 상태):
  `cd store/tools && node guide-shots.mjs && python3 build-guide.py` → 화면 조각 `store/guide/img` → 줄인 사본 `store/guide/web` → `sample/guide.pdf`.
  그림 위 ①②③ 번호는 찍을 때 요소 자리를 `img/<이름>.json` 에 남기고(`clip(..., { marks })`), `web/marks.js` 로 모아 설명서 HTML 이 얹는다(벡터 글자).
  도구 막대 · 메뉴만 찍을 때는 `blank(true)` 로 뒤 원고를 가려 배경을 깨끗하게.
  설명서에 Pretendard에 없는 기호(⏱ ◢ 등)를 쓰면 애플 글꼴이 대신 박히니 피할 것. 내용이 바뀌면 `GUIDE_VER` 과 `sw.js` `VERSION` 을 올린다.
- 백업 파일은 무압축 zip: `manifest.json`(원고 목록) + `pdf/<id>.pdf` + `ink/<id>.json`. 풀면 원본 PDF가 그대로 보인다.
  복원은 합치기: 없는 원고는 추가, 같은 원고는 필기가 더 최근인 쪽을 남긴다.

- 필기 저장 형식: 쪽마다 획 배열 `{t:'pen'|'hl', c:색, w:굵기(쪽 폭 비율), p:[x,y,압력,…](쪽 크기로 정규화)}`.
  그래서 여백 자르기·가로세로 전환·확대와 무관하게 제자리에 붙는다.
- 화면: 쪽마다 PDF 캔버스 + 필기 캔버스(`mix-blend-mode: multiply`, 형광펜을 먼저·펜을 나중에 그려 글씨가 가려지지 않음).
  화면 근처 쪽만 그리고 먼 쪽 캔버스는 비운다(아이패드 캔버스 메모리 한도 대비).
- 부분 지우개는 픽셀을 칠해 지우지 않고 **획을 잘라 조각 획으로 바꾼다**(지우개 원과 선분의 교점 계산).
  그래서 내보낸 PDF도 벡터 그대로이고, 되돌리기는 쪽 단위 스냅숏(`{t:'snap', before, after}`)으로 한다.
- 펜슬 판별: `pointerType === 'pen'` + `touchstart`에서 `touchType === 'stylus'`면 `preventDefault`로 스크롤 차단.

## 아이패드 앱 (Capacitor 8.5.2, iPad 전용)

웹판과 같은 코드를 쓰고, 기기 기능만 `NATIVE` 로 갈라 쓴다(app.js 윗부분).

| | 웹판 | 앱 |
|---|---|---|
| 화면 꺼짐 방지 | Wake Lock API | `@capacitor-community/keep-awake` |
| 내보내기·백업 저장 | Web Share / 다운로드 | Filesystem(임시 폴더) → `@capacitor/share` 공유 시트 |
| 다른 앱에서 받기 | — | Info.plist `CFBundleDocumentTypes`(PDF·zip) → `appUrlOpen` → Filesystem.readFile |
| 원고 불러오기 · 백업 복원 | `<input type=file>` | 자체 플러그인 `FolderPicker`(`ios/App/App/FolderPicker.swift`, `PulpitViewController` 에서 등록) — 원본 자리에서 열어 **마지막 폴더를 기억**(`directoryURL`, pdf·zip 따로 UserDefaults), 임시 폴더로 복사해 넘김 |
| 오프라인 | 서비스워커 | 앱 안에 파일이 들어 있음(서비스워커 안 씀) |

- 앱 ID `com.yeolstudio.pulpitnotes` · 이름 강단노트 · 팀 2GXUR7D82T · 버전 1.0.1(3) — 1.0.0(1)은 2026-09-27 심사 제출분 · `TARGETED_DEVICE_FAMILY = 2`(iPad 전용, 나중에 아이폰 추가는 가능·되돌리기는 불가).
- 빌드: `npm run ios`(www/ 모으기 + cap sync) → Xcode에서 `ios/App/App.xcodeproj` 열기 → Product › Archive.
  시뮬레이터: `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -derivedDataPath ios/DerivedData build CODE_SIGNING_ALLOWED=NO`.
- JS 콘솔 보기: `xcrun simctl launch --console-pty <기기> com.yeolstudio.pulpitnotes` (⚡️ 로그).
- 아이콘·실행 화면: `ios/App/App/Assets.xcassets` (1024 아이콘은 알파 없이).
- 다른 앱에서 온 파일 이름은 NFD(자모 분리)라 `normalize('NFC')` 필수.

## 스토어 스크린숏 · 등록 자료 (`store/`)

- `listing.md`: App Store Connect에 붙여 넣을 이름·부제·설명·키워드·심사 메모(글자 수 확인 포함).
- `screenshots/raw/`: 아이패드 13인치(2064×2752) 원본, `screenshots/appstore/`: 제목을 얹은 스토어용 6장.
- `demo/`: 스크린숏용 **가상** 설교 원고 16편(원본 HTML은 `demo-src/`, 크롬 `--print-to-pdf`로 만듦).
- 다시 찍기(개발 서버 5178을 켠 상태에서):
  1. 고운바탕 TTF 두 개를 `store/tools/cache/`에 둔다(github.com/google/fonts `ofl/gowunbatang`).
  2. `cd store/tools && npm i`
  3. `node textpos.mjs "../demo/260906 주일예배 설교 - 빈 그물에 다시 내리는 손.pdf" cache/rich-text.json && python3 mkink.py` — 글자 위치에 맞춰 필기 획 생성
  4. `node shots.mjs` — 헤드리스 크롬으로 서재·준비·강단·어둡게·고르기·설정 6장(시계는 주일 오전 10:52로 고정)
  5. `python3 compose.py` — 스토어 이미지 합성

## 로컬 실행

```bash
python3 -m http.server 5178
```

`.test/`는 테스트용 원고를 두는 곳(커밋 제외).
