@echo off
setlocal
if not exist "%USERPROFILE%\ArduinoS3Camera\data\packages\esp32\hardware\esp32\2.0.17\boards.txt" (
  echo Falta el paquete ESP32 2.0.17 de este proyecto.
  echo Consulta la seccion de versiones en README.md antes de continuar.
  pause
  exit /b 1
)
if not exist "%LOCALAPPDATA%\Programs\arduino-ide\Arduino IDE.exe" (
  echo No se encontro Arduino IDE en la ruta configurada.
  pause
  exit /b 1
)
start "" "%LOCALAPPDATA%\Programs\arduino-ide\Arduino IDE.exe" "%~dp0CameraWebServerS3.ino"
endlocal
