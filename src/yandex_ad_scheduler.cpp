#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>

namespace {

struct YandexAdSchedulerInstaller {
    YandexAdSchedulerInstaller()
    {
        // Use emscripten_run_script instead of EM_ASM here: the scheduler has
        // normal JavaScript commas/object literals which the EM_ASM C macro can
        // otherwise interpret as additional macro arguments.
        emscripten_run_script(R"ASTROMENACE_JS(
            (() => {
                // AstroMenace/Yandex interstitial policy:
                // - one request per 2 minutes;
                // - never interrupt active gameplay;
                // - if the timer expires during a mission, keep one pending
                //   request until the first safe non-gameplay state;
                // - Yandex Games still decides whether a request is actually
                //   shown and may suppress it.
                if (Module.yandexTwoMinuteAdsInstalled) return;
                Module.yandexTwoMinuteAdsInstalled = true;

                const AD_INTERVAL_MS = 120000;
                const CHECK_INTERVAL_MS = 1000;
                let nextAdAt = 0;

                const originalLevelComplete =
                    typeof Module.yandexLevelComplete === 'function'
                        ? Module.yandexLevelComplete.bind(Module)
                        : null;

                const isGameplayActive = () =>
                    Boolean(Module.yandexGameplayRequested || Module.yandexGameplayApiRunning);

                // Keep the bridge's existing fullscreen-ad implementation: it
                // already pauses audio, releases pointer lock, stops GameplayAPI
                // and restores the correct state in SDK callbacks. This scheduler
                // decides only WHEN that implementation may be invoked.
                const showSafeInterstitial = async () => {
                    if (!originalLevelComplete) return false;
                    if (typeof Module.yandexSDK?.adv?.showFullscreenAdv !== 'function') return false;
                    if (Module.yandexAdInProgress) return false;
                    if (Module.yandexPlatformPaused || document.hidden) return false;
                    if (isGameplayActive()) return false;

                    // Advance the deadline before requesting the ad. If Yandex
                    // suppresses this display, we still wait another two minutes
                    // instead of hammering the SDK every second.
                    nextAdAt = Date.now() + AD_INTERVAL_MS;
                    try {
                        await originalLevelComplete();
                        console.info('[Yandex] Two-minute interstitial requested in a safe non-gameplay state.');
                        return true;
                    } catch (error) {
                        console.warn('[Yandex] Scheduled interstitial failed:', error);
                        return false;
                    }
                };

                const tick = () => {
                    if (!Module.yandexGameReadySent) return;

                    if (!nextAdAt) {
                        // Start the cadence after the game is ready so we do not
                        // collide with the platform's startup advertising.
                        nextAdAt = Date.now() + AD_INTERVAL_MS;
                        return;
                    }

                    if (Date.now() < nextAdAt) return;

                    // A due ad stays pending for the entire mission. The first
                    // check after gameplay stops will request it.
                    if (isGameplayActive()) return;
                    if (Module.yandexAdInProgress || Module.yandexPlatformPaused || document.hidden) return;

                    void showSafeInterstitial();
                };

                // Mission completion no longer forces an interstitial. It ends
                // gameplay and flushes the save. A due 2-minute ad will then be
                // requested by tick() because the player is in a safe state.
                Module.yandexLevelComplete = async () => {
                    try {
                        Module.yandexGameplayStop?.();
                    } catch (_) {}
                    try {
                        if (Module.yandexSyncSave) await Module.yandexSyncSave(true);
                    } catch (error) {
                        console.warn('[Yandex] Level-complete save flush failed:', error);
                    }
                    tick();
                };

                Module.yandexAdScheduler = {
                    intervalMs: AD_INTERVAL_MS,
                    tick,
                    getNextAdAt: () => nextAdAt
                };

                setInterval(tick, CHECK_INTERVAL_MS);
                console.info('[Yandex] Interstitial scheduler installed: every 120s, non-gameplay only.');
            })();
        )ASTROMENACE_JS");
    }
};

YandexAdSchedulerInstaller gYandexAdSchedulerInstaller;

} // namespace
#endif
