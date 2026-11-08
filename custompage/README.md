# Página de rostros

**Actualización:** la interfaz ahora se aloja en Node.js para liberar flash del
ESP32 y enviar reportes mediante Brevo. Abrir `http://localhost:3000/rostros`.
Consultar [server/README.md](server/README.md) para arranque, `secret.env`, SMTP,
pruebas y limitación TLS pendiente. Los apartados sobre interfaz embebida de este
documento describen el modo anterior/opcional (`CUSTOMPAGE_EMBED_WEB_UI=1`).

La página adicional **http://localhost:3000/body** usa Human en un Web Worker de
Chrome para analizar el video del ESP32, inicialmente Full HD 1920×1080. Sus
archivos, funcionamiento y cambios de captura JPEG se describen en
[body/README.md](body/README.md). Esta página no se empaqueta en el firmware.

## Memoria del avance — 2026-11-06

Se añadió `/rostros` como página independiente de los ajustes originales `/`.
La implementación conserva el reconocedor de Espressif 2.0.17 y lo integra con
una API HTTP para registrar un nombre, recortar la foto del cuadro usado para
el alta, listar personas y eliminar su registro. Los recursos web se mantienen
en `custompage`, con JavaScript mediante arrow functions y CSS separado.

Se incorporaron Bootstrap local, confirmación de eliminación con SweetAlert2,
spinner durante el registro, limpieza del campo de nombre al aceptar el alta,
barra de cupos ocupados y aviso azul en `feedback` mientras se registra.
Los recursos se empaquetan con `node custompage/build-web.cjs` antes de compilar.

Se probó QCIF 176x144 a petición del usuario, quien informó un fallo al iniciar
video. Se restauró **240x240**; la causa de ese fallo no se diagnosticó. Conservar
este valor como punto de partida para futuras pruebas de rendimiento.

El usuario confirmó que la página funciona. La última compilación fue correcta
y las pruebas de navegador con cámara simulada pasaron; estas últimas no validan
la persistencia física ni el reconocimiento real. No confundir **Subir** con
iniciar depuración: la carga ejecuta el firmware y el video se inicia en la web.

Ampliación del CameraWebServer de Espressif 2.0.17 para esta ESP32-S3-CAM N16R8.
Se conserva el algoritmo de reconocimiento incluido en ese paquete.

## Interfaz de padrón, reconocimiento y eventos

- Arriba: cámara en vivo y panel de reconocimiento. El panel muestra el nombre
  y la foto **empadronada** por ID; para un desconocido solo muestra **Intruso**.
  Sin rostro reciente, con video detenido o sin conexión, se limpia ese panel.
- Abajo: padrón con formulario, lista vertical y capacidad; eventos con checkbox,
  botón Limpiar, lista de capturas y espacio para varios correos. Enviar reporte
  usa el servidor Node.js y se habilita cuando existen eventos.
- La sección de emociones se retiró por petición del usuario. El reconocedor
  instalado no incluye clasificación de expresiones ni confianza de emociones.
- Registrar eventos está desmarcado inicialmente. Con video iniciado, la página
  renueva una solicitud de captura consultando `/api/rostros?record=1&after=N`.
  El firmware recorta el mismo cuadro sin anotaciones usado por el reconocedor,
  guarda temporalmente su JPEG en base64 junto al nombre o Intruso y lo devuelve
  con un número de secuencia y su antigüedad en milisegundos. No se reutiliza la
  foto del padrón como si fuera una captura nueva.
- Antes de capturar se esperan tres segundos de detecciones con un solo rostro
  y el mismo resultado de reconocimiento. La espera se reinicia si no hay rostro,
  aparecen varios, cambia el ID o pasan más de 2.5 segundos sin observaciones.
  No se usa delay: el video sigue procesándose. Si la persona permanece, se
  genera otra captura después de otros tres segundos. Los desconocidos comparten
  el resultado Intruso: no se distinguen identidades entre personas sin registrar.
  La
  autorización temporal de captura vence a los seis segundos sin consultas de
  registro; la página deja de agregar eventos inmediatamente al desmarcar.
- Se deduplican las secuencias y se ignoran respuestas en vuelo después de
  desmarcar, detener el video o limpiar. Limpiar borra la lista de esta pestaña;
  si el checkbox sigue activo se incorporarán las siguientes capturas nuevas.
- Los últimos 50 eventos viven en la memoria de la pestaña, sin escrituras a
  flash. Se pierden al recargar o cerrar. No es una bitácora continua sin navegador:
  si se interrumpe la conexión pueden omitirse capturas. Cada pestaña tiene su lista.
- La fecha se estima con el reloj del navegador menos la antigüedad de la captura
  y se presenta con `Intl.DateTimeFormat`, zona `America/Lima`. Configurar bien el
  reloj de la PC; no depende de que la zona local del navegador sea Perú.

## Archivos

- `rostros.html`: estructura en español y clases Bootstrap; sin CSS ni JS inline.
- `rostros.js`: interacción mediante arrow functions y API de la cámara.
- `rostros.css`: estilos propios, separados del HTML.
- `vendor/bootstrap.min.css`: Bootstrap **5.3.8**, descargado de la distribución
  indicada en https://getbootstrap.com/docs/5.3/getting-started/download/.
- `vendor/BOOTSTRAP-LICENSE.txt`: licencia MIT de Bootstrap.
- `vendor/sweetalert2.min.js`, `vendor/sweetalert2.min.css`: SweetAlert2 **11.26.25**,
  descargado de su distribución npm/jsDelivr; licencia en `vendor/SWEETALERT2-LICENSE.txt`.
- `rostros_backend.h`: rutas HTTP, registro, fotos, nombres y eliminación.
- `build-web.cjs`: empaquetado gzip de los archivos; solo requiere Node.js.
- `rostros_assets.h`, `stock_index_assets.h`: recursos generados incluidos en el
  firmware. No hay que subir archivos mediante un plugin de filesystem.
- `test-ui.cjs`: pruebas de interfaz con navegador y cámara simulada.

Bootstrap se sirve desde el ESP32. No usa CDN en tiempo de ejecución, fuentes
externas ni JavaScript de Bootstrap; los controles usan el JS propio de la página.
SweetAlert2 también se sirve localmente. El botón Eliminar abre una confirmación
con **Cancelar / Sí, eliminar** y muestra un aviso cuando la cámara confirma la
eliminación. Los nombres se muestran como texto dentro de los cuadros de diálogo.

Junto a **Registrar rostro** aparece un spinner Bootstrap durante el envío y
mientras el registro está pendiente en la cámara. Se oculta al completar,
cancelar o finalizar con error. El nombre se limpia al aceptar la solicitud.
El aviso `feedback` muestra «Registrando rostro…» en azul al pulsar el botón
y mientras el registro está pendiente; después muestra el resultado o el error.

La barra junto al contador representa **cupos de rostros ocupados**, no bytes de
memoria: `2 / 7` equivale a aproximadamente **29 %**. Se actualiza al registrar o
eliminar; al llegar a siete registros se muestra en rojo y el registro se bloquea.

Después de editar HTML, JS o CSS, ejecutar desde la carpeta del proyecto:

```powershell
node custompage/build-web.cjs
```

El generador conserva las tres páginas oficiales de ajustes y añade un enlace
a `/rostros`. El archivo original `camera_index.h` permanece como fuente.

## Uso y prueba en la placa

1. Abrir `CameraWebServerS3.ino`; conservar **esp32 2.0.17**, **ESP32S3 Dev Module**,
   **16 MB**, **OPI PSRAM** y **16M Flash (3MB APP/9.9MB FATFS)**. Mantener
   **Erase All Flash Before Sketch Upload: Disabled**.
2. Subir el proyecto completo desde Arduino. La carga incluye el nuevo
   `partitions.csv`. No hace falta pulsar Iniciar depuración.
3. Con el hotspot en 2.4 GHz, leer la IP en el Monitor serie a 115200.
4. Abrir `http://IP/rostros` e iniciar video. Usar 240x240 (valor inicial) o QVGA;
   las resoluciones mayores no sirven para este flujo de reconocimiento.
5. Escribir el nombre y pulsar **Registrar rostro**. Mirar de frente con buena
   iluminación; debe haber un solo rostro. Hay 30 segundos para completar el
   registro y un botón para cancelarlo. Cada solicitud registra una sola vez.
6. Comprobar foto y nombre en la galería. La foto es un recorte, sin recuadros
   dibujados, del mismo cuadro usado para registrar el rostro.
7. Detener/iniciar video y comprobar reconocimiento, nombre y mensaje de intruso
   con una persona distinta. Un rostro que ya coincide con un registro no se
   vuelve a registrar: se informa la coincidencia existente.
8. Reiniciar con EN/RST y volver a abrir la página: comprobar nombre, foto y
   reconocimiento. Esta es la prueba pendiente de persistencia en hardware.
9. Probar **Eliminar**: cancelar primero la confirmación y comprobar que conserva
   el registro; después aceptar y comprobar que desaparece, se libera espacio y
   ese rostro queda no reconocido salvo que coincida con otro registro existente.
10. Reiniciar de nuevo para comprobar la eliminación permanente. Registrar otra
    persona para verificar reutilización de espacios y asociación correcta de foto.

La galería admite los **7 registros** del ejemplo. Los registros anteriores se
enumeran como `Persona #ID` y «Sin foto» si no tienen metadatos; eliminarlos y
registrarlos nuevamente permite añadirles nombre y foto. Se aceptan nombres de
hasta 40 caracteres en la interfaz y 64 bytes UTF-8. El texto web conserva tildes;
en el video, la fuente ASCII del ejemplo muestra el ID cuando el nombre tiene
tildes o supera 16 caracteres.

Abrir un solo video a la vez y cerrar el de la página original antes de iniciar
otro. El enlace entre páginas detiene el video de `/rostros` al salir. El ejemplo
original conserva sus controles; su botón de registro ahora registra una sola
persona por solicitud, con nombre genérico «Persona» y fotografía.

## Guardado y coordinación

- `fr` conserva las características faciales en su dirección original
  **0x3e0000**, tamaño **0x20000**. No se modifica el formato del reconocedor.
- La nueva partición `faces`, **0x400000**, tamaño **0x100000**, usa LittleFS para
  `/face-ID.txt` y `/face-ID.jpg`. Los nombres también se mantienen en RAM para
  no leer flash por cada cuadro reconocido.
- Solo se formatea una partición nueva completamente borrada (todos los bytes
  0xFF). Un fallo al montar una partición existente se informa sin formatearla.
- El registro guarda foto y nombre antes de confirmar las características en
  flash. Los fallos normales de escritura eliminan los archivos incompletos y
  revierten el alta en memoria. No se ha probado recuperación ante un corte de
  alimentación durante una escritura entre ambas particiones.
- Un mutex coordina el reconocedor, la galería y la eliminación con el servidor
  de video. Durante un registro pendiente se bloquea la eliminación.
- Eliminar actualiza el reconocedor en flash y después elimina foto y nombre.
  La galería solo enumera IDs que siguen registrados en el reconocedor.

## Rutas

| Método | Ruta | Uso |
|---|---|---|
| GET | `/` | Ajustes originales, con enlace a la galería |
| GET | `/rostros` | Página nueva |
| GET | `/rostros/app.js`, `/rostros/rostros.css`, `/rostros/bootstrap.min.css`, `/rostros/sweetalert2.min.js`, `/rostros/sweetalert2.min.css` | Recursos locales gzip |
| GET | `/api/rostros` | Personas, estado y resultado del registro |
| GET | `/api/rostros/foto?id=ID` | Foto de una persona registrada |
| POST | `/api/rostros/iniciar` | Habilitar detección y reconocimiento |
| POST | `/api/rostros/registrar` | JSON `{"name":"Henry"}`; esperar un rostro |
| POST | `/api/rostros/cancelar` | Cancelar el registro pendiente |
| POST | `/api/rostros/eliminar` | JSON `{"id":0}`; eliminar ese registro |

El video usa el `/stream` del ejemplo en el puerto HTTP siguiente (normalmente
81). El navegador consulta el estado cada 1.8 segundos. Los mensajes de error se
muestran en la página y los nombres se insertan como texto, sin interpretar HTML.

## Validación del desarrollo

Compilación con el CLI de Arduino IDE y el paquete 2.0.17, con resolución inicial
240x240: **3 095 549 bytes
(98 % de 3 145 728)**; variables globales **74 604 bytes (22 %)**. Se conservaron
la configuración de placa y el espacio de aplicación; el margen restante es
reducido para futuras ampliaciones.

Pruebas de interfaz aprobadas en Chrome con API simulada: recursos locales,
registro/cancelación, nombres con contenido HTML tratados como texto, confirmación
de eliminación (cancelar y aceptar), límite de siete registros, fallos HTTP,
desconexión y diseño móvil sin desbordamiento horizontal. Se inspeccionaron
capturas de escritorio y móvil. También se comprobó el binario de particiones:
`fr` mantiene offset/tamaño y `faces` no se solapa con las particiones existentes.
La ampliación de interfaz pasó además las pruebas de spinner durante envío y
espera, limpieza del nombre, confirmación/cancelación y aviso de éxito con
SweetAlert2, y barra de capacidad con 2/7 y 7/7 registros.
La reorganización pasó pruebas de nombre/foto por ID, Intruso sin foto del padrón,
limpieza del panel sin rostro, captura de eventos conocidos/desconocidos,
deduplicación, pausa al desmarcar y limpieza sin reaparecer el evento anterior.
La fecha se verificó en America/Lima usando un navegador configurado en Asia/Tokyo.
La nueva captura de eventos en firmware requiere prueba real después de Subir.

Las pruebas de navegador usan respuestas simuladas: no prueban el detector,
la escritura física de flash ni la calidad de reconocimiento. Para ejecutarlas,
instalar Playwright en un entorno de desarrollo y ejecutar `node custompage/test-ui.cjs`.
`PLAYWRIGHT_MODULE` permite indicar su carpeta si está instalado fuera del
proyecto; `CHROME_PATH` permite indicar el ejecutable de Chrome. Opcionalmente,
`UI_SCREENSHOT_DIR` guarda capturas del diseño de escritorio y móvil.

El usuario confirmó el funcionamiento de la página en la placa. Las pruebas de
hardware detalladas arriba no se han verificado de forma independiente; la carga
y comprobación de los últimos ajustes quedan a cargo del usuario.
