/*
 * AstroMenace -> Yandex Games bridge.
 * Loaded by Emscripten with --pre-js before the game starts.
 */
(() => {
  'use strict';

  const SAVE_DIR = '/persistent';
  const CLOUD_KEY = 'astromenaceSave';
  const SAVE_INTERVAL_MS = 15000;
  const trackedAudioContexts = new Set();

  // Keep all executable shell setup in this external Emscripten-generated
  // JavaScript file. The HTML shell intentionally contains no custom inline
  // script, which keeps it compatible with restrictive platform CSP rules.
  Module.canvas = document.getElementById('canvas');
  Module.setStatus = (text) => {
    const status = document.getElementById('status');
    const loading = document.getElementById('loading');
    if (status && text) status.textContent = text;
    if (!text && loading) loading.classList.add('hidden');
  };
  Module.monitorRunDependencies = (left) => {
    if (!left) Module.setStatus('');
  };
  Module.printErr = (text) => console.error(text);

  Module.yandexSDK = null;
  Module.yandexPlayer = null;
  Module.yandexLanguageIndex = 0;
  Module.yandexGameReadySent = false;

  const languageIndex = (lang) => {
    const short = String(lang || 'en').toLowerCase().split(/[-_]/)[0];
    // AstroMenace's shipped language table is EN/DE/RU/PL. Yandex locales
    // without a native AstroMenace translation must fall back automatically
    // to English instead of opening the desktop first-start language dialog.
    return ({ en: 0, de: 1, ru: 2, pl: 3 })[short] ?? 0;
  };

  const trackAudioContexts = () => {
    const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
    if (!NativeAudioContext || NativeAudioContext.__astromenaceWrapped) return;

    const WrappedAudioContext = new Proxy(NativeAudioContext, {
      construct(target, args, newTarget) {
        const context = Reflect.construct(target, args, newTarget === WrappedAudioContext ? target : newTarget);
        trackedAudioContexts.add(context);
        return context;
      }
    });
    WrappedAudioContext.__astromenaceWrapped = true;
    window.AudioContext = WrappedAudioContext;
    if (window.webkitAudioContext === NativeAudioContext) window.webkitAudioContext = WrappedAudioContext;
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
      const data = await Module.yandexPlayer.getData([CLOUD_KEY]);
      const save = data && data[CLOUD_KEY];
      if (!save || !save.files) return;

      for (const [name, encoded] of Object.entries(save.files)) {
        if (!/^[A-Za-z0-9_.-]+$/.test(name) || typeof encoded !== 'string') continue;
        FS.writeFile(`${SAVE_DIR}/${name}`, decodeBytes(encoded));
      }
    } catch (error) {
      console.warn('[Yandex] Cloud save restore failed:', error);
    }
  };

  const syncSave = async (flushCloud = false) => {
    if (typeof FS === 'undefined') return;

    await new Promise((resolve) => {
      try {
        FS.syncfs(false, (error) => {
          if (error) console.warn('[Yandex] IDBFS sync failed:', error);
          resolve();
        });
      } catch (error) {
        console.warn('[Yandex] IDBFS sync failed:', error);
        resolve();
      }
    });

    if (!Module.yandexPlayer) return;
    try {
      await Module.yandexPlayer.setData({
        [CLOUD_KEY]: {
          version: 1,
          updatedAt: Date.now(),
          files: collectSaveFiles()
        }
      }, Boolean(flushCloud));
    } catch (error) {
      console.warn('[Yandex] Cloud save write failed:', error);
    }
  };

  const loadYandexSDK = () => new Promise((resolve) => {
    if (typeof YaGames !== 'undefined') {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = '/sdk.js';
    script.async = true;
    script.onload = () => resolve(typeof YaGames !== 'undefined');
    script.onerror = () => resolve(false);
    document.head.appendChild(script);

    // Local/off-platform builds must still be runnable.
    setTimeout(() => resolve(typeof YaGames !== 'undefined'), 5000);
  });

  const initYandex = async () => {
    const loaded = await loadYandexSDK();
    if (!loaded) {
      console.info('[Yandex] SDK unavailable; running in standalone mode.');
      return;
    }

    try {
      const ysdk = await YaGames.init();
      Module.yandexSDK = ysdk;
      Module.yandexLanguageIndex = languageIndex(ysdk.environment?.i18n?.lang);

      try {
        Module.yandexPlayer = await ysdk.getPlayer();
      } catch (error) {
        console.warn('[Yandex] Player init failed:', error);
      }

      // Yandex emits these events for startup/fullscreen/rewarded ads,
      // purchase dialogs and page minimization. Synthetic focus events enter
      // AstroMenace's existing SDL_WINDOWEVENT pause path, which freezes game
      // time and opens the in-game pause state while audio is suspended.
      ysdk.on?.('game_api_pause', () => {
        pauseAudio();
        window.dispatchEvent(new Event('blur'));
      });
      ysdk.on?.('game_api_resume', () => {
        resumeAudio();
        window.dispatchEvent(new Event('focus'));
      });
    } catch (error) {
      console.warn('[Yandex] SDK initialization failed:', error);
    }
  };

  Module.yandexGameReady = () => {
    if (Module.yandexGameReadySent) return;
    Module.yandexGameReadySent = true;
    try {
      Module.yandexSDK?.features?.LoadingAPI?.ready();
      console.info('[Yandex] LoadingAPI.ready sent.');
    } catch (error) {
      console.warn('[Yandex] LoadingAPI.ready failed:', error);
    }
  };

  trackAudioContexts();

  Module.preRun = Module.preRun || [];
  Module.preRun.push(() => {
    addRunDependency('astromenace-yandex-init');

    (async () => {
      try {
        FS.mkdirTree(SAVE_DIR);
        FS.mount(IDBFS, {}, SAVE_DIR);

        await new Promise((resolve) => {
          FS.syncfs(true, (error) => {
            if (error) console.warn('[Yandex] Initial IDBFS load failed:', error);
            resolve();
          });
        });

        await initYandex();
        await restoreCloudFiles();

        await new Promise((resolve) => {
          FS.syncfs(false, (error) => {
            if (error) console.warn('[Yandex] Restored save sync failed:', error);
            resolve();
          });
        });
      } finally {
        removeRunDependency('astromenace-yandex-init');
      }
    })();
  });

  setInterval(() => syncSave(false), SAVE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseAudio();
      syncSave(true);
    } else {
      resumeAudio();
    }
  });
  window.addEventListener('pagehide', () => syncSave(true));
})();
