# ESP32-S3-CAM N16R8: ejemplo CameraWebServer

Proyecto nuevo para la placa ESP32-S3 con 16 MB de flash y 8 MB de PSRAM OPI.
Se usa el ejemplo CameraWebServer incluido por Espressif en el paquete de placas
ESP32 para Arduino, versión 2.0.17. Sus algoritmos de detección, reconocimiento,
registro y su interfaz web se conservan. La detección queda activada al arrancar;
el reconocimiento y el registro se controlan desde la página.

## Abrir y compilar

Para descargar este repositorio, conservar el nombre de carpeta que espera Arduino:

```powershell
git clone --branch master https://github.com/hachch1984/arduino-01-camera.git CameraWebServerS3
```

Abrir con **doble clic en `CameraWebServerS3.ino`**, como con la cámara anterior.
El 5 de noviembre de 2026 se configuró también la apertura habitual de Arduino IDE
para usar el paquete ESP32 2.0.17 de `%LOCALAPPDATA%\ArduinoS3Camera\data`.
Los lanzadores `Abrir-Arduino.cmd` y `Abrir-Arduino.ps1` quedan como alternativas
para abrir el mismo proyecto en la IDE habitual; ya no seleccionan otro perfil.

### Versión que debe conservarse

Este proyecto usa **esp32 by Espressif Systems 2.0.17**. Es la versión del paquete
de placas, distinta de la versión del programa Arduino IDE (2.3.10 en esta PC).
El CameraWebServer de ese paquete incluye detección y reconocimiento facial para
ESP32-S3. El proyecto fue comprobado con esa versión y con OPI PSRAM activada.

El 5 de noviembre de 2026 el paquete de la instalación del proyecto apareció
actualizado a **3.3.12** y Arduino mostró la lista de placas vacía. Son dos
observaciones; no se ha demostrado que la actualización causara la lista vacía.
Se reinició Arduino y se restauró 2.0.17 para mantener la configuración comprobada.

Al aparecer el aviso de actualizaciones de placas, elegir **LATER** para conservar
la versión de este proyecto. **INSTALL ALL** puede reemplazarla. Antes de actualizar,
hay que comprobar la compatibilidad de las bibliotecas de detección y reconocimiento.
La versión 3.3.12 no conserva esas funciones en su ejemplo CameraWebServer.

La configuración habitual está en `%USERPROFILE%\.arduinoIDE\arduino-cli.yaml`.
Sus directorios `data` y `downloads` apuntan ahora a `ArduinoS3Camera`; se conservó
la ubicación habitual de los proyectos y una copia de la configuración anterior
junto al YAML, con el sufijo `.before-s3-20261106-043517Z.bak` (hora UTC).
El entorno antiguo de `%LOCALAPPDATA%\Arduino15`, con ESP32 3.3.12, se conserva
en disco. Al comprobar la versión activa importa el directorio que usa la IDE.

Windows puede abrir `Abrir-Arduino.ps1` en el Bloc de notas al hacer doble clic;
es la asociación de archivos del sistema. `Abrir-Arduino.cmd` abre directamente
la IDE, sin modificar esa asociación ni la política de PowerShell.
El `.ps1` queda como alternativa para ejecutarlo desde PowerShell.
El `.cmd` comprueba que exista el paquete 2.0.17 antes de iniciar Arduino.

### Si COM7 está seleccionado y OK está deshabilitado

En **Select Other Board and Port** se eligen dos datos:

1. En **BOARDS**, buscar y seleccionar **ESP32S3 Dev Module**.
2. En **PORTS**, seleccionar **COM7 Serial Port (USB)**.
3. Confirmar que ambos tengan una marca y pulsar **OK**.

Si aparece **NO BOARDS FOUND** incluso con la búsqueda vacía, Arduino no está
mostrando el paquete de placas. Cancelar el diálogo, reiniciar Arduino abriendo el
archivo `.ino` y comprobar en el Gestor de placas que **esp32 by Espressif Systems
2.0.17** esté instalado. COM7 por sí solo no indica a Arduino qué placa compilar.

En Herramientas seleccionar:

- Placa: ESP32S3 Dev Module.
- Flash Size: 16MB (128Mb).
- PSRAM: OPI PSRAM.
- Partition Scheme: 16M Flash (3MB APP/9.9MB FATFS).
- Flash Mode: QIO 80MHz.
- CPU Frequency: 240MHz (WiFi).
- Upload Speed: 921600.
- Core Debug Level: Info (permite ver tiempos de captura y detección).
- Monitor serie: 115200 baudios.
- Puerto: COM7, USB-Enhanced-SERIAL CH343, comprobado el 5 de noviembre de 2026.
  En esta placa corresponde al USB-C derecho de la foto, junto a BOOT.
- USB CDC On Boot: Disabled para leer Serial por el conversor CH343.
- USB Mode: Hardware CDC and JTAG.
- Upload Mode: UART0 / Hardware CDC.

El archivo `partitions.csv` es el incluido en el ejemplo oficial y reserva la
partición `fr` utilizada por su reconocedor para guardar identificadores.

Los pines de cámara coinciden con el perfil `CAMERA_MODEL_ESP32S3_EYE` del ejemplo:
XCLK 15, SCCB SDA 4/SCL 5, VSYNC 6, HREF 7, PCLK 13, D0..D7 = 11,9,8,10,12,18,17,16.
Esto utiliza el perfil de pines; la placa adquirida es una ESP32-S3-CAM N16R8.

## Uso

1. Encender el hotspot del celular en 2.4 GHz con las credenciales configuradas
   en el archivo `.ino`. Esta publicación conserva los valores de Wi-Fi por
   indicación expresa del propietario; para usar otra red, editar `ssid` y `password`.
2. Cargar el programa y abrir el monitor serie a 115200.
3. Comprobar PSRAM, sensor y la dirección mostrada por `Camera Ready!`.
4. Conectar la PC a la misma red y abrir esa dirección por HTTP.
5. Pulsar Start Stream. En modo RGB565 el ejemplo arranca a 240x240. La detección
   debe dibujar recuadros sobre los rostros. Mantener una resolución de ancho
   inferior o igual a 400 píxeles: el ejemplo omite la detección por encima.
6. Para probar reconocimiento, activar Face Recognition y usar Enroll Face con
   la persona de frente y buena iluminación. Seguir los mensajes del ejemplo.

Cambios de configuración respecto al ejemplo: perfil de cámara, credenciales,
calidad JPEG 20, detección inicial activa, inicialización de configuración a cero
y mensajes de diagnóstico de chip, flash, PSRAM y sensor.
Se selecciona la opción RGB565 que el propio ejemplo recomienda para detección y
reconocimiento. Se desactiva el iluminador LED PWM del ejemplo: esta placa tiene
LED RGB y no define un pin de flash LED en el perfil de cámara utilizado.

## Verificación realizada el 5 de noviembre de 2026

- Compilación y carga desde Arduino IDE correctas, con hash verificado.
- ESP32-S3 revisión v0.2, flash de 16 MB, PSRAM disponible de 8.0 MB y sensor
  OV3660 (PID 0x3660), comprobados por el monitor serie en COM7 a 115200.
- Conexión al hotspot en 2.4 GHz y página HTTP en `http://10.150.195.3` correctas.
  La dirección depende del hotspot y puede cambiar en otro arranque.
- Video RGB565 a 240x240, Face Detection activado y Face Recognition desactivado.
- Detección comprobada visualmente: recuadro amarillo y puntos sobre un rostro.
  El monitor serie del ejemplo confirmó `DETECTED`.
- Registro de personas, comparación de identidades y persistencia después de
  reiniciar: todavía no probados en esta placa. Los controles y la partición
  `fr` del ejemplo oficial están incluidos.

Las carpetas anteriores se enviaron a la Papelera desde el Explorador; la memoria
del trabajo previo se conserva en `..\MEMORIA-ESP32-CAM-ANTERIOR.md`.

## Revisión de los proyectos anteriores en la Papelera

El 5 de noviembre de 2026 se leyeron ambas carpetas directamente en la Papelera:

- `CameraWebServer`: servidor de video para AI Thinker ESP32-CAM. Su documento
  registra el paquete 3.3.12 y su `app_httpd.cpp` no contiene el motor de rostros.
- `CameraWebServerRostros`: ejemplo de la etiqueta 1.0.6, compilado después con el
  paquete 2.0.0 del entorno `ArduinoFaceLegacy`. Esto figura tanto en su README
  como en sus scripts. Incluye `fd_forward.h`, `fr_forward.h`, cinco muestras de
  registro, hasta siete identificadores en RAM, `Hello Subject` e `Intruder Alert!`.
  Por cada imagen procesada convierte JPEG a RGB, detecta y opcionalmente reconoce
  el rostro, dibuja el resultado y vuelve a codificar JPEG para transmitirlo.

El usuario confirmó que la prueba anterior funcionaba pero era lenta. El código
confirma el trabajo adicional por imagen; esta revisión no mide sus FPS ni aísla
cuánto tiempo correspondía a reconocimiento, conversión, cámara o Wi-Fi.
Los proyectos anteriores permanecen en la Papelera.

Para la S3 se conserva el ejemplo 2.0.17, cuyo código habilita reconocimiento en
ESP32-S3 y detección con PSRAM. Su reconocedor es distinto del ejemplo antiguo:
usa los modelos `human_face_detect_*` y `face_recognition_112_*`, y la partición
`fr` para sus identificadores. No se trasladó el motor antiguo a la S3.

## Validación de la configuración habitual: 5 de noviembre de 2026

- Al revisar la IDE abierta se encontró el entorno habitual 3.3.12 y ninguna placa
  seleccionada. Se cerró Arduino, se respaldó el YAML y se configuró la apertura
  normal para usar el paquete 2.0.17 ya instalado en `ArduinoS3Camera`.
- Se seleccionaron ESP32S3 Dev Module y COM7 y se corrigieron los valores iniciales
  de flash (4 MB), PSRAM (desactivada) y partición (1.2 MB de aplicación).
  Los valores comprobados son los de la lista de Herramientas anterior.
- Verificar se ejecutó desde Arduino IDE 2.3.10, en la pantalla 1. Terminó sin
  errores: 2 977 453 bytes de programa y 74 404 bytes de variables globales.
- El `build.options.json` generado confirmó `esp32:esp32:esp32s3`, CPU a 240 MHz,
  flash de 16 MB QIO, PSRAM OPI, partición `app3M_fat9M_16MB`, diagnóstico Info,
  USB CDC al arrancar desactivado y las herramientas del paquete 2.0.17.
- El ejecutable compilado incluye símbolos de detección y `run_face_recognition`.
  La comparación del `app_httpd.cpp` con el ejemplo instalado encontró únicamente
  dos cambios: detección activa al inicio e iluminador PWM desactivado.
- Se comprobó que Windows conserva la asociación `.ino` con `ArduinoIDE.ino`.
  No hace falta un lanzador especial para el hardware S3.
- Esta revisión valida el entorno y la compilación. No se volvió a cargar el
  firmware ni se probó de nuevo el registro o la comparación de identidades.

Fuente: https://github.com/espressif/arduino-esp32/tree/2.0.17/libraries/ESP32/examples/Camera/CameraWebServer
