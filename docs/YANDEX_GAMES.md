# Yandex Games integration

This document describes the browser-specific architecture of the AstroMenace Yandex Games port.

## Target

The current published build target is **desktop browser**. The game keeps the original keyboard/mouse-oriented controls and uses Pointer Lock during missions.

Supported runtime languages:

- English
- Russian

## Startup flow

The fast offline build uses the following sequence:

1. load the external browser shell and `gamedata.js`;
2. initialize the Yandex Games SDK when running inside the platform;
3. read `ysdk.environment.i18n.lang` and choose RU/EN;
4. decode and decompress the optimized `gamedata.vfs` into MEMFS;
5. start the WebAssembly engine;
6. initialize SDL/WebGL/gl4es and game assets;
7. open the main menu;
8. call `LoadingAPI.ready()` only after the game is actually ready for interaction.

When the package is opened locally through `file://`, Yandex-specific features are skipped and a local language fallback is used.

## Yandex bridge

Main bridge:

```text
web/yandex-offline-pre.js
```

It owns the browser-side integration for:

- SDK initialization;
- locale selection;
- loading status;
- local/cloud save synchronization;
- GameplayAPI state;
- fullscreen advertisements;
- page visibility and audio handling;
- Pointer Lock;
- embedded VFS installation.

## Language detection

Inside Yandex Games the runtime language is selected from:

```js
ysdk.environment.i18n.lang
```

The WebAssembly runtime contains only Russian and English UI assets. Unsupported locales fall back to English; selected Russian-family fallback locales map to Russian.

The browser's `navigator.language` is used only as a fallback outside Yandex Games, for example when opening the generated build locally.

## Game Ready API

`LoadingAPI.ready()` is intentionally delayed until the engine has finished loading the game data and opened the playable main menu.

This prevents Yandex Games from treating a loading screen as a ready game state.

## GameplayAPI

The port marks actual mission gameplay separately from menus and pauses:

```text
Mission starts / resume  -> GameplayAPI.start()
Pause / menu / mission end -> GameplayAPI.stop()
```

Platform pauses and fullscreen ads also force the gameplay state to stop until normal play resumes.

## Pointer Lock

During a mission the port requests browser Pointer Lock for the game canvas. This prevents the mouse cursor from leaving the game iframe while controlling the ship.

Pointer Lock is released when:

- gameplay stops;
- the pause/menu state opens;
- an ad opens;
- the platform pauses the game;
- the tab loses visibility.

If a browser requires explicit user interaction before Pointer Lock, clicking inside the gameplay canvas retries the request.

## Saves

The game saves its persistent files under:

```text
/persistent
```

The browser bridge provides local persistence and, when available, Yandex Player cloud synchronization.

Cloud key:

```text
astromenaceSave
```

At startup the port compares local and cloud snapshots. The newer valid snapshot wins. Duplicate writes are avoided with a content fingerprint so unchanged saves are not repeatedly sent through `player.setData()`.

Important progress is synchronized after mission completion, while periodic synchronization acts as a safety net.

## Advertising

The current policy is based on a **120-second eligibility interval**.

This does not mean an ad is forcibly opened every 120 seconds. Instead:

1. after two minutes an interstitial becomes eligible;
2. active mission gameplay is never intentionally interrupted;
3. if the timer expires during gameplay, the request waits;
4. the next safe pause/menu transition or suitable menu interaction may request the fullscreen ad;
5. Yandex Games decides whether the ad is actually displayed.

During an ad:

- GameplayAPI is stopped;
- Pointer Lock is released;
- audio is suspended;
- normal state is restored after the ad closes.

## Browser shell / CSP

The generated `index.html` uses external resources and avoids custom inline scripts, inline styles and inline event handlers.

Fast build structure:

```text
index.html
index.js
astromenace.css
gamedata.js
```

`index.js` contains the compiled engine and embedded WebAssembly module. `gamedata.js` contains the compressed runtime VFS in JavaScript-safe chunks.

This design also allows the generated artifact to start locally from `index.html` without a separate HTTP server on browsers that support the required APIs.

## Build workflow

Release-oriented workflow:

```text
.github/workflows/build-web-offline.yml
```

Artifact name:

```text
astromenace-yandexgames-fast-offline
```

The workflow:

- prepares a complete RU/EN VFS manifest;
- optimizes compatible assets;
- builds gl4es;
- compiles AstroMenace through Emscripten;
- packages the embedded engine/runtime;
- audits the browser shell for inline CSP-sensitive code;
- rejects packages that exceed the configured Yandex size target;
- includes license and corresponding-source notices in the artifact.

## Web-only source modifications

Most web-specific C++ changes are applied during CI by:

```text
scripts/enable_gl4es_offline.py
```

This keeps the checked-in game source relatively close to the upstream/native tree while allowing the Yandex build to remove or alter browser-inappropriate behavior.

Examples include:

- WebGL/gl4es setup;
- startup progress hooks;
- GameplayAPI calls;
- mission save hooks;
- browser-only loading changes;
- filtering unused localized preload entries;
- hiding the desktop Quit action from the web main menu.

## Attribution

This repository is a community port. Original AstroMenace credits and copyright notices are preserved.

See:

- `../LICENSE.md`
- `../NOTICE.md`
- `../AUTHORS.md`
- `../licenses/`
