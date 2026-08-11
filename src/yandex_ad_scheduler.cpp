#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>

namespace {

struct YandexAdSchedulerInstaller {
    YandexAdSchedulerInstaller()
    {
        EM_ASM({
            // AstroMenace/Yandex interstitial policy:
            // - one request per 2 minutes;
            // - never interrupt active gameplay;
            // - if the timer expires during a mission, keep one pending request
            //   and show it at the first safe non-gameplay state (menu, pause,
            //   mission result, etc.);
            // - Yandex Games still controls whether a particular request is
            //   actually shown and can return wasShown=false.
            if (Module.yandexTwoMinuteAdsInstalled) return;
            Module.yandexTwoMinuteAdsInstalled = true;

            const AD_INTERVAL_MS = 120000;
            const CHECK_INTERVAL_MS = 1000;
            let nextAdAt = 0;

            const originalLevelComplete =
                typeof Module.yandexLevelComplete === 'function'
                    ? Module.yandexLevelComplete.bind(Module)
                    : null;

            // Keep the existing bridge's ad implementation because it already
            // handles sound pause/resume, pointer lock, GameplayAPI and SDK
            // callbacks correctly. The scheduler decides WHEN it may be called.
            const showSafeInterstitial = async () => {
                if (!originalLevelComplete) return false;
                if (!Module.yandexSDK?.adv?.showFullscreenAdv) return false;
                if (Module.yandexAdInProgress) return false;
                if (Module.yandexPlatformPaused || document.hidden) return false;
                if (Module.yandexGameplayRequested || Module.yandexGameplayApiRunning) return false;

                // Move the deadline before calling the SDK so a rejected or
                // suppressed request cannot create a rapid retry loop.
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
                    // Start the two-minute cadence only after the game is fully
                    // ready. This avoids colliding with Yandex's startup ad.
                    nextAdAt = Date.now() + AD_INTERVAL_MS;
                    return;
                }

                if (Date.now() < nextAdAt) return;

                // A due ad is intentionally kept pending while gameplay is
                // active. The next tick after gameplay stops will show it.
                if (Module.yandexGameplayRequested || Module.yandexGameplayApiRunning) return;
                if (Module.yandexAdInProgress || Module.yandexPlatformPaused || document.hidden) return;

                void showSafeInterstitial();
            };

            // Successful mission completion used to show an ad immediately.
            // It now only ends gameplay and flushes the save. If the 2-minute
            // deadline has already expired, the scheduler will show the pending
            // ad on the next safe tick instead of forcing one after every level.
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
        });
    }
};

YandexAdSchedulerInstaller gYandexAdSchedulerInstaller;

} // namespace
#endif
