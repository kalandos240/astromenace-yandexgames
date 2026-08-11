# AstroMenace for Yandex Games

[![Build AstroMenace WebAssembly](https://github.com/kalandos240/astromenace-yandexgames/actions/workflows/build-web-gl4es.yml/badge.svg)](https://github.com/kalandos240/astromenace-yandexgames/actions/workflows/build-web-gl4es.yml)

Browser/WebAssembly adaptation of the open-source **AstroMenace** space shooter for **Yandex Games**.

> This repository is a community port. AstroMenace was created by the Viewizard team. The original project is available at [viewizard/astromenace](https://github.com/viewizard/astromenace).

<p align="center">
  <img src="./share/preview1.png" alt="AstroMenace gameplay" width="760" />
</p>

## Port status

The Yandex Games port is under active development. The current work includes:

- C++/SDL2 to WebAssembly compilation with Emscripten;
- browser-safe Emscripten main loop;
- gl4es-based OpenGL 1.x/2.x compatibility on top of WebGL;
- small web-only GLU compatibility helpers for AstroMenace;
- Yandex Games SDK initialization;
- `LoadingAPI.ready()` integration;
- automatic Yandex language detection;
- pause/resume handling for platform events and ads;
- local persistent saves with IDBFS;
- Yandex Player cloud-save synchronization;
- full-screen browser canvas/shell;
- automated GitHub Actions WebAssembly builds;
- runtime package optimization for the Yandex Games size limit.

The current renderer/build diagnostics are written to [`web/BUILD_STATUS_GL4ES.md`](./web/BUILD_STATUS_GL4ES.md) after a CI run. Asset-size analysis is available in [`web/ASSET_SIZE_REPORT.txt`](./web/ASSET_SIZE_REPORT.txt).

## Building the web version

The current reproducible WebAssembly build is defined in:

```text
.github/workflows/build-web-gl4es.yml
```

Run **Build AstroMenace WebAssembly (gl4es)** from the repository's GitHub Actions page. A successful run produces the artifact:

```text
astromenace-yandexgames-web-gl4es
```

The artifact contains a Yandex Games-ready web root with `index.html`, JavaScript, WebAssembly and packaged game data.

The older `build-web.yml` workflow is retained temporarily as a diagnostic reference while the renderer migration is completed.

## Yandex Games integration

The JavaScript bridge is located at:

```text
web/yandex-pre.js
```

The browser shell is located at:

```text
web/shell.html
```

Web-specific C++ changes are guarded with `__EMSCRIPTEN__` where practical, so the native source structure stays close to upstream AstroMenace.

## Package-size optimization

The original game-data tree contains development/source material that is not required by the runtime. The web build keeps the complete material in this public source repository while excluding non-runtime data from the Yandex distribution package. No gameplay missions, runtime models, textures, sounds or music are intentionally removed by this optimization step.

## Upstream projects

- Original AstroMenace: [viewizard/astromenace](https://github.com/viewizard/astromenace)
- Emscripten groundwork used during this port: [midzer/astromenace](https://github.com/midzer/astromenace)
- OpenGL compatibility layer used by the browser build: [ptitSeb/gl4es](https://github.com/ptitSeb/gl4es)

## License

AstroMenace source code is distributed under **GNU GPL v3 or later**. Game assets include GPLv3, CC BY-SA 4.0 and SIL OFL 1.1 material as documented by the upstream project.

See [`LICENSE.md`](./LICENSE.md) and the [`licenses/`](./licenses/) directory for the complete notices and license texts. Modifications made in this repository are distributed under the applicable upstream licensing terms.

## Credits

AstroMenace copyright © 2006–2019 Mikhail Kurinnoi / Viewizard and contributors.

This repository contains the Yandex Games / WebAssembly adaptation and does not claim ownership of the original AstroMenace project or artwork.
