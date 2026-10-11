# 시뮬레이터 처리 과정들의 누적 CPU 시간을 N초 동안 재서 % 로: python3 cpu.py 초 이름=PID ...
import subprocess, sys, time
def t(pid):
    s = subprocess.run(['ps', '-o', 'time=', '-p', pid], capture_output=True, text=True).stdout.strip()
    if not s: return 0.0
    d = 0
    if '-' in s: dd, s = s.split('-'); d = int(dd) * 86400
    v = 0
    for p in s.split(':'): v = v * 60 + float(p)
    return d + v
sec = float(sys.argv[1]); procs = [a.split('=') for a in sys.argv[2:]]
a = {n: t(p) for n, p in procs}; time.sleep(sec); b = {n: t(p) for n, p in procs}
tot = 0
for n, _ in procs:
    pc = (b[n] - a[n]) / sec * 100; tot += pc
    print(f'{n:10s} {pc:5.1f}%')
print(f'{"합계":9s} {tot:5.1f}%')
