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

## Reporte

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

Compilación ESP32 2.0.17 correcta: **3 038 201 bytes (96%)**, globals **74 636 bytes
(22%)**. Frente a 3 095 813 bytes se liberaron **57 612 bytes** de flash. No cambian
particiones, resolución 240x240, pines ni datos del padrón. Para aplicar esta
reducción hay que subir el firmware; Node.js también puede usar el firmware
anterior que ya dispone de la API de eventos.

Los cambios de la interfaz en modo Node.js solo necesitan recargar el navegador;
no requieren compilar Arduino ni regenerar headers. Para volver a alojarla en el
ESP32 se puede poner la macro en 1, ejecutar `node custompage/build-web.cjs` y
compilar. El envío SMTP seguirá requiriendo Node.js.
