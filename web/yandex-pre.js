/*
 * AstroMenace -> Yandex Games bridge.
 * Loaded by Emscripten with --pre-js before the game starts.
 */
var Module = typeof Module !== 'undefined' ? Module : {};

(() => {
  'use strict';

  const SAVE_DIR = '/persistent';
  const CLOUD_KEY = 'astromenaceSave';
  const SAVE_INTERVAL_MS = 15000;
  const SDK_TIMEOUT_MS = 4000;
  const IO_TIMEOUT_MS = 2000;
  const trackedAudioContexts = new Set();

  Module.canvas = document.getElementById('canvas');
  Module.canvas?.addEventListener('contextmenu', (event) => event.preventDefault());

  const statusElement = () => document.getElementById('status');
  const loadingElement = () => document.getElementById('loading');

  const localFileMessage =
    'Direct file:// launch is not supported by WebAssembly data loading. ' +
    'Upload the ZIP to Yandex Games or serve this folder through HTTP.';

  const setStatus = (text) => {
    const status = statusElement();
    if (!status) return;

    if (location.protocol === 'file:' && /^Downloading data/i.test(String(text || ''))) {
      status.textContent = localFileMessage;
      return;
    }

    if (text) status.textContent = String(text);
  };

  const showFatal = (message) => {
    const loading = loadingElement();
    if (loading) loading.classList.add('error');
    setStatus(`Startup error: ${message || 'unknown error'}`);
  };

  Module.yandexSetStatus = setStatus;
  Module.setStatus = setStatus;

  // Important: dependency count reaching zero only means Emscripten finished
  // fetching/preloading index.data and index.wasm. AstroMenace still has to
  // open the VFS, create WebGL and synchronously load all game assets. Keep the
  // loading overlay visible until C++ explicitly calls yandexGameReady().
  Module.monitorRunDependencies = (left) => {
    if (left > 0) {
      setStatus(`Preparing game data… (${left})`);
    } else {
      setStatus('Starting AstroMenace…');
    }
  };

  Module.printErr = (text) => {
    console.error(text);
    if (!Module.yandexGameReadySent && /(failed|error|corrupt|not found|unable|abort)/i.test(String(text))) {
      showFatal(String(text));
    }
  };

  Module.onAbort = (reason) => showFatal(reason || 'WebAssembly aborted');
  Module.onExit = (status) => {
    if (!Module.yandexGameReadySent && status !== 0) {
      showFatal(`AstroMenace exited with code ${status}`);
    }
  };

  window.addEventListener('error', (event) => {
    if (!Module.yandexGameReadySent) {
      showFatal(event?.message || 'JavaScript error');
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (!Module.yandexGameReadySent) {
      const reason = event?.reason;
      showFatal(reason?.message || String(reason || 'unhandled promise rejection'));
    }
  });

  Module.yandexSDK = null;
  Module.yandexPlayer = null;
  // Instant browser-locale fallback. The SDK value replaces this during preRun
  // when Yandex is available. Runtime language indexes are EN=0 and RU=1.
  Module.yandexLanguageIndex = /^ru(?:[-_]|$)/i.test(navigator.language || '') ? 1 : 0;
  Module.yandexGameReadySent = false;
  Module.yandexPlatformPaused = false;
  Module.yandexAdInProgress = false;

  const languageIndex = (lang) => {
    const short = String(lang || 'en').toLowerCase().split(/[-_]/)[0];
    return short === 'ru' ? 1 : 0;
  };

  const timeout = (promise, ms, label) => Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms))
  ]);

  const trackAudioContexts = () => {
    const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
    if (!NativeAudioContext || NativeAudioContext.__astromenaceWrapped) return;

    const WrappedAudioContext = new Proxy(NativeAudioContext, {
      construct(target, args, newTarget) {
        const context = Reflect.construct(
          target,
          args,
          newTarget === WrappedAudioContext ? target : newTarget
        );
        trackedAudioContexts.add(context);
        return context;
      }
    });
    WrappedAudioContext.__astromenaceWrapped = true;
    window.AudioContext = WrappedAudioContext;
    if (window.webkitAudioContext === NativeAudioContext) {
      window.webkitAudioContext = WrappedAudioContext;
    }
  };

  const pauseAudio = () => {
    trackedAudioContexts.forEach((ctx) => {
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    });
  };

  const resumeAudio = () => {
    trackedAudioContexts.forEach((ctx) => {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    });
  };

  const syncFs = (populate, timeoutMs = IO_TIMEOUT_MS) => new Promise((resolve) => {
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      if (error) console.warn('[Yandex] IDBFS sync failed:', error);
      resolve(!error);
    };

    const timer = setTimeout(() => {
      console.warn('[Yandex] IDBFS sync timed out; continuing startup.');
      finish(null);
    }, timeoutMs);

    try {
      FS.syncfs(Boolean(populate), (error) => {
        clearTimeout(timer);
        finish(error || null);
      });
    } catch (error) {
      clearTimeout(timer);
      finish(error);
    }
  });

  const encodeBytes = (bytes) => {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(binary);
  };

  const decodeBytes = (value) => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const collectSaveFiles = () => {
    const files = {};
    let names = [];
    try {
      names = FS.readdir(SAVE_DIR).filter((name) => name !== '.' && name !== '..');
    } catch (_) {
      return files;
    }

    for (const name of names) {
      const path = `${SAVE_DIR}/${name}`;
      try {
        const stat = FS.stat(path);
        if (!FS.isFile(stat.mode)) continue;
        const bytes = FS.readFile(path, { encoding: 'binary' });
        files[name] = encodeBytes(bytes);
      } catch (error) {
        console.warn('[Yandex] Could not collect save file:', path, error);
      }
    }
    return files;
  };

  const restoreCloudFiles = async () => {
    if (!Module.yandexPlayer) return;
    try {
      const data = await timeout(
        Module.yandexPlayer.getData([CLOUD_KEY]),
        IO_TIMEOUT_MS,
        'player.getData'
      );
      const save = data && data[CLOUD_KEY];
      if (!save || !save.files) return;

      for (const [name, encoded] of Object.entries(save.files)) {
        if (!/^[A-Za-z0-9_.-]+$/.test(name) || typeof encoded !== 'string') continue;
        FS.writeFile(`${SAVE_DIR}/${name}`, decodeBytes(encoded));
      }
    } catch (error) {
      console.warn('[Yandex] Cloud save restore skipped:', error);
    }
  };

  const syncSave = async (flushCloud = false) => {
    if (typeof FS === 'undefined') return;
    await syncFs(false);

    if (!Module.yandexPlayer) return;
    try {
      await timeout(
        Module.yandexPlayer.setData({
          [CLOUD_KEY]: {
            version: 1,
            updatedAt: Date.now(),
            files: collectSaveFiles()
          }
        }, Boolean(flushCloud)),
        IO_TIMEOUT_MS,
        'player.setData'
      );
    } catch (error) {
      console.warn('[Yandex] Cloud save write failed:', error);
    }
  };

  Module.yandexSyncSave = syncSave;

  Module.yandexLevelComplete = async () => {
    await syncSave(true);

    const showFullscreenAdv = Module.yandexSDK?.adv?.showFullscreenAdv;
    if (typeof showFullscreenAdv !== 'function' || Module.yandexAdInProgress) return;

    Module.yandexAdInProgress = true;
    let finished = false;
    const finishAd = () => {
      if (finished) return;
      finished = true;
      Module.yandexAdInProgress = false;
      if (!Module.yandexPlatformPaused && !document.hidden) {
        window.dispatchEvent(new Event('focus'));
        resumeAudio();
      }
    };

    try {
      Module.yandexSDK.adv.showFullscreenAdv({
        callbacks: {
          onOpen: () => {
            pauseAudio();
            window.dispatchEvent(new Event('blur'));
            console.info('[Yandex] Level-complete interstitial opened.');
          },
          onClose: (wasShown) => {
            console.info(`[Yandex] Level-complete interstitial ${wasShown ? 'shown' : 'not shown'}.`);
            finishAd();
          },
          onError: (error) => {
            console.warn('[Yandex] Level-complete interstitial failed:', error);
            finishAd();
          }
        }
      });
    } catch (error) {
      console.warn('[Yandex] Level-complete interstitial call failed:', error);
      finishAd();
    }
  };

  const registerPlatformEvents = (ysdk) => {
    ysdk.on?.('game_api_pause', () => {
      Module.yandexPlatformPaused = true;
      pauseAudio();
      window.dispatchEvent(new Event('blur'));
    });
    ysdk.on?.('game_api_resume', () => {
      Module.yandexPlatformPaused = false;
      if (!Module.yandexAdInProgress) {
        resumeAudio();
        window.dispatchEvent(new Event('focus'));
      }
    });
  };

  const initYandexForStartup = async () => {
    if (typeof YaGames === 'undefined') {
      console.info('[Yandex] SDK unavailable; using browser language and local saves.');
      return;
    }

    try {
      const ysdk = await timeout(YaGames.init(), SDK_TIMEOUT_MS, 'YaGames.init');
      Module.yandexSDK = ysdk;
      Module.yandexLanguageIndex = languageIndex(ysdk.environment?.i18n?.lang);
      registerPlatformEvents(ysdk);

      try {
        Module.yandexPlayer = await timeout(ysdk.getPlayer(), IO_TIMEOUT_MS, 'ysdk.getPlayer');
        await restoreCloudFiles();
        await syncFs(false);
      } catch (error) {
        // Player/cloud availability must never block the game from launching.
        console.warn('[Yandex] Player/cloud startup skipped:', error);
      }
    } catch (error) {
      // SDK problems must not turn the game into a permanent black/loading screen.
      console.warn('[Yandex] SDK initialization skipped:', error);
    }
  };

  Module.yandexGameReady = () => {
    if (Module.yandexGameReadySent) return;
    Module.yandexGameReadySent = true;

    const loading = loadingElement();
    if (loading) loading.classList.add('hidden');

    try {
      Module.yandexSDK?.features?.LoadingAPI?.ready();
      console.info('[Yandex] LoadingAPI.ready sent.');
    } catch (error) {
      console.warn('[Yandex] LoadingAPI.ready failed:', error);
    }

    if (Module.yandexPlatformPaused) {
      pauseAudio();
      window.dispatchEvent(new Event('blur'));
    }
  };

  trackAudioContexts();

  Module.preRun = Module.preRun || [];
  Module.preRun.push(() => {
    addRunDependency('astromenace-startup');

    (async () => {
      try {
        setStatus('Preparing saved progress…');
        FS.mkdirTree(SAVE_DIR);
        try {
          FS.mount(IDBFS, {}, SAVE_DIR);
        } catch (error) {
          // Re-running an Emscripten runtime in the same page can report that
          // the mount already exists. Continue if so.
          console.warn('[Yandex] IDBFS mount warning:', error);
        }

        await syncFs(true);
        setStatus('Initializing platform…');
        await initYandexForStartup();
        setStatus('Starting AstroMenace…');
      } catch (error) {
        console.warn('[Yandex] Non-fatal startup integration error:', error);
      } finally {
        removeRunDependency('astromenace-startup');
      }
    })();
  });

  setInterval(() => syncSave(false), SAVE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseAudio();
      syncSave(true);
    } else if (!Module.yandexPlatformPaused && !Module.yandexAdInProgress) {
      resumeAudio();
    }
  });
  window.addEventListener('pagehide', () => syncSave(true));
})();
