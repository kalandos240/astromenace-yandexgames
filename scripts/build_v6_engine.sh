set -euo pipefail
mapfile -t SOURCES < <(find src -type f -name "*.cpp" -print | sort)
em++ "${SOURCES[@]}" web/web_glu_compat.cpp web/v7-smoke.cpp \
  -std=c++11 -O3 -flto -fno-exceptions -fno-rtti \
  -DASTROMENACE_WEB_ASYNC_STARTUP=1 ${ASTROMENACE_TEST_FLAGS:-} \
  -I/tmp/gl4es/include -I. -Isrc \
  /tmp/gl4es/lib/libGL.a \
  -sUSE_SDL=2 \
  -sUSE_FREETYPE=1 \
  -sUSE_OGG=1 \
  -sUSE_VORBIS=1 \
  -lopenal \
  -sALLOW_MEMORY_GROWTH=1 \
  -sFULL_ES2=1 \
  -sGL_ENABLE_GET_PROC_ADDRESS=1 \
  -sFORCE_FILESYSTEM=1 \
  -sENVIRONMENT=web \
  -sASYNCIFY=1 \
  -sASYNCIFY_STACK_SIZE=65536 \
  -sSINGLE_FILE=1 \
  -sEXPORTED_RUNTIME_METHODS=ccall \
  --pre-js web/mobile-controls.js \
  --pre-js web/yandex-offline-pre.js \
  -o dist/index.js \
  2>&1 | tee web/OFFLINE_BUILD_LOG.txt
