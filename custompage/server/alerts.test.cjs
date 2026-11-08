'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const nodemailer=require('nodemailer');
const {createAlerts}=require('./alerts.cjs');
const {createServer}=require('./index.cjs');
const jpeg=Buffer.from([255,216,1,2,255,217]);
const observation=(ticket,name='Persona <ejemplo>',ageMs=1200)=>({noticeSupported:true,
  noticeCapture:{ticket,name,ageMs,image:jpeg.toString('base64')},
  // El estado actual puede cambiar: el aviso conserva el resultado del cuadro capturado.
  faceVisible:false,lastId:-1,people:[]});

test('foto exacta del cuadro clasificado, sin duplicados ni capturas viejas, espera desde fin de envio',async()=>{
  let time=10000,release;const messages=[];
  const alerts=createAlerts({sender:'sender@example.com',now:()=>time,mailer:{sendMail:message=>{messages.push(message);return new Promise(resolve=>{release=resolve;});}}});
  alerts.configure({enabled:true,recipients:'one@example.com, two@example.com'});
  const ticket=alerts.captureTicket();assert.ok(ticket);assert.equal(alerts.captureTicket(),ticket);
  await alerts.observe({noticeSupported:true});
  await alerts.observe(observation(ticket+1));await alerts.observe(observation(ticket,'Antigua',6000));assert.equal(messages.length,0);
  const first=alerts.observe(observation(ticket));await alerts.observe(observation(ticket));assert.equal(messages.length,1);
  assert.equal(alerts.captureTicket(),0);assert.equal(messages[0].to.length,2);assert.match(messages[0].html,/Persona &lt;ejemplo&gt;/);
  assert.deepEqual(messages[0].attachments[0].content,jpeg);
  assert.deepEqual(alerts.photo(String(alerts.state().capture.id)),messages[0].attachments[0].content);
  assert.equal(alerts.state().capture.at,'1970-01-01T00:00:08.800Z');assert.equal(alerts.state().capture.status,'sending');
  time+=3000;release({accepted:['one@example.com'],rejected:[]});await first;
  assert.equal(alerts.state().capture.status,'accepted');assert.equal(alerts.state().remainingMs,5000);
  time+=4999;assert.equal(alerts.captureTicket(),0);await alerts.observe(observation(ticket));assert.equal(messages.length,1);
  time++;const next=alerts.captureTicket();assert.notEqual(next,ticket);
  await alerts.observe(observation(ticket));assert.equal(messages.length,1);
  const second=alerts.observe(observation(next,'Intruso'));assert.equal(messages.length,2);assert.match(messages[1].text,/Intruso/);
  release({rejected:[]});await second;
});

test('desactivar invalida la captura pendiente; errores SMTP pausan sin reintentos y conservan la foto fallida',async()=>{
  let time=10000,calls=0;
  const alerts=createAlerts({sender:'sender@example.com',now:()=>time,mailer:{sendMail:async()=>{calls++;if(calls===2)throw new Error('fallo');return {rejected:[]};}}});
  assert.throws(()=>alerts.configure({enabled:true,recipients:'bad'}));
  alerts.configure({enabled:true,recipients:'a@example.com'});await alerts.observe(observation(alerts.captureTicket()));
  alerts.configure({enabled:false,recipients:'a@example.com'});time+=5000;assert.equal(alerts.captureTicket(),0);
  alerts.configure({enabled:true,recipients:'b@example.com'});const pending=alerts.captureTicket();
  alerts.configure({enabled:false,recipients:'b@example.com'});await alerts.observe(observation(pending));assert.equal(calls,1);
  alerts.configure({enabled:true,recipients:'b@example.com'});await alerts.observe(observation(alerts.captureTicket()));
  assert.equal(alerts.state().enabled,false);assert.equal(alerts.state().capture.status,'failed');assert.match(alerts.state().lastError,/desactivados/);
  time+=10000;await alerts.observe(observation(pending));assert.equal(calls,2);
});

test('sin firmware compatible o sin JPEG valido no se envian avisos de texto sin captura',async()=>{
  let calls=0;
  const alerts=createAlerts({sender:'sender@example.com',mailer:{sendMail:async()=>{calls++;return {};}}});
  alerts.configure({enabled:true,recipients:'a@example.com'});alerts.captureTicket();await alerts.observe({faceVisible:true});
  assert.equal(alerts.state().enabled,false);assert.match(alerts.state().lastError,/firmware/);
  alerts.configure({enabled:true,recipients:'a@example.com'});
  const data=observation(alerts.captureTicket());data.noticeCapture.image=Buffer.from('no jpeg').toString('base64');await alerts.observe(data);
  assert.equal(calls,0);assert.equal(alerts.state().enabled,false);assert.equal(alerts.state().capture,null);
});

test('renueva tickets tras una pausa de red y rechaza la respuesta anterior',async()=>{
  let time=10000,calls=0;
  const alerts=createAlerts({sender:'sender@example.com',now:()=>time,mailer:{sendMail:async()=>{calls++;return {};}}});
  alerts.configure({enabled:true,recipients:'a@example.com'});const old=alerts.captureTicket();
  time+=6000;const fresh=alerts.captureTicket();assert.notEqual(old,fresh);
  await alerts.observe(observation(old));assert.equal(calls,0);
  await alerts.observe(observation(fresh));assert.equal(calls,1);
});

test('correo MIME adjunta la misma captura que se muestra, con CID y hora de Peru',async()=>{
  let message;
  const alerts=createAlerts({sender:'sender@example.com',now:()=>Date.parse('2026-11-07T18:30:00Z'),mailer:{sendMail:async value=>{message=value;return {};}}});
  alerts.configure({enabled:true,recipients:'a@example.com'});await alerts.observe(observation(alerts.captureTicket(),'Intruso',1000));
  assert.match(message.subject,/07\/11\/2026,? 01:30:00\s*p\.\s*m\./);assert.match(message.text,/01:29:59/);
  const transport=nodemailer.createTransport({streamTransport:true,buffer:true});
  const result=await transport.sendMail(message);const mime=result.message.toString();
  assert.match(mime,/Content-Disposition: attachment; filename=captura-aviso.jpg/);
  assert.match(mime,/Content-ID:/);assert.ok(mime.includes(jpeg.toString('base64')));
  assert.deepEqual(alerts.photo(String(alerts.state().capture.id)),message.attachments[0].content);
});

test('proxy arma captura solo con video y avisos activos, no depende de eventos; vista previa local no consulta ESP32',async()=>{
  let count=0,requests=0,lastTicket=0;const queries=[];const messages=[];
  const camera=http.createServer((req,res)=>{
    requests++;const url=new URL(req.url,'http://camera');queries.push(url.searchParams);
    const ticket=Number(url.searchParams.get('notify'));
    const data=ticket&&ticket===lastTicket?observation(ticket):{noticeSupported:true};lastTicket=ticket;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
  });
  await new Promise(resolve=>camera.listen(0,'127.0.0.1',resolve));
  const config={camera:new URL(`http://127.0.0.1:${camera.address().port}`),smtp:{sender:'sender@example.com',login:'login',key:'key'}};
  const server=createServer(config,{sendMail:async message=>{count++;messages.push(message);return {rejected:[]};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const runtime=await(await fetch(base+'/runtime.js')).text();const token=JSON.parse(runtime.slice('window.CAMERA_APP='.length,-1)).token;
    assert.equal((await fetch(base+'/api/avisos',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    const save=body=>fetch(base+'/api/avisos',{method:'POST',headers:{'Content-Type':'application/json','X-Report-Token':token},body:JSON.stringify(body)});
    await save({enabled:true,recipients:'a@example.com, b@example.com'});
    await(await fetch(base+'/api/rostros?watch=0&notify=123')).json();assert.equal(count,0);assert.equal(queries.at(-1).has('notify'),false);
    await(await fetch(base+'/api/rostros?watch=1')).json();assert.equal(count,0);
    await(await fetch(base+'/api/rostros?watch=1')).json();assert.equal(count,1);assert.equal(queries.at(-1).has('record'),false);
    await(await fetch(base+'/api/rostros?watch=1')).json();assert.equal(count,1);assert.equal(queries.at(-1).has('notify'),false);
    const status=await(await fetch(base+'/api/avisos')).json();assert.ok(status.remainingMs>0&&status.remainingMs<=5000);assert.equal(status.capture.image,undefined);
    const before=requests;const response=await fetch(base+`/api/avisos/foto?id=${status.capture.id}`);
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),messages[0].attachments[0].content);assert.equal(requests,before);
    assert.equal((await fetch(base+'/api/avisos/foto?id=missing')).status,404);
    await save({enabled:false,recipients:'a@example.com'});assert.equal((await(await fetch(base+'/api/avisos')).json()).enabled,false);
  }finally{await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>camera.close(resolve));}
});
