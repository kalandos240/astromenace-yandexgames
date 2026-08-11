# AstroMenace Yandex Games Port — Notice

This repository contains a modified WebAssembly/browser adaptation of the open-source **AstroMenace** project for Yandex Games.

## Original project

AstroMenace was created by **Mikhail Kurinnoi / Viewizard** and contributors.

- Original project: https://github.com/viewizard/astromenace
- Project website: https://viewizard.com/

Original copyright and attribution notices are intentionally preserved in the source tree, game interface and distributed build where applicable.

## Modifications in this repository

The browser/Yandex Games adaptation includes modifications and integration work such as:

- Emscripten/WebAssembly compilation;
- gl4es-based browser graphics compatibility;
- browser startup and loading changes;
- Yandex Games SDK initialization;
- `LoadingAPI.ready()` and GameplayAPI integration;
- Yandex SDK language detection;
- RU/EN web-runtime localization filtering;
- local and Yandex Player cloud-save synchronization;
- fullscreen-ad scheduling at logical pauses;
- Pointer Lock for mouse gameplay;
- browser focus/audio handling;
- CSP-friendly browser shell;
- web-only asset/package optimization;
- removal of browser-irrelevant UI such as the desktop Quit button.

These port-specific modifications were made during 2026. See the Git history for exact dates, authorship and source revisions.

## Licensing

The repository is not covered by one single license for every file.

AstroMenace source code is distributed under **GNU GPL version 3 or later**. Upstream game assets include material under GPLv3, **CC BY-SA 4.0**, **SIL Open Font License 1.1**, and other notices documented by the original project.

See:

- `LICENSE.md`
- `AUTHORS.md`
- `licenses/`
- license notices embedded in generated web artifacts

Third-party build/runtime components such as Emscripten and gl4es retain their own licenses and copyright notices.

## Source availability

Generated Yandex Games artifacts include `SOURCE_CODE.txt`, which points to the corresponding source revision for the port and identifies important upstream components.

## No affiliation

This community port is **not presented as an official Viewizard or Yandex product**. The repository does not claim ownership of the original AstroMenace game, artwork, music, models, trademarks or other upstream material.
