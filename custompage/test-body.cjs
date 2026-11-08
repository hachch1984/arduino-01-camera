'use strict';
// Prueba Human real en Chrome con una imagen de prueba; simula únicamente el transporte y las órdenes de cámara.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {createServer}=require('./server/index.cjs');

const run=async()=>{
  if(!process.env.BODY_TEST_IMAGE)throw new Error('Define BODY_TEST_IMAGE con una foto de prueba con rostro y cuerpo. Ver body/README.md.');
  const image=fs.readFileSync(process.env.BODY_TEST_IMAGE),server=createServer({camera:new URL('http://127.0.0.1:1'),smtp:{}},{});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://localhost:${server.address().port}`;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1200}}),errors=[],commands=[],external=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    page.on('request',req=>{if(!req.url().startsWith(base)&&!req.url().startsWith('data:'))external.push(req.url());});
    await page.route('**/api/body/start',route=>{commands.push(route.request().postDataJSON());return route.fulfill({json:{id:'fixture',width:1920,height:1080,streamUrl:'/body/test-frame'}});});
    await page.route('**/api/body/stop',route=>route.fulfill({json:{ok:true}}));
    await page.route('**/api/body',route=>route.fulfill({json:{active:true}}));
    await page.route('**/body/test-frame',route=>route.fulfill({contentType:'image/jpeg',body:image}));
    await page.goto(base+'/body');
    assert.equal(await page.locator('#resolution').inputValue(),'fhd');
    await page.locator('#start').click();
    await page.waitForFunction(()=>document.querySelector('#latency').textContent.includes('ms')||document.querySelector('#feedback').classList.contains('alert-danger'),{},{timeout:120000});
    assert.equal(await page.locator('#feedback').evaluate(el=>el.classList.contains('alert-danger')),false,await page.locator('#feedback').textContent());
    const bodies=Number(await page.locator('#bodyCount').textContent()),faces=Number(await page.locator('#faceCount').textContent());
    assert.ok(bodies>0,'MoveNet no detectó el cuerpo de la imagen de prueba.');
    assert.ok(faces>0,'BlazeFace no detectó el rostro de la imagen de prueba.');
    assert.match(await page.locator('#faceResults').textContent(),/(468|478) puntos de malla/,'No se ejecutó la malla facial.');
    assert.equal(await page.locator('#rawResults').count(),0);assert.equal(await page.locator('details').count(),0);
    assert.equal(commands[0].resolution,'fhd');assert.deepEqual(external,[],'Algún recurso salió del servidor local.');
    const diagnostics={backend:await page.locator('#backend').textContent(),video:await page.locator('#videoSize').textContent(),input:await page.locator('#analysisSize').textContent(),ms:await page.locator('#latency').textContent(),faces,bodies,hands:Number(await page.locator('#handCount').textContent()),gestures:await page.locator('#gestureResults .result-item').count()};
    if(process.env.UI_SCREENSHOT_DIR){fs.mkdirSync(process.env.UI_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.UI_SCREENSHOT_DIR+'/body-human.png',fullPage:true});}
    await page.locator('#stop').click();await page.waitForFunction(()=>!document.querySelector('#start').disabled);
    assert.equal(await page.locator('#video').getAttribute('src'),null);assert.equal(await page.locator('#bodyCount').textContent(),'0');assert.deepEqual(errors,[]);
    // Cancelar durante la carga también debe soltar el worker y dejar el botón listo.
    await page.locator('#start').click();await page.locator('#stop').click();await page.waitForFunction(()=>!document.querySelector('#start').disabled);
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'El diseño desborda en móvil.');
    console.log('BODY OK — Human real, transporte simulado:',JSON.stringify(diagnostics));
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
};
run().catch(error=>{console.error(error);process.exitCode=1;});
