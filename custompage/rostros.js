'use strict';
const $ = id => document.getElementById(id);
const app = window.CAMERA_APP || {};
let sendingReport = false;
let running = false, busy = false, state = null, revision = '', seenEvent = -1;
let enrollmentSubmitting = false, confirmingDelete = false;
let eventCursor = 0, eventGeneration = 0;
const peruTime = new Intl.DateTimeFormat('es-PE', {timeZone:'America/Lima', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
const dialogStyle = {
  background:'#182231', color:'#dee2e6', buttonsStyling:false,
  customClass:{confirmButton:'btn btn-danger',cancelButton:'btn btn-secondary'},
};
const session = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const api = async (path, options = {}) => {
  const response = await fetch('/api/rostros' + path, {cache:'no-store', headers:{'Content-Type':'application/json'}, ...options, signal:AbortSignal.timeout(12000)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'La cámara no pudo completar la operación.');
  return data;
};
const message = (text, danger = false, tone = 'secondary') => { $('feedback').textContent = text; $('feedback').className = 'alert alert-' + (danger ? 'danger' : tone); };
const controls = () => {
  $('toggle').disabled = busy || confirmingDelete || !state || state.pending;
  $('enroll').disabled = busy || confirmingDelete || !running || !state || !state.storage || state.pending || state.people.length >= state.limit;
  $('name').disabled = busy || confirmingDelete || !!state?.pending;
  const processing = enrollmentSubmitting || !!state?.pending;
  $('enrollProgress').hidden = !processing;
  $('enroll').setAttribute('aria-busy',String(processing));
  $('people').querySelectorAll('button').forEach(b => b.disabled = busy || confirmingDelete || !!state?.pending);
  $('cancel').hidden = !state?.pending;
  $('cancel').disabled = busy;
  $('sendReport').disabled = !app.reports || sendingReport || !$('events').children.length;
};
const stopVideo = () => {
  running = false; $('video').removeAttribute('src'); $('video').hidden = true; $('placeholder').hidden = false;
  $('toggle').textContent = 'Iniciar video'; $('recognition').textContent = 'Video detenido'; controls();
  renderRecognition(null); ++eventGeneration;
};
const renderRecognition = data => {
  const visible = running && data?.faceVisible;
  const person = visible && data.lastId >= 0 ? data.people.find(p => p.id === data.lastId) : null;
  $('recognizedName').textContent = !visible ? 'Sin reconocimiento' : person ? person.name : 'Intruso';
  $('recognizedName').className = 'h4 mt-4 text-break' + (visible && !person ? ' text-warning' : '');
  $('recognizedDetails').hidden = !person;
  $('recognizedPhoto').hidden = !person?.photo;
  $('recognizedNoPhoto').hidden = !person || person.photo;
  if (person?.photo) {
    const src = `/api/rostros/foto?id=${person.id}&v=${data.revision}&s=${session}`;
    if ($('recognizedPhoto').getAttribute('src') !== src) $('recognizedPhoto').src = src;
    $('recognizedPhoto').alt = `Foto empadronada de ${person.name}`;
  } else $('recognizedPhoto').removeAttribute('src');
};
const appendEvent = (event, receivedAt) => {
  if (!event || event.sequence <= eventCursor) return;
  eventCursor = event.sequence;
  const item = document.createElement('article'); item.className = 'event-item';
  const photo = document.createElement('img'); photo.className = 'portrait';
  photo.src = 'data:image/jpeg;base64,' + event.image; photo.alt = `Captura de ${event.name}`;
  const details = document.createElement('div'); details.className = 'event-details';
  const date = new Date(receivedAt - Math.max(0, event.ageMs || 0));
  const time = document.createElement('time'); time.className = 'small muted'; time.dateTime = date.toISOString(); time.textContent = peruTime.format(date);
  const name = document.createElement('p'); name.className = 'mb-0 fw-semibold'; name.textContent = event.name;
  details.append(time, name); item.append(photo, details); $('events').prepend(item);
  while ($('events').children.length > 50) $('events').lastElementChild.remove();
  $('eventsEmpty').hidden = true; $('clearEvents').disabled = false;
  controls();
};
const startVideo = async () => {
  await api('/iniciar', {method:'POST'});
  const url = new URL('/stream', location.href); url.port = String(Number(location.port || 80) + 1);
  $('video').src = app.streamUrl || url.href; $('video').hidden = false; $('placeholder').hidden = true;
  running = true; $('toggle').textContent = 'Detener video'; controls();
};
const render = (data) => {
  state = data;
  $('count').textContent = `${data.people.length} / ${data.limit}`;
  const occupied = data.people.length;
  const percent = data.limit > 0 ? Math.min(100, Math.round(occupied * 100 / data.limit)) : 0;
  $('capacityProgress').setAttribute('aria-valuemax', String(data.limit));
  $('capacityProgress').setAttribute('aria-valuenow', String(occupied));
  $('capacityProgress').setAttribute('aria-valuetext', `${occupied} de ${data.limit} cupos ocupados (${percent} %)`);
  $('capacityBar').style.width = `${percent}%`;
  $('capacityBar').textContent = percent ? `${percent} %` : '';
  $('capacityBar').className = 'progress-bar ' + (percent >= 100 ? 'bg-danger' : percent >= 80 ? 'bg-warning text-dark' : 'bg-info text-dark');
  $('empty').textContent = data.people.length ? '' : 'Todavía no hay personas registradas.';
  const signature = JSON.stringify({people:data.people,revision:data.revision});
  if (signature !== revision) {
    revision = signature; $('people').replaceChildren();
    for (const person of data.people) {
      const col = document.createElement('div'); col.className = 'col-12';
      const card = document.createElement('div'); card.className = 'card card-body h-100';
      const row = document.createElement('div'); row.className = 'd-flex gap-3 align-items-center';
      const photo = document.createElement(person.photo ? 'img' : 'div'); photo.className = 'portrait flex-shrink-0';
      if (person.photo) { photo.src = `/api/rostros/foto?id=${person.id}&v=${data.revision}&s=${session}`; photo.alt = `Foto de ${person.name}`; }
      else { photo.textContent = 'Sin foto'; photo.classList.add('d-grid','align-items-center','text-center'); }
      const details = document.createElement('div'); details.className = 'flex-grow-1 overflow-hidden';
      const name = document.createElement('h3'); name.className = 'h6 text-break'; name.textContent = person.name;
      const id = document.createElement('p'); id.className = 'small muted mb-2'; id.textContent = `Registro #${person.id}`;
      const remove = document.createElement('button'); remove.className = 'btn btn-sm btn-outline-danger'; remove.textContent = 'Eliminar';
      remove.onclick = () => deletePerson(person); details.append(name,id,remove); row.append(photo,details); card.append(row); col.append(card); $('people').append(col);
    }
  }
  if (seenEvent !== data.revision) { seenEvent = data.revision; message(data.message, data.failed); }
  if (data.pending) message('Registrando rostro… Mira a la cámara y mantén un solo rostro visible.', false, 'info');
  if (!data.storage) message('El almacenamiento de fotos no está disponible. Revisa que hayas subido el proyecto con su partitions.csv.', true);
  renderRecognition(data);
  if (running) $('recognition').textContent = data.pending ? 'Esperando un solo rostro…' : data.faceVisible ? (data.lastId >= 0 ? 'Estado: rostro reconocido' : 'Estado: intruso') : 'Buscando un rostro…';
  controls();
};
const action = async (fn) => {
  if (busy) return;
  busy = true; controls();
  try { await fn(); render(await api('')); }
  catch (error) { message(error.message, true); }
  finally { busy = false; controls(); }
};
const deletePerson = async (person) => {
  if (busy || confirmingDelete || state?.pending) return;
  confirmingDelete = true; controls();
  let confirmed = false;
  try {
    const result = await Swal.fire({
      ...dialogStyle, title:'¿Eliminar este registro?', icon:'warning',
      text:`Se eliminarán el rostro, el nombre y la foto de ${person.name}. Se liberará un espacio.`,
      showCancelButton:true, confirmButtonText:'Sí, eliminar', cancelButtonText:'Cancelar', focusCancel:true,
    });
    confirmed = result.isConfirmed;
  } finally { confirmingDelete = false; controls(); }
  if (!confirmed || busy || state?.pending) return;
  await action(async () => {
    await api('/eliminar', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:person.id})});
    await Swal.fire({...dialogStyle, title:'Registro eliminado', text:`Se eliminó el registro de ${person.name}.`, icon:'success', confirmButtonText:'Aceptar', customClass:{confirmButton:'btn btn-primary'}});
  });
};
$('toggle').onclick = () => action(async () => { if (running) stopVideo(); else await startVideo(); });
$('enrollForm').onsubmit = event => {
  event.preventDefault(); const name = $('name').value.trim();
  if (busy || confirmingDelete || state?.pending) return;
  if (!name || new TextEncoder().encode(name).length > 64) { message('Escribe un nombre de hasta 40 caracteres y 64 bytes.',true); return; }
  enrollmentSubmitting = true; controls();
  message('Registrando rostro… Mira a la cámara y mantén un solo rostro visible.', false, 'info');
  action(async () => {
    await api('/registrar', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
    $('name').value = '';
  }).finally(() => { enrollmentSubmitting = false; controls(); });
};
$('cancel').onclick = () => action(() => api('/cancelar', {method:'POST'}));
$('video').onerror = () => { stopVideo(); message('Se cortó el video. Cierra otras transmisiones e inténtalo de nuevo.',true); };
$('recordEvents').onchange = () => { ++eventGeneration; eventCursor = state?.eventSequence || 0; };
$('clearEvents').onclick = () => {
  ++eventGeneration; eventCursor = state?.eventSequence || 0;
  $('events').replaceChildren(); $('eventsEmpty').hidden = false; $('clearEvents').disabled = true;
  controls();
};
$('sendReport').onclick = async () => {
  if(sendingReport || !app.reports) return;
  const recipients=$('reportEmails').value.trim();
  const addresses=recipients.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean);
  if(!addresses.length || addresses.length>20 || addresses.some(v=>!/^\S+@[^\s@]+\.[^\s@]+$/.test(v))) {message('Ingresa entre 1 y 20 correos validos separados por comas.',true);return;}
  const events=[...$('events').children].map(item=>({image:item.querySelector('img').src.split(',')[1],at:item.querySelector('time').dateTime,name:item.querySelector('p').textContent}));
  if(!events.length) {message('No hay eventos para enviar.',true);return;}
  sendingReport=true;controls();$('sendReport').textContent='Enviando…';
  try {
    const requestId=crypto.randomUUID ? crypto.randomUUID() : 'report-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    const response=await fetch('/api/report',{method:'POST',headers:{'Content-Type':'application/json','X-Report-Token':app.token},body:JSON.stringify({recipients,events,requestId}),signal:AbortSignal.timeout(90000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'No se confirmo el envio.');
    message(result.message);
    await Swal.fire({...dialogStyle,title:result.rejected?.length?'Envío parcial':'Reporte aceptado por Brevo',text:result.message+(result.rejected?.length?' Rechazados: '+result.rejected.join(', '):''),icon:result.rejected?.length?'warning':'success',confirmButtonText:'Aceptar',customClass:{confirmButton:'btn btn-primary'}});
  } catch(error) {message(error.name==='TimeoutError'?'No se confirmo el envio. Revisa Brevo antes de reintentar para evitar duplicados.':error.message,true);}
  finally {sendingReport=false;$('sendReport').textContent='Enviar reporte';controls();}
};
if(app.reports) {
  $('reportHelp').textContent='Separa los correos con comas o saltos de línea. El servidor de la PC envía los eventos de esta lista mediante Brevo.';
  document.querySelector('a[href="/"]').href=app.cameraUrl+'/';
}
window.addEventListener('pagehide', stopVideo);
const poll = async () => {
  if (!busy) try {
    const generation = eventGeneration;
    const recording = running && $('recordEvents').checked;
    const data = await api(recording ? `?record=1&after=${eventCursor}` : '');
    render(data);
    if (data.eventSequence < eventCursor) eventCursor = data.eventSequence;
    if (recording && running && $('recordEvents').checked && generation === eventGeneration) appendEvent(data.event, Date.now());
  } catch (error) { state = null; controls(); renderRecognition(null); $('recognition').textContent = 'Sin conexión'; message('Sin conexión: ' + error.message, true); }
  setTimeout(poll, 1800);
};
poll();
