/* Playgama Bridge v1 compatibility layer for Yandex-integrated browser ports. */
(() => {
  'use strict';
  if (window.__playgamaYandexCompatInstalled) return;
  window.__playgamaYandexCompatInstalled = true;
  const pauseListeners = new Set(), resumeListeners = new Set(), pauseReasons = new Set();
  const trackedAudioContexts = new Set(), pausedMedia = new Set();
  let pseudoSdk = null, pseudoPlayer = null, gameReadySent = false, gameplayStarted = false, platformAudioEnabled = true;
  const safeCall = (cb, ...args) => { try { cb?.(...args); } catch (e) { console.warn('[Playgama] callback failed:', e); } };
  const normalizeLanguage = v => String(v || navigator.language || 'en').trim().toLowerCase().split(/[-_]/)[0] || 'en';

  const wrapAudioContext = () => {
    const Native = window.AudioContext || window.webkitAudioContext;
    if (!Native || Native.__playgamaCompatWrapped) return;
    const Wrapped = new Proxy(Native, { construct(target, args, newTarget) {
      const ctx = Reflect.construct(target, args, newTarget === Wrapped ? target : newTarget);
      trackedAudioContexts.add(ctx); return ctx;
    }});
    Wrapped.__playgamaCompatWrapped = true; window.AudioContext = Wrapped;
    if (window.webkitAudioContext === Native) window.webkitAudioContext = Wrapped;
  };
  const pauseAudio = () => {
    trackedAudioContexts.forEach(ctx => { if (ctx?.state === 'running') ctx.suspend?.().catch?.(() => {}); });
    document.querySelectorAll('audio,video').forEach(media => { if (!media.paused) { pausedMedia.add(media); try { media.pause(); } catch (_) {} } });
  };
  const resumeAudio = () => {
    if (pauseReasons.size || !platformAudioEnabled || document.hidden) return;
    trackedAudioContexts.forEach(ctx => { if (ctx?.state === 'suspended') ctx.resume?.().catch?.(() => {}); });
    Array.from(pausedMedia).forEach(media => { pausedMedia.delete(media); try { media.play?.().catch?.(() => {}); } catch (_) {} });
  };
  const emitPause = () => {
    const paused = pauseReasons.size > 0;
    (paused ? pauseListeners : resumeListeners).forEach(cb => safeCall(cb));
    if (paused) pauseAudio(); else resumeAudio();
  };
  const setPauseReason = (reason, active) => {
    const before = pauseReasons.size > 0;
    if (active) pauseReasons.add(reason); else pauseReasons.delete(reason);
    if (before !== (pauseReasons.size > 0)) emitPause();
  };
  wrapAudioContext();

  const initializeBridge = async () => {
    if (!window.bridge || typeof window.bridge.initialize !== 'function') throw new Error('Playgama Bridge script is unavailable');
    await window.bridge.initialize({ configFilePath: './playgama-bridge-config.json' });
    const bridge = window.bridge;
    try { bridge.advertisement?.setMinimumDelayBetweenInterstitial?.(120); } catch (_) {}
    platformAudioEnabled = bridge.platform?.isAudioEnabled !== false;
    if (!platformAudioEnabled) pauseAudio();
    try { bridge.platform?.on?.(bridge.EVENT_NAME.PAUSE_STATE_CHANGED, paused => setPauseReason('platform', Boolean(paused))); } catch (e) { console.warn('[Playgama] pause subscription failed:', e); }
    try { bridge.platform?.on?.(bridge.EVENT_NAME.AUDIO_STATE_CHANGED, enabled => { platformAudioEnabled = enabled !== false; if (platformAudioEnabled) resumeAudio(); else pauseAudio(); }); } catch (e) { console.warn('[Playgama] audio subscription failed:', e); }
    try {
      const key = '__playgama_bridge_port_v1';
      await bridge.storage.get(key).catch(() => undefined);
      await bridge.storage.set(key, { version: 1, updatedAt: Date.now() });
    } catch (e) { console.info('[Playgama] default storage unavailable; local persistence remains available.', e); }
    document.documentElement.dataset.playgamaBridge = 'ready';
    return bridge;
  };
  window.playgamaBridgeReady = initializeBridge().catch(e => { document.documentElement.dataset.playgamaBridge = 'failed'; console.warn('[Playgama] Bridge initialization failed:', e); return null; });

  const fallbackType = bridge => bridge?.STORAGE_TYPE?.LOCAL_STORAGE || 'local_storage';
  const storageGet = async (bridge, key) => { try { return await bridge.storage.get(key); } catch (_) { try { return await bridge.storage.get(key, fallbackType(bridge)); } catch (_) { return undefined; } } };
  const storageSet = async (bridge, key, value) => { try { await bridge.storage.set(key, value); return true; } catch (_) { try { await bridge.storage.set(key, value, fallbackType(bridge)); return true; } catch (_) { return false; } } };
  const createPlayer = bridge => {
    if (pseudoPlayer) return pseudoPlayer;
    pseudoPlayer = {
      async getData(keys) {
        const requested = Array.isArray(keys) ? keys : (keys == null ? [] : [keys]), result = {};
        for (const key of requested) { const value = await storageGet(bridge, String(key)); if (value !== undefined && value !== null) result[key] = value; }
        return result;
      },
      async setData(data) {
        for (const [key, value] of Object.entries(data || {})) if (!(await storageSet(bridge, String(key), value))) throw new Error(`Could not persist Playgama storage key: ${key}`);
      },
      getMode() { return 'full'; }, getUniqueID() { return ''; }, getName() { return ''; }
    };
    return pseudoPlayer;
  };

  const bindAdPause = (bridge, eventName, opened, closed, reason) => bridge.advertisement?.on?.(eventName, state => {
    if (state === opened) setPauseReason(reason, true); else if (closed.includes(state)) setPauseReason(reason, false);
  });
  const fullscreen = bridge => (options = {}) => {
    const callbacks = options.callbacks || {}, ad = bridge.advertisement;
    if (!ad?.isInterstitialSupported) { safeCall(callbacks.onError, new Error('Interstitial advertising is not supported')); return; }
    const event = bridge.EVENT_NAME.INTERSTITIAL_STATE_CHANGED, openedState = bridge.INTERSTITIAL_STATE.OPENED, closedState = bridge.INTERSTITIAL_STATE.CLOSED, failedState = bridge.INTERSTITIAL_STATE.FAILED;
    let opened = false, finished = false;
    const cleanup = () => ad.off?.(event, listener);
    const listener = state => {
      if (finished) return;
      if (state === openedState) { opened = true; setPauseReason('interstitial', true); safeCall(callbacks.onOpen); }
      else if (state === closedState) { finished = true; setPauseReason('interstitial', false); cleanup(); safeCall(callbacks.onClose, opened); }
      else if (state === failedState) { finished = true; setPauseReason('interstitial', false); cleanup(); safeCall(callbacks.onError, new Error('Playgama interstitial failed')); }
    };
    ad.on?.(event, listener); try { ad.showInterstitial(options.placement || null); } catch (e) { finished = true; cleanup(); setPauseReason('interstitial', false); safeCall(callbacks.onError, e); }
  };
  const rewarded = bridge => (options = {}) => {
    const callbacks = options.callbacks || {}, ad = bridge.advertisement;
    if (!ad?.isRewardedSupported) { safeCall(callbacks.onError, new Error('Rewarded advertising is not supported')); return; }
    const event = bridge.EVENT_NAME.REWARDED_STATE_CHANGED, openedState = bridge.REWARDED_STATE.OPENED, rewardState = bridge.REWARDED_STATE.REWARDED, closedState = bridge.REWARDED_STATE.CLOSED, failedState = bridge.REWARDED_STATE.FAILED;
    let gotReward = false, finished = false;
    const cleanup = () => ad.off?.(event, listener);
    const listener = state => {
      if (finished) return;
      if (state === openedState) { setPauseReason('rewarded', true); safeCall(callbacks.onOpen); }
      else if (state === rewardState) { gotReward = true; safeCall(callbacks.onRewarded); }
      else if (state === closedState) { finished = true; setPauseReason('rewarded', false); cleanup(); safeCall(callbacks.onClose, gotReward); }
      else if (state === failedState) { finished = true; setPauseReason('rewarded', false); cleanup(); safeCall(callbacks.onError, new Error('Playgama rewarded advertisement failed')); }
    };
    ad.on?.(event, listener); try { ad.showRewarded(options.placement || null); } catch (e) { finished = true; cleanup(); setPauseReason('rewarded', false); safeCall(callbacks.onError, e); }
  };
  const sendMessage = async (bridge, message) => { try { await bridge.platform?.sendMessage?.(message); } catch (e) { console.info(`[Playgama] platform message ${message} was not accepted.`, e); } };
  const createSdk = bridge => {
    if (pseudoSdk) return pseudoSdk;
    const player = createPlayer(bridge);
    pseudoSdk = {
      environment: { i18n: { lang: normalizeLanguage(bridge.platform?.language) }, app: { id: bridge.platform?.id || 'playgama' } },
      features: {
        LoadingAPI: { ready() { if (gameReadySent) return Promise.resolve(false); gameReadySent = true; return sendMessage(bridge, 'game_ready').then(() => true); } },
        GameplayAPI: {
          start() { if (gameplayStarted) return Promise.resolve(false); gameplayStarted = true; return sendMessage(bridge, 'gameplay_started').then(() => true); },
          stop() { if (!gameplayStarted) return Promise.resolve(false); gameplayStarted = false; return sendMessage(bridge, 'gameplay_stopped').then(() => true); }
        }
      },
      adv: { showFullscreenAdv: fullscreen(bridge), showRewardedVideo: rewarded(bridge) },
      async getPlayer() { return player; },
      on(name, cb) { if (name === 'game_api_pause') pauseListeners.add(cb); else if (name === 'game_api_resume') resumeListeners.add(cb); },
      off(name, cb) { if (name === 'game_api_pause') pauseListeners.delete(cb); else if (name === 'game_api_resume') resumeListeners.delete(cb); },
      isAvailableMethod(name) { return Promise.resolve(new Set(['getPlayer','adv.showFullscreenAdv','adv.showRewardedVideo','features.LoadingAPI.ready','features.GameplayAPI.start','features.GameplayAPI.stop']).has(String(name || ''))); }
    };
    window.ysdk = pseudoSdk; window.playgamaYandexCompatSdk = pseudoSdk; return pseudoSdk;
  };
  window.YaGames = { init() { return window.playgamaBridgeReady.then(bridge => { if (!bridge) throw new Error('Playgama Bridge initialization failed'); return createSdk(bridge); }); } };
  document.addEventListener('visibilitychange', () => setPauseReason('document-hidden', document.hidden));
  window.playgamaBridgeReady.then(bridge => {
    if (!bridge) return;
    try {
      bindAdPause(bridge, bridge.EVENT_NAME.INTERSTITIAL_STATE_CHANGED, bridge.INTERSTITIAL_STATE.OPENED, [bridge.INTERSTITIAL_STATE.CLOSED, bridge.INTERSTITIAL_STATE.FAILED], 'interstitial');
      bindAdPause(bridge, bridge.EVENT_NAME.REWARDED_STATE_CHANGED, bridge.REWARDED_STATE.OPENED, [bridge.REWARDED_STATE.CLOSED, bridge.REWARDED_STATE.FAILED], 'rewarded');
    } catch (e) { console.warn('[Playgama] ad lifecycle subscription failed:', e); }
  });
})();
