#!/bin/sh
set -eu

APK="android-rustore/app/build/outputs/apk/debug/app-debug.apk"
OUT="android-rustore/smoke"
mkdir -p "$OUT"

test -s "$APK"
adb install -r "$APK"
adb logcat -c
# Prevent Android's one-time immersive-mode education card from covering
# the game and intercepting the automated touch/keyboard validation.
adb shell settings put secure immersive_mode_confirmations confirmed || true
adb shell am force-stop com.kalandos240.astromenace.debug || true
adb shell am start -W -n com.kalandos240.astromenace.debug/com.kalandos240.astromenace.MainActivity

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
  sleep 25
fi

adb exec-out screencap -p > "$OUT/screen-before-input.png" || true

SIZE="$(adb shell wm size | tr -d '\r' | sed -n 's/.*: \([0-9][0-9]*\)x\([0-9][0-9]*\).*/\1 \2/p' | tail -n 1)"
WIDTH="$(printf '%s' "$SIZE" | awk '{print $1}')"
HEIGHT="$(printf '%s' "$SIZE" | awk '{print $2}')"

adb exec-out screencap -p > "$OUT/screen.png" || true

if [ "$menu_visible" = "1" ] && [ -n "${WIDTH:-}" ] && [ -n "${HEIGHT:-}" ]; then
  # Open Start Game -> profile screen, tap the pilot-name input and exercise
  # the real Android IME path. Coordinates are normalized against the
  # edge-to-edge canvas, so this also covers the full-screen mobile layout.
  adb shell input tap "$((WIDTH * 50 / 100))" "$((HEIGHT * 20 / 100))" || true
  sleep 4
  # Fresh profiles show the built-in "tips and tricks" dialog once. Android
  # Back is mapped to Escape by the app, so dismiss that modal before tapping
  # the name field.
  adb shell input keyevent 4 || true
  sleep 2
  adb exec-out screencap -p > "$OUT/screen-profile-before-keyboard.png" || true
  adb shell input tap "$((WIDTH * 35 / 100))" "$((HEIGHT * 32 / 100))" || true
  sleep 1
  adb shell input text MobilePilot || true
  sleep 1
  adb shell input keyevent 66 || true
  sleep 2
  adb logcat -d > "$OUT/logcat-after-input.txt"

  if ! grep -q 'AstroMenaceAndroid.*SOFT_KEYBOARD_SHOW' "$OUT/logcat-after-input.txt"; then
    echo "Android profile keyboard was not requested." >&2
    exit 1
  fi
  if ! grep -q 'AstroMenaceAndroid.*NATIVE_IME_TEXT_CHANGE' "$OUT/logcat-after-input.txt"; then
    echo "Native Android EditText did not receive the pilot name." >&2
    exit 1
  fi
  if ! grep -q 'AstroMenaceAndroid.*PROFILE_NAME_HOTSPOT' "$OUT/logcat-after-input.txt"; then
    echo "Mobile pilot-name hotspot was not detected." >&2
    exit 1
  fi
  if ! grep -q 'TextInput, Unicode:' "$OUT/logcat-after-input.txt"; then
    echo "Android profile text did not reach SDL text input." >&2
    exit 1
  fi
  adb exec-out screencap -p > "$OUT/screen-after-profile-input.png" || true
fi

adb shell dumpsys meminfo com.kalandos240.astromenace.debug > "$OUT/meminfo.txt" || true
adb logcat -d > "$OUT/logcat.txt"

if ! grep -q 'AstroMenaceAndroid.*FULLSCREEN_CANVAS_PASS' "$OUT/logcat.txt"; then
  echo "Android canvas did not validate as full-screen." >&2
  grep 'AstroMenaceAndroid.*FULLSCREEN_CANVAS' "$OUT/logcat.txt" || true
  exit 1
fi

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
