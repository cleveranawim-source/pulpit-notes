#!/bin/zsh
# 측정용 앱을 다시 켜고 기기 전체를 기록(Power Profiler·Activity Monitor·Thermal State·Display). Xcode 가 켜져 있어야 기록 도구가 기기를 본다
# 쓰는 법: record-all.sh <기기 UDID> <초> <출력 이름>
DEV=$1; SEC=$2; NAME=$3; OUT=${0:A:h}/out
open -g -a Xcode
until xcrun xctrace list devices 2>/dev/null | sed -n '/== Devices ==/,/== Devices Offline ==/p' | grep -q "$DEV"; do sleep 2; done
xcrun devicectl device process launch --device $DEV --terminate-existing com.yeolstudio.pulpitnotes >/dev/null 2>&1
date +%s > $OUT/$NAME.launch; echo "앱 실행 $(date +%H:%M:%S)"
rm -rf $OUT/$NAME.trace
xcrun xctrace record --device $DEV --instrument 'Power Profiler' --instrument 'Activity Monitor' --instrument 'Thermal State' --instrument 'Display' --all-processes --time-limit ${SEC}s --output $OUT/$NAME.trace 2>&1
echo "끝 $(date +%H:%M:%S)"
