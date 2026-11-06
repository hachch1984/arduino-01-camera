'use strict';
const $ = id => document.getElementById(id);
let running = false, busy = false, state = null, revision = '', seenEvent = -1;
let enrollmentSubmitting = false, confirmingDelete = false;
const dialogStyle = {
  background:'#182231', color:'#dee2e6', buttonsStyling:false,
  customClass:{confirmButton:'btn btn-danger',cancelButton:'btn btn-secondary'},
};
const session = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const api = async (path, options = {}) => {
  const response = await fetch('/api/rostros' + path, {cache:'no-store', ...options, signal:AbortSignal.timeout(12000)});
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
};
const stopVideo = () => {
  running = false; $('video').removeAttribute('src'); $('video').hidden = true; $('placeholder').hidden = false;
  $('toggle').textContent = 'Iniciar video'; $('recognition').textContent = 'Video detenido'; controls();
};
const startVideo = async () => {
  await api('/iniciar', {method:'POST'});
  const url = new URL('/stream', location.href); url.port = String(Number(location.port || 80) + 1);
  $('video').src = url.href; $('video').hidden = false; $('placeholder').hidden = true;
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
      const col = document.createElement('div'); col.className = 'col-md-6 col-xl-4';
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
  if (running) $('recognition').textContent = data.pending ? 'Esperando un solo rostro…' : data.lastName || 'Buscando un rostro…';
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
window.addEventListener('pagehide', stopVideo);
const poll = async () => {
  if (!busy) try { render(await api('')); } catch (error) { state = null; controls(); message('Sin conexión: ' + error.message, true); }
  setTimeout(poll, 1800);
};
poll();
