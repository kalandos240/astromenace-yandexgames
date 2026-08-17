# AstroMenace — Playgama build

This repository keeps the Yandex Games build and the Playgama build separate.
The Playgama package is produced by `.github/workflows/package-playgama.yml`.

## Runtime baseline

The Playgama workflow is intentionally pinned to the tested offline AstroMenace artifact:

- artifact id: `9119584924`
- artifact SHA-256: `59625416555b481c0a779280ee51e622c2b4a8ba9bc84f6838238f7b26b49782`
- `index.js` SHA-256: `37a851b7b5462170e1ec7d77869146a2a07d19ab260c9e1fcd42ecbdccc34bf0`
- `gamedata.js` SHA-256: `1f14f374b60489722789f478c3dd6bc8009171893125e2127363bc64c34aa58e`

The Playgama packager may patch only the HTML shell, CSS presentation and platform adapter/config files. It must not mutate `index.js` or `gamedata.js`.

## Playgama SDK

- Playgama Bridge JS Core v2 stable
- engine reported to QA: `javascript`
- `index.html` remains at archive root
- no direct `/sdk.js` Yandex SDK request in the Playgama package
- cloud progress is mapped from the existing Yandex Player `getData`/`setData` flow to Playgama Bridge storage
- LoadingAPI and GameplayAPI calls are mapped to Playgama platform messages
- Playgama pause/audio signals pause AstroMenace gameplay/audio through the existing Yandex-style pause hooks

## Advertising

AstroMenace has interstitial advertising only.

- interstitial: enabled
- minimum delay: 120 seconds
- shown by the existing game logic only at safe pauses/transitions, never intentionally during active combat
- rewarded: disabled; AstroMenace has no rewarded-ad mechanic
- banner: disabled

## Display target

The current web port is desktop-first and uses keyboard + mouse.

- Supported device in the Playgama draft: **Desktop**
- Orientation: **Landscape**
- The native 16:9 game canvas is kept fully visible and centered.
- Unused space in square/wide/tall QA viewports is filled by the Playgama-only space backdrop instead of black letterbox bars.
- The game runtime itself is not stretched or cropped for this presentation fix.

## Languages

Declare only:

- English
- Russian

The language is selected automatically from the platform locale; unsupported locales fall back to English.

## Draft feature flags

Do not declare features that AstroMenace does not implement:

- In-Game Purchases: no
- Leaderboards: no
- Multiplayer: no
- Social Sharing & Interactions: no
- Authorization: no

## Suggested Playgama description

**English:**
AstroMenace is a fast-paced 3D space scrolling shooter. Pilot a combat spacecraft through dangerous missions, fight enemy fleets, earn resources, and improve your ship with new weapons and equipment. This browser edition preserves the gameplay of the open-source AstroMenace project while adapting it for modern web platforms.

**Russian:**
AstroMenace — динамичный трёхмерный космический скролл-шутер. Управляйте боевым кораблём, проходите опасные миссии, сражайтесь с вражескими флотами, зарабатывайте ресурсы и улучшайте корабль новым оружием и оборудованием. Браузерная версия сохраняет игровой процесс оригинального open-source проекта AstroMenace и адаптирует его для современных веб-платформ.

## Suggested “How to play”

**English:**
Use the mouse and the configured keyboard controls to steer and aim your ship. Fire your primary and secondary weapons with the controls shown in the game settings. Complete mission objectives, destroy hostile spacecraft, collect rewards, and purchase ship and weapon upgrades between missions. Press Esc to pause or open the menu.

**Russian:**
Управляйте и наводите корабль мышью и назначенными клавишами. Используйте основное и дополнительное оружие с помощью клавиш, указанных в настройках игры. Выполняйте задачи миссий, уничтожайте вражеские корабли, получайте награды и покупайте улучшения корабля и вооружения между миссиями. Нажмите Esc, чтобы поставить игру на паузу или открыть меню.

## Certification notes

During Playgama QA:

- complete a mission or otherwise change progress to trigger a real save event, then use the reload/restore check;
- there is no rewarded-ad action, so do not invent a fake rewarded flow for certification;
- trigger interstitial after at least two minutes and at a safe transition/pause;
- mute/pause signals must silence the game and pause gameplay;
- authorization is not used;
- AstroMenace depicts spacecraft combat and explosions, but does not contain realistic human violence, blood, alcohol/tobacco use, gambling or sexual content in the browser build.
