'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {loadConfig} = require('./config.cjs');
const {buildReport} = require('./report.cjs');
const {createMailer,mailError} = require('./mailer.cjs');
const json = (res,status,body) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
const readJson = async req => {
  let size=0;const chunks=[];
  for await (const chunk of req) {size+=chunk.length;if(size>8500000) throw new Error('El reporte supera el limite de tamaño.');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
const createServer = (config,mailer=createMailer(config.smtp)) => {
  const token=randomUUID(), jobs=new Map();let sending=false,streamActive=false;
  const proxy = (req,res,stream=false) => {
    if(stream && streamActive) return json(res,409,{error:'Ya hay un video abierto. Cierra la otra transmision.'});
    const target=new URL(stream?'/stream':req.url,config.camera);
    if(stream) {target.port=String(Number(config.camera.port||80)+1);streamActive=true;}
    const upstream=http.request(target,{method:req.method,headers:{...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{}),...(req.headers['content-length']?{'Content-Length':req.headers['content-length']}:{}),Connection:'close'}},response=>{
      res.writeHead(response.statusCode,{'Content-Type':response.headers['content-type']||'application/octet-stream','Cache-Control':'no-store'});response.pipe(res);
    });
    upstream.setTimeout(stream?20000:12000,()=>upstream.destroy(new Error('Tiempo de espera de la camara agotado.')));
    upstream.on('error',()=>{if(!res.headersSent) json(res,502,{error:'La camara no responde. Revisa CAMERA_URL, el hotspot y el cable USB.'});else res.destroy();});
    res.on('close',()=>{upstream.destroy();if(stream)streamActive=false;});req.pipe(upstream);
  };
  const assets={
    '/rostros/app.js':['rostros.js','application/javascript'], '/rostros/rostros.css':['rostros.css','text/css'],
    '/rostros/bootstrap.min.css':['vendor/bootstrap.min.css','text/css'], '/rostros/sweetalert2.min.js':['vendor/sweetalert2.min.js','application/javascript'],
    '/rostros/sweetalert2.min.css':['vendor/sweetalert2.min.css','text/css'],
  };
  const server=http.createServer(async(req,res)=>{
    try {
      // Loopback only, plus Host validation to reject DNS rebinding.
      if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'')) return json(res,403,{error:'Host no permitido.'});
      const url=new URL(req.url,'http://localhost');
      if(req.headers.origin && ![`http://${req.headers.host}`].includes(req.headers.origin)) return json(res,403,{error:'Origen no permitido.'});
      if(req.method==='GET' && (url.pathname==='/'||url.pathname==='/rostros')) {
        const html=fs.readFileSync(path.join(__dirname,'../rostros.html'),'utf8').replace('<script defer src="/rostros/app.js">','<script defer src="/runtime.js"></script>\n  <script defer src="/rostros/app.js">');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(html);
      }
      if(req.method==='GET' && url.pathname==='/runtime.js') {
        res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});
        return res.end('window.CAMERA_APP='+JSON.stringify({reports:true,token,streamUrl:'/camera-stream',cameraUrl:config.camera.origin})+';');
      }
      if(req.method==='GET' && assets[url.pathname]) {
        const [file,type]=assets[url.pathname];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache'});return fs.createReadStream(path.join(__dirname,'..',file)).pipe(res);
      }
      if(req.method==='POST' && url.pathname==='/api/report') {
        if(req.headers['x-report-token']!==token || !req.headers['content-type']?.startsWith('application/json')) return json(res,403,{error:'Recarga la pagina antes de enviar.'});
        if(!config.smtp.login||!config.smtp.key||!config.smtp.sender) return json(res,503,{error:'Completa secret.env en el servidor.'});
        const payload=await readJson(req);
        if(typeof payload.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(payload.requestId)) return json(res,400,{error:'Identificador de envio invalido.'});
        const previous=jobs.get(payload.requestId);
        if(previous) return json(res,previous.status,previous.body);
        if(sending) return json(res,409,{error:'Ya hay un reporte enviandose. Espera a que termine.'});
        let report;try {report=buildReport(payload,config.smtp.sender);}catch(error){return json(res,400,{error:error.message});}
        sending=true;jobs.set(payload.requestId,{status:409,body:{error:'Este reporte ya se esta enviando.'}});
        try {
          const result=await mailer.sendMail(report);
          const body={ok:true,message:result.rejected?.length?'Brevo acepto parte de los destinatarios. Revisa los rechazados.':'Brevo acepto el reporte para envio.',accepted:result.accepted||[],rejected:result.rejected||[]};
          jobs.set(payload.requestId,{status:200,body});return json(res,200,body);
        } catch(error) {
          const body={error:mailError(error)};jobs.set(payload.requestId,{status:502,body});return json(res,502,body);
        } finally {sending=false;if(jobs.size>100)jobs.delete(jobs.keys().next().value);}
      }
      if(req.method==='GET'&&url.pathname==='/camera-stream') return proxy(req,res,true);
      const read=['/api/rostros','/api/rostros/foto'];const write=['/api/rostros/iniciar','/api/rostros/registrar','/api/rostros/cancelar','/api/rostros/eliminar'];
      if((req.method==='GET'&&read.includes(url.pathname))||(req.method==='POST'&&write.includes(url.pathname)&&req.headers['content-type']?.startsWith('application/json'))) return proxy(req,res);
      return json(res,404,{error:'Ruta no encontrada.'});
    } catch(error) {if(!res.headersSent)json(res,400,{error:'Solicitud invalida o demasiado grande.'});else res.destroy();}
  });
  server.on('close',()=>mailer.close?.());return server;
};
if(require.main===module){const config=loadConfig();const server=createServer(config);server.listen(config.port,'127.0.0.1',()=>console.log(`Camara: ${config.camera.origin}\nPagina: http://localhost:${config.port}/rostros\nLa clave SMTP solo se usa en el servidor.`));}
module.exports={createServer};
