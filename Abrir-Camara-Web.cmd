@echo off
if /i "%~1"=="--console" goto console
start "Camara ESP32 - Servidor web" "%ComSpec%" /d /k ""%~f0" --console"
exit /b

:console
title Camara ESP32 - Servidor web
cd /d "%~dp0"
if not exist node_modules\nodemailer (
  echo Ejecuta npm ci en esta carpeta antes de iniciar.
  pause
  exit /b 1
)
if not exist node_modules\@vladmandic\human (
  echo Ejecuta npm ci en esta carpeta para instalar Human antes de iniciar.
  pause
  exit /b 1
)
echo Abre http://localhost:3000/rostros en el navegador.
echo Para analisis corporal en la PC: http://localhost:3000/body
echo Mantiene esta ventana abierta mientras el servidor esta funcionando.
echo Para detenerlo pulsa Ctrl+C o cierra esta ventana.
node custompage/server/index.cjs
echo.
echo El proceso Node.js termino. Esta consola permanece abierta.
pause
