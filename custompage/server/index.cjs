'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {loadConfig} = require('./config.cjs');
const {buildReport} = require('./report.cjs');
const {createMailer,mailError} = require('./mailer.cjs');
const {createAlerts} = require('./alerts.cjs');
const {createBodyCamera} = require('./body-camera.cjs');
const {serveBodyAsset} = require('./body-assets.cjs');
/** Responde JSON UTF-8 con el código HTTP indicado y sin caché. Es la salida común para resultados y errores del servidor local. */
const json = (res,status,body) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
/** Consume el cuerpo HTTP por fragmentos y lo convierte a JSON. Rechaza cargas mayores de 8.500.000 bytes antes de construir el reporte completo. */
const readJson = async req => {
  let size=0;const chunks=[];
  for await (const chunk of req) {size+=chunk.length;if(size>8500000) throw new Error('El reporte supera el limite de tamaño.');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
/**
 * Construye el servidor HTTP con configuración privada y un transporte SMTP inyectable para pruebas.
 * Mantiene en memoria el token del navegador, los IDs de envío y los bloqueos de stream/envío. No llama
 * listen: el arranque se realiza al final del módulo.
 */
const createServer = (config,mailer=createMailer(config.smtp)) => {
  const token=randomUUID(), jobs=new Map();let sending=false,streamActive=false;
  const alerts=createAlerts({mailer,sender:config.smtp.sender,isMailBusy:()=>sending});
  const bodyCamera=createBodyCamera(config.camera);
  /**
   * Reenvía solicitudes HTTP al ESP32 configurado en CAMERA_URL. Para video usa /stream en el puerto
   * siguiente (normalmente 81), permite una transmisión local y conecta streams con pipe para transmitir sin
   * almacenar el video completo.
   */
  const proxy = (req,res,stream=false,bodySession='') => {
    if(stream && !bodySession && (streamActive||bodyCamera.active())) return json(res,409,{error:'Ya hay un video abierto. Cierra la otra transmision.'});
    if(bodySession&&!bodyCamera.attach(bodySession,()=>res.destroy()))return json(res,409,{error:'La sesión de /body venció o ya tiene un video abierto.'});
    const target=new URL(stream?'/stream':req.url,config.camera);
    // Node.js controla el ticket; el navegador no puede pedir capturas durante la espera SMTP.
    if(!stream&&target.pathname==='/api/rostros'){
      target.searchParams.delete('notify');
      const ticket=!bodyCamera.active()&&target.searchParams.get('watch')==='1'?alerts.captureTicket():0;
      if(ticket)target.searchParams.set('notify',String(ticket));
    }
    if(stream) {
      target.port=String(Number(config.camera.port||80)+1);if(!bodySession)streamActive=true;
      // Conserva solo el modo PIR solicitado; el ESP32 aplica el corte por inactividad en cada frame.
      if(new URL(req.url,'http://localhost').searchParams.get('pir')==='1')target.searchParams.set('pir','1');
    }
    /** Al llegar la respuesta del ESP32, conserva el estado HTTP y el tipo de contenido y pasa sus bytes directamente al navegador. */
    const upstream=http.request(target,{method:req.method,headers:{...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{}),...(req.headers['content-length']?{'Content-Length':req.headers['content-length']}:{}),Connection:'close'}},response=>{
      // Solo observa JSON de estado solicitado mientras el video está activo.
      // El correo se envía en segundo plano y no retiene la respuesta a la web.
      if(!stream&&!bodyCamera.active()&&req.method==='GET'&&target.pathname==='/api/rostros'&&target.searchParams.get('watch')==='1'&&response.statusCode===200){
        let size=0;const chunks=[];
        response.on('data',chunk=>{size+=chunk.length;if(size<=1000000)chunks.push(chunk);});
        response.on('end',()=>{if(size<=1000000){try{void alerts.observe(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{ /* Una respuesta no JSON no dispara avisos. */ }}});
      }
      res.writeHead(response.statusCode,{'Content-Type':response.headers['content-type']||'application/octet-stream','Cache-Control':'no-store'});response.pipe(res);
    });
    upstream.setTimeout(stream?20000:12000,()=>upstream.destroy(new Error('Tiempo de espera de la camara agotado.')));
    /** Un fallo de conexión produce 502 si aún no hay cabeceras; si el stream ya empezó se cierra la respuesta para que la página detecte la interrupción. */
    upstream.on('error',()=>{if(!res.headersSent) json(res,502,{error:'La camara no responde. Revisa CAMERA_URL, el hotspot y el cable USB.'});else res.destroy();});
    /**
     * Al desconectarse el navegador destruye la conexión ascendente y libera el cupo de video. req.pipe
     * transmite también el cuerpo de los POST hacia la cámara.
     */
    res.on('close',()=>{upstream.destroy();if(stream&&!bodySession)streamActive=false;});
    // El sensor se restaura después de cerrar el socket ascendente, conservando el bloqueo entre tanto.
    if(bodySession)upstream.on('close',()=>{void bodyCamera.release(bodySession);});
    req.pipe(upstream);
  };
  const assets={
    '/rostros/app.js':['rostros.js','application/javascript'], '/rostros/avisos.js':['avisos.js','application/javascript'], '/rostros/tabs.js':['tabs.js','application/javascript'], '/rostros/rostros.css':['rostros.css','text/css'],
    '/rostros/bootstrap.min.css':['vendor/bootstrap.min.css','text/css'], '/rostros/sweetalert2.min.js':['vendor/sweetalert2.min.js','application/javascript'],
    '/rostros/sweetalert2.min.css':['vendor/sweetalert2.min.css','text/css'],
  };
  /**
   * Despacha cada solicitud por método y pathname. Verifica Host/Origin, sirve recursos públicos, procesa
   * reportes en la PC y limita el proxy a rutas explícitas de la API del ESP32.
   */
  const server=http.createServer(async(req,res)=>{
    try {
      // Loopback only, plus Host validation to reject DNS rebinding.
      if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'')) return json(res,403,{error:'Host no permitido.'});
      const url=new URL(req.url,'http://localhost');
      if(req.headers.origin && ![`http://${req.headers.host}`].includes(req.headers.origin)) return json(res,403,{error:'Origen no permitido.'});
      if(req.method==='GET'&&serveBodyAsset(url.pathname,res))return;
      /** Sirve la página e inserta /runtime.js antes de app.js para que el navegador conozca el proxy y el envío de reportes. */
      if(req.method==='GET' && (url.pathname==='/'||url.pathname==='/rostros')) {
        const html=fs.readFileSync(path.join(__dirname,'../rostros.html'),'utf8')
          .replace('<script defer src="/rostros/app.js">','<script defer src="/runtime.js"></script>\n  <script defer src="/rostros/app.js">')
          .replace('</header>','<a class="btn btn-outline-info" href="/body">Análisis corporal (PC)</a></header>');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(html);
      }
      /**
       * Entrega solo configuración pública: URL de cámara, ruta de stream y token de sesión. Las credenciales
       * SMTP permanecen en config.smtp dentro de Node.js.
       */
      if(req.method==='GET' && url.pathname==='/runtime.js') {
        res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});
        return res.end('window.CAMERA_APP='+JSON.stringify({reports:true,alerts:true,token,streamUrl:'/camera-stream',cameraUrl:config.camera.origin})+';');
      }
      /** Reserva Full HD para Human en la PC. Los POST requieren el mismo token de sesión que los reportes. */
      if(req.method==='GET'&&url.pathname==='/api/body')return json(res,200,bodyCamera.state());
      if(req.method==='POST'&&['/api/body/start','/api/body/stop'].includes(url.pathname)){
        if(req.headers['x-report-token']!==token||!req.headers['content-type']?.startsWith('application/json'))return json(res,403,{error:'Recarga la página antes de controlar /body.'});
        const payload=await readJson(req);
        if(url.pathname.endsWith('/stop')){
          const result=await bodyCamera.stop(payload.id);return json(res,result.ok?200:409,result);
        }
        if(streamActive||bodyCamera.active())return json(res,409,{error:'Cierra el video de la otra página antes de iniciar /body.'});
        try{return json(res,200,await bodyCamera.start(payload.resolution||'fhd'));}
        catch(error){return json(res,503,{error:error.message,...(error.session?{session:error.session}:{})});}
      }
      if(req.method==='GET'&&url.pathname==='/body/stream'){
        const session=url.searchParams.get('session');
        if(!session)return json(res,403,{error:'Falta la sesión de video.'});
        return proxy(req,res,true,session);
      }
      /** Sirve únicamente los archivos de la lista assets. No expone libremente la carpeta del proyecto ni secret.env. */
      if(req.method==='GET' && assets[url.pathname]) {
        const [file,type]=assets[url.pathname];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache'});return fs.createReadStream(path.join(__dirname,'..',file)).pipe(res);
      }
      /** Configuración automática de avisos y contador compartido para todas las pestañas. */
      if(url.pathname==='/api/avisos'&&req.method==='GET')return json(res,200,alerts.state());
      /** Sirve la copia del JPEG adjunto: consultar la vista previa no captura otro cuadro ni consume CPU del ESP32. */
      if(url.pathname==='/api/avisos/foto'&&req.method==='GET'){
        const image=alerts.photo(url.searchParams.get('id'));
        if(!image)return json(res,404,{error:'Captura de aviso no disponible.'});
        res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store','Content-Length':image.length});return res.end(image);
      }
      if(url.pathname==='/api/avisos'&&req.method==='POST'){
        if(req.headers['x-report-token']!==token||!req.headers['content-type']?.startsWith('application/json'))return json(res,403,{error:'Recarga la pagina antes de configurar avisos.'});
        const payload=await readJson(req);
        if(payload.enabled&&(!config.smtp.login||!config.smtp.key||!config.smtp.sender))return json(res,503,{error:'Completa secret.env en el servidor.'});
        try{return json(res,200,alerts.configure(payload));}catch(error){return json(res,400,{error:error.message});}
      }
      /**
       * Recibe la copia de eventos del navegador, valida token y JSON, comprueba requestId y evita duplicar el
       * mismo envío. buildReport valida datos y crea MIME; sendMail contacta Brevo y devuelve destinatarios
       * aceptados/rechazados.
       */
      if(req.method==='POST' && url.pathname==='/api/report') {
        if(req.headers['x-report-token']!==token || !req.headers['content-type']?.startsWith('application/json')) return json(res,403,{error:'Recarga la pagina antes de enviar.'});
        if(!config.smtp.login||!config.smtp.key||!config.smtp.sender) return json(res,503,{error:'Completa secret.env en el servidor.'});
        const payload=await readJson(req);
        if(typeof payload.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(payload.requestId)) return json(res,400,{error:'Identificador de envio invalido.'});
        const previous=jobs.get(payload.requestId);
        if(previous) return json(res,previous.status,previous.body);
        if(sending||alerts.state().sending) return json(res,409,{error:'Ya hay un correo enviandose. Espera a que termine.'});
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
      /** Expone al navegador una ruta de video del mismo origen; el proxy conecta con el puerto de stream de la cámara. */
      if(req.method==='GET'&&url.pathname==='/camera-stream') return proxy(req,res,true);
      const read=['/api/rostros','/api/rostros/foto'];const write=['/api/rostros/iniciar','/api/rostros/registrar','/api/rostros/cancelar','/api/rostros/eliminar'];
      if(bodyCamera.active()&&req.method==='POST'&&write.includes(url.pathname))return json(res,409,{error:'Detén /body antes de modificar el reconocedor de la cámara.'});
      if((req.method==='GET'&&read.includes(url.pathname))||(req.method==='POST'&&write.includes(url.pathname)&&req.headers['content-type']?.startsWith('application/json'))) return proxy(req,res);
      return json(res,404,{error:'Ruta no encontrada.'});
    } catch(error) {if(!res.headersSent)json(res,400,{error:'Solicitud invalida o demasiado grande.'});else res.destroy();}
  });
  server.on('close',()=>{mailer.close?.();void bodyCamera.close();});return server;
};
if(require.main===module){
  const config=loadConfig();const server=createServer(config);let stopping=false;
  /**
   * Gestiona Ctrl+C/SIGTERM: deja de aceptar solicitudes y cierra conexiones HTTP activas. El evento close
   * cierra el transporte SMTP; hay un límite de 5 segundos para finalizar operaciones pendientes.
   */
  const stop=()=>{
    if(stopping)return;stopping=true;
    console.log('\nDeteniendo servidor y cerrando conexiones...');
    const timeout=setTimeout(()=>{console.error('Finalizando operaciones pendientes.');process.exit(1);},5000);
    timeout.unref();
    server.close(()=>{clearTimeout(timeout);console.log('SERVIDOR DETENIDO. Puerto y conexiones liberados.');});
    server.closeAllConnections();
  };
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  /** Muestra un diagnóstico legible si el puerto está ocupado u ocurre otro error al iniciar, dejando la consola disponible para revisión. */
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'El puerto ya esta ocupado. Revisa si el servidor esta abierto en otra consola.':error.message);process.exitCode=1;});
  /** Abre el puerto solo en loopback (127.0.0.1). El callback se ejecuta cuando el servidor ya escucha y muestra la URL, el PID y cómo detenerlo. */
  server.listen(config.port,'127.0.0.1',()=>console.log(`SERVIDOR INICIADO (PID ${process.pid})\nCamara: ${config.camera.origin}\nRostros: http://localhost:${config.port}/rostros\nHuman (PC): http://localhost:${config.port}/body\nMantiene esta consola abierta. Ctrl+C detiene el servidor.\nLa clave SMTP solo se usa en el servidor.`));
}
module.exports={createServer};
