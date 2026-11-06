'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const nodemailer=require('nodemailer');
const {recipients,buildReport}=require('./report.cjs');
const {createServer}=require('./index.cjs');
const http=require('node:http');
const jpeg=Buffer.from([255,216,255,217]).toString('base64');
const sample=()=>({requestId:'test-request-00000001',recipients:'one@example.com, two@example.com',events:[{name:'Henry <script>alert(1)</script>',at:'2026-11-06T15:00:00.000Z',image:jpeg},{name:'Intruso',at:'2026-11-06T15:01:00.000Z',image:jpeg}]});
test('recipients: commas, duplicate addresses and injection rejection',()=>{
  assert.deepEqual(recipients('a@example.com, a@example.com\nb@example.com'),['a@example.com','b@example.com']);
  assert.throws(()=>recipients('bad@example.com\rBcc:other@example.com'));
  assert.throws(()=>recipients('not-an-email'));
});
test('Peru subject, two-column HTML, escaped names and inline MIME photos',async()=>{
  const report=buildReport(sample(),'sender@example.com',new Date('2026-11-06T16:00:00Z'));
  assert.match(report.subject,/Registro de eventos camara android <06\/11\/2026,? 11:00:00\s*a\.\s*m\.>/);
  assert.doesNotMatch(report.html,/Fecha y hora de Perú|\(Perú\)/);
  assert.match(buildReport(sample(),'sender@example.com',new Date('2026-11-06T18:00:00Z')).subject,/01:00:00\s*p\.\s*m\./);
  assert.match(report.html,/10:00:00/);assert.match(report.html,/Intruso/);assert.match(report.html,/&lt;script&gt;/);assert.doesNotMatch(report.html,/<script>/);
  assert.equal((report.html.match(/<td /g)||[]).length,4);assert.equal(report.attachments.length,2);
  const transport=nodemailer.createTransport({streamTransport:true,buffer:true});const result=await transport.sendMail(report);
  const mime=result.message.toString();assert.match(mime,/multipart\/related/);assert.match(mime,/Content-ID:/);assert.match(mime,/Content-Disposition: inline/);
});
test('reject empty events, invalid dates and non-JPEG images',()=>{
  assert.throws(()=>buildReport({...sample(),events:[]},'x@example.com'));
  const body=sample();body.events[0].at='bad';assert.throws(()=>buildReport(body,'x@example.com'));
  body.events[0].at='2026-11-06';body.events[0].image=Buffer.from('script').toString('base64');assert.throws(()=>buildReport(body,'x@example.com'));
});
test('local service protects secrets, proxies camera and deduplicates report requests',async()=>{
  let calls=0;const camera=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:req.url}));});
  await new Promise(resolve=>camera.listen(0,'127.0.0.1',resolve));
  const config={camera:new URL(`http://127.0.0.1:${camera.address().port}`),smtp:{login:'login',key:'DO-NOT-EXPOSE',sender:'sender@example.com'}};
  const server=createServer(config,{sendMail:async()=>{calls++;return {accepted:['one@example.com','two@example.com'],rejected:[]};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const html=await(await fetch(base+'/rostros')).text();assert.match(html,/runtime.js/);assert.doesNotMatch(html,/DO-NOT-EXPOSE/);
    assert.equal((await fetch(base+'/secret.env')).status,404);
    assert.equal((await fetch(base+'/runtime.js',{headers:{Origin:'https://foreign.example'}})).status,403);
    const runtime=await(await fetch(base+'/runtime.js')).text();assert.doesNotMatch(runtime,/DO-NOT-EXPOSE/);const token=JSON.parse(runtime.slice('window.CAMERA_APP='.length,-1)).token;
    assert.equal((await(await fetch(base+'/api/rostros?record=1&after=3')).json()).path,'/api/rostros?record=1&after=3');
    const options={method:'POST',headers:{'Content-Type':'application/json','X-Report-Token':token},body:JSON.stringify(sample())};
    assert.equal((await fetch(base+'/api/report',{...options,headers:{'Content-Type':'application/json'}})).status,403);
    assert.equal((await fetch(base+'/api/report',options)).status,200);assert.equal((await fetch(base+'/api/report',options)).status,200);assert.equal(calls,1);
  } finally {await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>camera.close(resolve));}
});
