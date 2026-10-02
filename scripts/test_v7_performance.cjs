const {chromium}=require('playwright'),http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert');
const percentile=(v,p)=>[...v].sort((a,b)=>a-b)[Math.floor((v.length-1)*p)];
async function main(){
const server=http.createServer((req,res)=>{const file=path.join(process.cwd(),decodeURIComponent(req.url).split('?')[0]);if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);}).listen(8081,'127.0.0.1');
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const results={};
try{for(const build of ['dist-baseline','dist']){
 const context=await browser.newContext({viewport:{width:960,height:540},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>{errors.push(String(e));console.log(build+' pageerror: '+String(e));});
 await page.goto('http://127.0.0.1:8081/'+build+'/index.html');await page.waitForFunction(()=>Module.yandexGameReadySent,null,{timeout:180000});
 await page.evaluate(()=>Module.ccall('AstroMenaceAndroidSmokeStartMission',null,[],[]));await page.waitForFunction(()=>{const state=Module.ccall('AstroMenaceWebGameState','number',[],[]);return (state&3)===3&&!(state&16);});
 await page.evaluate(()=>Module.ccall('AstroMenaceWebStressSpawn',null,[],[]));
 await page.waitForTimeout(1000);
 await page.evaluate(()=>{Module.astroPerfSamples=[];Module.astroPerfCollect=true;Module.astroPerfLast=0;});
 try { await page.waitForFunction(()=>Module.astroPerfSamples.length>=40,null,{timeout:120000}); } catch(e) { console.log('DIAGNOSTIC '+JSON.stringify(await page.evaluate(()=>({samples:Module.astroPerfSamples,collect:Module.astroPerfCollect,state:Module.ccall('AstroMenaceWebGameState','number',[],[]),particles:Module.ccall('AstroMenaceWebParticleVisibleCount','number',[],[])})))); console.log('ERRORS '+JSON.stringify(errors)); throw e; }
 const samples=await page.evaluate(()=>{Module.astroPerfCollect=false;return Module.astroPerfSamples.slice(5,35);});
 assert(samples.every(s=>s.particles>=7000),'Stress particles unexpectedly absent');
 const mean=k=>samples.reduce((a,s)=>a+s[k],0)/samples.length;
 const result={particles:mean('particles'),particleDraws:mean('particleDraws'),drawMs:mean('drawMs'),drawP95:percentile(samples.map(s=>s.drawMs),.95),frameP95:percentile(samples.map(s=>s.gapMs),.95)};
 await page.evaluate(()=>{Module.ccall('AstroMenaceWebResetBufferStats',null,[],[]);Module.ccall('AstroMenaceWebStressAnimate',null,[],[]);});
 await page.waitForTimeout(1400);
 Object.assign(result,await page.evaluate(()=>({bufferCreates:Module.ccall('AstroMenaceWebBufferCreates','number',[],[]),bufferDeletes:Module.ccall('AstroMenaceWebBufferDeletes','number',[],[]),bufferUpdates:Module.ccall('AstroMenaceWebBufferUpdates','number',[],[])})));
 assert.deepEqual(errors,[]);results[build]=result;console.log(build+': '+JSON.stringify(result));await context.close();
 }
 const before=results['dist-baseline'],after=results.dist;
 assert(Math.abs(after.particles-before.particles)/before.particles<.05,'Particle amount changed');
 assert(after.particleDraws<before.particleDraws*.25,'Particle batching did not reduce calls');
 assert(before.bufferCreates>0,'Baseline CPU explosion fixture did not animate geometry');
 assert(after.bufferUpdates>0,'Buffer update path did not run');
 assert(after.bufferCreates<before.bufferCreates*.5,'Explosion buffers still recreated');
 console.log('PASS: unchanged stress particle amount, >75% fewer particle draws, explosion buffers updated in place');
 fs.writeFileSync('dist/V7_PERFORMANCE.json',JSON.stringify({environment:'Headless Chromium/SwiftShader, 960x540 touch viewport; these numbers are not phone FPS',results},null,2));
}finally{await browser.close();server.close();}}
main().catch(e=>{console.error(e);process.exit(1);});

