'use strict';
const {recipients,buildAlert} = require('./report.cjs');
const {mailError} = require('./mailer.cjs');
const {randomInt} = require('node:crypto');

/**
 * Coordina avisos de todas las pestañas en una sola instancia Node.js.
 * No crea un temporizador de envíos: una observación nueva debe llegar después
 * del enfriamiento para iniciar otro correo. La configuración vive en memoria.
 */
const createAlerts = ({mailer,sender,isMailBusy=()=>false,now=Date.now}) => {
  let enabled=false,addresses=[],sending=false,nextAllowedAt=0,lastError='',ticket=0,ticketSince=0,capture=null;
  /** Publica el estado y la espera restante sin revelar credenciales SMTP. */
  const state = () => ({enabled,recipients:addresses.join(', '),sending,
    remainingMs:Math.max(0,nextAllowedAt-now()),lastError,
    capture:capture?{id:capture.id,name:capture.name,at:capture.at,status:capture.status}:null});
  /** Arma una captura nueva solo cuando se permite otro correo. El ticket evita reutilizar fotos de solicitudes anteriores. */
  const captureTicket = () => {
    if(!enabled||sending||isMailBusy()||now()<nextAllowedAt)return 0;
    if(!ticket||now()-ticketSince>=6000){
      // Renueva solicitudes sin respuesta para recuperarse de pausas o cortes de red.
      do{ticket=randomInt(1,0x100000000);}while(ticket===capture?.id);
      ticketSince=now();
    }
    return ticket;
  };
  /** Devuelve exactamente los bytes adjuntos del último aviso, sin volver a consultar la cámara. */
  const photo = id => capture&&String(capture.id)===id?capture.image:null;
  /** Valida y aplica cambios automáticamente. Desactivar no cancela un SMTP ya iniciado. */
  const configure = payload => {
    if(typeof payload.enabled!=='boolean')throw new Error('Estado de aviso invalido.');
    if(typeof payload.recipients!=='string')throw new Error('Destinatarios invalidos.');
    const next=payload.recipients.trim()?recipients(payload.recipients):[];
    if(payload.enabled&&!next.length)throw new Error('Ingresa al menos un correo para activar los avisos.');
    if(enabled!==payload.enabled||addresses.join(',')!==next.join(','))ticket=0;
    addresses=next;enabled=payload.enabled;lastError='';
    return state();
  };
  /**
   * Consume la foto y el resultado del mismo cuadro del ESP32, separados de los eventos con espera de 3 s.
   * Reserva sending antes del primer await para excluir solicitudes concurrentes.
   * Tras completar un envío espera 5 s. Un fallo pausa los avisos para no reintentar
   * un correo de resultado incierto; el usuario puede reactivarlos tras revisarlo.
   */
  const observe = async data => {
    if(!enabled||sending||isMailBusy()||now()<nextAllowedAt||!ticket)return;
    if(data?.noticeSupported!==true){
      enabled=false;ticket=0;lastError='Actualiza el firmware del ESP32 para capturar la foto de los avisos. Los avisos quedaron desactivados.';return;
    }
    const detected=data.noticeCapture;
    if(!detected||detected.ticket!==ticket||!Number.isFinite(detected.ageMs)||detected.ageMs<0||detected.ageMs>=6000)return;
    sending=true;
    let attempt;
    try {
      const at=new Date(now()-detected.ageMs).toISOString();
      const message=buildAlert(addresses,sender,{...detected,at},new Date(now()));
      attempt=capture={id:ticket,name:detected.name,at,status:'sending',image:message.attachments[0].content};
      const result=await mailer.sendMail(message);
      if(result.rejected?.length)throw new Error('Destinatarios rechazados');
      attempt.status='accepted';
    } catch(error) {
      if(attempt)attempt.status='failed';
      enabled=false;
      lastError=mailError(error)+' Los avisos quedaron desactivados; revisa Brevo antes de reactivarlos.';
    } finally {nextAllowedAt=now()+5000;sending=false;ticket=0;}
  };
  return {state,configure,observe,captureTicket,photo};
};
module.exports={createAlerts};
