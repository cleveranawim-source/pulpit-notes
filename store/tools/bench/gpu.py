# 맥 GPU 'Device Utilization %' 를 0.5초마다 읽어 평균(시뮬레이터 화면 합성은 맥 GPU 가 맡는다): python3 gpu.py 초
import re, subprocess, sys, time
sec = float(sys.argv[1]); xs = []
t_end = time.time() + sec
while time.time() < t_end:
    o = subprocess.run(['ioreg', '-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], capture_output=True, text=True).stdout
    m = re.search(r'"Device Utilization %"=(\d+)', o)
    if m: xs.append(int(m.group(1)))
    time.sleep(0.5)
print(f'GPU 평균 {sum(xs)/len(xs):.1f}% (표본 {len(xs)})')
