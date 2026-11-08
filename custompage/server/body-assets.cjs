'use strict';
const fs=require('node:fs');
const path=require('node:path');
const human=path.join(__dirname,'../../node_modules/@vladmandic/human');
const files={
  '/body':['body/index.html','text/html; charset=utf-8'],
  '/body/':['body/index.html','text/html; charset=utf-8'],
  '/body/app.js':['body/app.js','application/javascript'],
  '/body/worker.js':['body/worker.js','application/javascript'],
  '/body/body.css':['body/body.css','text/css'],
};
const models=new Set(['blazeface','facemesh','iris','emotion','movenet-lightning','handtrack','handlandmark-lite','centernet','antispoof','liveness']);
/** Sirve HTML/JS/CSS propios y únicamente el bundle, licencia y modelos locales permitidos de Human. */
const serveBodyAsset=(pathname,res)=>{
  let file,type,cache='no-cache';
  if(files[pathname]){[file,type]=files[pathname];file=path.join(__dirname,'..',file);}
  else if(pathname==='/body/vendor/human.esm.js'){file=path.join(human,'dist/human.esm.js');type='application/javascript';}
  else if(pathname==='/body/vendor/LICENSE'){file=path.join(human,'LICENSE');type='text/plain';}
  else{
    const match=/^\/body\/models\/([a-z-]+)\.(json|bin)$/.exec(pathname);
    if(!match||!models.has(match[1]))return false;
    file=path.join(human,'models',`${match[1]}.${match[2]}`);type=match[2]==='json'?'application/json':'application/octet-stream';cache='private, max-age=86400';
  }
  if(!fs.existsSync(file)){res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});res.end('Faltan archivos locales de Human. Ejecuta npm ci en la carpeta del proyecto.');return true;}
  res.writeHead(200,{'Content-Type':type,'Cache-Control':cache,'X-Content-Type-Options':'nosniff'});
  const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);return true;
};
module.exports={serveBodyAsset};
