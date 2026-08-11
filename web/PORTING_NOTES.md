# AstroMenace WebAssembly porting notes

This document records browser-specific engineering decisions for the Yandex Games port.

## Renderer

AstroMenace uses a sizeable OpenGL 1.x/2.x fixed-function surface in addition to newer extension entry points. Emscripten's built-in legacy GL emulation does not cover every function used by the game, so the primary browser build uses **gl4es** on top of WebGL/GLES2.

The CI build compiles a pinned gl4es revision as a static library and places its headers before Emscripten's GL headers. Under Emscripten, gl4es mangles fixed-function OpenGL calls to its compatibility implementation while still obtaining the browser GL entry points through Emscripten.

`initialize_gl4es()` must run after SDL creates the WebGL context. The CI-only source-preparation script is:

```text
scripts/enable_gl4es_web.py
```

The older `build-web.yml` legacy-GL experiment is retained only as a diagnostic reference while the gl4es pipeline is brought up.

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

`web/yandex-pre.js` mounts IDBFS there before the game starts. Local files are synchronized to IndexedDB and mirrored to Yandex Player data when a player object is available.

## Runtime game data

The game continues to use its normal `gamedata.vfs`. CI creates that VFS with the native AstroMenace packer before the WebAssembly link step.

`gamedata/models/models.pack` is **required as an input to the upstream VFS builder**. The packer reads the model data from this archive while creating `gamedata.vfs`; removing it before the packing step creates an invalid/header-only VFS. It is therefore kept during VFS generation.

The browser distribution does **not** ship the raw `models.pack` tree separately. Emscripten preloads only the generated `gamedata.vfs`, so the final Yandex package contains the packed runtime data once rather than both the source archive and the generated VFS.

CI rejects a generated VFS smaller than 1 MiB to catch accidental empty packs before an artifact is published.

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
