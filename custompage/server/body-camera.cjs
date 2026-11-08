'use strict';
const http=require('node:http');
const {randomUUID}=require('node:crypto');
// Valores del enum framesize_t de esp32-camera incluido en el core 2.0.17.
const resolutions={fhd:{value:14,width:1920,height:1080},hd:{value:11,width:1280,height:720},vga:{value:8,width:640,height:480}};

/** Consulta solo rutas internas elegidas por el servidor; nunca acepta una URL enviada por el navegador. */
const cameraRequest=(camera,route)=>new Promise((resolve,reject)=>{
  const req=http.get(new URL(route,camera),{headers:{Connection:'close'}},res=>{
    let size=0;const chunks=[];
    res.on('data',chunk=>{size+=chunk.length;if(size>100000)res.destroy(new Error('Respuesta de cámara demasiado grande.'));else chunks.push(chunk);});
    res.on('error',reject);
    res.on('end',()=>res.statusCode===200?resolve(Buffer.concat(chunks).toString('utf8')):reject(new Error(`La cámara respondió HTTP ${res.statusCode}.`)));
  });
  req.setTimeout(3000,()=>req.destroy(new Error('La cámara no responde. Revisa CAMERA_URL y el hotspot.')));
  req.on('error',reject);
});

/** Reserva la cámara para un único visor body y restaura sus ajustes al cerrar el stream o caducar la reserva. */
const createBodyCamera=camera=>{
  let lease=null,releasePromise=null,lastError='';
  const control=async(variable,value)=>cameraRequest(camera,`/control?var=${variable}&val=${value}`);
  /** Restaura primero la resolución/calidad y luego la IA. Conserva el bloqueo si algún ajuste falla para permitir reintentar. */
  const release=async id=>{
    if(!lease||lease.id!==id)return;
    if(releasePromise)return releasePromise;
    const current=lease;clearTimeout(current.timer);current.disconnect?.();
    releasePromise=(async()=>{
      const errors=[];let sizeRestored=false;
      if(current.saved){
        for(const [key,value] of [['framesize',current.saved.framesize],['quality',current.saved.quality],['face_detect',current.saved.face_detect],['face_recognize',current.saved.face_recognize]]){
          if(key.startsWith('face_')&&!sizeRestored)continue;
          try{await control(key,value);if(key==='framesize')sizeRestored=true;}catch(error){errors.push(error.message);}
        }
      }
      lastError=errors.length?'No se pudieron restaurar todos los ajustes. Reconecta la cámara y pulsa Detener de nuevo.':'';
      if(!errors.length)lease=null;
      else{current.connected=false;current.disconnect=null;}
    })().finally(()=>{releasePromise=null;});
    return releasePromise;
  };
  return {
    /** active incluye la preparación y restauración, evitando cambios simultáneos desde /rostros. */
    active:()=>!!lease,
    state:()=>({active:!!lease,restoring:!!releasePromise,error:lastError}),
    /** Guarda el estado real y exige captura JPEG: el firmware RGB565 anterior no puede transmitir Full HD. */
    start:async key=>{
      if(lease)throw new Error('La cámara está ocupada por /body. Detén esa sesión primero.');
      const resolution=resolutions[key];if(!resolution)throw new Error('Resolución no permitida.');
      const current={id:randomUUID(),saved:null,connected:false};lease=current;lastError='';
      try{
        const status=JSON.parse(await cameraRequest(camera,'/status'));
        if(status.pixformat!==4)throw new Error('Actualiza el firmware desde Arduino: /body necesita captura JPEG para Full HD. El firmware anterior usa RGB565.');
        if(status.face_enroll)throw new Error('Finaliza o cancela el registro de rostro antes de abrir /body.');
        if(!['framesize','quality','face_detect','face_recognize'].every(field=>Number.isInteger(status[field])))throw new Error('Estado de cámara incompatible.');
        current.saved=status;
        await control('face_detect',0);await control('quality',20);await control('framesize',resolution.value);
        const actual=JSON.parse(await cameraRequest(camera,'/status'));
        if(actual.framesize!==resolution.value||actual.face_detect||actual.face_recognize)throw new Error('La cámara no aplicó la resolución o la pausa de IA.');
        current.timer=setTimeout(()=>{void release(current.id);},15000);current.timer.unref();
        return {id:current.id,resolution:key,...resolution,streamUrl:`/body/stream?session=${current.id}`};
      }catch(error){await release(current.id);if(lease)error.session=current.id;throw error;}
    },
    /** Autoriza una sola conexión MJPEG por reserva y registra cómo cerrarla antes de restaurar el sensor. */
    attach:(id,disconnect)=>{
      if(!lease||lease.id!==id||lease.connected||releasePromise||lastError)return false;
      clearTimeout(lease.timer);lease.connected=true;lease.disconnect=disconnect;return true;
    },
    release,
    /** Se usa al cerrar Node; si hubo error de red, también sirve como reintento explícito. */
    stop:async id=>{if(lease&&lease.id===id)await release(id);return {ok:!lease,...(lease?{error:lastError||'Sesión distinta de la activa.'}:{})};},
    close:async()=>{if(lease)await release(lease.id);},
  };
};
module.exports={createBodyCamera,resolutions};
