#!/usr/bin/env bash
set -euo pipefail

GAME_DIR="${1:?Usage: build_android_engine.sh <game-assets-dir>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/astromenace-android-engine"

rm -rf "${WORK}"
mkdir -p "${WORK}"

EMSDK="${WORK}/emsdk"
GL4ES="${WORK}/gl4es"
GL4ES_BUILD="${WORK}/gl4es-build"

git clone --depth 1 https://github.com/emscripten-core/emsdk.git "${EMSDK}"
(
  cd "${EMSDK}"
  ./emsdk install latest
  ./emsdk activate latest
)
# shellcheck disable=SC1091
source "${EMSDK}/emsdk_env.sh"

git init "${GL4ES}"
git -C "${GL4ES}" remote add origin https://github.com/ptitSeb/gl4es.git
git -C "${GL4ES}" fetch --depth 1 origin 81547d986798e876de8b434193920b606a72363f
git -C "${GL4ES}" checkout --detach FETCH_HEAD

emcmake cmake -S "${GL4ES}" -B "${GL4ES_BUILD}"   -DCMAKE_BUILD_TYPE=Release   -DNOX11=ON   -DNOEGL=ON   -DSTATICLIB=ON   -DDEFAULT_ES=2
cmake --build "${GL4ES_BUILD}" --target GL -j2

mapfile -t SOURCES < <(find "${ROOT}/src" -type f -name '*.cpp' -print | sort)

em++ "${SOURCES[@]}" "${ROOT}/web/web_glu_compat.cpp"   -std=c++11 -O3 -flto -fno-exceptions -fno-rtti   -DASTROMENACE_WEB_ASYNC_STARTUP=1   -DASTROMENACE_ANDROID_BUILD=1   -I"${GL4ES}/include" -I"${ROOT}" -I"${ROOT}/src"   "${GL4ES}/lib/libGL.a"   -sUSE_SDL=2   -sUSE_FREETYPE=1   -sUSE_OGG=1   -sUSE_VORBIS=1   -lopenal   -sALLOW_MEMORY_GROWTH=1   -sFULL_ES2=1   -sGL_ENABLE_GET_PROC_ADDRESS=1   -sFORCE_FILESYSTEM=1   -sENVIRONMENT=web   -sASYNCIFY=1   -sASYNCIFY_STACK_SIZE=65536   -sSINGLE_FILE=1   --pre-js "${ROOT}/web/yandex-offline-pre.js"   -o "${GAME_DIR}/index.js"

test -s "${GAME_DIR}/index.js"
grep -q 'decodeEmbeddedGzip' "${GAME_DIR}/index.js"
echo "Android-tuned WebAssembly engine built: $(du -h "${GAME_DIR}/index.js" | awk '{print $1}')"
