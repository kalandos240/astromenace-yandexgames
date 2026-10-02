const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const root = path.resolve(process.argv[2] || 'dist');
const output = path.resolve('browser-smoke');
fs.mkdirSync(output, {recursive:true});
const server = http.createServer((req,res) => {
  const file=path.join(root,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
  if (!file.startsWith(root) || !fs.existsSync(file)) {res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(8765,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    for (const mobile of [true,false]) {
      const context=await browser.newContext(mobile ? {...devices['Pixel 7'],viewport:{width:960,height:540},locale:'ru-RU'} : {viewport:{width:1280,height:720},locale:'en-US'});
      const page=await context.newPage();const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/sdk.js',route=>route.fulfill({contentType:'application/javascript',body:`globalThis.__sdkEvents=[];globalThis.YaGames={init:async()=>({environment:{i18n:{lang:'${mobile?'ru':'en'}'}},on(){},getPlayer:async()=>({getData:async()=>({}),setData:async()=>{}}),features:{LoadingAPI:{ready(){__sdkEvents.push('ready')}},GameplayAPI:{start(){__sdkEvents.push('start')},stop(){__sdkEvents.push('stop')}}},adv:{showFullscreenAdv({callbacks}){__sdkEvents.push('ad');callbacks.onClose(false)}}})};`}));
      const name=mobile?'mobile':'desktop';
      try {
        await page.goto('http://127.0.0.1:8765');
        await page.waitForFunction(()=>globalThis.Module?.yandexGameReadySent,{},{timeout:180000});
        await page.waitForTimeout(2500);
        assert.equal(await page.evaluate(()=>Module.astroMobile),mobile);
        await page.screenshot({path:path.join(output,`${name}-menu.png`)});
        const tap=async(x,y)=>{const box=await page.locator('#canvas').boundingBox(); if(mobile)await page.touchscreen.tap(box.x+x*box.width,box.y+y*box.height);else await page.mouse.click(box.x+x*box.width,box.y+y*box.height);await page.waitForTimeout(2200);};
        await tap(.5,.26);
        await tap(.68,.83); // Close first-run pilot help.
        await page.waitForFunction(()=>!document.getElementById('mobile-profile-name').hidden || !Module.astroMobile);
        if(mobile) {
          await page.locator('#mobile-profile-name').fill('Тест');
          await page.locator('#mobile-profile-name').press('Enter');
        } else await page.evaluate(()=>Module.ccall('AstroMenaceAndroidSetProfileName',null,['string'],['Pilot']));
        assert.equal(await page.evaluate(()=>Module.ccall('AstroMenaceAndroidGetProfileName','string',[],[])),mobile?'Тест':'Pilot');
        await page.screenshot({path:path.join(output,`${name}-profile.png`)});
        await tap(.725,.315); // Create pilot.
        await tap(.67,.925); // Mission selection.
        await tap(.67,.925); // Workshop.
        await page.screenshot({path:path.join(output,`${name}-workshop.png`)});
        assert.equal(await page.locator('#mobile-profile-name').isVisible(),false);
        // Close first-run workshop tips if present, then start the mission.
        await tap(.68,.83);
        await tap(.80,.91);
        if(!mobile)await tap(.68,.83); // Desktop shortcut hint.
        await page.waitForFunction(()=>Module.yandexGameplayRequested,{},{timeout:30000});
        await page.waitForTimeout(2500);
        assert.equal(await page.evaluate(() => { Module.yandexNextAdAt = Date.now() - 1; return Module.yandexMaybeShowAd('test-active-mission'); }), false, 'No ad during gameplay');
        assert.equal(await page.evaluate(() => __sdkEvents.includes('ad')), false);
        if(mobile) {
          await page.waitForFunction(()=>!document.getElementById('mobile-controls').hidden);
          const client=await context.newCDPSession(page);
          const right=await page.locator('.mobile-button.right').boundingBox();const fire=await page.locator('.mobile-button.fire1').boundingBox();
          await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:right.x+right.width/2,y:right.y+right.height/2,id:1},{x:fire.x+fire.width/2,y:fire.y+fire.height/2,id:2}]});
          await page.waitForTimeout(1200);
          await page.screenshot({path:path.join(output,'mobile-flight.png')});
          await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          await page.locator('.mobile-button.pause').tap();
        } else await page.keyboard.press('Escape');
        await page.waitForFunction(()=>!Module.yandexGameplayRequested);
        await page.evaluate(() => Module.yandexMaybeShowAd('test-pause'));
        assert.equal(await page.evaluate(() => __sdkEvents.includes('ad')), true, 'Ad at safe pause');
        await tap(.5,.338); // Resume.
        await page.waitForFunction(()=>Module.yandexGameplayRequested);
        await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});
        await page.waitForTimeout(1000);
        assert.equal(await page.evaluate(()=>Module.yandexGameplayRequested),false);
        await tap(.5,.338);
        await page.waitForFunction(()=>Module.yandexGameplayRequested);
        if(mobile)await page.locator('.mobile-button.pause').tap();else await page.keyboard.press('Escape');
        await page.waitForFunction(()=>!Module.yandexGameplayRequested);
        await tap(.5,.73);await tap(.42,.604); // Quit confirmation.
        await page.waitForTimeout(2500);
        await page.screenshot({path:path.join(output,`${name}-quit-menu.png`)});
        assert.equal(await page.evaluate(()=>Module.yandexGameplayRequested),false);
        assert.equal(await page.locator('#mobile-controls').isVisible(),false);
        await page.evaluate(() => Module.yandexSyncSave(true));
        const saved = await page.evaluate(() => Object.fromEntries(FS.readdir('/persistent').filter(n => n !== '.' && n !== '..').map(n => [n, Array.from(FS.readFile('/persistent/' + n))])));
        assert.ok(Object.keys(saved).length > 0, 'Pilot save files exist');
        await page.reload();
        await page.waitForFunction(() => Module.yandexGameReadySent, {}, {timeout:180000});
        const restored = await page.evaluate(() => Object.fromEntries(FS.readdir('/persistent').filter(n => n !== '.' && n !== '..').map(n => [n, Array.from(FS.readFile('/persistent/' + n))])));
        for (const [file, bytes] of Object.entries(saved)) assert.deepEqual(restored[file], bytes, 'Save survives page reload: ' + file);
        assert.deepEqual(errors,[]);
        fs.writeFileSync(path.join(output,`${name}-result.json`),JSON.stringify({passed:true,events:await page.evaluate(()=>__sdkEvents)},null,2));
        console.log(`${name}: PASS`);
      } catch(e) {await page.screenshot({path:path.join(output,`${name}-failure.png`)});throw e;} finally {await context.close();}
    }
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
