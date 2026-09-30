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
  # 1) Main menu -> Profiles. Do not use Android Back here: Escape can close
  # both a first-run dialog and the underlying menu in the same frame.
  adb shell input tap "$((WIDTH * 50 / 100))" "$((HEIGHT * 26 / 100))" || true
  sleep 4

  # If the first-run profile hint is visible, this is its CLOSE button.
  # On the profile screen itself the same coordinate is harmless.
  adb shell input tap "$((WIDTH * 70 / 100))" "$((HEIGHT * 83 / 100))" || true
  sleep 2
  adb exec-out screencap -p > "$OUT/screen-profile.png" || true

  # 2) Real profile-name input through Android IME.
  adb shell input tap "$((WIDTH * 35 / 100))" "$((HEIGHT * 31 / 100))" || true
  sleep 2
  adb shell input text MobilePilot || true
  sleep 1
  adb shell input keyevent 66 || true
  sleep 3
  adb logcat -d > "$OUT/logcat-after-input.txt"

  if ! grep -q 'AstroMenaceAndroid.*PROFILE_KEYBOARD_ARMED' "$OUT/logcat-after-input.txt"; then
    echo "Profile keyboard gate was never armed from Start Game." >&2
    exit 1
  fi
  if ! grep -q 'AstroMenaceAndroid.*SOFT_KEYBOARD_SHOW' "$OUT/logcat-after-input.txt"; then
    echo "Android profile keyboard was not requested on the profile screen." >&2
    exit 1
  fi
  if ! grep -q 'AstroMenaceAndroid.*NATIVE_IME_TEXT_CHANGE' "$OUT/logcat-after-input.txt"; then
    echo "Native Android EditText did not receive the pilot name." >&2
    exit 1
  fi
  if ! grep -q 'TextInput, Unicode:' "$OUT/logcat-after-input.txt"; then
    echo "Android profile text did not reach SDL text input." >&2
    exit 1
  fi
  adb exec-out screencap -p > "$OUT/screen-after-profile-input.png" || true

  # 3) Profiles -> Mission List -> Workshop.
  # The bottom-right button occupies the same location in both profile and
  # mission menus (MISSION LIST / NEXT).
  adb shell input tap "$((WIDTH * 63 / 100))" "$((HEIGHT * 91 / 100))" || true
  sleep 4
  adb exec-out screencap -p > "$OUT/screen-mission-list.png" || true
  adb shell input tap "$((WIDTH * 63 / 100))" "$((HEIGHT * 91 / 100))" || true
  sleep 5

  # Close the first Weaponry tip if it is present.
  adb shell input tap "$((WIDTH * 70 / 100))" "$((HEIGHT * 83 / 100))" || true
  sleep 2
  adb exec-out screencap -p > "$OUT/screen-workshop.png" || true

  # Regression: the old global keyboard hotspot overlapped workshop controls.
  # Tapping that exact area must NOT reopen Android's keyboard now.
  BEFORE_IME="$(adb logcat -d | grep -c 'AstroMenaceAndroid.*SOFT_KEYBOARD_SHOW' || true)"
  adb shell input tap "$((WIDTH * 35 / 100))" "$((HEIGHT * 31 / 100))" || true
  sleep 2
  AFTER_IME="$(adb logcat -d | grep -c 'AstroMenaceAndroid.*SOFT_KEYBOARD_SHOW' || true)"
  if [ "$AFTER_IME" -ne "$BEFORE_IME" ]; then
    echo "Workshop tap incorrectly reopened the profile keyboard." >&2
    exit 1
  fi
  echo "Workshop keyboard regression: PASS"

  # 4) Start mission. The first run may show the keyboard-shortcuts hint;
  # press its START button as well.
  adb shell input tap "$((WIDTH * 84 / 100))" "$((HEIGHT * 91 / 100))" || true
  sleep 3
  adb shell input tap "$((WIDTH * 73 / 100))" "$((HEIGHT * 83 / 100))" || true

  gameplay=0
  n=1
  while [ "$n" -le 25 ]; do
    adb logcat -d > "$OUT/logcat-gameplay-wait.txt"
    if grep -q 'AstroMenaceAndroid.*GAMEPLAY_CONTROLS_SHOW joystick-only' "$OUT/logcat-gameplay-wait.txt"; then
      gameplay=1
      break
    fi
    if grep -Eq 'AstroMenaceAndroid.*(STARTUP_ERROR|RENDER_PROCESS_GONE)|FATAL EXCEPTION.*com.kalandos240.astromenace' "$OUT/logcat-gameplay-wait.txt"; then
      break
    fi
    sleep 2
    n=$((n + 1))
  done

  if [ "$gameplay" != "1" ]; then
    echo "Mission did not reach native joystick gameplay state." >&2
    exit 1
  fi

  adb exec-out screencap -p > "$OUT/screen-gameplay.png" || true

  # Direct center-screen finger steering must be swallowed by Android.
  adb shell input tap "$((WIDTH * 50 / 100))" "$((HEIGHT * 50 / 100))" || true
  sleep 1

  # Exercise the analog joystick with a diagonal swipe.
  adb shell input swipe     "$((WIDTH * 12 / 100))" "$((HEIGHT * 80 / 100))"     "$((WIDTH * 18 / 100))" "$((HEIGHT * 68 / 100))" 450 || true
  sleep 1

  # 5) Pause -> Quit -> YES. This was the reported freeze path.
  adb shell input tap "$((WIDTH * 4 / 100))" "$((HEIGHT * 8 / 100))" || true
  sleep 3
  adb exec-out screencap -p > "$OUT/screen-pause-menu.png" || true
  adb shell input tap "$((WIDTH * 50 / 100))" "$((HEIGHT * 73 / 100))" || true
  sleep 2
  adb exec-out screencap -p > "$OUT/screen-quit-confirm.png" || true
  adb shell input tap "$((WIDTH * 42 / 100))" "$((HEIGHT * 60 / 100))" || true
  sleep 8
  adb exec-out screencap -p > "$OUT/screen-after-confirmed-quit.png" || true

  adb logcat -d > "$OUT/logcat-after-regressions.txt"
  if grep -Eq 'AstroMenaceAndroid.*(STARTUP_ERROR|RENDER_PROCESS_GONE)|FATAL EXCEPTION.*com.kalandos240.astromenace' "$OUT/logcat-after-regressions.txt"; then
    echo "Crash/render failure detected during workshop/gameplay/quit regression." >&2
    exit 1
  fi
  if ! grep -q 'AstroMenaceAndroid.*GAMEPLAY_CANVAS_TOUCH_BLOCKED' "$OUT/logcat-after-regressions.txt"; then
    echo "Direct gameplay canvas touches were not blocked." >&2
    exit 1
  fi
  if ! grep -q 'AstroMenaceAndroid.*JOYSTICK_ACTIVE' "$OUT/logcat-after-regressions.txt"; then
    echo "Native joystick did not emit directional input." >&2
    exit 1
  fi
  if ! grep -q 'AstroMenaceAndroid.*PAUSE_BUTTON_TAPPED' "$OUT/logcat-after-regressions.txt"; then
    echo "Pause button regression path was not exercised." >&2
    exit 1
  fi
  if ! adb shell pidof com.kalandos240.astromenace.debug >/dev/null 2>&1; then
    echo "AstroMenace process died during confirmed quit-to-menu path." >&2
    exit 1
  fi
  echo "Workshop + joystick + pause/quit regressions: PASS"
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
