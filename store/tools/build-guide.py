# 사용 설명서 PDF 만들기: guide-shots.mjs 로 찍은 화면(../guide/img) → 알맞게 줄여 ../guide/web → 크롬으로 ../../sample/guide.pdf
import os, subprocess
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
IMG, WEB = os.path.join(HERE, '../guide/img'), os.path.join(HERE, '../guide/web')
ROOT = os.path.abspath(os.path.join(HERE, '../..'))
os.makedirs(WEB, exist_ok=True)
FULL = {'library', 'library-select', 'prep', 'thumbs', 'pulpit'}  # 화면 전체 → JPEG
for f in sorted(os.listdir(IMG)):
    name, _ = os.path.splitext(f)
    im = Image.open(os.path.join(IMG, f)).convert('RGB')
    if im.width > 1400: im = im.resize((1400, round(im.height * 1400 / im.width)), Image.LANCZOS)
    if name in FULL: im.save(os.path.join(WEB, name + '.jpg'), quality=80, optimize=True)
    else: im.save(os.path.join(WEB, name + '.png'), optimize=True)
chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
out = os.path.join(ROOT, 'sample/guide.pdf')
subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files',
                f'--print-to-pdf={out}', 'file://' + os.path.join(ROOT, 'sample/guide-source.html')], check=True, capture_output=True)
print('guide.pdf', round(os.path.getsize(out) / 1024), 'KB')
