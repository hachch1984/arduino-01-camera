'use strict';
(() => {
  const byId=id=>document.getElementById(id);
  const ui=Object.fromEntries(['start','stop','loading','feedback','video','overlay','stage','placeholder','videoSize','analysisSize','fps','latency','backend','resolution','inputWidth','rate','showOverlay','face','emotion','body','hand','liveness'].map(id=>[id,byId(id)]));
  const controls=['resolution','inputWidth','rate','face','emotion','body','hand','liveness'];
  const context=ui.overlay.getContext('2d');
  const sampling=document.createElement('canvas'),samplingContext=sampling.getContext('2d');
  let worker=null,session=null,running=false,busy=false,generation=0,timer=0,watchdog=0,heartbeat=0,checking=false,startingAt=0,lastResultAt=0,lastFrameAt=0;
  let initResolve=null,initReject=null,lastResult=null;
  const colors={face:'#64e8f6',body:'#92f29b',hand:'#ffcb78'};
  const emotionNames={angry:'Enojo',disgust:'Disgusto',fear:'Miedo',happy:'Alegría',sad:'Tristeza',surprise:'Sorpresa',neutral:'Neutral'};
  const bodyEdges=[['leftShoulder','rightShoulder'],['leftShoulder','leftElbow'],['leftElbow','leftWrist'],['rightShoulder','rightElbow'],['rightElbow','rightWrist'],['leftShoulder','leftHip'],['rightShoulder','rightHip'],['leftHip','rightHip'],['leftHip','leftKnee'],['leftKnee','leftAnkle'],['rightHip','rightKnee'],['rightKnee','rightAnkle'],['nose','leftEye'],['nose','rightEye'],['leftEye','leftEar'],['rightEye','rightEar']];
  const handEdges=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

  /** Actualiza el único mensaje de estado sin insertar HTML recibido de servicios externos. */
  const feedback=(message,kind='info')=>{ui.feedback.className=`alert alert-${kind}`;ui.feedback.textContent=message;};
  /** Impide cambiar modelos durante una inferencia y mantiene Detener disponible durante la carga inicial. */
  const buttons=(active,loading=false)=>{ui.start.disabled=active||!!session;ui.stop.disabled=!active&&!session;ui.loading.hidden=!loading;ui.start.textContent=active?(loading?'Preparando…':'Análisis activo'):'Iniciar análisis';controls.forEach(id=>{ui[id].disabled=active||!!session;});};
  const percent=value=>Number.isFinite(value)?`${Math.round(value*100)}%`:'—';
  const angle=value=>Number.isFinite(value)?`${Math.round(value*180/Math.PI)}°`:'—';
  /** Envía comandos de sesión al proxy local; jamás envía imágenes ni claves a Human o un servicio en Internet. */
  const command=async(path,payload,keepalive=false)=>{
    const res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Report-Token':window.CAMERA_APP?.token||''},body:JSON.stringify(payload),signal:keepalive?undefined:AbortSignal.timeout(25000),keepalive});
    const body=await res.json();
    if(!res.ok){const error=new Error(body.error||`HTTP ${res.status}`);error.session=body.session;throw error;}
    return body;
  };
  /** Crea nodos de texto para cada resultado y reemplaza los datos anteriores; no conserva imágenes del usuario. */
  const results=(kind,items,describe,empty='Sin detecciones en este cuadro.')=>{
    const target=byId(`${kind}Results`);target.replaceChildren();const count=byId(`${kind}Count`);if(count)count.textContent=items.length;
    if(!items.length){target.textContent=empty;return;}
    items.forEach(item=>{
      const entry=document.createElement('div');entry.className='result-item';
      const {title,lines}=describe(item),heading=document.createElement('h3');heading.textContent=title;entry.append(heading);
      const list=document.createElement('ul');lines.filter(Boolean).forEach(text=>{const li=document.createElement('li');li.textContent=text;list.append(li);});entry.append(list);target.append(entry);
    });
  };
  /** Actualiza los paneles de detección con los resultados y puntuaciones de Human. */
  const showResults=(result,elapsed)=>{
    if(!lastResult){buttons(true);feedback('Análisis activo. Human procesa las imágenes en la PC; la IA facial del ESP32 está pausada.','success');}
    results('body',result.body,item=>({title:`Cuerpo #${item.id} · ${percent(item.score)}`,lines:[`${item.keypoints.length} puntos de postura`,...item.keypoints.map(point=>`${point.part}: (${point.position.map(n=>Math.round(n)).join(', ')}) · ${percent(point.score)}`)]}),ui.body.checked?undefined:'Modelo desactivado.');
    results('face',result.face,item=>({title:`Rostro #${item.id} · ${percent(item.boxScore)}`,lines:[`${item.mesh?.length||0} puntos de malla / iris`,item.rotation&&`Cabeza: giro ${angle(item.rotation.angle.yaw)}, inclinación ${angle(item.rotation.angle.pitch)}, rotación ${angle(item.rotation.angle.roll)}`,item.rotation?.gaze&&`Mirada: dirección ${angle(item.rotation.gaze.bearing)}, intensidad ${Number(item.rotation.gaze.strength).toFixed(2)}`,...(item.emotion||[]).map(emotion=>`${emotionNames[emotion.emotion]||emotion.emotion}: ${percent(emotion.score)} (score del modelo)`),Number.isFinite(item.real)&&`Anti-spoof: ${percent(item.real)}`,Number.isFinite(item.live)&&`Liveness: ${percent(item.live)}`]}),ui.face.checked?undefined:'Modelo desactivado.');
    results('hand',result.hand,item=>({title:`Mano #${item.id} · ${percent(item.score)}`,lines:[`${item.keypoints.length} puntos · ${item.label}`,...Object.entries(item.landmarks||{}).map(([finger,data])=>`${finger}: ${data.curl} / ${data.direction}`)]}),ui.hand.checked?undefined:'Modelo desactivado.');
    results('gesture',result.gesture,item=>({title:item.gesture,lines:[Object.entries(item).filter(([key])=>key!=='gesture').map(([key,value])=>`${key} #${value}`).join(' · ')]}),'Sin gestos en este cuadro.');
    ui.latency.textContent=`${Math.round(elapsed)} ms`;
    const now=performance.now();ui.fps.textContent=lastResultAt?(1000/(now-lastResultAt)).toFixed(1):'—';lastResultAt=now;
    lastResult=result;draw(result);
  };
  /** Dibuja puntos y líneas en el sistema de coordenadas del cuadro analizado, escalado sobre el video real. */
  const draw=result=>{
    context.clearRect(0,0,ui.overlay.width,ui.overlay.height);
    if(!ui.showOverlay.checked||!result)return;
    context.lineWidth=2;context.font='14px sans-serif';
    const line=(a,b)=>{if(!a||!b)return;context.beginPath();context.moveTo(a[0],a[1]);context.lineTo(b[0],b[1]);context.stroke();};
    const dot=point=>{context.beginPath();context.arc(point[0],point[1],2,0,2*Math.PI);context.fill();};
    const box=(item,label)=>{if(!item.box)return;context.strokeRect(...item.box);context.fillText(label,item.box[0]+4,Math.max(14,item.box[1]-5));};
    context.strokeStyle=context.fillStyle=colors.body;
    result.body.forEach(body=>{const points=Object.fromEntries(body.keypoints.filter(p=>p.score>.25).map(p=>[p.part,p.position]));bodyEdges.forEach(([a,b])=>line(points[a],points[b]));Object.values(points).forEach(dot);box(body,`Cuerpo #${body.id}`);});
    context.strokeStyle=context.fillStyle=colors.face;
    result.face.forEach(face=>{box(face,`Rostro #${face.id}`);(face.mesh||[]).forEach(dot);});
    context.strokeStyle=context.fillStyle=colors.hand;
    result.hand.forEach(hand=>{handEdges.forEach(([a,b])=>line(hand.keypoints[a],hand.keypoints[b]));hand.keypoints.forEach(dot);box(hand,`Mano #${hand.id}`);});
  };
  /** Espera los modelos en un Web Worker para que sus cargas y operaciones de IA no bloqueen los botones de la página. */
  const loadWorker=()=>new Promise((resolve,reject)=>{
    initResolve=resolve;initReject=reject;
    worker=new Worker('/body/worker.js',{type:'module'});
    worker.onmessage=({data})=>{
      if(data.type==='ready'){ui.backend.textContent=data.backend;initResolve?.();initResolve=null;initReject=null;}
      else if(data.type==='result'&&running){busy=false;lastFrameAt=performance.now();showResults(data.result,data.elapsed);schedule();}
      else if(data.type==='error'){initReject?.(new Error(data.error));initResolve=null;initReject=null;if(running)void stop(`Error de Human: ${data.error}`);}
    };
    worker.onerror=event=>{event.preventDefault();const error=new Error(event.message||'No se pudo cargar Human. Ejecuta npm ci y usa Chrome actualizado.');initReject?.(error);if(running)void stop(error.message);};
    worker.postMessage({type:'init',options:Object.fromEntries(['face','emotion','body','hand','liveness'].map(id=>[id,ui[id].checked]))});
  });
  /** Agenda solo el siguiente análisis; nunca mantiene más de un cuadro en vuelo en el worker. */
  const schedule=()=>{clearTimeout(timer);if(running)timer=setTimeout(()=>{void frame();},Math.max(0,1000/Number(ui.rate.value)-(performance.now()-startingAt)));};
  /** Copia el cuadro más reciente del stream y reduce solo la entrada de IA en la PC, conservando Full HD en el video. */
  const frame=async()=>{
    if(!running||busy)return;
    if(!ui.video.naturalWidth){timer=setTimeout(()=>{void frame();},100);return;}
    busy=true;startingAt=performance.now();const current=generation;
    try{
      const width=Math.min(Number(ui.inputWidth.value),ui.video.naturalWidth),height=Math.round(width*ui.video.naturalHeight/ui.video.naturalWidth);
      if(sampling.width!==width||sampling.height!==height){sampling.width=ui.overlay.width=width;sampling.height=ui.overlay.height=height;}
      ui.stage.style.aspectRatio=`${ui.video.naturalWidth} / ${ui.video.naturalHeight}`;
      ui.videoSize.textContent=`${ui.video.naturalWidth}×${ui.video.naturalHeight}`;ui.analysisSize.textContent=`${width}×${height}`;
      samplingContext.drawImage(ui.video,0,0,width,height);
      const image=await createImageBitmap(sampling);
      if(!running||current!==generation){image.close();return;}
      worker.postMessage({type:'frame',image},[image]);
    }catch(error){if(current===generation)void stop(`No se pudo analizar el video: ${error.message}`);}
  };
  /** Termina video, worker y temporizadores; solicita al servidor restaurar la configuración anterior de la cámara. */
  const stop=async error=>{
    ++generation;running=false;busy=false;clearTimeout(timer);clearInterval(watchdog);clearInterval(heartbeat);
    initReject?.(new Error('Inicio cancelado.'));initResolve=null;initReject=null;
    worker?.terminate();worker=null;ui.video.removeAttribute('src');ui.video.hidden=true;ui.overlay.hidden=true;ui.placeholder.hidden=false;
    ui.placeholder.textContent='Video detenido. Inicia para volver a analizar.';
    lastResult=null;lastResultAt=0;
    ['body','face','hand','gesture'].forEach(kind=>results(kind,[],()=>({}), 'Video detenido.'));
    ui.stop.disabled=true;ui.loading.hidden=false;
    if(session){
      try{await command('/api/body/stop',{id:session.id});session=null;}
      catch(restoreError){buttons(false);feedback(`${error?error+' ':''}${restoreError.message} Pulsa Detener para reintentar.`, 'danger');return;}
    }
    buttons(false);feedback(error||'Video detenido. Ajustes de la cámara restaurados.',error?'danger':'secondary');
  };
  /** Carga modelos primero y reserva la cámara después. La resolución mostrada procede del JPEG recibido, no del selector. */
  const start=async()=>{
    const current=++generation;buttons(true,true);feedback('Cargando modelos de Human en la PC. El primer inicio puede tardar…');
    const initTimeout=setTimeout(()=>initReject?.(new Error('La carga de modelos tardó demasiado. Revisa la consola del navegador.')),120000);
    try{
      if(!window.CAMERA_APP?.token)throw new Error('Abre /body desde el servidor Node.js de la PC.');
      await loadWorker();clearTimeout(initTimeout);if(current!==generation)return;
      feedback(`Preparando ${ui.resolution.selectedOptions[0].textContent}. Pausando la IA del ESP32…`);
      const reservation=await command('/api/body/start',{resolution:ui.resolution.value});
      if(current!==generation){await command('/api/body/stop',{id:reservation.id});return;}
      session=reservation;running=true;lastFrameAt=performance.now();
      ui.video.onerror=()=>{if(running)void stop('La transmisión se interrumpió. Revisa el Wi-Fi o prueba HD / VGA.');};
      ui.video.src=reservation.streamUrl;ui.video.hidden=false;ui.overlay.hidden=false;ui.placeholder.hidden=true;
      feedback('Video conectado. Preparando la primera inferencia en la PC; puede tardar varios segundos…');
      watchdog=setInterval(()=>{if(performance.now()-lastFrameAt>(lastResult?45000:120000))void stop('No se recibieron resultados a tiempo. Prueba menos modelos o una resolución menor.');},1000);
      // Consulta solo Node, sin otra captura en el ESP32. Detecta el final de MJPEG aunque <img> conserve el último cuadro.
      heartbeat=setInterval(async()=>{
        if(checking||!running)return;checking=true;const checkGeneration=generation;
        try{
          const response=await fetch('/api/body',{signal:AbortSignal.timeout(5000)});const state=await response.json();
          if(checkGeneration===generation&&running&&!state.active)void stop('La transmisión terminó. Inicia de nuevo para reconectar.');
        }catch{if(checkGeneration===generation&&running)void stop('Se perdió la conexión con el servidor de la PC.');}
        finally{checking=false;}
      },2000);
      void frame();
    }catch(error){clearTimeout(initTimeout);if(current!==generation)return;if(error.session)session={id:error.session};await stop(error.message);}
  };
  ui.start.addEventListener('click',()=>{void start();});ui.stop.addEventListener('click',()=>{void stop();});
  ui.showOverlay.addEventListener('change',()=>draw(lastResult));
  /** El cierre de la pestaña libera recursos locales y envía una orden pequeña keepalive; el cierre del stream también restaura en Node. */
  window.addEventListener('pagehide',()=>{running=false;++generation;worker?.terminate();clearTimeout(timer);clearInterval(watchdog);clearInterval(heartbeat);ui.video.removeAttribute('src');if(session)void command('/api/body/stop',{id:session.id},true).catch(()=>{});});
})();
