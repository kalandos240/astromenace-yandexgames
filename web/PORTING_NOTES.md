# AstroMenace WebAssembly porting notes

This document records browser-specific engineering decisions for the Yandex Games port.

## Renderer

AstroMenace uses a sizeable OpenGL 1.x/2.x fixed-function surface in addition to newer extension entry points. Emscripten's built-in legacy GL emulation does not cover every function used by the game, so the supported browser build uses **gl4es** on top of WebGL/GLES2.

The CI build compiles a pinned gl4es revision as a static library and places its headers before Emscripten's GL headers. Under Emscripten, gl4es maps AstroMenace's fixed-function OpenGL calls to its compatibility implementation while obtaining the browser GL entry points through Emscripten.

`initialize_gl4es()` must run after SDL creates the WebGL context. Browser-only source preparation is performed by:

```text
scripts/enable_gl4es_web.py
```

The same CI-only preparation step prevents SDL from requesting desktop fullscreen, supplies a deterministic **1280×720** window mode for the WebGL backbuffer, and lets the external CSS shell fit that 16:9 surface inside arbitrary Yandex iframe sizes without stretching it.

The obsolete legacy-GL workflow has been removed; the gl4es workflow is the single supported browser renderer pipeline in this repository.

## GLU subset

AstroMenace references only a small part of GLU in the runtime renderer:

- `gluPerspective`
- `gluLookAt`
- `gluBuild2DMipmaps`

The WebAssembly build supplies these helpers from:

```text
web/web_glu_compat.cpp
```

This avoids shipping or maintaining a full GLU implementation in the Yandex package.

## Persistent saves

For `__EMSCRIPTEN__`, `GetConfigPath()` points to:

```text
/persistent/
```

`web/yandex-pre.js` mounts IDBFS there before the game starts. Local configuration and pilot-profile files are synchronized to IndexedDB and mirrored to Yandex Player data when a player object is available.

The browser build also patches the normal mission-completion save path so `SaveXMLConfigFile()` runs immediately before leaving a completed mission, followed by an IDBFS/cloud flush. This avoids depending on the desktop process-shutdown path, which a browser tab may never execute.

## Yandex platform integration

The bridge initializes the Yandex Games SDK before releasing the Emscripten startup dependency. It then:

- uses Yandex locale information to select AstroMenace's shipped text language;
- supports the six text translations present in `gamedata/lang/text.csv`: EN, DE, RU, PL, ES and TR;
- relies on AstroMenace's own translation table to fall back to English voice/bitmap assets where a language does not ship dedicated files;
- calls `LoadingAPI.ready()` only after game assets have loaded and the main menu is interactive;
- forwards `game_api_pause` / `game_api_resume` into AstroMenace's existing SDL focus-pause path;
- suspends/resumes browser audio contexts with platform pause state;
- flushes saves on page hide/visibility changes and periodically while playing.

## CSP-safe browser shell

The custom browser shell keeps authored executable code and styles outside `index.html`:

```text
web/shell.html
web/astromenace.css
web/yandex-pre.js
```

The release workflow audits generated `dist/index.html` and rejects custom inline `<style>` blocks, inline event handlers, or script tags without a `src` attribute. The Emscripten-generated runtime script remains external.

## Runtime game data

The game continues to use its normal `gamedata.vfs`. CI creates that VFS with the native AstroMenace packer before the WebAssembly link step.

`gamedata/models/models.pack` is **required as an input to the upstream VFS builder**. The packer reads model data from this archive while creating `gamedata.vfs`; removing it before the packing step creates an invalid/header-only VFS. It is therefore kept during VFS generation.

The browser distribution does **not** ship the raw `models.pack` tree separately. Emscripten preloads only the generated `gamedata.vfs`, so the final package contains the packed runtime data once rather than both the source archive and generated VFS.

CI rejects a generated VFS smaller than 1 MiB to catch accidental empty packs before an artifact is published.

## Distribution-size optimization

The Yandex Games build is optimized in a temporary CI copy of `gamedata`; upstream/source assets in the repository are not destructively changed.

Two optimizations are applied before VFS generation:

1. Uncompressed 24/32-bit type-2 TGA textures are losslessly converted to AstroMenace-supported type-10 TGA RLE when the RLE representation is smaller. This saves about **13.1 MB** in the complete data set without changing pixels.
2. Uncompressed PCM WAV clips are resampled to **16 kHz** for the browser distribution while preserving channel count and sample width. Music remains in its original Ogg Vorbis form. This creates enough package headroom without removing missions, models, textures, music tracks, text translations, voice assets or gameplay content.

The release pipeline validates the total uncompressed recursive `dist/` size and publishes the artifact only if it remains below the conservative **100,000,000-byte** target.

## Distribution notices

The generated artifact includes:

- AstroMenace's `LICENSE.md` and `AUTHORS.md`;
- GPL-3.0, CC BY-SA 4.0 and SIL OFL 1.1 license texts used by the upstream project/assets;
- the gl4es license notice;
- the Emscripten license notice;
- `SOURCE_CODE.txt` pointing to the exact repository revision used for the build and the upstream projects.

## Current CI

Primary workflow:

```text
.github/workflows/build-web-gl4es.yml
```

Expected successful artifact:

```text
astromenace-yandexgames-web-gl4es
```

CI writes its latest diagnostics to `web/BUILD_STATUS_GL4ES.md` and companion log files.
