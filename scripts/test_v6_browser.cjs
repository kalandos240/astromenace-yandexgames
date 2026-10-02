const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
(async () => {
  const server = http.createServer((req,res) => {
    const file = path.join(process.cwd(),'dist',req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
    if (!fs.existsSync(file)) {res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(file).pipe(res);
  }).listen(8080,'127.0.0.1');
  const browser = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    for (const mobile of [true,false]) {
      const context = await browser.newContext({viewport:{width:1280,height:720},isMobile:mobile,hasTouch:mobile,userAgent:mobile ? 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36' : undefined});
      const page = await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(String(e)));
      await page.goto('http://127.0.0.1:8080/');
      await page.waitForFunction(()=>Module.yandexGameReadySent && typeof Module.ccall==='function',null,{timeout:180000});
      const state=()=>page.evaluate(()=>Module.ccall('AstroMenaceWebGameState','number',[],[]));
      const start=async()=>{await page.evaluate(()=>Module.ccall('AstroMenaceAndroidSmokeStartMission',null,[],[]));await page.waitForFunction(()=> (Module.ccall('AstroMenaceWebGameState','number',[],[]) & 3)===3);};
      const defeat=async()=>{await page.evaluate(()=>Module.ccall('AstroMenaceWebSmokeDefeat',null,[],[]));await page.waitForFunction(()=>Module.ccall('AstroMenaceWebGameState','number',[],[])===1&&!Module.yandexGameplayRequested&&!document.pointerLockElement);};
      const click=async(restart)=>{
        const point=await page.evaluate(restart=>{const c=Module.canvas,r=c.getBoundingClientRect(),v=c.width/c.height<1.4?1024:1228;return {x:r.left+(v/2+(restart?130:-130))/v*r.width,y:r.top+466/768*r.height};},restart);
        if(mobile)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
      };
      await start();await defeat();
      await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});
      assert.equal(await state(),1,'Focus loss must preserve defeat screen');
      await click(true);
      await page.waitForFunction(()=> (Module.ccall('AstroMenaceWebGameState','number',[],[]) & 3)===3,null,{timeout:30000});
      assert.equal((await state())&3,3);console.log((mobile?'Mobile':'Desktop')+': defeat -> RESTART -> living player PASS');
      if(mobile){await page.setViewportSize({width:900,height:600});await page.waitForTimeout(600);}
      await defeat();await click(false);
      await page.waitForFunction(()=>Module.ccall('AstroMenaceWebSmokeMainMenu','number',[],[])===1,null,{timeout:4000});
      console.log((mobile?'Mobile resized':'Desktop')+': defeat -> QUIT -> main menu within 4 seconds PASS');
      assert.deepEqual(errors,[]);await context.close();
    }
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
