'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {setTimeout:delay}=require('node:timers/promises');
const {createServer}=require('./index.cjs');
const {createBodyCamera}=require('./body-camera.cjs');

/** Cámara HTTP controlable: comprueba protocolo y restauración sin mover el sensor ni enviar correos. */
const fixture=async()=>{
  const initial={pixformat:4,framesize:4,quality:12,face_detect:1,face_recognize:1,face_enroll:0};
  const state={...initial},commands=[];let badResolution=false,failRestore=false;
  const camera=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
    if(url.pathname==='/status')return res.end(JSON.stringify(state));
    if(url.pathname==='/control'){
      const variable=url.searchParams.get('var'),value=Number(url.searchParams.get('val'));commands.push([variable,value]);
      if(failRestore&&variable==='framesize'&&value===4){res.statusCode=500;return res.end('{}');}
      if(!(badResolution&&variable==='framesize'))state[variable]=value;
      if(variable==='face_detect'&&!value)state.face_recognize=0;
      return res.end('{}');
    }
    res.end('{}');
  });
  await new Promise(resolve=>camera.listen(0,'127.0.0.1',resolve));
  return {camera,initial,state,commands,url:new URL(`http://127.0.0.1:${camera.address().port}`),badResolution:value=>{badResolution=value;},failRestore:value=>{failRestore=value;},close:()=>new Promise(resolve=>camera.close(resolve))};
};

test('body solicita FHD real, pausa IA, bloquea otra sesión y restaura tamaño, calidad y reconocimiento',async()=>{
  const mock=await fixture(),body=createBodyCamera(mock.url);
  try{
    const session=await body.start('fhd');assert.equal(session.width,1920);assert.equal(session.height,1080);
    assert.equal(mock.state.framesize,14);assert.equal(mock.state.face_recognize,0);assert.equal(mock.state.face_detect,0);
    await assert.rejects(()=>body.start('vga'),/ocupada/);
    assert.equal(body.attach('wrong',()=>{}),false);
    let disconnected=false;assert.equal(body.attach(session.id,()=>{disconnected=true;}),true);assert.equal(body.attach(session.id,()=>{}),false);
    await body.stop(session.id);assert.equal(disconnected,true);assert.deepEqual(mock.state,mock.initial);assert.equal(body.active(),false);
  }finally{await body.close();await mock.close();}
});

test('firmware RGB565 se rechaza sin fingir Full HD; un cambio fallido se revierte',async()=>{
  const mock=await fixture(),body=createBodyCamera(mock.url);
  try{
    mock.state.pixformat=0;await assert.rejects(()=>body.start('fhd'),/Actualiza el firmware/);assert.deepEqual(mock.commands,[]);assert.equal(body.active(),false);
    mock.state.pixformat=4;mock.badResolution(true);await assert.rejects(()=>body.start('fhd'),/no aplicó/);assert.deepEqual(mock.state,mock.initial);assert.equal(body.active(),false);
    mock.state.face_enroll=1;await assert.rejects(()=>body.start('hd'),/registro de rostro/);assert.equal(body.active(),false);
  }finally{await body.close();await mock.close();}
});

test('una restauración fallida conserva la reserva y permite reintentar sin iniciar IA a resolución incorrecta',async()=>{
  const mock=await fixture(),body=createBodyCamera(mock.url);
  try{
    const session=await body.start('hd');mock.failRestore(true);const result=await body.stop(session.id);assert.equal(result.ok,false);assert.equal(body.active(),true);
    assert.equal(mock.state.face_detect,0);assert.equal(mock.state.face_recognize,0);
    mock.failRestore(false);assert.equal((await body.stop(session.id)).ok,true);assert.deepEqual(mock.state,mock.initial);
  }finally{mock.failRestore(false);await body.close();await mock.close();}
});

test('rutas body sirven solo modelos locales permitidos, exigen token y bloquean rostros durante la reserva',async()=>{
  const mock=await fixture(),server=createServer({camera:mock.url,smtp:{key:'PRIVATE-SMTP'}},{});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  let session;
  try{
    const html=await(await fetch(base+'/body')).text();assert.match(html,/1920×1080/);assert.doesNotMatch(html,/PRIVATE-SMTP/);
    assert.equal((await fetch(base+'/body/vendor/human.esm.js')).status,200);
    assert.equal((await fetch(base+'/body/models/movenet-lightning.json')).status,200);
    assert.equal((await fetch(base+'/body/models/movenet-lightning.bin')).status,200);
    for(const route of ['/body/models/faceres.bin','/body/vendor/package.json','/body/secret.env'])assert.equal((await fetch(base+route)).status,404);
    const runtime=await(await fetch(base+'/runtime.js')).text(),token=JSON.parse(runtime.slice('window.CAMERA_APP='.length,-1)).token;
    const post=(route,payload,authorized=true)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{'X-Report-Token':token}:{})},body:JSON.stringify(payload)});
    assert.equal((await post('/api/body/start',{},false)).status,403);
    session=await(await post('/api/body/start',{resolution:'fhd'})).json();assert.ok(session.id);
    assert.equal((await post('/api/rostros/iniciar',{})).status,409);assert.equal((await fetch(base+'/camera-stream')).status,409);
    assert.equal((await fetch(base+'/body/stream?session=wrong')).status,409);
    assert.equal((await post('/api/body/stop',{id:session.id})).status,200);assert.deepEqual(mock.state,mock.initial);
    // Cerrar también restaura si el navegador reservó la cámara y aún no conectó el stream.
    session=await(await post('/api/body/start',{resolution:'vga'})).json();
  }finally{
    await new Promise(resolve=>server.close(resolve));
    try{
      for(let retry=0;retry<100&&JSON.stringify(mock.state)!==JSON.stringify(mock.initial);retry++)await delay(20);
      assert.deepEqual(mock.state,mock.initial);
    }finally{await mock.close();}
  }
});
