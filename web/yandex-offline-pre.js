/* AstroMenace fast/offline Yandex Games bridge. */
var Module = typeof Module !== 'undefined' ? Module : {};

(() => {
  'use strict';

  const SAVE_DIR = '/persistent';
  const CLOUD_KEY = 'astromenaceSave';
  const SAVE_INTERVAL_MS = 15000;
  const IDB_STARTUP_TIMEOUT_MS = 1200;
  const SDK_SCRIPT_TIMEOUT_MS = 6000;
  const SDK_INIT_TIMEOUT_MS = 8000;
  const PLAYER_TIMEOUT_MS = 2500;
  const RU_FALLBACK_LANGS = new Set(['ru', 'be', 'kk', 'uk', 'uz']);
  const trackedAudioContexts = new Set();

  Module.canvas = document.getElementById('canvas');
  Module.canvas?.addEventListener('contextmenu', (event) => event.preventDefault());

  const statusElement = () => document.getElementById('status');
  const loadingElement = () => document.getElementById('loading');

  Module.yandexSDK = null;
  Module.yandexPlayer = null;
  Module.yandexLanguageCode = /^ru(?:[-_]|$)/i.test(navigator.language || '') ? 'ru' : 'en';
  Module.yandexLanguageIndex = Module.yandexLanguageCode === 'ru' ? 1 : 0;
  Module.yandexGameReadySent = false;
  Module.yandexPlatformPaused = false;
  Module.yandexAdInProgress = false;
  Module.hadLocalSaveAtStartup = false;

  const isRussian = () => Module.yandexLanguageCode === 'ru';

  const localizeStatus = (value) => {
    let text = String(value || '');
    if (!isRussian()) {
      return text === 'Running...' ? 'Starting engine...' : text;
    }

    const replacements = [
      [/^Running\.\.\.$/, 'Запуск движка...'],
      [/^Starting engine\.\.\.$/, 'Запуск движка...'],
      [/^Connecting to Yandex Games\.\.\.$/, 'Подключение к Яндекс Играм...'],
      [/^Decoding game data\.\.\./, 'Подготовка данных игры...'],
      [/^Unpacking game data\.\.\./, 'Распаковка данных игры...'],
      [/^Installing game data\.\.\./, 'Подготовка файлов игры...'],
      [/^Loading saved progress\.\.\./, 'Загрузка сохранения...'],
      [/^Preparing game\.\.\./, 'Подготовка игры...'],
      [/^Initializing SDL\.\.\./, 'Инициализация игры...'],
      [/^Opening game data\.\.\./, 'Открытие данных игры...'],
      [/^Configuring video\.\.\./, 'Настройка изображения...'],
      [/^Creating WebGL renderer\.\.\./, 'Запуск графики...'],
      [/^Generating fonts\.\.\./, 'Подготовка шрифтов...'],
      [/^Loading game assets\.\.\./, 'Загрузка ресурсов...'],
      [/^Opening main menu\.\.\./, 'Открытие главного меню...'],
      [/^Startup error:/, 'Ошибка запуска:']
    ];
    for (const [pattern, replacement] of replacements) {
      if (pattern.test(text)) return text.replace(pattern, replacement);
    }
    return text;
  };

  const setStatus = (value) => {
    const status = statusElement();
    if (!status || value === undefined || value === null || value === '') return;
    status.textContent = localizeStatus(value);
  };

  const showFatal = (message) => {
    const loading = loadingElement();
    if (loading) loading.classList.add('error');
    setStatus(`Startup error: ${message || 'unknown error'}`);
  };

  const nextBrowserTurn = () => new Promise((resolve) => setTimeout(resolve, 0));
  const timeout = (promise, ms, label) => Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms))
  ]);

  Module.yandexSetStatus = setStatus;
  Module.setStatus = setStatus;
  Module.monitorRunDependencies = (left) => {
    if (left > 0 && !String(statusElement()?.textContent || '').includes('Распаковка данных игры')) {
      setStatus(`Preparing game... (${left})`);
    }
  };

  const isExpectedFirstLaunchMessage = (text) =>
    /LoadPilotProfiles\(\): Can't open file \/persistent\/PilotProfiles_/i.test(text) ||
    /cXMLDocument\(\): XML file not found: \/persistent\/config\.xml/i.test(text);

  const isUnusedLocaleAssetMessage = (text) =>
    /lang\/(?:de|pl|es|tr)\//i.test(text) && /(not found|unable to found)/i.test(text);

  Module.printErr = (value) => {
    const text = String(value || '');
    // The web VFS intentionally contains only EN/RU. Upstream still has a few
    // unconditional preload entries for other locales, but those assets are never
    // selected in the EN/RU runtime. Do not surface those harmless misses as errors.
    if (isExpectedFirstLaunchMessage(text) || isUnusedLocaleAssetMessage(text)) {
      console.debug('[AstroMenace] Expected web fallback:', text);
      return;
    }

    console.error(text);
    if (!Module.yandexGameReadySent && /(abort|failed|error|corrupt|not found|unable)/i.test(text)) {
      showFatal(text);
    }
  };
  Module.onAbort = (reason) => showFatal(reason || 'WebAssembly aborted');
  Module.onExit = (status) => {
    if (!Module.yandexGameReadySent && status !== 0) showFatal(`AstroMenace exited with code ${status}`);
  };

  window.addEventListener('error', (event) => {
    if (!Module.yandexGameReadySent) showFatal(event?.message || 'JavaScript error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (!Module.yandexGameReadySent) {
      const reason = event?.reason;
      showFatal(reason?.message || String(reason || 'unhandled promise rejection'));
    }
  });

  const setGameLanguage = (sdkLanguage) => {
    const sdkLang = String(sdkLanguage || '').trim().toLowerCase().split(/[-_]/)[0];
    const gameLang = RU_FALLBACK_LANGS.has(sdkLang) ? 'ru' : 'en';
    Module.yandexLanguageCode = gameLang;
    Module.yandexLanguageIndex = gameLang === 'ru' ? 1 : 0;
    document.documentElement.lang = gameLang;
    return { sdkLang, gameLang };
  };

  const applyLocalLanguageFallback = () => setGameLanguage(navigator.language || 'en');

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
      if (ctx?.state === 'running') ctx.suspend().catch(() => {});
    });
  };

  const resumeAudio = () => {
    trackedAudioContexts.forEach((ctx) => {
      if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
    });
  };

  const syncFs = (populate, timeoutMs = 1500) => new Promise((resolve) => {
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      resolve(!error);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      FS.syncfs(Boolean(populate), (error) => {
        clearTimeout(timer);
        if (error) console.warn('[Storage] IDBFS sync failed:', error);
        finish(error || null);
      });
    } catch (error) {
      clearTimeout(timer);
      console.warn('[Storage] IDBFS unavailable; continuing:', error);
      finish(error);
    }
  });

  const decodeEmbeddedGzip = async () => {
    const chunks = globalThis.ASTROMENACE_GAMEDATA_GZIP_B64_CHUNKS;
    const gzipSize = Number(globalThis.ASTROMENACE_GAMEDATA_GZIP_SIZE || 0);
    const rawSize = Number(globalThis.ASTROMENACE_GAMEDATA_RAW_SIZE || 0);

    if (!Array.isArray(chunks) || chunks.length === 0 || !gzipSize || !rawSize) {
      throw new Error('embedded gamedata is missing');
    }
    if (typeof DecompressionStream !== 'function') {
      throw new Error('this browser does not support gzip DecompressionStream');
    }

    setStatus('Decoding game data...');
    let compressed = new Uint8Array(gzipSize);
    let offset = 0;

    for (let index = 0; index < chunks.length; index++) {
      const binary = atob(chunks[index]);
      if (offset + binary.length > compressed.length) {
        throw new Error('embedded gamedata size is invalid');
      }
      for (let i = 0; i < binary.length; i++) compressed[offset + i] = binary.charCodeAt(i);
      offset += binary.length;

      if ((index & 7) === 7 || index === chunks.length - 1) {
        const percent = Math.min(99, Math.floor((100 * offset) / gzipSize));
        setStatus(`Decoding game data... ${percent}%`);
        await nextBrowserTurn();
      }
    }

    if (offset !== gzipSize) {
      throw new Error(`embedded gamedata is truncated (${offset}/${gzipSize})`);
    }

    globalThis.ASTROMENACE_GAMEDATA_GZIP_B64_CHUNKS = null;
    setStatus('Unpacking game data...');
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const rawBuffer = await new Response(stream).arrayBuffer();
    compressed = null;

    if (rawBuffer.byteLength !== rawSize) {
      throw new Error(`unpacked gamedata size mismatch (${rawBuffer.byteLength}/${rawSize})`);
    }

    setStatus('Installing game data...');
    FS.writeFile('/gamedata.vfs', new Uint8Array(rawBuffer));
    await nextBrowserTurn();
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

  const saveFileNames = () => {
    try {
      return FS.readdir(SAVE_DIR).filter((name) => name !== '.' && name !== '..');
    } catch (_) {
      return [];
    }
  };

  const collectSaveFiles = () => {
    const files = {};
    for (const name of saveFileNames()) {
      if (!/^[A-Za-z0-9_.-]+$/.test(name)) continue;
      try {
        const path = `${SAVE_DIR}/${name}`;
        const stat = FS.stat(path);
        if (!FS.isFile(stat.mode)) continue;
        files[name] = encodeBytes(FS.readFile(path, { encoding: 'binary' }));
      } catch (error) {
        console.warn('[Storage] Could not collect save file:', name, error);
      }
    }
    return files;
  };

  const syncSave = async (flushCloud = false) => {
    if (typeof FS === 'undefined') return;
    await syncFs(false);
    if (!Module.yandexPlayer) return;
    try {
      await timeout(Module.yandexPlayer.setData({
        [CLOUD_KEY]: {
          version: 2,
          updatedAt: Date.now(),
          files: collectSaveFiles()
        }
      }, Boolean(flushCloud)), PLAYER_TIMEOUT_MS, 'player.setData');
    } catch (error) {
      console.warn('[Yandex] Cloud save write skipped:', error);
    }
  };
  Module.yandexSyncSave = syncSave;

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

  const ensureSdkScript = async () => {
    if (location.protocol === 'file:') return false;
    if (typeof YaGames !== 'undefined') return true;

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const script = document.createElement('script');
      script.src = '/sdk.js';
      script.async = true;
      script.onload = finish;
      script.onerror = finish;
      document.head.appendChild(script);
      setTimeout(finish, SDK_SCRIPT_TIMEOUT_MS);
    });
    return typeof YaGames !== 'undefined';
  };

  const initYandexForStartup = async () => {
    if (location.protocol === 'file:') {
      applyLocalLanguageFallback();
      return;
    }

    setStatus('Connecting to Yandex Games...');
    if (!(await ensureSdkScript())) throw new Error('Yandex Games SDK did not load');

    const ysdk = await timeout(YaGames.init(), SDK_INIT_TIMEOUT_MS, 'YaGames.init');
    Module.yandexSDK = ysdk;

    // Requirement 2.14: use the SDK language during launch, before main().
    const resolved = setGameLanguage(ysdk.environment?.i18n?.lang);
    registerPlatformEvents(ysdk);
    console.info(`[Yandex] SDK initialized before main; language ${resolved.sdkLang || 'unknown'} -> ${resolved.gameLang}.`);
  };

  const restoreCloudOnlyWhenNoLocalSave = async () => {
    if (!Module.yandexPlayer || Module.hadLocalSaveAtStartup) return;
    try {
      const data = await timeout(Module.yandexPlayer.getData([CLOUD_KEY]), PLAYER_TIMEOUT_MS, 'player.getData');
      const save = data?.[CLOUD_KEY];
      if (!save?.files || !Object.keys(save.files).length) return;
      for (const [name, encoded] of Object.entries(save.files)) {
        if (!/^[A-Za-z0-9_.-]+$/.test(name) || typeof encoded !== 'string') continue;
        FS.writeFile(`${SAVE_DIR}/${name}`, decodeBytes(encoded));
      }
      await syncFs(false);
      if (!sessionStorage.getItem('astromenace-cloud-restored')) {
        sessionStorage.setItem('astromenace-cloud-restored', '1');
        location.reload();
      }
    } catch (error) {
      console.warn('[Yandex] Cloud restore skipped:', error);
    }
  };

  const initPlayerAfterGameReady = async () => {
    const ysdk = Module.yandexSDK;
    if (!ysdk) return;
    try {
      Module.yandexPlayer = await timeout(ysdk.getPlayer(), PLAYER_TIMEOUT_MS, 'ysdk.getPlayer');
      await restoreCloudOnlyWhenNoLocalSave();
    } catch (error) {
      console.warn('[Yandex] Player initialization skipped:', error);
    }
  };

  Module.yandexLevelComplete = async () => {
    await syncSave(true);
    const showFullscreenAdv = Module.yandexSDK?.adv?.showFullscreenAdv;
    if (typeof showFullscreenAdv !== 'function' || Module.yandexAdInProgress) return;

    Module.yandexAdInProgress = true;
    let finished = false;
    const finish = () => {
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
          },
          onClose: finish,
          onError: (error) => {
            console.warn('[Yandex] Interstitial failed:', error);
            finish();
          }
        }
      });
    } catch (error) {
      console.warn('[Yandex] Interstitial call failed:', error);
      finish();
    }
  };

  Module.yandexGameReady = () => {
    if (Module.yandexGameReadySent) return;
    Module.yandexGameReadySent = true;
    const loading = loadingElement();
    if (loading) loading.classList.add('hidden');

    // Requirement 1.19.2: C++ calls this after InitMenu(), exactly when the
    // interactive main menu becomes available.
    try {
      Module.yandexSDK?.features?.LoadingAPI?.ready();
      if (Module.yandexSDK) console.info('[Yandex] LoadingAPI.ready sent.');
    } catch (error) {
      console.warn('[Yandex] LoadingAPI.ready failed:', error);
    }
    initPlayerAfterGameReady();
  };

  trackAudioContexts();
  applyLocalLanguageFallback();

  Module.preRun = Module.preRun || [];

  // Initialize SDK and resolve language before C++ reads yandexLanguageIndex.
  // file:// deliberately skips SDK networking and remains directly launchable.
  Module.preRun.push(() => {
    addRunDependency('astromenace-yandex-sdk');
    (async () => {
      try {
        await initYandexForStartup();
      } catch (error) {
        console.warn('[Yandex] SDK startup initialization failed; continuing with local fallback:', error);
        applyLocalLanguageFallback();
      } finally {
        removeRunDependency('astromenace-yandex-sdk');
      }
    })();
  });

  // Install the complete VFS from a normal external script resource. Script
  // tags are allowed from file://, unlike fetch/XHR of index.data/index.wasm.
  Module.preRun.push(() => {
    addRunDependency('astromenace-embedded-gamedata');
    (async () => {
      try {
        await decodeEmbeddedGzip();
      } catch (error) {
        console.error('[Startup] Could not install game data:', error);
        showFatal(error?.message || String(error));
        return;
      }
      removeRunDependency('astromenace-embedded-gamedata');
    })();
  });

  Module.preRun.push(() => {
    addRunDependency('astromenace-local-save');
    (async () => {
      try {
        setStatus('Loading saved progress...');
        FS.mkdirTree(SAVE_DIR);
        try {
          FS.mount(IDBFS, {}, SAVE_DIR);
        } catch (error) {
          console.warn('[Storage] IDBFS mount warning:', error);
        }
        await syncFs(true, IDB_STARTUP_TIMEOUT_MS);
        Module.hadLocalSaveAtStartup = saveFileNames().length > 0;
      } finally {
        removeRunDependency('astromenace-local-save');
      }
    })();
  });

  setInterval(() => {
    if (Module.yandexGameReadySent) syncSave(false);
  }, SAVE_INTERVAL_MS);

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
