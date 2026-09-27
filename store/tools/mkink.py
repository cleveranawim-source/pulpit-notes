import json, math, random
random.seed(7)
import os
os.chdir(os.path.join(os.path.dirname(__file__), 'cache'))
d=json.load(open('rich-text.json'))
def find(pg, phrase):
    s=''.join(c['ch'] for c in pg['chars']); i=s.find(phrase)
    if i<0: return []
    cs=pg['chars'][i:i+len(phrase)]; lines=[]
    for c in cs:
        if lines and abs(lines[-1][-1]['y']-c['y'])<1: lines[-1].append(c)
        else: lines.append([c])
    return [(l[0]['x'], l[-1]['x']+l[-1]['w'], l[0]['y'], l[0]['fs']) for l in lines]
def N(pg, x, ytop): return [round(x/pg['W'],5), round(ytop/pg['H'],5)]
strokes={}
RED='#D23B2E'; BLUE='#2456C8'; YEL='#FFE45C'; GRN='#A8E890'
def add(p,s): strokes.setdefault(p,[]).append(s)
def underline(p,pg,x0,x1,y,fs,color):
    yt=pg['H']-y+0.28*fs; n=26; pts=[]
    for k in range(n+1):
        t=k/n; x=x0-2+(x1-x0+4)*t; yy=yt+math.sin(t*5.3+0.7)*0.55+t*0.9
        pts+=N(pg,x,yy)+[round(0.35+0.3*math.sin(t*math.pi)+random.uniform(-.03,.03),2)]
    add(p,{'t':'pen','c':color,'w':0.0034,'p':pts})
def highlight(p,pg,x0,x1,y,fs,color):
    yt=pg['H']-y-0.33*fs; add(p,{'t':'hl','c':color,'w':round(1.3*fs/pg['W'],5),'p':N(pg,x0-1,yt)+[0.5]+N(pg,x1+1,yt)+[0.5]})
def circle(p,pg,x0,x1,y,fs,color):
    cx=(x0+x1)/2; cy=pg['H']-y-0.35*fs; rx=(x1-x0)/2+7; ry=0.95*fs; pts=[]; n=48
    for k in range(n+1):
        a=-2.5+k/n*2*math.pi*1.07; r=1+0.04*math.sin(a*3)
        pts+=N(pg,cx+rx*r*math.cos(a),cy+ry*r*math.sin(a))+[round(0.45+0.15*math.sin(a),2)]
    add(p,{'t':'pen','c':color,'w':0.0034,'p':pts})
def slash(p,pg,x,y,fs,color):
    yt=pg['H']-y
    for dx in (5,11): add(p,{'t':'pen','c':color,'w':0.003,'p':N(pg,x+dx,yt+0.15*fs)+[0.5]+N(pg,x+dx+3.2,yt-0.55*fs)+[0.55]+N(pg,x+dx+6,yt-1.0*fs)+[0.4]})
def check(p,pg,x,y,fs,color):
    yt=pg['H']-y-0.3*fs
    add(p,{'t':'pen','c':color,'w':0.0036,'p':N(pg,x,yt)+[0.4]+N(pg,x+3,yt+3.5)+[0.6]+N(pg,x+5,yt+5)+[0.6]+N(pg,x+9,yt-2)+[0.5]+N(pg,x+14,yt-8)+[0.35]})
plan=[('u','빈 그물을 씻는 손은 유난히 무겁습니다.',RED),('h','실패한 사람의 빈 배가 말씀이 선포되는 자리가 되었습니다.',YEL),('c','경험보다 말씀을',RED),
      ('h','한 번 더 그물을 내리는 작은 순종',GRN),('s','그런 아침을 맞았습니다.',BLUE),('k','믿음은 거창한',RED),
      ('u','그 순종이 확신을 낳았습니다.',BLUE),('h','두려워하지 말라',YEL),('u','주님은 빈 그물을 탓하지 않으십니다.',BLUE),('u','빈 손을 들고 나아가는 그 자리에서',BLUE)]
for kind,ph,col in plan:
    for pi,pg in enumerate(d):
        segs=find(pg,ph)
        if not segs: continue
        if kind=='u': [underline(pi,pg,*sg,col) for sg in segs]
        elif kind=='h': [highlight(pi,pg,*sg,col) for sg in segs]
        elif kind=='c': circle(pi,pg,*segs[0],col)
        elif kind=='s': slash(pi,pg,segs[-1][1],segs[-1][2],segs[-1][3],col)
        elif kind=='k': check(pi,pg,segs[0][0]-17,segs[0][2],segs[0][3],col)
        break
    else: print('없음:',ph)
json.dump(strokes,open('rich-ink.json','w')); print({k:len(v) for k,v in strokes.items()})
