#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>

namespace {

struct YandexAdSchedulerInstaller {
    YandexAdSchedulerInstaller()
    {
        // JavaScript lives in a raw string because the scheduler contains normal
        // commas/object literals that are inconvenient inside the EM_ASM macro.
        emscripten_run_script(R"ASTROMENACE_JS(
            (() => {
                if (Module.yandexTwoMinuteAdsInstalled) return;
                Module.yandexTwoMinuteAdsInstalled = true;

                const AD_INTERVAL_MS = 120000;
                let nextAdAt = 0;
                let safeAttemptQueued = false;

                const originalLevelComplete =
                    typeof Module.yandexLevelComplete === 'function'
                        ? Module.yandexLevelComplete.bind(Module)
                        : null;
                const originalGameplayStop =
                    typeof Module.yandexGameplayStop === 'function'
                        ? Module.yandexGameplayStop.bind(Module)
                        : null;
                const originalGameReady =
                    typeof Module.yandexGameReady === 'function'
                        ? Module.yandexGameReady.bind(Module)
                        : null;

                const isGameplayActive = () =>
                    Boolean(Module.yandexGameplayRequested || Module.yandexGameplayApiRunning);

                const adIsDue = () =>
                    Boolean(nextAdAt && Date.now() >= nextAdAt);

                const canRequestAdNow = () =>
                    Boolean(
                        Module.yandexGameReadySent &&
                        adIsDue() &&
                        typeof Module.yandexSDK?.adv?.showFullscreenAdv === 'function' &&
                        !Module.yandexAdInProgress &&
                        !Module.yandexPlatformPaused &&
                        !document.hidden &&
                        !isGameplayActive()
                    );

                // The captured bridge implementation already performs all SDK
                // callbacks correctly: save flush, GameplayAPI stop, sound pause,
                // pointer-lock release and state restoration after the ad.
                const showDueInterstitial = async () => {
                    safeAttemptQueued = false;
                    if (!originalLevelComplete || !canRequestAdNow()) return false;

                    // Advance before the SDK request. Yandex can suppress an
                    // overly frequent request; in that case we still wait for the
                    // next 2-minute window rather than immediately retrying.
                    nextAdAt = Date.now() + AD_INTERVAL_MS;
                    try {
                        await originalLevelComplete();
                        console.info('[Yandex] Due interstitial requested at a safe non-gameplay pause.');
                        return true;
                    } catch (error) {
                        console.warn('[Yandex] Scheduled interstitial failed:', error);
                        return false;
                    }
                };

                const queueSafeAttempt = () => {
                    if (safeAttemptQueued || !adIsDue()) return;
                    safeAttemptQueued = true;
                    // Run on the next task so C++/SDL can finish switching from
                    // gameplay to the pause/result/menu state first.
                    setTimeout(() => {
                        safeAttemptQueued = false;
                        void showDueInterstitial();
                    }, 0);
                };

                // Start the 2-minute cadence only after the interactive game is
                // ready. This intentionally does not compete with the automatic
                // startup ad shown by the Yandex Games platform.
                if (originalGameReady) {
                    Module.yandexGameReady = (...args) => {
                        const result = originalGameReady(...args);
                        if (!nextAdAt) nextAdAt = Date.now() + AD_INTERVAL_MS;
                        return result;
                    };
                }

                // A gameplay -> pause/menu/result transition is a logical pause.
                // If the 2-minute deadline expired during the mission, request the
                // pending ad immediately after this transition instead of during
                // active flight.
                if (originalGameplayStop) {
                    Module.yandexGameplayStop = (...args) => {
                        const result = originalGameplayStop(...args);
                        queueSafeAttempt();
                        return result;
                    };
                }

                // Successful mission completion no longer forces an ad every
                // level. It closes GameplayAPI and flushes progress. A due ad is
                // then handled by the safe-transition hook above.
                Module.yandexLevelComplete = async () => {
                    try {
                        Module.yandexGameplayStop?.();
                    } catch (_) {}
                    try {
                        if (Module.yandexSyncSave) await Module.yandexSyncSave(true);
                    } catch (error) {
                        console.warn('[Yandex] Level-complete save flush failed:', error);
                    }
                    queueSafeAttempt();
                };

                // If the player has already been outside gameplay for two minutes,
                // do not pop an ad out of nowhere. Wait for their next menu click,
                // then request it immediately after that non-gameplay action.
                Module.canvas?.addEventListener('pointerdown', () => {
                    if (!isGameplayActive()) queueSafeAttempt();
                }, true);

                Module.yandexAdScheduler = {
                    intervalMs: AD_INTERVAL_MS,
                    isDue: adIsDue,
                    requestIfSafe: queueSafeAttempt,
                    getNextAdAt: () => nextAdAt
                };

                console.info('[Yandex] Interstitial scheduler installed: 120s cadence, logical pauses only, never active gameplay.');
            })();
        )ASTROMENACE_JS");
    }
};

YandexAdSchedulerInstaller gYandexAdSchedulerInstaller;

} // namespace
#endif
