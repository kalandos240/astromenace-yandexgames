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

if [ "$menu_visible" = "1" ] && [ -n "${WIDTH:-}" ] && [ -n "${HEIGHT:-}" ]; then
  # On overloaded CI emulators Pixel Launcher can raise its own ANR dialog
  # above the foreground game. Tap "Wait" if it is present; on a normal
  # device this tap is harmless and does not target any AstroMenace button.
  adb shell input tap "$((WIDTH * 35 / 100))" "$((HEIGHT * 63 / 100))" || true
  sleep 2
fi

adb exec-out screencap -p > "$OUT/screen.png" || true

if [ "$menu_visible" = "1" ] && [ -n "${WIDTH:-}" ] && [ -n "${HEIGHT:-}" ]; then
  # Open Start Game -> profile screen, tap the pilot-name input and exercise
  # the real Android IME path. Start Game is centered around 26% screen height
  # in the stretched edge-to-edge Android layout.
  adb shell input tap "$((WIDTH * 50 / 100))" "$((HEIGHT * 26 / 100))" || true
  sleep 5
  adb exec-out screencap -p > "$OUT/screen-profile-before-keyboard.png" || true

  # New Pilot Profile text field: internal 1228x768 coordinates roughly
  # X=242..832, Y=224..254, mapped to the full-screen canvas.
  adb shell input tap "$((WIDTH * 35 / 100))" "$((HEIGHT * 31 / 100))" || true
  sleep 2
  adb shell input text MobilePilot || true
  sleep 1
  adb shell input keyevent 66 || true
  sleep 3
  adb logcat -d > "$OUT/logcat-after-input.txt"

  if ! grep -q 'AstroMenaceAndroid.*SOFT_KEYBOARD_SHOW' "$OUT/logcat-after-input.txt"; then
    echo "Android profile keyboard was not requested." >&2
    exit 1
  fi
  if ! grep -q 'AstroMenaceAndroid.*NATIVE_IME_TEXT_CHANGE' "$OUT/logcat-after-input.txt"; then
    echo "Native Android EditText did not receive the pilot name." >&2
    exit 1
  fi
  if ! grep -Eq 'AstroMenaceAndroid.*(PROFILE_NAME_TAP|PROFILE_NAME_HOTSPOT)' "$OUT/logcat-after-input.txt"; then
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
