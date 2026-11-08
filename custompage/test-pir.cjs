'use strict';
// Contrato navegador/firmware simulado: no mueve pines ni envía correos.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1kAAAAASUVORK5CYII=','base64');
const run=async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{window.CAMERA_APP={reports:true,alerts:false,token:'test',cameraUrl:'http://camera.test',streamUrl:'/camera-stream'};});
    let starts=0,cancels=0,failStart=false,offline=false;const streams=[];
    const state={storage:true,pending:false,failed:false,revision:0,limit:7,message:'Listo.',faceVisible:false,lastId:-1,eventSequence:0,people:[],
      pir:{gpio:21,ready:false,active:false,cameraAllowed:false,warmupMs:60000,remainingMs:0,sequence:0,boot:1}};
    await page.route('http://camera.test/**',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/camera-stream'){streams.push(url.search);return route.fulfill({contentType:'image/png',body:image});}
      if(url.pathname==='/api/rostros')return offline?route.abort():route.fulfill({json:state});
      if(url.pathname==='/api/rostros/iniciar'){
        starts++;if(failStart)return route.fulfill({status:503,json:{error:'Camara ocupada.'}});
        return route.fulfill({json:{ok:true}});
      }
      if(url.pathname==='/api/rostros/cancelar'){cancels++;state.pending=false;return route.fulfill({json:{ok:true}});}
      const assets={'/rostros':'rostros.html','/rostros/app.js':'rostros.js','/rostros/tabs.js':'tabs.js','/rostros/avisos.js':'avisos.js','/rostros/rostros.css':'rostros.css',
        '/rostros/bootstrap.min.css':'vendor/bootstrap.min.css','/rostros/sweetalert2.min.js':'vendor/sweetalert2.min.js','/rostros/sweetalert2.min.css':'vendor/sweetalert2.min.css'};
      const file=assets[url.pathname];if(!file)return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(path.join(__dirname,file))});
    });
    await page.goto('http://camera.test/rostros');await page.waitForFunction(()=>!document.querySelector('#usePir').disabled);
    assert.equal(await page.locator('#usePir').isChecked(),false);
    await page.locator('#usePir').check();assert.equal(await page.locator('#toggle').isDisabled(),true);
    await page.waitForTimeout(2000);assert.equal(starts,0);assert.match(await page.locator('#pirStatus').textContent(),/estabilizando/);
    state.pir.ready=true;state.pir.warmupMs=0;
    await page.waitForFunction(()=>document.querySelector('#pirStatus').textContent.includes('esperando movimiento'));assert.equal(starts,0);
    state.pir.active=true;state.pir.cameraAllowed=true;state.pir.remainingMs=60000;state.pir.sequence++;
    await page.waitForFunction(()=>!document.querySelector('#video').hidden);assert.equal(starts,1);assert.equal(streams[0],'?pir=1');
    await page.waitForTimeout(2000);assert.equal(starts,1); // HIGH sostenido no abre streams repetidos.
    // Simula 15 s sin señal: debe seguir activo y mostrar 45 s restantes.
    state.pir.active=false;state.pir.remainingMs=45000;
    await page.waitForFunction(()=>document.querySelector('#pirStatus').textContent.includes('45 s'));
    assert.equal(await page.locator('#video').isVisible(),true);
    state.pending=true;state.pir.cameraAllowed=false;state.pir.remainingMs=0;
    await page.waitForFunction(()=>document.querySelector('#video').hidden);await page.waitForFunction(()=>document.querySelector('#cancel').hidden);
    assert.equal(cancels,1);assert.equal(await page.locator('#video').getAttribute('src'),null);
    state.pir.active=true;state.pir.cameraAllowed=true;state.pir.remainingMs=60000;state.pir.sequence++;
    await page.waitForFunction(()=>!document.querySelector('#video').hidden);assert.equal(starts,2);
    // Volver a manual cierra el stream PIR y permite iniciar sin movimiento.
    await page.locator('#usePir').uncheck();assert.equal(await page.locator('#video').isHidden(),true);
    state.pir.active=false;state.pir.cameraAllowed=false;state.pir.remainingMs=0;
    const manualResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/camera-stream'&&!new URL(response.url()).searchParams.has('pir'));
    await page.locator('#toggle').click();await manualResponse;
    await page.waitForFunction(()=>!document.querySelector('#video').hidden);assert.equal(streams.at(-1),'');
    // Un fallo no produce un bucle de POST; puede recuperar en la siguiente ventana válida.
    await page.locator('#usePir').check();failStart=true;state.pir.cameraAllowed=true;state.pir.active=true;state.pir.remainingMs=60000;
    const before=starts;await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('Camara ocupada'));
    await page.waitForTimeout(2000);assert.equal(starts,before+1);
    failStart=false;await page.waitForFunction(()=>!document.querySelector('#video').hidden,{},{timeout:10000});
    // Desconexión: se cierra el video PIR y se recupera cuando regresa la cámara.
    offline=true;await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('Sin conexión'));
    assert.equal(await page.locator('#video').isHidden(),true);offline=false;
    await page.waitForFunction(()=>!document.querySelector('#video').hidden);
    assert.equal(await page.locator('#feedback').evaluate(el=>el.classList.contains('alert-danger')),false);
    if(process.env.UI_SCREENSHOT_DIR){fs.mkdirSync(process.env.UI_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'pir-desktop.png'),fullPage:true});}
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    console.log('PASS: checkbox PIR/manual, estabilizacion, movimiento, HIGH sostenido, ventana de inactividad, corte/cancelacion, reactivacion, fallo con espera, desconexion y movil. API simulada.');
  }finally{await browser.close();}
};
run().catch(error=>{console.error(error);process.exitCode=1;});
