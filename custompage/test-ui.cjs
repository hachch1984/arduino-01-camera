// Browser-only contract tests with a simulated camera. Never touches the board.
// PLAYWRIGHT_MODULE may point to an externally installed playwright package.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1kAAAAASUVORK5CYII=', 'base64');
const run = async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:960}});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let offline = false, rejectPost = false, deletes = 0, registeredName = '';
    const state = {storage:true,pending:false,failed:false,revision:0,limit:7,message:'Listo.',lastName:'',people:[{id:0,name:'Registro anterior',photo:false}]};
    await page.route('http://camera.test*/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/stream' || url.pathname === '/api/rostros/foto') return route.fulfill({contentType:'image/png',body:image});
      if (url.pathname.startsWith('/api/rostros')) {
        if (offline) return route.abort();
        if (request.method() === 'GET') return route.fulfill({json:state});
        if (rejectPost) return route.fulfill({status:500,json:{error:'No se pudo guardar el registro.'}});
        if (url.pathname.endsWith('/registrar')) {await new Promise(resolve=>setTimeout(resolve,600));registeredName=request.postDataJSON().name; state.pending=true; state.message='Esperando un solo rostro'; state.revision++;}
        if (url.pathname.endsWith('/cancelar')) {state.pending=false; state.message='Registro cancelado'; state.revision++;}
        if (url.pathname.endsWith('/eliminar')) {deletes++;state.people=state.people.filter(p=>p.id!==request.postDataJSON().id);state.revision++;state.message='Eliminado';}
        return route.fulfill({json:{ok:true}});
      }
      const assets = {'/rostros':['rostros.html','text/html'],'/rostros/app.js':['rostros.js','application/javascript'],'/rostros/rostros.css':['rostros.css','text/css'],'/rostros/bootstrap.min.css':['vendor/bootstrap.min.css','text/css'],'/rostros/sweetalert2.min.js':['vendor/sweetalert2.min.js','application/javascript'],'/rostros/sweetalert2.min.css':['vendor/sweetalert2.min.css','text/css']};
      const asset = assets[url.pathname];
      if (!asset) return route.fulfill({status:404,body:'Not found'});
      return route.fulfill({contentType:asset[1],body:fs.readFileSync(path.join(__dirname,asset[0]))});
    });
    await page.goto('http://camera.test/rostros');
    await page.waitForFunction(()=>document.querySelector('#count').textContent==='1 / 7');
    assert.equal(await page.locator('#enroll').isDisabled(),true);
    assert.match(await page.locator('#people').innerText(),/Sin foto/);
    await page.locator('#toggle').click();
    await page.waitForFunction(()=>!document.querySelector('#enroll').disabled);
    await page.locator('#name').fill('María <img src=x onerror=alert(1)>');
    await page.locator('#enroll').click();
    assert.equal(await page.locator('#enrollProgress').isVisible(),true);
    await page.waitForFunction(()=>!document.querySelector('#cancel').hidden);
    assert.equal(registeredName,'María <img src=x onerror=alert(1)>');
    assert.equal(await page.locator('#name').inputValue(),'');
    assert.equal(await page.locator('#enrollProgress').isVisible(),true);
    assert.equal(await page.locator('#enroll').isDisabled(),true);
    await page.locator('#cancel').click();
    await page.waitForFunction(()=>document.querySelector('#cancel').hidden);
    await page.waitForFunction(()=>document.querySelector('#enrollProgress').hidden);
    // Simulate successful capture on the camera; markup must remain plain text.
    state.people.push({id:1,name:registeredName,photo:true});state.revision++;state.message='Registrado';
    await page.waitForFunction(()=>document.querySelector('#count').textContent==='2 / 7');
    assert.equal(await page.locator('#capacityProgress').getAttribute('aria-valuenow'),'2');
    assert.equal(await page.locator('#capacityBar').textContent(),'29 %');
    assert.equal(await page.locator('#people img').count(),1);
    assert.ok((await page.locator('#people').innerText()).includes(registeredName));
    await page.locator('#people button').last().click();
    await page.locator('.swal2-popup').waitFor({state:'visible'});
    assert.ok((await page.locator('.swal2-html-container').innerText()).includes(registeredName));
    assert.equal(await page.locator('.swal2-html-container img').count(),0);
    await page.locator('.swal2-cancel').click();
    await page.locator('.swal2-popup').waitFor({state:'hidden'});assert.equal(deletes,0);
    await page.locator('#people button').last().click();
    await page.locator('.swal2-confirm').click();
    await page.getByRole('heading',{name:'Registro eliminado',exact:true}).waitFor();
    await page.locator('.swal2-confirm').click();
    await page.waitForFunction(()=>document.querySelector('#count').textContent==='1 / 7'); assert.equal(deletes,1);
    const screenshotDir=process.env.UI_SCREENSHOT_DIR;
    if (screenshotDir) {fs.mkdirSync(screenshotDir,{recursive:true});await page.screenshot({path:path.join(screenshotDir,'desktop.png'),fullPage:true});}
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    if (screenshotDir) await page.screenshot({path:path.join(screenshotDir,'mobile.png'),fullPage:true});
    rejectPost=true; await page.locator('#name').fill('Otro nombre'); await page.locator('#enroll').click();
    await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('No se pudo guardar'));
    assert.equal(await page.locator('#name').isDisabled(),false);
    assert.equal(await page.locator('#enrollProgress').isVisible(),false);
    assert.equal(await page.locator('#name').inputValue(),'Otro nombre');
    rejectPost=false; state.people=Array.from({length:7},(_,id)=>({id,name:'Persona '+id,photo:false}));state.revision++;
    await page.waitForFunction(()=>document.querySelector('#count').textContent==='7 / 7');
    assert.equal(await page.locator('#enroll').isDisabled(),true);
    assert.equal(await page.locator('#capacityBar').textContent(),'100 %');
    assert.ok((await page.locator('#capacityBar').getAttribute('class')).includes('bg-danger'));
    offline=true;
    await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('Sin conexión'));
    assert.equal(await page.locator('#enroll').isDisabled(),true);
    assert.deepEqual(errors,[]);
    console.log('PASS: local assets, spinner during submission/pending, input clearing, SweetAlert cancel/delete/success, escaped names, capacity progress, errors, mobile layout. Simulated camera only.');
  } finally {await browser.close();}
};
run().catch(error=>{console.error(error);process.exitCode=1;});
