'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createServer}=require('./index.cjs');

test('el proxy de video conserva pir=1 y descarta parametros ajenos; manual conserva /stream',async()=>{
  const stream=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:req.url}));});
  await new Promise(resolve=>stream.listen(0,'127.0.0.1',resolve));
  const config={camera:new URL(`http://127.0.0.1:${stream.address().port-1}`),smtp:{}};
  const server=createServer(config,{});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.deepEqual(await(await fetch(base+'/camera-stream?pir=1&extra=ignored')).json(),{path:'/stream?pir=1'});
    assert.deepEqual(await(await fetch(base+'/camera-stream')).json(),{path:'/stream'});
  }finally{await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>stream.close(resolve));}
});
