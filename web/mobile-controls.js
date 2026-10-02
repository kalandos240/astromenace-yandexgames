/* AstroMenace browser host: RuStore engine controls with Yandex Games lifecycle. */
var Module = typeof Module !== 'undefined' ? Module : {};
(() => {
  'use strict';
  Module.astroMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
  Module.astroHostSuspended = false;
  let mission = false, paused = false, profile = false;
  const held = new Map();
  const canvas = document.getElementById('canvas');
  const stage = document.createElement('div');
  stage.id = 'mobile-stage';
  stage.hidden = true;
  const controls = document.createElement('div');
  controls.id = 'mobile-controls';
  const input = document.createElement('input');
  input.id = 'mobile-profile-name';
  input.type = 'text';
  input.maxLength = 24;
  input.autocomplete = 'off';
  input.setAttribute('autocapitalize', 'off');
  input.spellcheck = false;
  input.enterKeyHint = 'done';
  input.hidden = true;
  stage.append(controls, input);
  const rotateHint = document.createElement('div');
  rotateHint.id = 'mobile-rotate'; rotateHint.hidden = true;
  document.body.append(stage, rotateHint);
  if (Module.astroMobile) document.body.classList.add('mobile');
  const ready = () => Module.yandexGameReadySent && !Module.astroHostSuspended &&
    !Module.yandexPlatformPaused && !Module.yandexAdInProgress && !document.hidden;
  const call = (name, args = [], types = []) => {
    if (!Module.yandexGameReadySent || typeof Module.ccall !== 'function') return;
    return Module.ccall(name, null, types, args);
  };
  const setKey = (key, down) => call('AstroMenaceAndroidSetKey', [key, down ? 1 : 0], ['number','number']);
  const release = () => {
    for (const [key, pointers] of held) { setKey(key, false); pointers.clear(); }
    held.clear();
    controls.querySelectorAll('button').forEach(b => b.classList.remove('pressed'));
  };
  Module.astroReleaseControls = release;
  const update = () => {
    const portrait = Module.astroMobile && window.innerHeight > window.innerWidth;
    rotateHint.hidden = !portrait || !Module.yandexGameReadySent;
    rotateHint.textContent = Module.yandexLanguageIndex === 1 ? '↻ Поверните устройство горизонтально' : '↻ Rotate your device to landscape';
    if (portrait && mission && !paused) call('AstroMenaceAndroidHostPause');
    const visible = Module.astroMobile && mission && !paused && !portrait && ready();
    controls.hidden = !visible;
    input.hidden = !(Module.astroMobile && profile && !mission && ready());
    stage.hidden = controls.hidden && input.hidden;
    if (!visible) release();
    if (input.hidden && document.activeElement === input) input.blur();
    const ru = Module.yandexLanguageIndex === 1;
    for (const b of controls.querySelectorAll('[data-attack]')) b.textContent = `${ru ? 'АТАКА' : 'FIRE'} ${b.dataset.attack}`;
    input.setAttribute('aria-label', ru ? 'Имя пилота' : 'Pilot name');
    const rect = canvas.getBoundingClientRect();
    stage.style.left = `${rect.left}px`; stage.style.top = `${rect.top}px`;
    stage.style.width = `${rect.width}px`; stage.style.height = `${rect.height}px`;
  };
  Module.astroUpdateControls = update;
  const gameplay = () => {
    if (mission && !paused) Module.yandexGameplayStart?.();
    else Module.yandexGameplayStop?.();
    update();
  };
  globalThis.AndroidHost = {
    gameplayState(active) { mission = !!active; if (!mission) paused = false; gameplay(); },
    pauseMenuState(visible) { const next = !!visible; if (paused !== next) { paused = next; gameplay(); } else update(); },
    profileInputMode(enabled) { profile = !!enabled; update(); },
  };
  for (const [name, text, key] of [['up','▲',38],['left','◀',37],['right','▶',39],['down','▼',40],['fire1','',90],['fire2','',88],['pause','Ⅱ',27]]) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `mobile-button ${name}`; button.textContent = text;
    button.setAttribute('aria-label', name);
    if (name.startsWith('fire')) button.dataset.attack = name.slice(-1);
    const pointers = new Set();
    button.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      if (!ready() || !mission || paused) return;
      if (name === 'pause') { release(); call('AstroMenaceAndroidGameBack'); return; }
      button.setPointerCapture(e.pointerId);
      pointers.add(e.pointerId);
      held.set(key, pointers);
      button.classList.add('pressed'); setKey(key, true);
    });
    const end = e => {
      e.preventDefault(); e.stopPropagation(); pointers.delete(e.pointerId);
      if (!pointers.size) { held.delete(key); button.classList.remove('pressed'); setKey(key, false); }
    };
    for (const ev of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(ev, end);
    controls.append(button);
  }
  input.addEventListener('focus', () => {
    if (!profile || !ready()) { input.blur(); return; }
    if (typeof Module.ccall === 'function') input.value = Module.ccall('AstroMenaceAndroidGetProfileName','string',[],[]) || '';
  });
  input.addEventListener('input', () => {
    if (profile && ready()) call('AstroMenaceAndroidSetProfileName',[input.value],['string']);
  });
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  input.addEventListener('keyup', e => e.stopPropagation());
  for (const ev of ['keydown','keyup','keypress']) window.addEventListener(ev, e => {
    if (e.target === input) {
      if (ev === 'keydown' && e.key === 'Enter') { e.preventDefault(); input.blur(); }
      e.stopImmediatePropagation();
    }
  }, true);
  const blockGameplayTouch = e => {
    if (Module.astroMobile && mission && !paused) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  for (const ev of ['pointerdown','pointermove','pointerup','touchstart','touchmove','touchend','mousedown','mousemove','mouseup','click'])
    canvas.addEventListener(ev, blockGameplayTouch, {capture:true, passive:false});
  const suspend = () => {
    Module.astroHostSuspended = true; release();
    if (mission) call('AstroMenaceAndroidHostPause');
    update();
  };
  window.addEventListener('blur', suspend);
  window.addEventListener('focus', () => { Module.astroHostSuspended = false; update(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else { Module.astroHostSuspended = false; update(); } });
  window.addEventListener('pagehide', suspend);
  window.addEventListener('resize', update);
  document.addEventListener('fullscreenchange', update);
  window.visualViewport?.addEventListener('resize', update);
  if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(canvas);
  update();
})();
