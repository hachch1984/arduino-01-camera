'use strict';
(() => {
  const panel=document.getElementById('noticeSection');
  const app=window.CAMERA_APP||{};
  if(!panel)return;
  const enabled=document.getElementById('noticeEnabled');
  const emails=document.getElementById('noticeEmails');
  const counter=document.getElementById('noticeCounter');
  const error=document.getElementById('noticeError');
  const photo=document.getElementById('noticePhoto');
  const capturePanel=document.getElementById('noticeCapture');
  const captureEmpty=document.getElementById('noticeCaptureEmpty');
  const captureName=document.getElementById('noticeCaptureName');
  const captureTime=document.getElementById('noticeCaptureTime');
  const captureStatus=document.getElementById('noticeCaptureStatus');
  const peru=new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
  let captureId=null;
  let revision=0,dirty=false,saving=false,saveTimer=null,queue=Promise.resolve();
  let snapshot={enabled:false,sending:false,remainingMs:0},deadline=0,closed=false;
  /** Solicita únicamente configuración pública de avisos; las credenciales SMTP quedan en Node.js. */
  const request=async options=>{
    const response=await fetch('/api/avisos',{cache:'no-store',headers:{'Content-Type':'application/json','X-Report-Token':app.token},signal:AbortSignal.timeout(6000),...options});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'No se pudo configurar el aviso.');return result;
  };
  /** Muestra la espera indicada por el servidor, con actualización local entre consultas. */
  const tick=()=>{
    const seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));
    counter.hidden=!enabled.checked||(!snapshot.sending&&!seconds);
    counter.textContent=snapshot.sending?'Enviando aviso…':`Próximo aviso disponible en ${seconds} s`;
  };
  /** Aplica el estado remoto sin reemplazar texto que el usuario está editando. */
  const apply=(data,configuration)=>{
    snapshot=data;deadline=Date.now()+data.remainingMs;
    if(configuration){enabled.checked=data.enabled;if(document.activeElement!==emails)emails.value=data.recipients;}
    if(data.lastError){error.textContent=data.lastError;error.hidden=false;}
    if(data.capture){
      const capture=data.capture;
      capturePanel.hidden=false;captureEmpty.hidden=true;
      if(captureId!==capture.id){captureId=capture.id;photo.src=`/api/avisos/foto?id=${encodeURIComponent(capture.id)}`;}
      captureName.textContent=capture.name;
      captureTime.dateTime=capture.at;captureTime.textContent=peru.format(new Date(capture.at));
      captureStatus.textContent={sending:'Enviando esta captura…',accepted:'Brevo aceptó el aviso con esta captura.',failed:'No se confirmó el envío de esta captura.'}[capture.status]||'';
    }else{
      capturePanel.hidden=true;captureEmpty.hidden=false;photo.removeAttribute('src');captureId=null;
    }
    tick();
  };
  /** Valida y guarda sin botón. Serializa cambios para que una respuesta lenta no revierta un cambio posterior. */
  const save=()=>{
    const version=revision;
    const values=emails.value.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean);
    const valid=values.length>0&&values.length<=20&&values.every(v=>/^\S+@[^\s@]+\.[^\s@]+$/.test(v));
    const invalid=enabled.checked&&!valid;
    if(invalid){enabled.checked=false;error.textContent='Ingresa entre 1 y 20 correos válidos separados por comas y activa el aviso.';error.hidden=false;}
    else {error.hidden=true;}
    const payload={enabled:enabled.checked,recipients:valid?values.join(', '):''};
    queue=queue.catch(()=>{}).then(async()=>{
      saving=true;
      try{const data=await request({method:'POST',body:JSON.stringify(payload)});if(version===revision){dirty=invalid;apply(data,!invalid);}}
      catch(failure){if(version===revision){dirty=false;enabled.checked=snapshot.enabled;error.textContent='No se confirmó el cambio. '+failure.message;error.hidden=false;}}
      finally{saving=false;tick();}
    });
  };
  /** Aplica el checkbox inmediatamente; desactivar impide los siguientes envíos. */
  enabled.onchange=()=>{revision++;dirty=true;clearTimeout(saveTimer);tick();save();};
  /** Agrupa la escritura de destinatarios; guardar ocurre automáticamente al dejar de teclear o salir del campo. */
  emails.oninput=()=>{revision++;dirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(save,500);};
  emails.onchange=()=>{clearTimeout(saveTimer);save();};
  /** Consulta el contador de Node.js sin generar solicitudes adicionales al ESP32. */
  const poll=async()=>{
    if(closed)return;
    try{apply(await request(),!dirty&&!saving);}catch(failure){error.textContent=failure.message;error.hidden=false;}
    if(!closed)setTimeout(poll,1000);
  };
  if(!app.alerts){enabled.disabled=true;emails.disabled=true;error.textContent='Abre la página desde el servidor Node.js para activar avisos.';error.hidden=false;return;}
  const ticker=setInterval(tick,250);
  window.addEventListener('pagehide',()=>{closed=true;clearInterval(ticker);clearTimeout(saveTimer);},{once:true});
  poll();
})();
