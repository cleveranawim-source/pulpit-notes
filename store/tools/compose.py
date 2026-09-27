# 스토어 이미지: raw 스크린숏 위에 제목·부제를 얹고 아이패드 테두리로 감싼다(2064×2752)
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, '..', 'screenshots')
H1 = ImageFont.truetype(os.path.join(HERE, 'cache', 'GowunBatang-Bold.ttf'), 124)
SUB = ImageFont.truetype(os.path.expanduser('~/Library/Fonts/Pretendard-Regular.otf'), 56)
W, H = 2064, 2752
ITEMS = [
    ('1-library', '설교 원고를 한 서재에', 'PDF로 만든 원고가 날짜와 예배별로 정리돼요', 'light'),
    ('2-prep', '애플펜슬로 표시하며 준비하고', '밑줄 · 형광펜 · 동그라미, 손바닥이 닿아도 괜찮아요', 'light'),
    ('3-pulpit', '강단에서는 탭 한 번으로', '이어 읽을 자리 표시 · 설교 타이머 · 화면 꺼짐 방지', 'light'),
    ('4-pulpit-dark', '어두운 예배당에서도 편안하게', '밝게 · 종이 · 어둡게, 눈에 맞는 화면으로', 'dark'),
    ('5-select', '고르고, 옮기고, 지우고', '올가미로 둘러싼 필기를 끌어서 옮겨요', 'light'),
    ('6-settings', '원고는 내 아이패드에만', '로그인도 서버도 없이, 백업은 파일 하나로', 'light'),
]
THEME = {'light': ('#F4EFE6', '#2A241D', '#6E6356', '#EBE3D4'), 'dark': ('#1B1917', '#F4EFE6', '#BDB3A5', '#2A2724')}

def rounded(size, r):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], r, fill=255)
    return m

os.makedirs(os.path.join(SHOTS, 'appstore'), exist_ok=True)
for k, (name, title, sub, th) in enumerate(ITEMS, 1):
    bg, ink, ink2, glow = THEME[th]
    can = Image.new('RGB', (W, H), bg)
    g = Image.new('L', (W, H), 0)
    ImageDraw.Draw(g).ellipse([W * 0.1, 1100, W * 0.9, 3100], fill=255)
    can = Image.composite(Image.new('RGB', (W, H), glow), can, g.filter(ImageFilter.GaussianBlur(220)))
    d = ImageDraw.Draw(can)
    d.text(((W - d.textlength(title, font=H1)) / 2, 170), title, font=H1, fill=ink)
    d.text(((W - d.textlength(sub, font=SUB)) / 2, 350), sub, font=SUB, fill=ink2)
    shot = Image.open(os.path.join(SHOTS, 'raw', name + '.png')).convert('RGB')
    top, bez = 540, 28
    inner_h = H - top - 70 - bez * 2
    inner_w = round(shot.size[0] * inner_h / shot.size[1])
    shot = shot.resize((inner_w, inner_h), Image.LANCZOS)
    dw, dh = inner_w + bez * 2, inner_h + bez * 2
    dx, dy = (W - dw) // 2, top
    sh = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh).rounded_rectangle([dx + 14, dy + 36, dx + dw - 14, dy + dh + 30], 92, fill=140 if th == 'light' else 220)
    can = Image.composite(Image.new('RGB', (W, H), '#3A2E24' if th == 'light' else '#000000'), can, sh.filter(ImageFilter.GaussianBlur(56)))
    can.paste(Image.new('RGB', (dw, dh), '#1E1B18'), (dx, dy), rounded((dw, dh), 92))
    can.paste(shot, (dx + bez, dy + bez), rounded(shot.size, 64))
    can.save(os.path.join(SHOTS, 'appstore', f'0{k}-{name.split("-", 1)[1]}.png'))
    print('saved', k, name)
