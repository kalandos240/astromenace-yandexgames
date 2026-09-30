# AstroMenace for RuStore / Android

This directory contains the Android packaging target for the RuStore version.

## Architecture

- Android app, not a link/redirect to a website.
- The verified offline AstroMenace WebAssembly runtime is bundled inside the APK/AAB under `assets/game/`.
- The runtime is opened from `file:///android_asset/` and therefore does not require the `INTERNET` permission for gameplay.
- Hardware-accelerated WebView hosts the existing WebGL/WebAssembly renderer.
- Native Android overlay provides touch controls: D-pad, two attack buttons and pause.
- Direct touch on the game surface remains available for aiming/interaction.
- Android lifecycle events pause/resume the game and flush local progress.
- Android back sends `Esc`; a second back press quickly exits the app.
- Landscape immersive mode is used on phones while remaining resizable on large-screen Android devices.

## Store-ready baseline

- `compileSdk 36`, `targetSdk 36`, Java 17.
- No runtime network permission in the manifest.
- No Yandex Games SDK is requested when the packaged game is opened through `file://`.
- Local saves use the existing offline storage path.
- Release signing is supported through environment variables/secrets without committing keystore material.

## Build

The GitHub Actions workflow `.github/workflows/build-rustore-android.yml` downloads the latest successful `astromenace-yandexgames-fast-offline` web artifact, puts it into `app/src/main/assets/game/`, and builds:

- debug APK for device testing;
- release APK;
- release AAB for RuStore.

For a signed release configure these repository secrets:

- `RUSTORE_KEYSTORE_BASE64`
- `RUSTORE_KEYSTORE_PASSWORD`
- `RUSTORE_KEY_ALIAS`
- `RUSTORE_KEY_PASSWORD`

The keystore itself must never be committed to Git.
