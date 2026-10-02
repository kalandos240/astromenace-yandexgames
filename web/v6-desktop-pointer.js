// Use the same viewport-normalized menu bridge for short desktop clicks.
// SDL mouse motion and held buttons still serve flight controls.
(() => {
  let pointer = null;
  const canvas = document.getElementById('canvas');
  const ready = () => Module.yandexGameReadySent && !Module.astroHostSuspended &&
    !Module.yandexAdInProgress && !Module.yandexPlatformPaused && !document.hidden;
  const send = (event, phase) => {
    const rect = canvas.getBoundingClientRect();
    Module.ccall('AstroMenaceWebMenuPointer', null, ['number','number','number'],
      [Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),
       Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)),phase]);
  };
  canvas.addEventListener('pointerdown', event => {
    if (Module.astroMobile || event.button !== 0 || !ready()) return;
    const state = Module.ccall('AstroMenaceWebGameState','number',[],[]);
    if ((state & 3) === 3 && !(state & 8) && !(state & 16)) return;
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    send(event,0);
  },true);
  for (const name of ['pointerup','pointercancel']) canvas.addEventListener(name,event => {
    if (pointer !== event.pointerId) return;
    send(event,ready() && name === 'pointerup' ? 2 : 3);
    pointer = null;
  },true);
  window.addEventListener('blur',() => {
    if (pointer !== null) Module.ccall('AstroMenaceWebMenuPointer',null,['number','number','number'],[0,0,3]);
    pointer = null;
  });
})();
