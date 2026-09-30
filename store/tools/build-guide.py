# 사용 설명서 PDF 만들기: guide-shots.mjs 로 찍은 화면(../guide/img) → 알맞게 줄여 ../guide/web → 크롬으로 ../../sample/guide.pdf
# 번호 자리(img/*.json)는 web/marks.js 로 모아 두고, 설명서 HTML 이 그림 위에 ①②③ 을 얹는다(글자가 벡터로 선명).
import os, subprocess, json
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
IMG, WEB = os.path.join(HERE, '../guide/img'), os.path.join(HERE, '../guide/web')
ROOT = os.path.abspath(os.path.join(HERE, '../..'))
os.makedirs(WEB, exist_ok=True)
FULL = {'library', 'library-select', 'prep', 'thumbs', 'pulpit', 'select'}  # 원고 글씨가 많이 든 화면 → JPEG
marks = {}
for f in sorted(os.listdir(IMG)):
    name, ext = os.path.splitext(f)
    if ext != '.png': continue
    im = Image.open(os.path.join(IMG, f)).convert('RGB')
    mj = os.path.join(IMG, name + '.json')
    if os.path.exists(mj): marks[name] = {'w': im.width, 'h': im.height, 'marks': json.load(open(mj))}
    if im.width > 1200: im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
    if name in FULL: im.save(os.path.join(WEB, name + '.jpg'), quality=80, optimize=True)
    else: im.save(os.path.join(WEB, name + '.png'), optimize=True)
open(os.path.join(WEB, 'marks.js'), 'w').write('window.MARKS = ' + json.dumps(marks, ensure_ascii=False) + ';\n')
chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
out = os.path.join(ROOT, 'sample/guide.pdf')
subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files',
                f'--print-to-pdf={out}', 'file://' + os.path.join(ROOT, 'sample/guide-source.html')], check=True, capture_output=True)
print('guide.pdf', round(os.path.getsize(out) / 1024), 'KB')
