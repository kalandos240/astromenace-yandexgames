#!/bin/sh
set -eu

APK="android-rustore/app/build/outputs/apk/debug/app-debug.apk"
OUT="android-rustore/smoke"
mkdir -p "$OUT"

test -s "$APK"

# Source-level guardrails for the mobile-only control surface.
grep -q 'addHoldButton(root, "▲"' android-rustore/app/src/main/java/com/kalandos240/astromenace/MainActivity.java
if grep -q 'class JoystickView' android-rustore/app/src/main/java/com/kalandos240/astromenace/MainActivity.java; then
  echo "Joystick control unexpectedly remains in mobile Activity." >&2
  exit 1
fi
grep -q 'Android/WebView must not wait in the desktop fade-out state' src/game/game.cpp
grep -q 'NeedShowHint\[4\] = false' src/main.cpp
echo "Mobile-only UI source audit: PASS."
adb install -r "$APK"
adb logcat -c
# Prevent Android's one-time immersive-mode education card from covering
# the game and intercepting the automated touch/keyboard validation.
adb shell settings put secure immersive_mode_confirmations confirmed || true
# The CI Pixel Launcher frequently triggers its own ANR under SwiftShader and
# places a system dialog above the game. Hide unrelated system error dialogs
# so input validation targets AstroMenace only.
adb shell settings put global hide_error_dialogs 1 || true
adb shell settings put global show_first_crash_dialog 0 || true
adb shell am force-stop com.kalandos240.astromenace.debug || true
adb shell am start -W -n com.kalandos240.astromenace.debug/com.kalandos240.astromenace.MainActivity --ez astromenace_smoke true

ready=0
menu_visible=0
i=1
while [ "$i" -le 120 ]; do
  adb logcat -d > "$OUT/logcat-live.txt"

  if grep -q 'AstroMenaceAndroid.*GAME_READY' "$OUT/logcat-live.txt"; then
    ready=1
  fi

  if grep -q 'AstroMenaceAndroid.*MENU_VISIBLE' "$OUT/logcat-live.txt"; then
    menu_visible=1
    echo "AstroMenace reached GAME_READY and visible main menu."
    break
  fi

  if grep -Eq 'AstroMenaceAndroid.*(STARTUP_ERROR|RENDER_PROCESS_GONE)|FATAL EXCEPTION.*com.kalandos240.astromenace' "$OUT/logcat-live.txt"; then
    echo "AstroMenace startup failure detected."
    break
  fi

  sleep 2
  i=$((i + 1))
done

if [ "$menu_visible" = "1" ]; then
  # SwiftShader is much slower than a real phone while AstroMenace finishes
  # first-frame OpenGL/menu setup. Wait for the visible menu before taps.
  sleep 15
fi

adb exec-out screencap -p > "$OUT/screen-before-input.png" || true
SIZE="$(python3 - "$OUT/screen-before-input.png" <<'PY'
import struct, sys
with open(sys.argv[1], "rb") as f:
    header = f.read(24)
if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
    raise SystemExit(1)
w, h = struct.unpack(">II", header[16:24])
print(w, h)
PY
)"
WIDTH="$(printf '%s' "$SIZE" | awk '{print $1}')"
HEIGHT="$(printf '%s' "$SIZE" | awk '{print $2}')"
echo "Landscape screenshot size: ${WIDTH}x${HEIGHT}"

adb exec-out screencap -p > "$OUT/screen.png" || true

# Wait for the deterministic native regression suite that runs inside the
# real Activity/WebView after AstroMenace reaches its visible menu.
selftest=0
n=1
while [ "$n" -le 20 ]; do
  adb logcat -d > "$OUT/logcat-selftest.txt"
  if grep -q 'AstroMenaceAndroid.*SMOKE_NATIVE_CONTROLS_PASS' "$OUT/logcat-selftest.txt"; then
    selftest=1
    break
  fi
  if grep -Eq 'AstroMenaceAndroid.*SMOKE_.*_FAIL|AstroMenaceAndroid.*(STARTUP_ERROR|RENDER_PROCESS_GONE)|FATAL EXCEPTION.*com.kalandos240.astromenace' "$OUT/logcat-selftest.txt"; then
    break
  fi
  sleep 1
  n=$((n + 1))
done

if [ "$selftest" != "1" ]; then
  echo "Native Android regression self-test did not complete." >&2
  grep -E 'AstroMenaceAndroid.*SMOKE_|AstroMenaceAndroid.*(STARTUP_ERROR|RENDER_PROCESS_GONE)' "$OUT/logcat-selftest.txt" || true
  exit 1
fi

for marker in   SMOKE_WORKSHOP_IME_GATE_PASS   SMOKE_PROFILE_IME_PASS   SMOKE_GAMEPLAY_TOUCH_BLOCK_PASS   ARROW_CONTROLS_ACTIVE   SMOKE_PAUSE_TOUCH_PASS   SMOKE_QUIT_TO_MENU_GUARD_PASS   SMOKE_NATIVE_CONTROLS_PASS
do
  if ! grep -q "AstroMenaceAndroid.*${marker}" "$OUT/logcat-selftest.txt"; then
    echo "Missing regression marker: ${marker}" >&2
    exit 1
  fi
done
echo "Native IME/arrows/touch/quit regression suite: PASS"

# Background/resume regression: WebView timers, fullscreen and engine must recover.
adb shell input keyevent 3 || true
sleep 2
adb shell am start -W -n com.kalandos240.astromenace.debug/com.kalandos240.astromenace.MainActivity --ez astromenace_smoke true >/dev/null
sleep 4
adb logcat -d > "$OUT/logcat-after-resume.txt"
if grep -Eq 'AstroMenaceAndroid.*(STARTUP_ERROR|RENDER_PROCESS_GONE)|FATAL EXCEPTION.*com.kalandos240.astromenace|ANR in com.kalandos240.astromenace' "$OUT/logcat-after-resume.txt"; then
  echo "Crash/render failure after Android background/resume." >&2
  exit 1
fi
if ! adb shell pidof com.kalandos240.astromenace.debug >/dev/null 2>&1; then
  echo "AstroMenace process is not alive after background/resume." >&2
  exit 1
fi
adb exec-out screencap -p > "$OUT/screen-after-resume.png" || true
echo "Android background/resume regression: PASS"

adb shell dumpsys meminfo com.kalandos240.astromenace.debug > "$OUT/meminfo.txt" || true
adb logcat -d > "$OUT/logcat.txt"

if ! grep -q 'AstroMenaceAndroid.*FULLSCREEN_CANVAS_PASS' "$OUT/logcat.txt"; then
  echo "Android canvas did not validate as full-screen." >&2
  grep 'AstroMenaceAndroid.*FULLSCREEN_CANVAS' "$OUT/logcat.txt" || true
  exit 1
fi

if grep -Eq 'FATAL EXCEPTION.*com.kalandos240.astromenace|ANR in com.kalandos240.astromenace|AstroMenaceAndroid.*(STARTUP_ERROR|RENDER_PROCESS_GONE)' "$OUT/logcat.txt"; then
  echo "Android runtime regression detected." >&2
  grep -E 'FATAL EXCEPTION.*com.kalandos240.astromenace|ANR in com.kalandos240.astromenace|AstroMenaceAndroid.*(STARTUP_ERROR|RENDER_PROCESS_GONE)' "$OUT/logcat.txt" || true
  exit 1
fi

if ! grep -q 'AstroMenaceAndroid.*MOBILE_RENDER_TARGET' "$OUT/logcat.txt"; then
  echo "Adaptive mobile render target was not selected." >&2
  exit 1
fi
if ! grep -q 'AstroMenaceAndroid.*RENDER_BUFFER_PASS' "$OUT/logcat.txt"; then
  echo "SDL/WebGL render buffer did not match the adaptive Android target." >&2
  grep 'AstroMenaceAndroid.*RENDER_BUFFER_' "$OUT/logcat.txt" || true
  exit 1
fi
grep 'AstroMenaceAndroid.*FULLSCREEN_CANVAS_PASS' "$OUT/logcat.txt" | tail -n 1
grep 'AstroMenaceAndroid.*MOBILE_RENDER_TARGET' "$OUT/logcat.txt" | tail -n 1
grep 'AstroMenaceAndroid.*RENDER_BUFFER_PASS' "$OUT/logcat.txt" | tail -n 1

if [ "$ready" != "1" ]; then
  echo "AstroMenace did not reach GAME_READY."
  tail -n 400 "$OUT/logcat.txt"
  exit 1
fi

if [ "$menu_visible" != "1" ]; then
  echo "AstroMenace engine initialized but the main menu never became visible."
  tail -n 400 "$OUT/logcat.txt"
  exit 1
fi

echo "Android emulator smoke test: PASS"
