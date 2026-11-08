# Servidor local de la cámara

Node.js sirve la interfaz y sus bibliotecas, conecta con la API y el video del
ESP32 y envía reportes usando Nodemailer y Brevo. El ESP32 conserva la captura,
la detección, el reconocimiento y el padrón persistente. Los eventos continúan
en la pestaña (máximo 50); se envía una copia de los eventos visibles al pulsar
Enviar reporte. No requiere servicios en la nube aparte del SMTP de Brevo.

## Arranque

Desde la raíz del proyecto, con Node.js 22 o posterior:

```powershell
npm ci
npm start
```

Abrir **http://localhost:3000/rostros**. También se puede hacer doble clic en
`Abrir-Camara-Web.cmd` después de instalar dependencias. Mantener el servidor
encendido mientras se usa la página. Solo escucha en 127.0.0.1; no se abre un
puerto de red ni el firewall. Si ya está iniciado, no abrir una segunda instancia.

El lanzador abre una CMD propia titulada **Camara ESP32 - Servidor web** y ejecuta
Node.js en primer plano. `SERVIDOR INICIADO` muestra el PID. Ctrl+C cierra el
servidor y sus conexiones y muestra `SERVIDOR DETENIDO`; la CMD permanece abierta
para revisar el resultado y cerrarla manualmente. Cerrar la ventana también
termina el proceso que ejecuta en ella. No usar un lanzador oculto o desacoplado.

Copiar `secret.env.example` como `secret.env` y completar los valores si se instala
en otra PC. `secret.env` y `node_modules` están excluidos de Git. Nunca colocar
la clave en el HTML/JavaScript del navegador. No se genera `mail_secrets.h` ni
se compilan credenciales SMTP en el firmware: el usuario eligió finalmente Node.js.

`CAMERA_URL` debe coincidir con la IP del monitor serie. El servidor y la cámara
deben estar conectados al mismo hotspot. Cambiar `secret.env` requiere reiniciar
Node.js. La clave SMTP es distinta de una API key HTTP de Brevo.

## Aviso automático de rostro

La sección **Aviso** tiene un checkbox y destinatarios separados por comas. No
incluye botones de guardar ni de simulación. Los cambios se aplican al terminar
de escribir (500 ms) o al salir del campo. Admite de 1 a 20 correos válidos.

- Requiere iniciar el video y mantener abierta la página en Node.js. Funciona
  aunque **Registrar eventos** esté desmarcado.
- `rostros.js` agrega `watch=1` al consultar estado con video activo. El proxy
  agrega `notify=<ticket>` solo cuando puede enviarse otro aviso. No abre una
  segunda consulta de estado. El firmware renovado reconoce `notify` y publica
  `noticeSupported: true`; una versión anterior deja los avisos desactivados con
  un mensaje para actualizar la placa.
- `captureNotice()` recorta el primer rostro único del mismo cuadro BGR888 que
  acaba de clasificar `run_face_recognition()`, antes de dibujar nombres y cajas.
  Guarda JPEG base64, nombre/Intruso, ticket y tiempo de captura en RAM. Captura
  una vez por ticket; la solicitud caduca a los 6 s sin renovarse. Node.js también
  renueva tickets sin respuesta tras 6 s para recuperarse de cortes de red. No guarda fotos
  de avisos en LittleFS ni cambia el padrón, pines, resolución o particiones.
- La siguiente respuesta de estado incluye `noticeCapture: {ticket, ageMs, name,
  image}`. `alerts.cjs` exige el ticket vigente y una antigüedad inferior a 6 s.
  La captura es inmediata al clasificar el rostro, sin la espera de 3 s de los
  eventos. Su traslado a Node.js depende del polling (1,8 s después de responder
  la consulta anterior) y de la red; no implica entrega instantánea del correo.
- El correo incluye fecha/hora de captura en Perú (día/mes/año, 12 h), nombre o
  Intruso y `captura-aviso.jpg` como adjunto MIME y referencia CID en el cuerpo.
  La sección muestra exactamente ese JPEG, no la foto del padrón. Node.js sirve
  la copia del adjunto sin volver a capturar ni consultar el ESP32. Se muestra si
  está enviando, fue aceptado por Brevo o no se confirmó el envío.
- Mientras Nodemailer está enviando, no admite otro aviso. Al terminar espera
  **5 segundos completos** antes del siguiente. Es una espera por instancia del
  servidor, compartida entre pestañas. Cambiar destinatarios o desactivar/activar
  no borra el contador.
- Si siguen llegando detecciones tras la espera puede enviar otro correo, incluso
  si es la misma persona. No guarda una cola de detecciones durante la espera.
- Un fallo o rechazo SMTP pausa los avisos y muestra el error. Revisar Brevo antes
  de reactivar, porque un error de red puede dejar incierto el resultado del envío.
- Desactivar impide nuevos envíos, pero no revoca un correo ya entregado al SMTP.
- La configuración vive en RAM de Node.js: reiniciar el servidor deja el checkbox
  apagado y los destinatarios vacíos. Recargar una pestaña consulta la configuración
  vigente del servidor. Conserva solo la última foto de aviso en RAM; se pierde
  al reiniciar Node.js. La lista de eventos sigue siendo propia de cada navegador.

`GET /api/avisos` devuelve configuración, `sending`, `remainingMs`, `lastError` y
los metadatos `capture: {id, name, at, status}` (o null). No repite el JPEG en cada
sondeo. `GET /api/avisos/foto?id=ID` devuelve solo la última foto, con el ID vigente;
un ID desconocido devuelve 404. La web pide la foto una vez por nuevo ID.
`POST /api/avisos` exige el token de sesión y recibe `{enabled, recipients}`.
`avisos.js` actualiza el contador localmente cada 250 ms y consulta solo a Node.js
cada segundo. No se agregan llamadas de sondeo al ESP32 para este contador.

Pruebas: `npm test` cubre foto/adjunto idénticos, MIME, tickets antiguos, espera
desde el fin de SMTP, concurrencia, desactivación, firmware antiguo, JPEG inválido,
errores y detecciones con `watch=1` sin `record=1`. La interfaz se
comprueba con `node custompage/test-avisos.cjs` y Playwright configurado como en
`custompage/test-ui.cjs`. Las pruebas no envían correos reales.

## Pestañas de administración

El panel de cámara incluye **Usar PIR**. Su funcionamiento, conexión a GPIO21,
tiempo de estabilización y corte tras 60 s sin señal están en [PIR.md](../PIR.md).
El proxy de video conserva `pir=1` para que la propia placa aplique el corte entre
cuadros. Requiere reiniciar Node.js y Subir el firmware actualizado.

**Padrón**, **Eventos** y **Aviso** ocupan paneles separados debajo de la cámara y
el reconocimiento, que permanecen visibles. `tabs.js` cambia clases Bootstrap y
visibilidad de nodos existentes; no navega, recarga ni recrea formularios. Cambiar
de panel mantiene el video, los datos escritos, eventos y avisos activados. Los
avisos y la captura de eventos continúan aunque su panel esté oculto.

Se admiten clic, Enter/Espacio, flechas izquierda/derecha e Inicio/Fin. Los roles
tablist/tab/tabpanel, aria-selected, aria-controls y tabindex mantienen el foco y
la selección accesibles. La primera pestaña al abrir es Padrón.

Para aplicar estos cambios, detener Node.js con Ctrl+C y volver a iniciar el CMD;
recargar la página. Además, **Subir el firmware nuevo** desde Arduino IDE para
habilitar las fotos de avisos. Cambiar solo las pestañas no requiere subir firmware.

## Reporte manual

- Escribir entre 1 y 20 destinatarios separados por comas o saltos de línea.
- Se valida en el servidor y se eliminan direcciones repetidas idénticas.
- El asunto es `Registro de eventos camara android <fecha y hora de Perú>`.
- El asunto y las filas usan día/mes/año y hora de 12 horas con a. m./p. m.
  La zona sigue siendo America/Lima, sin imprimir «Perú» en las filas ni encima
  de la tabla.
- Tabla de dos columnas: foto y fecha/hora más nombre o Intruso. Las fechas de
  los eventos se convierten a America/Lima y el asunto usa el reloj del servidor.
- Las imágenes viajan como partes MIME inline con CID; no dependen de la IP de
  la cámara ni de URLs públicas. El cliente de correo puede decidir cómo mostrarlas.
- Los mensajes se escapan como texto HTML. Solo se admiten capturas JPEG y no
  se permiten adjuntos por rutas locales o URLs externas.
- El botón se bloquea durante el envío; el servidor deduplica hasta 100 IDs de
  solicitud en memoria. No hay reintentos SMTP automáticos. Un resultado aceptado
  significa que Brevo lo recibió, no que ya llegó a la bandeja del destinatario.
- Si se pierde la respuesta, revisar los registros de Brevo antes de reintentar.

## TLS y comprobación

Se usa el puerto 587 con STARTTLS obligatorio y verificación de certificados.
El puerto 465 también admite TLS directo si se configura expresamente.

```powershell
npm run smtp:verify
npm test
```

`smtp:verify` comprueba conexión y autenticación sin enviar un correo. La prueba
del 2026-11-06 falló antes de autenticar: el certificado observado desde la PC
estaba emitido por **Norton Web/Mail Shield Untrusted Root**, no por una CA
pública confiable. No se deshabilitó TLS ni se aceptó esa raíz. Es necesario
resolver la cadena de confianza/inspección SMTP del antivirus para probar el envío.
La cuenta de Brevo también muestra restricción de IPs autorizadas; esa comprobación
queda pendiente porque TLS no permitió llegar a la autenticación. El remitente
debe estar verificado en Brevo.

Actualización 2026-11-06: el usuario exportó `MailShield.der` desde Norton. Se
verificó que es **Norton Web/Mail Shield Root**, no la raíz Untrusted, con huella
SHA-256 `4AD4838B189829E3A683AD59943D861E1BF736DA972E37EAABEF14ABBEB1C4CE`.
Se guardó en `custompage/server/local/` (excluido de Git) y se configuró mediante
`BREVO_SMTP_CA_FILE` en `secret.env`. Nodemailer añade esta CA únicamente a su
conexión SMTP, conserva las raíces públicas y exige validación TLS. No se modificó
la confianza global de Windows ni se desactivó protección del antivirus.
La prueba ya supera TLS; el bloqueo actual de Brevo es **525 5.7.1 Unauthorized
IP address**. Autorizar la IP pública de salida en la cuenta antes de reintentar.

Estado final: el usuario autorizó la IP pública en Brevo, el SMTP aceptó el correo
de prueba y el usuario confirmó su recepción en Gmail. También mostró un reporte
real con fotos incorporadas. Los bloqueos descritos arriba quedan como historial
de diagnóstico. Si cambia la IP pública del hotspot, puede ser necesario autorizar
la nueva dirección. Las pruebas automatizadas usan MIME en memoria y SMTP simulado.

## Firmware

`custompage/web_config.h` define `CUSTOMPAGE_EMBED_WEB_UI 0`: la página y Bootstrap/
SweetAlert2 dejan de formar parte del binario. La ruta `/rostros` de la cámara
indica abrir el servidor local. El ejemplo original permanece en `/`.

Compilación ESP32 2.0.17 con captura de avisos (2026-11-07): **3 038 941 bytes
(96%)**, globals **74 692 bytes (22%)**. La ampliación agrega 740 bytes de flash
y 56 bytes globales respecto del firmware Node.js anterior; las fotos usan RAM
dinámica adicional solo como último recorte. No cambian particiones, resolución
240x240, pines ni datos del padrón. Requiere **Subir** para habilitar la captura
de avisos; no se verificó en la placa durante esta implementación.

Los cambios de la interfaz en modo Node.js solo necesitan recargar el navegador;
no requieren compilar Arduino ni regenerar headers. Para volver a alojarla en el
ESP32 se puede poner la macro en 1, ejecutar `node custompage/build-web.cjs` y
compilar. El envío SMTP seguirá requiriendo Node.js.
