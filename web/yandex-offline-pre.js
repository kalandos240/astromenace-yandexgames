/* AstroMenace fast/offline Yandex Games bridge. */
var Module = typeof Module !== 'undefined' ? Module : {};

(() => {
  'use strict';

  const SAVE_DIR = '/persistent';
  const CLOUD_KEY = 'astromenaceSave';
  const LOCAL_STORAGE_KEY = 'astromenaceLocalSaveV1';
  const SAVE_INTERVAL_MS = 15000;
  const IDB_STARTUP_TIMEOUT_MS = 1200;
  const SDK_SCRIPT_TIMEOUT_MS = 6000;
  const SDK_INIT_TIMEOUT_MS = 8000;
  const PLAYER_TIMEOUT_MS = 2500;
  const SAVE_CLOCK_TOLERANCE_MS = 1500;
  const AD_INTERVAL_MS = 120000;
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
  Module.yandexGameplayRequested = false;
  Module.yandexGameplayApiRunning = false;
  Module.yandexCloudResolved = false;
  Module.yandexLastCloudFingerprint = null;
  Module.hadLocalSaveAtStartup = false;
  Module.localSaveUpdatedAtAtStartup = 0;
  Module.usesIDBFS = false;
  Module.yandexNextAdAt = 0;

  const isRussian = () => Module.yandexLanguageCode === 'ru';

  const localizeStatus = (value) => {
    const text = String(value || '');
    if (!isRussian()) return text === 'Running...' ? 'Starting engine...' : text;
    const replacements = [
      [/^Running\.\.\.$/, 'Запуск движка...'],
      [/^Starting engine\.\.\.$/, 'Запуск движка...'],
      [/^Connecting to Yandex Games\.\.\.$/, 'Подключение к Яндекс Играм...'],
      [/^Decoding game data\.\.\./, 'Подготовка данных игры...'],
      [/^Unpacking game data\.\.\./, 'Распаковка данных игры...'],
      [/^Installing game data\.\.\./, 'Проверка данных игры...'],
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
    if (left <= 0) return;
    const current = String(statusElement()?.textContent || '');
    if (/Распаковка данных игры|Unpacking game data|Проверка данных игры|Installing game data/i.test(current)) return;
  };

  const isExpectedFirstLaunchMessage = (text) =>
    /LoadPilotProfiles\(\): Can't open file \/persistent\/PilotProfiles_/i.test(text) ||
    /cXMLDocument\(\): XML file not found: \/persistent\/config\.xml/i.test(text);

  const isUnusedLocaleAssetMessage = (text) =>
    /lang\/(?:de|pl|es|tr)\//i.test(text) && /(not found|unable to found)/i.test(text);

  Module.printErr = (value) => {
    const text = String(value || '');
    if (isExpectedFirstLaunchMessage(text) || isUnusedLocaleAssetMessage(text)) {
      console.debug('[AstroMenace] Expected web fallback:', text);
      return;
    }
    console.error(text);
    if (!Module.yandexGameReadySent && /(abort|failed|error|corrupt|not found|unable)/i.test(text)) showFatal(text);
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

  const pauseAudio = () => trackedAudioContexts.forEach((ctx) => {
    if (ctx?.state === 'running') ctx.suspend().catch(() => {});
  });
  const resumeAudio = () => trackedAudioContexts.forEach((ctx) => {
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  });

  const releasePointerLock = () => {
    if (document.pointerLockElement === Module.canvas) {
      try { document.exitPointerLock?.(); } catch (_) {}
    }
  };

  const tryPointerLock = () => {
    if (!Module.yandexGameplayRequested || Module.yandexPlatformPaused || Module.yandexAdInProgress || document.hidden) return;
    if (!Module.canvas?.requestPointerLock || document.pointerLockElement === Module.canvas) return;
    try {
      const result = Module.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {}
  };

  const setGameplayApiRunning = (running) => {
    const shouldRun = Boolean(running) && !Module.yandexPlatformPaused && !Module.yandexAdInProgress && !document.hidden;
    if (Module.yandexGameplayApiRunning === shouldRun) return;
    const api = Module.yandexSDK?.features?.GameplayAPI;
    try {
      if (shouldRun) api?.start?.(); else api?.stop?.();
      Module.yandexGameplayApiRunning = shouldRun;
      if (Module.yandexSDK) console.info(`[Yandex] GameplayAPI.${shouldRun ? 'start' : 'stop'} sent.`);
    } catch (error) {
      console.warn('[Yandex] GameplayAPI event failed:', error);
    }
  };

  const adIsDue = () => Module.yandexNextAdAt > 0 && Date.now() >= Module.yandexNextAdAt;
  const armAdClock = () => { Module.yandexNextAdAt = Date.now() + AD_INTERVAL_MS; };

  const showScheduledInterstitial = (reason) => {
    if (!Module.yandexGameReadySent || !adIsDue()) return false;
    if (Module.yandexGameplayRequested || Module.yandexPlatformPaused || Module.yandexAdInProgress || document.hidden) return false;
    if (typeof Module.yandexSDK?.adv?.showFullscreenAdv !== 'function') {
      armAdClock();
      return false;
    }

    Module.yandexAdInProgress = true;
    armAdClock();
    setGameplayApiRunning(false);
    releasePointerLock();
    pauseAudio();
    window.dispatchEvent(new Event('blur'));
    console.info(`[Yandex] Scheduled interstitial requested at safe point: ${reason}.`);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      Module.yandexAdInProgress = false;
      if (!Module.yandexPlatformPaused && !document.hidden) {
        window.dispatchEvent(new Event('focus'));
        resumeAudio();
        if (Module.yandexGameplayRequested) setGameplayApiRunning(true);
      }
    };

    try {
      Module.yandexSDK.adv.showFullscreenAdv({
        callbacks: {
          onOpen: () => {
            setGameplayApiRunning(false);
            releasePointerLock();
            pauseAudio();
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
    return true;
  };
  Module.yandexMaybeShowAd = showScheduledInterstitial;

  Module.yandexGameplayStart = () => {
    Module.yandexGameplayRequested = true;
    setGameplayApiRunning(true);
    tryPointerLock();
  };
  Module.yandexGameplayStop = () => {
    Module.yandexGameplayRequested = false;
    setGameplayApiRunning(false);
    releasePointerLock();
    setTimeout(() => showScheduledInterstitial('gameplay-pause-or-menu'), 0);
  };

  Module.canvas?.addEventListener('pointerdown', () => {
    if (Module.yandexGameplayRequested) tryPointerLock();
    else showScheduledInterstitial('menu-interaction');
  });

  const decodeEmbeddedGzip = async () => {
    const chunks = globalThis.ASTROMENACE_GAMEDATA_GZIP_B64_CHUNKS;
    const gzipSize = Number(globalThis.ASTROMENACE_GAMEDATA_GZIP_SIZE || 0);
    const rawSize = Number(globalThis.ASTROMENACE_GAMEDATA_RAW_SIZE || 0);
    if (!Array.isArray(chunks) || chunks.length === 0 || !gzipSize || !rawSize) throw new Error('embedded gamedata is missing');
    if (typeof DecompressionStream !== 'function' || typeof ReadableStream !== 'function') throw new Error('browser gzip streaming is unavailable');

    let chunkIndex = 0;
    let compressedRead = 0;
    setStatus('Decoding game data... 0%');

    const compressedStream = new ReadableStream({
      async pull(controller) {
        if (chunkIndex >= chunks.length) {
          if (compressedRead !== gzipSize) {
            controller.error(new Error(`embedded gamedata is truncated (${compressedRead}/${gzipSize})`));
            return;
          }
          controller.close();
          return;
        }

        const encoded = chunks[chunkIndex];
        chunks[chunkIndex] = null;
        chunkIndex += 1;
        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        compressedRead += bytes.length;
        if (compressedRead > gzipSize) {
          controller.error(new Error('embedded gamedata size is invalid'));
          return;
        }
        controller.enqueue(bytes);
        const percent = Math.min(99, Math.floor((100 * compressedRead) / gzipSize));
        setStatus(`Decoding game data... ${percent}%`);
        await nextBrowserTurn();
      }
    });

    setStatus('Unpacking game data... 0%');
    const reader = compressedStream.pipeThrough(new DecompressionStream('gzip')).getReader();
    const rawBytes = new Uint8Array(rawSize);
    let rawWritten = 0;
    let lastPercent = -1;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || !value.length) continue;
        if (rawWritten + value.length > rawSize) throw new Error('unpacked gamedata exceeds expected size');
        rawBytes.set(value, rawWritten);
        rawWritten += value.length;

        const percent = Math.min(99, Math.floor((100 * rawWritten) / rawSize));
        if (percent !== lastPercent) {
          lastPercent = percent;
          setStatus(`Unpacking game data... ${percent}%`);
          await nextBrowserTurn();
        }
      }
    } finally {
      globalThis.ASTROMENACE_GAMEDATA_GZIP_B64_CHUNKS = null;
    }

    if (rawWritten !== rawSize) throw new Error(`unpacked gamedata size mismatch (${rawWritten}/${rawSize})`);

    const expectedHeader = [0x56, 0x46, 0x53, 0x5f, 0x76, 0x31, 0x2e, 0x36]; // VFS_v1.6
    for (let i = 0; i < expectedHeader.length; i++) {
      if (rawBytes[i] !== expectedHeader[i]) throw new Error('decompressed gamedata VFS header is invalid');
    }

    setStatus('Installing game data...');
    try { FS.unlink('/gamedata.vfs'); } catch (_) {}

    // Install the VFS atomically. Passing canOwn=true lets MEMFS own the single
    // decompressed buffer directly, avoiding hundreds of positioned FS.write()
    // calls and avoiding a second 88 MB copy of the game archive.
    if (typeof FS.createDataFile !== 'function') throw new Error('MEMFS createDataFile is unavailable');
    FS.createDataFile('/', 'gamedata.vfs', rawBytes, true, false, true);

    const stat = FS.stat('/gamedata.vfs');
    if (Number(stat?.size || 0) !== rawSize) throw new Error(`installed gamedata size mismatch (${stat?.size}/${rawSize})`);
    const installedHeader = FS.readFile('/gamedata.vfs', { encoding: 'binary' }).subarray(0, 8);
    for (let i = 0; i < expectedHeader.length; i++) {
      if (installedHeader[i] !== expectedHeader[i]) throw new Error('installed gamedata VFS header is invalid');
    }

    setStatus('Installing game data... 100%');
    console.info(`[Startup] Atomic MEMFS VFS installed: ${rawWritten} bytes, header VFS_v1.6.`);
    await nextBrowserTurn();
  };

  const encodeBytes = (bytes) => {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    return btoa(binary);
  };
  const decodeBytes = (value) => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const saveFileNames = () => {
    try { return FS.readdir(SAVE_DIR).filter((name) => name !== '.' && name !== '..'); } catch (_) { return []; }
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
      } catch (error) { console.warn('[Storage] Could not collect save file:', name, error); }
    }
    return files;
  };

  const statTimestamp = (stat) => {
    const value = stat?.mtime;
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return numeric < 1e12 ? numeric * 1000 : numeric;
  };
  const localSaveUpdatedAt = () => {
    let newest = 0;
    for (const name of saveFileNames()) {
      if (!/^[A-Za-z0-9_.-]+$/.test(name)) continue;
      try {
        const stat = FS.stat(`${SAVE_DIR}/${name}`);
        if (FS.isFile(stat.mode)) newest = Math.max(newest, statTimestamp(stat));
      } catch (_) {}
    }
    return newest;
  };

  const restoreLocalStorage = () => {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return true;
      const snapshot = JSON.parse(raw);
      const files = snapshot?.files && typeof snapshot.files === 'object' ? snapshot.files : {};
      const stamp = Number(snapshot?.updatedAt || 0);
      for (const [name, encoded] of Object.entries(files)) {
        if (!/^[A-Za-z0-9_.-]+$/.test(name) || typeof encoded !== 'string') continue;
        const path = `${SAVE_DIR}/${name}`;
        FS.writeFile(path, decodeBytes(encoded));
        if (stamp > 0 && typeof FS.utime === 'function') {
          try { FS.utime(path, stamp, stamp); } catch (_) {}
        }
      }
      return true;
    } catch (error) {
      console.warn('[Storage] localStorage restore skipped:', error);
      return false;
    }
  };

  const persistLocalStorage = () => {
    try {
      const files = collectSaveFiles();
      const updatedAt = Math.max(localSaveUpdatedAt(), Date.now());
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ version: 1, updatedAt, files }));
      return true;
    } catch (error) {
      console.warn('[Storage] localStorage save skipped:', error);
      return false;
    }
  };

  const syncFs = (populate, timeoutMs = 1500) => {
    if (!Module.usesIDBFS) return Promise.resolve(populate ? restoreLocalStorage() : persistLocalStorage());
    return new Promise((resolve) => {
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
        console.warn('[Storage] IDBFS sync unavailable; switching to localStorage:', error);
        Module.usesIDBFS = false;
        finish(error);
      }
    });
  };

  const fingerprintFiles = (files) => {
    const names = Object.keys(files || {}).sort();
    let hash = 2166136261;
    const feed = (text) => {
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
    };
    for (const name of names) {
      feed(name); feed('\0'); feed(String(files[name] || '')); feed('\0');
    }
    return `${names.length}:${hash.toString(16)}`;
  };

  const isUnchangedCloudError = (error) =>
    /data does not differ from the previous ones/i.test(String(error?.message || error || ''));

  const writeCloudPayload = async (flushCloud, updatedAtOverride = 0) => {
    if (!Module.yandexPlayer || !Module.yandexCloudResolved) return false;
    const files = collectSaveFiles();
    if (!Object.keys(files).length) return false;

    const fingerprint = fingerprintFiles(files);
    if (fingerprint === Module.yandexLastCloudFingerprint) return false;

    const updatedAt = Math.max(Number(updatedAtOverride || 0), localSaveUpdatedAt(), 1);
    const previousFingerprint = Module.yandexLastCloudFingerprint;
    Module.yandexLastCloudFingerprint = fingerprint;

    try {
      await timeout(Module.yandexPlayer.setData({
        [CLOUD_KEY]: { version: 3, updatedAt, files }
      }, Boolean(flushCloud)), PLAYER_TIMEOUT_MS, 'player.setData');
      return true;
    } catch (error) {
      if (isUnchangedCloudError(error)) {
        console.debug('[Yandex] Cloud save unchanged; duplicate write skipped.');
        return false;
      }
      Module.yandexLastCloudFingerprint = previousFingerprint;
      throw error;
    }
  };

  const syncSave = async (flushCloud = false) => {
    if (typeof FS === 'undefined') return;
    await syncFs(false);
    if (!Module.yandexPlayer || !Module.yandexCloudResolved) return;
    try { await writeCloudPayload(flushCloud); } catch (error) { console.warn('[Yandex] Cloud save write skipped:', error); }
  };
  Module.yandexSyncSave = syncSave;

  const registerPlatformEvents = (ysdk) => {
    ysdk.on?.('game_api_pause', () => {
      Module.yandexPlatformPaused = true;
      setGameplayApiRunning(false);
      releasePointerLock();
      pauseAudio();
      window.dispatchEvent(new Event('blur'));
    });
    ysdk.on?.('game_api_resume', () => {
      Module.yandexPlatformPaused = false;
      if (!Module.yandexAdInProgress) {
        resumeAudio();
        window.dispatchEvent(new Event('focus'));
        if (Module.yandexGameplayRequested) setGameplayApiRunning(true);
      }
    });
  };

  const ensureSdkScript = async () => {
    if (location.protocol === 'file:') return false;
    if (typeof YaGames !== 'undefined') return true;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
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
    const resolved = setGameLanguage(ysdk.environment?.i18n?.lang);
    registerPlatformEvents(ysdk);
    console.info(`[Yandex] SDK initialized before main; language ${resolved.sdkLang || 'unknown'} -> ${resolved.gameLang}.`);
  };

  const restoreCloudFiles = async (cloudFiles, cloudUpdatedAt = 0) => {
    const allowed = new Set(Object.keys(cloudFiles || {}).filter((name) => /^[A-Za-z0-9_.-]+$/.test(name)));
    for (const name of saveFileNames()) {
      if (!/^[A-Za-z0-9_.-]+$/.test(name) || allowed.has(name)) continue;
      try { FS.unlink(`${SAVE_DIR}/${name}`); } catch (_) {}
    }
    for (const [name, encoded] of Object.entries(cloudFiles || {})) {
      if (!/^[A-Za-z0-9_.-]+$/.test(name) || typeof encoded !== 'string') continue;
      const path = `${SAVE_DIR}/${name}`;
      FS.writeFile(path, decodeBytes(encoded));
      if (cloudUpdatedAt > 0 && typeof FS.utime === 'function') {
        try { FS.utime(path, cloudUpdatedAt, cloudUpdatedAt); } catch (_) {}
      }
    }
    await syncFs(false);
  };

  const resolveNewestSave = async () => {
    if (!Module.yandexPlayer) return false;
    const localFiles = collectSaveFiles();
    const localHasSave = Object.keys(localFiles).length > 0;
    const localTimestamp = Number(Module.localSaveUpdatedAtAtStartup || localSaveUpdatedAt() || 0);
    const data = await timeout(Module.yandexPlayer.getData([CLOUD_KEY]), PLAYER_TIMEOUT_MS, 'player.getData');
    const cloud = data?.[CLOUD_KEY];
    const cloudFiles = cloud?.files && typeof cloud.files === 'object' ? cloud.files : {};
    const cloudHasSave = Object.keys(cloudFiles).length > 0;
    const cloudTimestamp = Number(cloud?.updatedAt || 0);
    Module.yandexLastCloudFingerprint = cloudHasSave ? fingerprintFiles(cloudFiles) : null;

    if (!cloudHasSave) {
      Module.yandexCloudResolved = true;
      if (localHasSave) await writeCloudPayload(true, localTimestamp);
      console.info('[Yandex] Save merge: local save selected (cloud empty).');
      return false;
    }
    if (!Module.hadLocalSaveAtStartup) {
      await restoreCloudFiles(cloudFiles, cloudTimestamp);
      Module.yandexCloudResolved = true;
      console.info('[Yandex] Save merge: cloud save selected (no local save at startup).');
      return true;
    }

    const localFingerprint = fingerprintFiles(localFiles);
    const cloudFingerprint = fingerprintFiles(cloudFiles);
    if (localFingerprint === cloudFingerprint) {
      Module.yandexCloudResolved = true;
      console.info('[Yandex] Save merge: local and cloud progress are identical.');
      return false;
    }
    if (cloudTimestamp > localTimestamp + SAVE_CLOCK_TOLERANCE_MS) {
      await restoreCloudFiles(cloudFiles, cloudTimestamp);
      Module.yandexCloudResolved = true;
      console.info(`[Yandex] Save merge: newer cloud save selected (${cloudTimestamp} > ${localTimestamp}).`);
      return true;
    }

    Module.yandexCloudResolved = true;
    await writeCloudPayload(true, localTimestamp);
    console.info(`[Yandex] Save merge: newer local save selected (${localTimestamp} >= ${cloudTimestamp}).`);
    return false;
  };

  const initPlayerAfterGameReady = async () => {
    const ysdk = Module.yandexSDK;
    if (!ysdk) {
      Module.yandexCloudResolved = true;
      return;
    }
    try {
      Module.yandexPlayer = await timeout(ysdk.getPlayer(), PLAYER_TIMEOUT_MS, 'ysdk.getPlayer');
      const restoredCloud = await resolveNewestSave();
      if (restoredCloud) {
        if (!sessionStorage.getItem('astromenace-cloud-restore-reload')) {
          sessionStorage.setItem('astromenace-cloud-restore-reload', '1');
          location.reload();
        } else {
          console.warn('[Yandex] Cloud save restored but reload was already attempted; continuing without another reload.');
        }
      } else {
        sessionStorage.removeItem('astromenace-cloud-restore-reload');
      }
    } catch (error) {
      Module.yandexCloudResolved = true;
      console.warn('[Yandex] Player/save initialization skipped:', error);
    }
  };

  Module.yandexLevelComplete = async () => {
    Module.yandexGameplayStop();
    await syncSave(true);
    showScheduledInterstitial('level-complete');
  };

  Module.yandexGameReady = () => {
    if (Module.yandexGameReadySent) return;
    Module.yandexGameReadySent = true;
    const loading = loadingElement();
    if (loading) loading.classList.add('hidden');
    try {
      Module.yandexSDK?.features?.LoadingAPI?.ready();
      if (Module.yandexSDK) console.info('[Yandex] LoadingAPI.ready sent.');
    } catch (error) { console.warn('[Yandex] LoadingAPI.ready failed:', error); }
    setGameplayApiRunning(false);
    armAdClock();
    initPlayerAfterGameReady();
  };

  trackAudioContexts();
  applyLocalLanguageFallback();
  Module.preRun = Module.preRun || [];

  Module.preRun.push(() => {
    addRunDependency('astromenace-yandex-sdk');
    (async () => {
      try { await initYandexForStartup(); }
      catch (error) {
        console.warn('[Yandex] SDK startup initialization failed; continuing with local fallback:', error);
        applyLocalLanguageFallback();
      } finally { removeRunDependency('astromenace-yandex-sdk'); }
    })();
  });

  Module.preRun.push(() => {
    addRunDependency('astromenace-embedded-gamedata');
    (async () => {
      try {
        await decodeEmbeddedGzip();
        removeRunDependency('astromenace-embedded-gamedata');
      } catch (error) {
        console.error('[Startup] Could not install game data:', error);
        showFatal(error?.message || String(error));
      }
    })();
  });

  Module.preRun.push(() => {
    addRunDependency('astromenace-local-save');
    (async () => {
      try {
        setStatus('Loading saved progress...');
        FS.mkdirTree(SAVE_DIR);
        if (typeof IDBFS !== 'undefined') {
          try {
            FS.mount(IDBFS, {}, SAVE_DIR);
            Module.usesIDBFS = true;
            console.info('[Storage] IDBFS enabled.');
          } catch (error) {
            Module.usesIDBFS = false;
            console.warn('[Storage] IDBFS mount failed; using localStorage:', error);
          }
        } else {
          console.info('[Storage] IDBFS is not linked; using localStorage fallback.');
        }
        await syncFs(true, IDB_STARTUP_TIMEOUT_MS);
        Module.hadLocalSaveAtStartup = saveFileNames().length > 0;
        Module.localSaveUpdatedAtAtStartup = localSaveUpdatedAt();
      } finally { removeRunDependency('astromenace-local-save'); }
    })();
  });

  setInterval(() => {
    if (Module.yandexGameReadySent) syncSave(false);
  }, SAVE_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      setGameplayApiRunning(false);
      releasePointerLock();
      pauseAudio();
      syncSave(true);
    } else if (!Module.yandexPlatformPaused && !Module.yandexAdInProgress) {
      resumeAudio();
      if (Module.yandexGameplayRequested) setGameplayApiRunning(true);
    }
  });

  window.addEventListener('pagehide', () => {
    setGameplayApiRunning(false);
    releasePointerLock();
    syncSave(true);
  });
})();