# AstroMenace for RuStore / Android

## Runtime

The offline game engine and resources are bundled in the APK. A hardware-accelerated WebView loads them through AndroidX WebViewAssetLoader at `https://appassets.androidplatform.net/assets/game/index.html`; gameplay needs no network connection.

Native arrow, attack and pause buttons call exported engine functions. Gameplay canvas touches are blocked; menus accept normal touch input. Android IME is available only on the profile screen, supports full Unicode names and submits through Done. Pause Quit returns to the main menu. Android Back closes the keyboard first, opens mission pause while playing, and uses double Back to exit from menus.

Android backgrounding releases held controls, pauses timers/audio and flushes local saves. Resuming restores the WebView; the mission remains paused for the player to continue. Host pause applies directly to the engine, including when focus events arrive in the same frame. Holding one button with two fingers continues until both fingers are released. The double-Back exit gesture resets when the app leaves the foreground.

## Build and signing

- Android 8+ (`minSdk 26`), `compileSdk 36`, `targetSdk 36`, Java 17.
- Version 1.0.7, versionCode 7, package `com.kalandos240.astromenace`.
- Internet/network-state permissions support optional Yandex Mobile Ads; the Yandex Games SDK is disabled.
- No demo ad unit ships by default. Set `YANDEX_INTERSTITIAL_AD_UNIT_ID` to a production unit to enable ads.
- Release self-test intent is disabled with `BuildConfig.DEBUG`.

`.github/workflows/build-rustore-android.yml` downloads the verified offline resources, rebuilds the Android-specific WebAssembly engine, converts its VFS to a direct asset, builds a debug APK and runs emulator regressions. Release APK/AAB are built only after those pass.

Tests cover initial rendering, canvas size, keyboard gating and Unicode profile names, engine movement from a native arrow, mission pause/resume/quit, repeated host pause followed by immediate focus restoration, and Android background/resume. Emulator tests do not replace physical-device compatibility/performance testing or a full campaign playthrough.

Optional CI release signing secrets:

- `RUSTORE_KEYSTORE_BASE64`
- `RUSTORE_KEYSTORE_PASSWORD`
- `RUSTORE_KEY_ALIAS`
- `RUSTORE_KEY_PASSWORD`

Without these secrets CI produces unsigned release outputs. Sign the APK with the private release key using official Android `apksigner`, then verify its signature. Keep the same package and signing key for every update and increase versionCode. Never commit keys or passwords to Git.

The bundled `SOURCE_CODE.txt` points to the exact source commit and build instructions. Upstream credits and licenses remain included.
