#!/bin/zsh
# 측정용 앱을 다시 켜고, 강단노트 처리 과정에 붙여 Power Profiler 로 기록(저장까지 끝나야 끝남)
# 쓰는 법: record.sh <기기 UDID> <초> <출력 이름> [템플릿]
DEV=$1; SEC=$2; NAME=$3; TPL=${4:-Power Profiler}; OUT=${0:A:h}/out
xcrun devicectl device info apps --device $DEV --bundle-id com.yeolstudio.pulpitnotes --json-output /tmp/pn-apps.json >/dev/null 2>&1
BUNDLE=$(python3 -c "import json;d=json.load(open('/tmp/pn-apps.json'));print(d['result']['apps'][0]['url'].replace('file://','').rstrip('/'))")
xcrun devicectl device process launch --device $DEV --terminate-existing com.yeolstudio.pulpitnotes >/dev/null 2>&1
date +%s > $OUT/$NAME.launch
sleep 3  # 기록 도구가 새 처리 과정을 알아볼 틈
PID=$(xcrun devicectl device info processes --device $DEV 2>/dev/null | grep "${BUNDLE#/private}/App\|$BUNDLE/App" | awk '{print $1}' | head -1)
echo "앱 경로 $BUNDLE · PID $PID"
for i in 1 2 3; do
  rm -rf $OUT/$NAME.trace
  xcrun xctrace record --device $DEV --template "$TPL" --time-limit ${SEC}s --attach $PID --output $OUT/$NAME.trace 2>&1 | tee $OUT/$NAME.log
  grep -q "Cannot find process" $OUT/$NAME.log || break
  sleep 2
done
echo "끝 $(date +%H:%M:%S)"
