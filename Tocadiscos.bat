@echo off
chcp 65001 >nul
title Tocadiscos
rem Abre el Tocadiscos con doble clic: arranca el servidor local y abre el navegador.
rem Usa siempre la direccion http://localhost:5173 porque la coleccion de vinilos
rem se guarda en el navegador ligada a esa direccion.
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 goto sin_node

if exist node_modules goto arrancar
echo Preparando el tocadiscos por primera vez. Tarda un minuto...
call npm install
if errorlevel 1 goto error_instalar

:arrancar
echo.
echo  El tocadiscos se abre en el navegador.
echo  Deja esta ventana abierta mientras lo usas. Para apagarlo, ciérrala.
echo.
call npm run dev -- --port 5173 --strictPort --open
if not errorlevel 1 goto fin
rem Si el puerto ya estaba ocupado, lo normal es que el tocadiscos ya este en marcha.
echo.
echo  Parece que ya estaba en marcha: se abre en el navegador.
start "" http://localhost:5173/
timeout /t 5 >nul
goto fin

:sin_node
echo  Falta Node.js. Instala la versión LTS desde https://nodejs.org y vuelve a abrir este archivo.
pause
goto fin

:error_instalar
echo  No se pudieron instalar las dependencias. Revisa la conexión a internet y vuelve a intentarlo.
pause

:fin
