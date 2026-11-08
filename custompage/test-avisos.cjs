'use strict';
// Prueba de navegador con API simulada; no conecta con SMTP ni con la placa.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const run=async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{window.CAMERA_APP={reports:true,alerts:true,token:'test',cameraUrl:'http://camera.test'};});
    let settings={enabled:false,recipients:'',sending:false,lastError:'',capture:null},until=0,posts=0,photoRequests=0;
    const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1kAAAAASUVORK5CYII=','base64');
    const state={storage:true,pending:false,failed:false,revision:0,limit:7,message:'Listo.',faceVisible:false,lastId:-1,eventSequence:0,people:[]};
    await page.route('http://camera.test/**',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/api/avisos/foto'){photoRequests++;return route.fulfill({contentType:'image/png',body:image});}
      if(url.pathname==='/api/avisos'){
        if(route.request().method()==='POST'){posts++;const body=route.request().postDataJSON();settings={...settings,...body};}
        return route.fulfill({json:{...settings,remainingMs:Math.max(0,until-Date.now())}});
      }
      if(url.pathname==='/api/rostros')return route.fulfill({json:state});
      const map={'/rostros':'rostros.html','/rostros/app.js':'rostros.js','/rostros/avisos.js':'avisos.js','/rostros/rostros.css':'rostros.css','/rostros/bootstrap.min.css':'vendor/bootstrap.min.css','/rostros/sweetalert2.min.js':'vendor/sweetalert2.min.js','/rostros/sweetalert2.min.css':'vendor/sweetalert2.min.css'};
      map['/rostros/tabs.js']='tabs.js';
      const file=map[url.pathname];if(!file)return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(path.join(__dirname,file))});
    });
    await page.goto('http://camera.test/rostros');await page.waitForFunction(()=>document.querySelector('#count').textContent==='0 / 7');
    // Flechas/Inicio/Fin cambian un único panel accesible y dejan cámara/reconocimiento visibles.
    await page.locator('#padronTab').focus();await page.keyboard.press('End');
    assert.equal(await page.locator('#noticeTab').getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#padronSection').isHidden(),true);
    await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#padronTab').getAttribute('aria-selected'),'true');
    await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#noticeSection').isVisible(),true);
    assert.equal(await page.locator('#noticeSection button').count(),0);
    await page.locator('#noticeEmails').fill('one@example.com, two@example.com');
    await page.waitForFunction(()=>document.querySelector('#noticeEmails').value.includes('two@'));await page.waitForTimeout(650);
    await page.locator('#noticeEnabled').check();
    await page.waitForTimeout(300);assert.equal(settings.enabled,true);assert.equal(settings.recipients,'one@example.com, two@example.com');assert.ok(posts>=1);
    settings.sending=true;settings.capture={id:101,name:'Persona <ejemplo>',at:'2026-11-07T18:30:00Z',status:'sending'};
    await page.waitForFunction(()=>document.querySelector('#noticeCounter').textContent==='Enviando aviso…');
    await page.waitForFunction(()=>document.querySelector('#noticePhoto').naturalWidth===1);
    assert.equal(await page.locator('#noticeCaptureName').textContent(),'Persona <ejemplo>');
    assert.equal(await page.locator('#noticeCaptureName img').count(),0);
    assert.match(await page.locator('#noticeCaptureTime').textContent(),/07\/11\/2026,? 01:30:00\s*p\.\s*m\./);
    assert.equal(await page.locator('#noticePhoto').getAttribute('src'),'/api/avisos/foto?id=101');
    await page.getByRole('tab',{name:'Eventos',exact:true}).click();
    assert.equal(settings.enabled,true);await page.getByRole('tab',{name:'Aviso',exact:true}).click();
    assert.equal(await page.locator('#noticeEmails').inputValue(),'one@example.com, two@example.com');
    settings.sending=false;settings.capture.status='accepted';until=Date.now()+5000;
    await page.waitForFunction(()=>/disponible en [1-5] s/.test(document.querySelector('#noticeCounter').textContent));
    await page.waitForFunction(()=>document.querySelector('#noticeCaptureStatus').textContent.includes('Brevo aceptó'));
    assert.equal(photoRequests,1);
    await page.locator('#noticeEnabled').uncheck();await page.waitForTimeout(300);assert.equal(settings.enabled,false);assert.equal(await page.locator('#noticeCounter').isHidden(),true);
    await page.locator('#noticeEmails').fill('incorrecto');await page.locator('#noticeEnabled').click();
    await page.waitForFunction(()=>!document.querySelector('#noticeEnabled').checked);assert.equal(await page.locator('#noticeError').isVisible(),true);
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    if(process.env.UI_SCREENSHOT_DIR){fs.mkdirSync(process.env.UI_SCREENSHOT_DIR,{recursive:true});await page.locator('#noticeSection').screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'avisos-mobile.png')});await page.setViewportSize({width:1280,height:1000});await page.locator('#noticeSection').screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'avisos-desktop.png')});}
    console.log('PASS: tabs con teclado y estado conservado, avisos sin botones, destinatarios, captura/fecha/estado, foto consultada una sola vez, envio/contador, desactivar, validacion y movil. API simulada.');
  }finally{await browser.close();}
};
run().catch(error=>{console.error(error);process.exitCode=1;});
