@echo off
cd /d "%~dp0"
if not exist node_modules\nodemailer (
  echo Ejecuta npm ci en esta carpeta antes de iniciar.
  pause
  exit /b 1
)
echo Abre http://localhost:3000/rostros en el navegador.
call npm start
pause
