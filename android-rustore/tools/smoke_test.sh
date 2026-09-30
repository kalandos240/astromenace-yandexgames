#!/bin/sh
set -eu

APK="android-rustore/app/build/outputs/apk/debug/app-debug.apk"
OUT="android-rustore/smoke"
mkdir -p "$OUT"

test -s "$APK"
adb install -r "$APK"
adb logcat -c
adb shell am force-stop com.kalandos240.astromenace.debug || true
adb shell am start -W -n com.kalandos240.astromenace.debug/com.kalandos240.astromenace.MainActivity

ready=0
i=1
while [ "$i" -le 120 ]; do
  adb logcat -d > "$OUT/logcat-live.txt"

  if grep -q 'AstroMenaceAndroid.*GAME_READY' "$OUT/logcat-live.txt"; then
    ready=1
    echo "AstroMenace reached GAME_READY."
    break
  fi

  if grep -Eq 'AstroMenaceAndroid.*(STARTUP_ERROR|RENDER_PROCESS_GONE)|FATAL EXCEPTION.*com.kalandos240.astromenace' "$OUT/logcat-live.txt"; then
    echo "AstroMenace startup failure detected."
    break
  fi

  sleep 2
  i=$((i + 1))
done

adb exec-out screencap -p > "$OUT/screen.png" || true
adb shell dumpsys meminfo com.kalandos240.astromenace.debug > "$OUT/meminfo.txt" || true
adb logcat -d > "$OUT/logcat.txt"

if [ "$ready" != "1" ]; then
  echo "AstroMenace did not reach GAME_READY."
  tail -n 400 "$OUT/logcat.txt"
  exit 1
fi

echo "Android emulator smoke test: PASS"
