'use strict';
const {randomUUID} = require('node:crypto');
const peru = new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
/**
 * Escapa caracteres especiales antes de insertar nombres y fechas en el HTML del correo, evitando que el
 * contenido del usuario se interprete como etiquetas.
 */
const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
/**
 * Divide los destinatarios por comas o saltos de línea, quita vacíos y duplicados idénticos, y exige entre
 * 1 y 20 direcciones válidas. Lanza un error de validación si la lista no cumple.
 */
const recipients = text => {
  if (typeof text !== 'string' || text.length > 2000) throw new Error('Escribe los destinatarios separados por comas.');
  const values = [...new Set(text.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean))];
  if (!values.length || values.length > 20 || values.some(v=>v.length>254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(v))) throw new Error('Ingresa entre 1 y 20 correos validos, separados por comas.');
  return values;
};
/**
 * Valida de 1 a 50 eventos y construye el objeto que acepta Nodemailer. Comprueba fechas, nombres y límites
 * de JPEG, convierte fechas a America/Lima y relaciona cada imagen adjunta con su referencia cid en la
 * tabla HTML. No envía correo.
 */
const buildReport = (payload, sender, now = new Date()) => {
  const to = recipients(payload.recipients);
  if (!Array.isArray(payload.events) || !payload.events.length || payload.events.length > 50) throw new Error('El reporte debe contener entre 1 y 50 eventos.');
  const id = randomUUID(); let total = 0;
  /**
   * Normaliza cada evento recibido: decodifica base64, comprueba marcadores JPEG y tamaño acumulado, formatea
   * la fecha y asigna un Content-ID único para esa imagen.
   */
  const events = payload.events.map((event,index) => {
    const date = new Date(event.at);
    if (typeof event.at !== 'string' || !Number.isFinite(date.getTime()) || typeof event.name !== 'string' || !event.name.trim() || event.name.length > 128) throw new Error('Un evento tiene fecha o mensaje invalido.');
    if (typeof event.image !== 'string' || event.image.length > 350000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.image)) throw new Error('Una captura no es valida.');
    const content = Buffer.from(event.image,'base64'); total += content.length;
    if (content.length < 4 || content[0] !== 0xff || content[1] !== 0xd8 || content[content.length-2] !== 0xff || content[content.length-1] !== 0xd9 || total > 6000000) throw new Error('Las capturas deben ser JPEG y sumar menos de 6 MB.');
    return {name:event.name,date:peru.format(date),content,cid:`evento-${index}-${id}@camera.local`};
  });
  const subject = `Registro de eventos camara android <${peru.format(now)}>`;
  const rows = events.map(event=>`<tr><td style="padding:12px;border:1px solid #ccc"><img src="cid:${event.cid}" width="144" alt="Captura del evento"></td><td style="padding:12px;border:1px solid #ccc"><p>${escapeHtml(event.date)}</p><p>${escapeHtml(event.name)}</p></td></tr>`).join('');
  return {from:{name:'Camara ESP32',address:sender},to:to.map(address=>({address})),subject,
    text:events.map(event=>`${event.date} — ${event.name}`).join('\n'),
    html:`<!doctype html><html lang="es"><body><h2>Registro de eventos</h2><table style="border-collapse:collapse"><thead><tr><th>Foto</th><th>Fecha, hora y mensaje</th></tr></thead><tbody>${rows}</tbody></table></body></html>`,
    attachments:events.map((event,index)=>({filename:`evento-${index+1}.jpg`,content:event.content,contentType:'image/jpeg',cid:event.cid,contentDisposition:'inline'})),
    disableFileAccess:true,disableUrlAccess:true};
};
module.exports = {recipients,buildReport};
